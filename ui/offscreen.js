// offscreen.js - copy to clipboard and auto-clear (robust + fallback)

async function writeClipboard(text) {
  // normalize
  const str = String(text ?? "");
  // Try navigator.clipboard first (preferred)
  try {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      throw new Error("navigator.clipboard.writeText not available");
    }
    await navigator.clipboard.writeText(str);
    return;
  } catch (err) {
    console.warn("navigator.clipboard.writeText failed:", err);
  }

  // Fallback: execCommand copy (best-effort)
  try {
    const ta = document.createElement("textarea");
    ta.value = str;
    // make invisible and non-disruptive
    ta.setAttribute("aria-hidden", "true");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    if (!ok) throw new Error("document.execCommand('copy') returned false");
    return;
  } catch (err) {
    console.warn("execCommand fallback failed:", err);
    throw err;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === "OFFSCREEN_COPY") {
      try {
        const text = msg.text ?? "";
        await writeClipboard(text);

        // schedule clear after timeout (best-effort)
        const timeoutSec = Math.max(1, Number(msg.timeout || 30));
        setTimeout(async () => {
          try { await writeClipboard(""); } catch (e) { /* ignore */ }
        }, timeoutSec * 1000);

        sendResponse({ ok: true });
      } catch (e) {
        // provide a readable error for debugging
        sendResponse({ ok: false, error: (e && e.message) ? e.message : String(e) });
      }
    }
  })();
  return true; // indicate async response
});
