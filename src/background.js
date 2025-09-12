// background.js - service worker (module)
// src/background.js
import { deriveKey, encryptJson, decryptJson, exportRawKey, importRawKey } from "./crypto.js";
import * as DB from "./db.js";
import { generatePassword } from "./password.js";


const DEFAULT_SETTINGS = {
  theme: "dark",
  autoLockMinutes: 15,
  clipboardTimeoutSec: 30,
  showPasswordStrength: true,
  biometricUnlock: false,
  keepUnlocked: false
};

let unlocked = false;
let key = null;                 // CryptoKey in memory
let saltB64 = null;             // salt from vault
let vault = null;               // decrypted vault object
let lockTimer = null;
let sessionExpiresAt = null;    // in ms since epoch if persisted

const SESSION_STORAGE_NAME = "sv_session";        // { keyB64, expiresAt }
const PENDING_SETTINGS_KEY = "sv_pending_settings";

// ———————————— Helpers ————————————
async function persist() {
  if (!key || !vault) {
    console.debug("persist: skipping (no key or vault)");
    return;
  }
  try {
    const payload = await encryptJson(vault, key);
    const stored = { ...payload, saltB64, version: 1 };
    console.debug("persist: saving vault", { credentialsCount: vault.credentials?.length || 0 });
    await DB.saveEncryptedVault(stored);
    console.info("persist: saved vault OK", { credentialsCount: vault.credentials?.length || 0 });
  } catch (err) {
    console.error("persist: failed", err);
    try { await chrome.storage.local.set({ sv_last_persist_error: String(err) }); } catch {}
    throw err;
  }
}

async function saveSessionKey(keyB64, expiresAtMs) {
  try {
    await chrome.storage.local.set({ [SESSION_STORAGE_NAME]: { keyB64, expiresAt: expiresAtMs } });
    sessionExpiresAt = expiresAtMs;
    scheduleAutoLock(); // ensure lock scheduled to expireAt
    console.info("saveSessionKey: stored session, expiresAt:", new Date(expiresAtMs).toISOString());
  } catch (e) {
    console.warn("saveSessionKey: failed to save session", e);
  }
}

async function clearSessionKey() {
  try {
    await chrome.storage.local.remove(SESSION_STORAGE_NAME);
  } catch (e) {}
  sessionExpiresAt = null;
  scheduleAutoLock();
  console.info("clearSessionKey: cleared");
}

async function tryRestoreSession(record) {
  try {
    const res = await chrome.storage.local.get(SESSION_STORAGE_NAME);
    const session = res && res[SESSION_STORAGE_NAME];
    if (!session) return false;
    if (!session.expiresAt || session.expiresAt <= Date.now()) {
      // expired
      await chrome.storage.local.remove(SESSION_STORAGE_NAME).catch(()=>{});
      console.info("tryRestoreSession: found session but expired");
      return false;
    }
    const imported = await importRawKey(session.keyB64);
    // decrypt to verify
    const plain = await decryptJson({ ivB64: record.ivB64, cipherB64: record.cipherB64 }, imported);
    // success: set unlocked state
    key = imported;
    vault = plain;
    unlocked = true;
    vault.settings = vault.settings || { ...DEFAULT_SETTINGS };
    sessionExpiresAt = session.expiresAt;
    console.info("tryRestoreSession: restored session, expires at", new Date(session.expiresAt).toISOString());
    scheduleAutoLock();
    return true;
  } catch (e) {
    console.warn("tryRestoreSession: failed to restore session", e);
    try { await chrome.storage.local.remove(SESSION_STORAGE_NAME); } catch {}
    sessionExpiresAt = null;
    return false;
  }
}

