
(function() {
  const STATE = { enabled: true, rules: [] };

  function sendRulesToPage() {
    window.postMessage({ type: "oro-update-rules", payload: { enabled: STATE.enabled, rules: STATE.rules } }, "*");
  }

  function ensureMainHook() {
    chrome.runtime.sendMessage({ type: "oro-inject-main-hook" }, (res) => {
      // When MAIN hook signals ready, we'll push rules
    });
  }

  function requestRules() {
    chrome.runtime.sendMessage({ type: "oro-get-rules-for-content" }, (res) => {
      if (!res) return;
      STATE.enabled = !!res.enabled;
      STATE.rules = Array.isArray(res.rules) ? res.rules : [];
      ensureMainHook();
      sendRulesToPage();
      applyInjectionsIfAny();
    });
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "oro-rules-updated") {
      requestRules();
    }
  });

  window.addEventListener("message", (ev) => {
    if (ev && ev.data && ev.data.type === "oro-main-ready") {
      // MAIN hook loaded, push latest rules
      sendRulesToPage();
    }
  });

  function applyInjectionsIfAny() {
    if (!STATE.enabled) return;
    const url = location.href;
    for (const r of STATE.rules) {
      if (!r.enabled) continue;
      if (r.action !== "injectJS" && r.action !== "injectCSS") continue;
      const re = new RegExp(r._compiledRegex, r.isCaseSensitive ? "" : "i");
      if (!re.test(url)) continue;
      if (r.action === "injectJS" && r.inject?.body) {
        const s = document.createElement("script");
        s.textContent = r.inject.body;
        (document.head || document.documentElement).appendChild(s);
        s.remove();
      } else if (r.action === "injectCSS" && r.inject?.body) {
        const st = document.createElement("style");
        st.textContent = r.inject.body;
        (document.head || document.body || document.documentElement).appendChild(st);
      }
    }
  }

  // Kick off
  requestRules();
})();
