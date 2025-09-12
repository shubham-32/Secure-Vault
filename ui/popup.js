// popup.js
import { scorePassword } from "../src/password.js";

const els = {
  lockedView: document.getElementById("lockedView"),
  vaultView: document.getElementById("vaultView"),
  editor: document.getElementById("editor"),

  // setup / unlock (setup elements may be present in modified popup.html)
  setupBlock: document.getElementById("setupBlock"),
  masterSetInput: document.getElementById("masterSetInput"),
  masterConfirm: document.getElementById("masterConfirm"),
  setMasterBtn: document.getElementById("setMasterBtn"),
  setupMsg: document.getElementById("setupMsg"),

  masterInput: document.getElementById("masterInput"),
  toggleMaster: document.getElementById("toggleMaster"),
  unlockBtn: document.getElementById("unlockBtn"),

  addBtn: document.getElementById("addBtn"),
  settingsBtn: document.getElementById("settingsBtn"),
  searchInput: document.getElementById("searchInput"),
  list: document.getElementById("list"),
  empty: document.getElementById("empty"),
  bigAdd: document.getElementById("bigAdd"),
  firstAdd: document.getElementById("firstAdd"),
  layoutBtn: document.getElementById("layoutBtn"),

  // editor
  editorTitle: document.getElementById("editorTitle"),
  eSite: document.getElementById("eSite"),
  eUrl: document.getElementById("eUrl"),
  eUser: document.getElementById("eUser"),
  ePass: document.getElementById("ePass"),
  genPass: document.getElementById("genPass"),
  saveCredential: document.getElementById("saveCredential"),
  cancelEdit: document.getElementById("cancelEdit"),

  // new / misc
  rememberCheckbox: document.getElementById("rememberCheckbox"),
  unlockMsg: document.getElementById("unlockMsg"),
  lockBtn: document.getElementById("lockBtn"),
  sessionTimer: document.getElementById("sessionTimer")
};

let state = {
  unlocked: false,
  credentials: [],
  filter: "all",
  editing: null,
  needsSetup: false
};

let timerInterval = null;

// ---------------- view helpers ----------------
function show(view) {
  // view: "locked" | "vault" | "editor"
  els.lockedView?.classList.toggle("hidden", view !== "locked");
  els.vaultView?.classList.toggle("hidden", view !== "vault");
  els.editor?.classList.toggle("hidden", view !== "editor");
  els.lockBtn?.classList.toggle("hidden", view !== "vault");
}

// ---------------- list rendering ----------------
async function refreshList() {
  if (!state.unlocked) return;
  const res = await new Promise(r => chrome.runtime.sendMessage({ type: "LIST" }, r));
  if (res?.ok) {
    state.credentials = res.credentials || [];
    renderList();
  }
}

function renderList() {
  const q = (els.searchInput?.value || "").toLowerCase().trim();
  const items = (state.credentials || []).filter((c) => {
    if (state.filter && state.filter !== "all" && c.type !== state.filter) return false;
    if (!q) return true;
    return (c.siteName?.toLowerCase().includes(q) || c.username?.toLowerCase().includes(q) || c.url?.toLowerCase().includes(q));
  });

  if (els.empty) els.empty.classList.toggle("hidden", items.length > 0);
  if (!els.list) return;

  els.list.innerHTML = items.map(renderCard).join("");
  els.list.querySelectorAll("[data-action]").forEach(btn => {
    btn.addEventListener("click", onCardAction);
  });
}

