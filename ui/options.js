// options.js

const els = {
  theme: document.getElementById("theme"),
  autoLock: document.getElementById("autoLock"),
  clipboardTimeout: document.getElementById("clipboardTimeout"),
  strengthSwitch: document.getElementById("strengthSwitch"),
  saveBtn: document.getElementById("saveBtn"),
  lockBtn: document.getElementById("lockBtn")
};

function setSwitch(el, val) {
  el.dataset.checked = val ? "true" : "false";
  el.textContent = val ? "On" : "Off"; // visual feedback
}
function getSwitch(el) {
  return el.dataset.checked === "true";
}

// Toggle strength switch
els.strengthSwitch.addEventListener("click", () => {
  setSwitch(els.strengthSwitch, !getSwitch(els.strengthSwitch));
});

// Manual lock
els.lockBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "LOCK" });
  window.close();
});

// Save settings
els.saveBtn.addEventListener("click", async () => {
  const settings = {
    theme: els.theme.value,
    autoLockMinutes: Number(els.autoLock.value) || 0,   // 0 = never auto-lock
    clipboardTimeoutSec: Number(els.clipboardTimeout.value) || 30,
    showPasswordStrength: getSwitch(els.strengthSwitch)
  };

  const res = await chrome.runtime.sendMessage({ type: "SETTINGS_SAVE", settings });

  if (res?.ok) {
    els.saveBtn.textContent = "Saved ✓";
    setTimeout(() => (els.saveBtn.textContent = "Save Settings"), 1400);
  }
});

// Load settings on page open
(async function init() {
  const res = await chrome.runtime.sendMessage({ type: "SETTINGS_GET" }).catch(() => null);
  const s = res?.settings || {};

  els.theme.value = s.theme || "dark";
  els.autoLock.value = String(s.autoLockMinutes ?? 15);
  els.clipboardTimeout.value = String(s.clipboardTimeoutSec ?? 30);
  setSwitch(els.strengthSwitch, !!s.showPasswordStrength);
})();