async function applyPendingSettingsIfAny() {
  try {
    const res = await chrome.storage.local.get(PENDING_SETTINGS_KEY);
    const pending = res && res[PENDING_SETTINGS_KEY];
    if (!pending) return;
    vault.settings = vault.settings || { ...DEFAULT_SETTINGS };
    vault.settings = { ...vault.settings, ...pending };
    await persist();
    await chrome.storage.local.remove(PENDING_SETTINGS_KEY).catch(()=>{});
    console.info("applyPendingSettingsIfAny: applied pending settings", pending);
  } catch (e) {
    console.warn("applyPendingSettingsIfAny failed", e);
  }
}

// ———————————— Init / load ————————————
async function loadOrInit() {
  try {
    const record = await DB.loadEncryptedVault();

    if (!record) {
      // No existing vault on first install — require explicit setup by the user.
      // Keep everything locked and unset; popup will trigger the setup flow.
      saltB64 = null;
      vault = null;
      key = null;
      unlocked = false;
      console.log("SecureVault: no vault found — setup required");
      return;
    }

    // Existing vault found: store salt for later key derivation, but keep locked
    saltB64 = record.saltB64 || null;
    vault = null;
    key = null;
    unlocked = false;
    console.log("SecureVault: existing vault detected (salt loaded)");

    // Attempt to restore session if helper exists (e.g. session persisted in memory/other storage)
    if (typeof tryRestoreSession === "function") {
      try {
        const restored = await tryRestoreSession(record);
        if (restored) {
          console.log("SecureVault: session restored");
          // If there is any pending settings/application step, run it if available
          if (typeof applyPendingSettingsIfAny === "function") {
            try {
              await applyPendingSettingsIfAny();
            } catch (err) {
              console.warn("applyPendingSettingsIfAny failed:", err);
            }
          }
        } else {
          console.log("SecureVault: no session to restore — remaining locked");
        }
      } catch (err) {
        console.warn("tryRestoreSession error (continuing locked):", err);
      }
    } else {
      // No session restore helper provided — stay locked (normal behavior)
      console.log("SecureVault: session restore not configured — remaining locked");
    }
  } catch (err) {
    // If anything goes terribly wrong reading DB, ensure we fail closed (locked) and log the error
    console.error("SecureVault: loadOrInit failed:", err);
    saltB64 = null;
    vault = null;
    key = null;
    unlocked = false;
  }
}

loadOrInit();


// ———————————— Auto-lock scheduling ————————————
function scheduleAutoLock() {
  // clear previous
  if (lockTimer) {
    clearTimeout(lockTimer);
    lockTimer = null;
  }

  if (!unlocked) return;

  // If there is a persisted session expiresAt, lock at that exact time
  if (sessionExpiresAt && sessionExpiresAt > Date.now()) {
    const ms = sessionExpiresAt - Date.now();
    lockTimer = setTimeout(() => {
      // expire session lock
      lock().catch(()=>{});
    }, ms);
    console.info("scheduleAutoLock: scheduled session expiry in ms:", ms);
    return;
  }

  // Otherwise schedule based on vault.settings.autoLockMinutes
  const minutes = (vault?.settings?.autoLockMinutes ?? DEFAULT_SETTINGS.autoLockMinutes);
  if (typeof minutes !== "number" || minutes <= 0) {
    console.info("scheduleAutoLock: auto-lock disabled (minutes)", minutes);
    return; // no auto-lock
  }
  const ms = minutes * 60 * 1000;
  lockTimer = setTimeout(() => {
    lock().catch(()=>{});
  }, ms);
  console.info("scheduleAutoLock: scheduled auto-lock in minutes:", minutes);
}

function recordActivity() {
  if (unlocked) scheduleAutoLock();
}

// ———————————— Lock / Unlock ————————————
async function lock() {
  unlocked = false;
  key = null;
  vault = null;
  if (lockTimer) { clearTimeout(lockTimer); lockTimer = null; }
  sessionExpiresAt = null;
  // clear persisted session (it either expired or user locked)
  try { await chrome.storage.local.remove(SESSION_STORAGE_NAME); } catch (e) {}
  chrome.runtime.sendMessage({ type: "LOCKED" }).catch(()=>{});
  console.info("lock: vault locked");
}