function renderCard(c) {
  const url = c.url ? new URL(c.url).hostname : "";
  const last = c.lastUsed ? new Date(c.lastUsed).toLocaleDateString() : "—";
  return `
    <div class="card" data-id="${c.id}">
      <div class="row">
        <div class="left">
          <div class="logo" style="width:28px;height:28px;border-radius:10px;"><svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="white" stroke-width="1.6"/></svg></div>
          <div>
            <div><b>${escapeHtml(c.siteName || url || "Untitled")}</b> <span class="star">${c.favorite ? "★" : ""}</span></div>
            <div class="small">${escapeHtml(c.url || "")}</div>
          </div>
        </div>
        <div class="right-tools">
          <span class="badge">login</span>
        </div>
      </div>
      <div class="field">
        <span class="label">username</span>
        <span class="value">${escapeHtml(c.username || "")}</span>
        <div class="right-tools">
          <button class="tool" data-action="copy-user" title="Copy"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="10" height="10" rx="2" stroke="#9ca3af" stroke-width="1.6"/><rect x="5" y="5" width="10" height="10" rx="2" stroke="#9ca3af" stroke-width="1.6"/></svg></button>
        </div>
      </div>
      <div class="field">
        <span class="label">password</span>
        <span class="value">••••••••</span>
        <div class="right-tools">
          <button class="tool" data-action="reveal" title="Reveal"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M3 12s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7Z" stroke="#9ca3af" stroke-width="1.6"/><circle cx="12" cy="12" r="3" stroke="#9ca3af" stroke-width="1.6"/></svg></button>
          <button class="tool" data-action="copy-pass" title="Copy"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="10" height="10" rx="2" stroke="#9ca3af" stroke-width="1.6"/><rect x="5" y="5" width="10" height="10" rx="2" stroke="#9ca3af" stroke-width="1.6"/></svg></button>
          <button class="tool" data-action="edit" title="Edit"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M4 16.5V20h3.5L18 9.5 14.5 6 4 16.5Z" stroke="#9ca3af" stroke-width="1.6"/></svg></button>
          <button class="tool" data-action="delete" title="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M6 7h12M9 7V5h6v2m-8 0v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V7" stroke="#f87171" stroke-width="1.6"/></svg></button>
        </div>
      </div>
      <div class="small">Last used: ${last}</div>
    </div>`;
}

// ---------------- card actions ----------------
function onCardAction(e) {
  const btn = e.currentTarget;
  const id = btn.closest(".card").dataset.id;
  const item = state.credentials.find(c => c.id === id);
  if (!item) return;
  switch (btn.dataset.action) {
    case "copy-user":
      copyText(item.username, "Username");
      break;
    case "copy-pass":
      copyPasswordFlow(item);
      break;
    case "reveal":
      alert(`Password: ${item.password}`);
      break;
    case "edit":
      state.editing = item;
      fillEditor(item);
      show("editor");
      break;
    case "delete":
      if (confirm("Delete this credential?")) {
        chrome.runtime.sendMessage({ type: "DELETE", id }, () => refreshList());
      }
      break;
    case "login":
      copyPasswordFlow(item);
      break;
  }
}

// ---------------- copy / mark-used flow ----------------
async function copyPasswordFlow(item) {
  if (!item) return;
  try {
    await copyText(item.password, "Password");
    // mark used so background persists lastUsed
    chrome.runtime.sendMessage({ type: "MARK_USED", id: item.id }, () => {
      refreshList();
    });
  } catch (e) {
    // fallback: ask background to copy via offscreen
    chrome.runtime.sendMessage({ type: "COPY", id: item.id }, (res) => {
      if (res?.ok) showToast("Password copied");
      else showToast("Copy failed");
      refreshList();
    });
  }
}

// ---------------- editor helpers ----------------
function fillEditor(item) {
  els.editorTitle.textContent = item?.id ? "Edit Credential" : "Add Credential";
  els.eSite.value = item?.siteName || "";
  els.eUrl.value = item?.url || "";
  els.eUser.value = item?.username || "";
  els.ePass.value = item?.password || "";
}

function resetEditor() {
  state.editing = null;
  fillEditor(null);
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>'\"]/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;","\"":"&quot;" }[c]));
}

// ---------------- clipboard helpers & toasts ----------------
async function copyText(text, label = "Text") {
  if (!text) { showToast("Nothing to copy"); throw new Error("Nothing to copy"); }
  try {
    // navigator.clipboard works inside popup on user gesture
    await navigator.clipboard.writeText(text);
    showToast(`${label} copied`);
  } catch (err) {
    // fallback to background/offscreen-based copy
    await new Promise((resolve) => chrome.runtime.sendMessage({ type: "OFFSCREEN_COPY", text, timeout: 15 }, resolve));
    showToast(`${label} copied`);
  }
}

