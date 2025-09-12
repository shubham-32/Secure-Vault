// db.js - chrome.storage.local primary, IndexedDB fallback + migration

const DB_NAME = "securevault-db";
const DB_VERSION = 1;
const STORE = "vault";
const STORAGE_KEY = "sv_vault";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function putIndexedDB(data) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ id: "singleton", ...data, updatedAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getIndexedDB() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get("singleton");
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function clearIndexedDB() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveEncryptedVault(data) {
  // Try primary store (chrome.storage.local)
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: data });
    return;
  } catch (e) {
    console.warn("chrome.storage.local.set failed, falling back to IndexedDB", e);
  }

  // Fallback
  return putIndexedDB(data);
}

export async function loadEncryptedVault() {
  // primary: chrome.storage.local
  try {
    const res = await chrome.storage.local.get(STORAGE_KEY);
    if (res && res[STORAGE_KEY]) return res[STORAGE_KEY];
  } catch (e) {
    console.warn("chrome.storage.local.get failed, will try IndexedDB", e);
  }

  // fallback: indexedDB
  try {
    const rec = await getIndexedDB();
    if (rec) {
      // Migrate to chrome.storage.local for future reliability (best-effort)
      try {
        await chrome.storage.local.set({ [STORAGE_KEY]: rec });
      } catch (e) {
        // ignore migration failures, keep returning the indexedDB record
      }
    }
    return rec || null;
  } catch (e) {
    console.error("IndexedDB load error", e);
    return null;
  }
}

export async function clearDB() {
  try {
    await chrome.storage.local.remove(STORAGE_KEY);
  } catch (e) {
    console.warn("chrome.storage.local.remove failed", e);
  }

  try {
    await clearIndexedDB();
  } catch (e) {
    console.warn("IndexedDB clear failed", e);
  }
}