async function unlockWithPassword(masterPassword, persistSession = false) {
  // persistSession true => derived key extractable already handled in deriveKey call
  const { key: derivedKey } = await deriveKey(masterPassword, saltB64, undefined, persistSession);
  const record = await DB.loadEncryptedVault();
  try {
    const plain = await decryptJson({ ivB64: record.ivB64, cipherB64: record.cipherB64 }, derivedKey);
    unlocked = true;
    key = derivedKey;
    vault = plain;
    vault.settings = vault.settings || { ...DEFAULT_SETTINGS };
    // apply pending settings if any (user may have changed in options while locked)
    await applyPendingSettingsIfAny();
    // schedule auto-lock or session expiry
    if (persistSession) {
      // export key and save session with expiry = now + autoLockMinutes
      try {
        const exported = await exportRawKey(derivedKey);
        const minutes = vault.settings.autoLockMinutes ?? DEFAULT_SETTINGS.autoLockMinutes;
        const expiresAt = Date.now() + ((typeof minutes === "number" && minutes > 0) ? minutes * 60 * 1000 : 0);
        if (expiresAt > Date.now()) {
          await saveSessionKey(exported, expiresAt);
        } else {
          // no expiry calculated (minutes 0) => don't save session
          await clearSessionKey();
        }
      } catch (e) {
        console.warn("unlockWithPassword: exporting session key failed", e);
      }
    } else {
      await clearSessionKey();
    }
    scheduleAutoLock();
    return { ok: true, vault: { credentials: vault.credentials.length, settings: vault.settings } };
  } catch (e) {
    console.warn("unlockWithPassword: invalid master password or decrypt failed", e);
    return { ok: false, error: "Invalid master password" };
  }
}

// ———————————— Clipboard via offscreen ————————————
async function ensureOffscreen() {
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["CLIPBOARD"],
      justification: "Copy password to clipboard and clear after timeout."
    });
  } catch (e) {
    if (!e.message.includes("already exists")) throw e;
  }
}

async function copyToClipboard(text) {
  await ensureOffscreen();
  const timeout = vault?.settings?.clipboardTimeoutSec ?? DEFAULT_SETTINGS.clipboardTimeoutSec;
  // forward to offscreen (offscreen listens for {type: "copy"})
  await chrome.runtime.sendMessage({ type: "copy", text, timeout }).catch(() => {});
}


// ———————————— Context menu & alarms ————————————
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "sv-generate-password",
    title: "SecureVault: Generate Password",
    contexts: ["editable"]
  });
  chrome.alarms.create("sv-security-maintenance", { periodInMinutes: 60 });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "sv-generate-password") {
    const pwd = generatePassword({ length: 20, symbol: true, upper: true, lower: true, number: true });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (value) => {
        const el = document.activeElement;
        if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) {
          el.value = value;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
      },
      args: [pwd]
    });
    if (unlocked) await copyToClipboard(pwd);
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "sv-security-maintenance") {
    if (unlocked) recordActivity();
  }
});