let toastTimer = null;
function showToast(msg, ms = 1800) {
  const existing = document.getElementById("sv-toast");
  if (existing) existing.remove();
  const d = document.createElement("div");
  d.id = "sv-toast";
  d.textContent = msg;
  Object.assign(d.style, {
    position: "fixed",
    bottom: "14px",
    left: "50%",
    transform: "translateX(-50%)",
    background: "rgba(0,0,0,0.85)",
    color: "white",
    padding: "8px 12px",
    borderRadius: "8px",
    zIndex: 9999,
    fontSize: "13px",
    boxShadow: "0 6px 18px rgba(0,0,0,0.25)"
  });
  document.body.appendChild(d);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => d.remove(), ms);
}

// ---------------- session timer ----------------
function startSessionTimer(expiresAt) {
  stopSessionTimer();
  if (!expiresAt || expiresAt <= Date.now()) {
    els.sessionTimer.textContent = "";
    return;
  }
  function tick() {
    const diff = Math.max(0, expiresAt - Date.now());
    if (diff <= 0) {
      els.sessionTimer.textContent = "Session expired";
      stopSessionTimer();
      refreshState();
      return;
    }
    const sec = Math.floor(diff / 1000);
    const mm = Math.floor(sec / 60);
    const ss = sec % 60;
    els.sessionTimer.textContent = `Session: ${mm}m ${ss}s`;
  }
  tick();
  timerInterval = setInterval(tick, 1000);
}

function stopSessionTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  els.sessionTimer.textContent = "";
}

// ---------------- events wiring ----------------
els.toggleMaster?.addEventListener("click", () => {
  if (els.masterInput) els.masterInput.type = els.masterInput.type === "password" ? "text" : "password";
  if (els.masterSetInput) els.masterSetInput.type = els.masterSetInput.type === "password" ? "text" : "password";
});

els.unlockBtn?.addEventListener("click", async () => {
  const master = els.masterInput?.value;
  const persist = !!els.rememberCheckbox?.checked;
  if (!master) return;
  els.unlockMsg.textContent = "";
  els.unlockBtn.disabled = true;
  try {
    const res = await new Promise(r => chrome.runtime.sendMessage({ type: "UNLOCK", master, persist }, r));
    if (res?.ok) {
      state.unlocked = true;
      show("vault");
      if (els.masterInput) els.masterInput.value = "";
      await refreshState();
      await refreshList();
      showToast("Unlocked");
    } else {
      els.unlockMsg.textContent = res?.error || "Unlock failed";
      setTimeout(() => (els.unlockMsg.textContent = ""), 3000);
    }
  } catch (e) {
    els.unlockMsg.textContent = "Error unlocking";
  } finally {
    els.unlockBtn.disabled = false;
  }
});

// Setup: set master (first-run)
els.setMasterBtn?.addEventListener("click", async () => {
  const p1 = els.masterSetInput?.value || "";
  const p2 = els.masterConfirm?.value || "";
  if (!p1 || !p2) {
    if (els.setupMsg) els.setupMsg.textContent = "Please enter and confirm password.";
    return;
  }
  if (p1 !== p2) {
    if (els.setupMsg) els.setupMsg.textContent = "Passwords do not match.";
    return;
  }
  if (p1.length < 8) {
    if (els.setupMsg) els.setupMsg.textContent = "Use at least 8 characters.";
    return;
  }

  els.setMasterBtn.disabled = true;
  if (els.setupMsg) els.setupMsg.textContent = "";
  try {
    const res = await new Promise(r => chrome.runtime.sendMessage({ type: "SET_MASTER", master: p1 }, r));
    if (res?.ok) {
      state.unlocked = true;
      show("vault");
      if (els.masterSetInput) els.masterSetInput.value = "";
      if (els.masterConfirm) els.masterConfirm.value = "";
      showToast("Master password set");
      await refreshList();
    } else {
      if (els.setupMsg) els.setupMsg.textContent = res?.error || "Failed to set master password";
    }
  } catch (e) {
    if (els.setupMsg) els.setupMsg.textContent = "Error";
  } finally {
    els.setMasterBtn.disabled = false;
  }
});

