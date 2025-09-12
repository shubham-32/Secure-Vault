// content.js - autofill + suggestion UI (supports signup suggestions)

(function () {
  let currentHint = null;
  let currentTarget = null;
  let cleanupFns = [];

  function cleanupAll() {
    cleanupFns.forEach(fn => {
      try { fn(); } catch {}
    });
    cleanupFns = [];
    if (currentHint && currentHint.parentNode) currentHint.parentNode.removeChild(currentHint);
    currentHint = null;
    currentTarget = null;
  }

  function createHintElement(text) {
    const el = document.createElement("div");
    el.className = "sv-fill-hint";
    Object.assign(el.style, {
      position: "absolute",
      zIndex: 2147483647,
      padding: "6px 10px",
      borderRadius: "8px",
      boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
      background: "#fff",
      color: "#111",
      fontFamily: "sans-serif",
      fontSize: "13px",
      cursor: "pointer",
      userSelect: "none",
    });
    el.textContent = text;
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "-1");
    return el;
  }

  function dispatchInputEvents(el) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function simulateTypingKeystrokes(el) {
    try {
      const up = new KeyboardEvent("keyup", { bubbles: true });
      el.dispatchEvent(up);
    } catch (e) {}
  }

  function looksLikeSignup(passwordInput) {
    // heuristics: autocomplete new-password, name/id contains new, or presence of confirm-password nearby
    if (passwordInput.autocomplete && /new-password/i.test(passwordInput.autocomplete)) return true;
    const name = (passwordInput.name || "") + " " + (passwordInput.id || "");
    if (/new|signup|register|create/i.test(name)) return true;

    const form = passwordInput.closest("form");
    if (form) {
      const confirm = form.querySelector(`input[type=password][name*=confirm i], input[type=password][id*=confirm i], input[autocomplete*=confirm i]`);
      if (confirm) return true;
    }
    return false;
  }

  async function showHintForInput(passwordInput, resp, isSignup) {
    cleanupAll();
    currentTarget = passwordInput;

    const rect = passwordInput.getBoundingClientRect();
    const actionText = resp.ok && resp.credential ? "Fill from SecureVault" : (isSignup ? "Suggest SecureVault password" : "Unlock SecureVault");
    const hint = createHintElement(actionText);
    document.body.appendChild(hint);

    const spaceRight = window.innerWidth - rect.right;
    if (spaceRight > 120) {
      hint.style.left = (window.scrollX + rect.right + 8) + "px";
      hint.style.top = (window.scrollY + rect.top) + "px";
    } else {
      hint.style.left = (window.scrollX + rect.left) + "px";
      hint.style.top = (window.scrollY + rect.top - rect.height - 12) + "px";
    }

    currentHint = hint;

    const onDocClick = (ev) => {
      if (!hint.contains(ev.target) && ev.target !== passwordInput) cleanupAll();
    };
    document.addEventListener("click", onDocClick, true);
    cleanupFns.push(() => document.removeEventListener("click", onDocClick, true));

    const onBlur = () => cleanupAll();
    passwordInput.addEventListener("blur", onBlur, { once: true });
    cleanupFns.push(() => passwordInput.removeEventListener("blur", onBlur, { once: true }));

    const onPointerDown = async (e) => {
      e.preventDefault();
      e.stopPropagation();

      try { passwordInput.removeEventListener("blur", onBlur, { once: true }); } catch {}

      if (isSignup) {
        // Suggest a new password
        try {
          const gen = await chrome.runtime.sendMessage({ type: "GENERATE", options: { length: 20, symbol: true, upper: true, number: true } });
          if (gen?.ok && gen.value) {
            const pwd = gen.value;
            const form = passwordInput.closest("form") || document;
            // try to locate confirm password
            const confirm = form.querySelector(`input[type=password][name*=confirm i], input[type=password][id*=confirm i], input[autocomplete*=confirm i]`);
            // fill both fields
            if (confirm) {
              passwordInput.focus();
              passwordInput.value = pwd;
              dispatchInputEvents(passwordInput);
              confirm.value = pwd;
              dispatchInputEvents(confirm);
              simulateTypingKeystrokes(passwordInput);
              simulateTypingKeystrokes(confirm);
            } else {
              passwordInput.focus();
              passwordInput.value = pwd;
              dispatchInputEvents(passwordInput);
              simulateTypingKeystrokes(passwordInput);
            }
            // optionally copy to clipboard if unlocked
            try {
              if ((await chrome.runtime.sendMessage({ type: "PING" })).unlocked) {
                await chrome.runtime.sendMessage({ type: "COPY_PASSWORD_TO_CLIPBOARD_ON_DEMAND", text: pwd }).catch(()=>{});
              }
            } catch {}
          }
        } catch (e) {}
        cleanupAll();
        return;
      }

      if (resp.ok && resp.credential) {
        const cred = resp.credential;
        try {
          const form = passwordInput.closest("form") || document;
          const user = form.querySelector(`input[type=email], input[name*=user i], input[name*=login i], input[type=text]`);
          if (user && (!user.value || user.value.trim() === "")) {
            user.focus();
            user.value = cred.username || "";
            dispatchInputEvents(user);
          }
          passwordInput.focus();
          passwordInput.value = cred.password || "";
          dispatchInputEvents(passwordInput);
          simulateTypingKeystrokes(passwordInput);

          // Tell background we used it
          try { chrome.runtime.sendMessage({ type: "MARK_USED", id: cred.id }).catch(()=>{}); } catch (e) {}
        } catch (err) {
          console.error("SecureVault fill error", err);
        } finally {
          cleanupAll();
        }
      } else {
        try { await chrome.runtime.sendMessage({ type: "OPEN_POPUP" }); } catch (e) {}
        cleanupAll();
      }
    };

    hint.addEventListener("pointerdown", onPointerDown, { passive: false });
    cleanupFns.push(() => hint.removeEventListener("pointerdown", onPointerDown, { passive: false }));

    const observer = new MutationObserver(() => {
      if (!document.body.contains(hint)) cleanupAll();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    cleanupFns.push(() => observer.disconnect());
  }

  // Main listener
  document.addEventListener("focusin", async (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement)) return;
    if (el.type !== "password") return;
    const url = location.href;

    const isSignup = looksLikeSignup(el);

    try {
      // For signup suggestions we don't need to require unlocked; we can still offer suggestion (generate locally)
      if (isSignup) {
        // show suggestion UI (pass ok:false so it shows suggest text)
        await showHintForInput(el, { ok: false }, true);
        return;
      }

      const res = await chrome.runtime.sendMessage({ type: "SEARCH_FOR_URL", url });
      if (!res?.ok) {
        await showHintForInput(el, { ok: false }, false);
        return;
      }
      const cred = res.credential;
      if (cred) {
        await showHintForInput(el, { ok: true, credential: cred }, false);
      } else {
        cleanupAll();
      }
    } catch (err) {
      cleanupAll();
    }
  }, true);

  window.addEventListener("beforeunload", () => cleanupAll());
})();