// ———————————— Messaging ————————————
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case "PING":
          sendResponse({ alive: true, unlocked, sessionExpiresAt });
          break;

        case "UNLOCK":
          sendResponse(await unlockWithPassword(msg.master, !!msg.persist));
          break;

        case "LOCK":
          await lock();
          sendResponse({ ok: true });
          break;

        case "GET_STATE":
          // include sessionExpiresAt so popup can show timer
          const needsSetup = !saltB64;
          sendResponse({needsSetup, unlocked, counts: { credentials: vault?.credentials?.length || 0 }, sessionExpiresAt, settings: vault?.settings || DEFAULT_SETTINGS });
          break;

        case "LIST":
          if (!unlocked) return sendResponse({ ok: false, error: "locked" });
          recordActivity();
          sendResponse({ ok: true, credentials: vault.credentials });
          break;

        case "UPSERT":
          if (!unlocked) return sendResponse({ ok: false, error: "locked" });
          recordActivity();
          {
            try {
              const now = Date.now();
              const item = { ...msg.item };
              if (!item.id) item.id = crypto.randomUUID();
              const idx = vault.credentials.findIndex(c => c.id === item.id);
              const base = { siteName: "", username: "", password: "", url: "", type: "login", createdAt: now, updatedAt: now, lastUsed: null, favorite: false };
              const merged = { ...base, ...item, updatedAt: now };
              if (idx >= 0) vault.credentials[idx] = merged; else vault.credentials.unshift(merged);
              console.debug("UPSERT: merged credential", { id: merged.id, site: merged.siteName });
              await persist();
              console.info("UPSERT: persisted credential", { id: merged.id });
              sendResponse({ ok: true, id: merged.id });
            } catch (err) {
              console.error("UPSERT: failed", err);
              sendResponse({ ok: false, error: "persist_failed", detail: String(err) });
            }
          }
          break;

        case "DELETE":
          if (!unlocked) return sendResponse({ ok: false, error: "locked" });
          recordActivity();
          vault.credentials = vault.credentials.filter(c => c.id !== msg.id);
          await persist();
          sendResponse({ ok: true });
          break;

        case "COPY":
          if (!unlocked) return sendResponse({ ok: false, error: "locked" });
          {
            const item = vault.credentials.find(c => c.id === msg.id);
            if (item) {
              await copyToClipboard(item.password);
              item.lastUsed = Date.now();
              await persist();
              sendResponse({ ok: true });
            } else sendResponse({ ok: false });
          }
          break;
        
        case "MARK_USED":
          if (!unlocked) return sendResponse({ ok: false, error: "locked" });
          {
            const id = msg.id;
            const item = vault.credentials.find(c => c.id === id);
            if (item) {
              item.lastUsed = Date.now();
              await persist();
              sendResponse({ ok: true });
            } else sendResponse({ ok: false });
          }
          break;

        case "SEARCH_FOR_URL":
          if (!unlocked) return sendResponse({ ok: false, error: "locked" });
          recordActivity();
          {
            const urlStr = msg.url || "";
            let host = "";
            try { host = new URL(urlStr).hostname.replace(/^www\./i, "").toLowerCase(); } catch (e) { host = ""; }
            const match = vault.credentials.find(c => {
              if (c.url) {
                try {
                  const cHost = new URL(c.url).hostname.replace(/^www\./i, "").toLowerCase();
                  if (cHost && cHost === host) return true;
                } catch (e) {}
              }
              if (c.siteName && host && c.siteName.toLowerCase().includes(host)) return true;
              return false;
            });
            sendResponse({ ok: true, credential: match || null });
          }
          break;

        case "SETTINGS_GET":
          sendResponse({ ok: true, settings: vault?.settings || DEFAULT_SETTINGS, unlocked });
          break;

        case "SETTINGS_SAVE":
          {
            const newSettings = msg.settings || {};
            // if unlocked: apply immediately to vault.settings
            if (unlocked && vault) {
              vault.settings = { ...vault.settings, ...newSettings };
              await persist();
              // if keepUnlocked true and a session exists (or persist requested), update session expiry
              if (vault.settings.keepUnlocked && key) {
                try {
                  const exported = await exportRawKey(key);
                  // compute new expiresAt based on updated autoLockMinutes
                  const minutes = vault.settings.autoLockMinutes ?? DEFAULT_SETTINGS.autoLockMinutes;
                  const expiresAt = (typeof minutes === "number" && minutes > 0) ? (Date.now() + minutes * 60 * 1000) : 0;
                  if (expiresAt > Date.now()) {
                    await saveSessionKey(exported, expiresAt);
                  } else {
                    await clearSessionKey();
                  }
                } catch (e) {
                  console.warn("SETTINGS_SAVE: couldn't update session expiry", e);
                }
              } else {
                // If keepUnlocked disabled, clear persisted session
                if (!vault.settings.keepUnlocked) await clearSessionKey();
              }
              scheduleAutoLock();
              sendResponse({ ok: true });
            } else {
              // locked: save pending settings to apply after unlock
              try {
                await chrome.storage.local.set({ [PENDING_SETTINGS_KEY]: newSettings });
                sendResponse({ ok: true, pending: true });
                console.info("SETTINGS_SAVE: saved pending settings (will apply on next unlock)", newSettings);
              } catch (e) {
                console.error("SETTINGS_SAVE: failed to save pending settings", e);
                sendResponse({ ok: false, error: "save_failed" });
              }
            }
          }
          break;

        case "GENERATE":
          sendResponse({ ok: true, value: generatePassword(msg.options || {}) });
          break;

        case "SESSION_SET":
          // toggle keepUnlocked preference (if unlocked apply immediately, else save flag as pending)
          {
            const val = !!msg.value;
            if (unlocked && vault) {
              vault.settings = vault.settings || { ...DEFAULT_SETTINGS };
              vault.settings.keepUnlocked = val;
              await persist();
              if (!val) {
                await clearSessionKey();
              } else {
                try {
                  const exported = await exportRawKey(key);
                  const minutes = vault.settings.autoLockMinutes ?? DEFAULT_SETTINGS.autoLockMinutes;
                  const expiresAt = (typeof minutes === "number" && minutes > 0) ? (Date.now() + minutes * 60 * 1000) : 0;
                  if (expiresAt > Date.now()) await saveSessionKey(exported, expiresAt);
                } catch (e) { console.warn("SESSION_SET: failed to create session key", e); }
              }
              scheduleAutoLock();
              sendResponse({ ok: true });
            } else {
              // store pending flag
              try {
                await chrome.storage.local.set({ sv_keepUnlocked_flag: val });
                sendResponse({ ok: true });
              } catch (e) { sendResponse({ ok: false }); }
            }
          }
          break;

        case "SESSION_GET":
          {
            const sflag = (vault && vault.settings && !!vault.settings.keepUnlocked) ? !!vault.settings.keepUnlocked : (await chrome.storage.local.get("sv_keepUnlocked_flag"))?.sv_keepUnlocked_flag || false;
            // include sessionExpiresAt if present
            sendResponse({ ok: true, value: sflag, sessionExpiresAt });
          }
          break;

        case "SET_MASTER":
        {
          try {
            const master = msg.master;
            if (!master || master.length < 8) return sendResponse({ ok: false, error: "invalid_password" });
            const derived = await deriveKey(master);
            key = derived.key;
            saltB64 = derived.saltB64;
            vault = { credentials: [], settings: { ...DEFAULT_SETTINGS } };
            const payload = await encryptJson(vault, key);
            await DB.saveEncryptedVault({ ...payload, saltB64, version: 1, kdf: "PBKDF2", iterations: 310000 });
            unlocked = true;
            scheduleAutoLock();
            sendResponse({ ok: true });
          } catch {
            sendResponse({ ok: false, error: "failed" });
          }
        }
        break;

        case "COPY_PASSWORD_TO_CLIPBOARD_ON_DEMAND":
          try {
            if (!msg.text) return sendResponse({ ok: false });
            await copyToClipboard(msg.text);
            sendResponse({ ok: true });
          } catch (e) {
            sendResponse({ ok: false, error: "copy_failed" });
          }
          break;

        case "OPEN_POPUP":
          try {
            if (chrome.action && chrome.action.openPopup) {
              chrome.action.openPopup().catch(() => {});
              sendResponse({ ok: true });
            } else {
              sendResponse({ ok: false, error: "popup_not_supported" });
            }
          } catch (e) {
            sendResponse({ ok: false, error: "failed" });
          }
          break;

        default:
          sendResponse({ ok: false, error: "unknown_message" });
      }
    } catch (err) {
      console.error("onMessage: unexpected error", err);
      sendResponse({ ok: false, error: "unexpected" });
    }
  })();
  return true;
});