// add / bigAdd / firstAdd
[els.addBtn, els.bigAdd, els.firstAdd].forEach(b => b?.addEventListener("click", () => {
  state.editing = null; fillEditor(null); show("editor");
}));

els.cancelEdit?.addEventListener("click", () => { show("vault"); resetEditor(); });

els.saveCredential?.addEventListener("click", async () => {
  const item = {
    id: state.editing?.id,
    siteName: els.eSite.value.trim(),
    username: els.eUser.value.trim(),
    password: els.ePass.value,
    url: els.eUrl.value.trim(),
    type: "login"
  };
  try {
    const res = await new Promise(r => chrome.runtime.sendMessage({ type: "UPSERT", item }, r));
    if (res?.ok) {
      show("vault");
      resetEditor();
      await refreshList();
      showToast("Saved");
    } else {
      alert("Failed to save credential: " + (res?.error || "unknown"));
    }
  } catch (e) {
    alert("Save error");
  }
});

els.genPass?.addEventListener("click", async () => {
  const res = await new Promise(r => chrome.runtime.sendMessage({ type: "GENERATE", options: { length: 20, lower: true, upper: true, number: true, symbol: true } }, r));
  if (res?.ok) {
    els.ePass.value = res.value;
    const score = scorePassword(res.value);
    els.genPass.textContent = score < 40 ? "Weak" : score < 70 ? "Good" : "Strong";
    setTimeout(() => els.genPass.textContent = "Generate", 1200);
  }
});

els.settingsBtn?.addEventListener("click", () => chrome.runtime.openOptionsPage());
els.searchInput?.addEventListener("input", renderList);

els.rememberCheckbox?.addEventListener("change", async () => {
  try {
    await new Promise(r => chrome.runtime.sendMessage({ type: "SESSION_SET", value: !!els.rememberCheckbox.checked }, r));
  } catch (e) {}
});

els.lockBtn?.addEventListener("click", async () => {
  await new Promise(r => chrome.runtime.sendMessage({ type: "LOCK" }, r));
  await refreshState();
});

// Listen for LOCKED broadcasts (background will send)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "LOCKED") {
    refreshState();
  }
});
// ---------------- initial state / GET_STATE ----------------
async function refreshState() {
  try {
    const stateRsp = await new Promise(r => chrome.runtime.sendMessage({ type: "GET_STATE" }, r));
    console.log("state repsonse", stateRsp)
    // show setup UI if backend says setup required
    if (stateRsp?.needsSetup) {
    state.needsSetup = true;
    if (els.setupBlock) els.setupBlock.classList.remove("hidden");
    if (els.masterSetInput) els.masterSetInput.value = "";
    if (els.masterConfirm) els.masterConfirm.value = "";
    if (els.setupMsg) els.setupMsg.textContent = "";

    // ✅ Hide unlock block properly
    const unlockBlock = document.getElementById("unlockBlock");
    if (unlockBlock) unlockBlock.classList.add("hidden");

    show("locked");
    return;
  } else {
    state.needsSetup = false;
    if (els.setupBlock) els.setupBlock.classList.add("hidden");

    // ✅ Show unlock block again when setup not required
    const unlockBlock = document.getElementById("unlockBlock");
    if (unlockBlock) unlockBlock.classList.remove("hidden");
  }


    if (stateRsp?.unlocked) {
      state.unlocked = true;
      show("vault");
      els.lockBtn?.classList.remove("hidden");
      if (stateRsp.sessionExpiresAt) {
        startSessionTimer(stateRsp.sessionExpiresAt);
      } else {
        stopSessionTimer();
      }
      if (stateRsp.settings) {
        els.rememberCheckbox.checked = !!stateRsp.settings.keepUnlocked;
      }
      await refreshList();
    } else {
      state.unlocked = false;
      show("locked");
      stopSessionTimer();
      els.lockBtn?.classList.add("hidden");
    }
  } catch (e) {
    console.error("refreshState err", e);
    show("locked");
    stopSessionTimer();
  }
}

(async function init() {
  await refreshState();
})();
