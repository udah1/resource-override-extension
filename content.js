
(function() {
  const STATE = { enabled: true, rules: [] };

  // On normal pages targetOrigin is the page origin; on null-origin docs (file://,
  // sandboxed) the only valid targetOrigin is "*", but we still verify ev.origin/source
  // on receipt so other windows/frames can't spoof or read our messages.
  const NULL_ORIGIN = location.origin === "null" || location.origin === "";
  const TARGET = NULL_ORIGIN ? "*" : location.origin;
  function trusted(ev) {
    if (!ev || ev.source !== window) return false;
    return NULL_ORIGIN ? (ev.origin === "null" || ev.origin === "") : ev.origin === location.origin;
  }

  function sendRulesToPage() {
    window.postMessage({ type: "oro-update-rules", payload: { enabled: STATE.enabled, rules: STATE.rules } }, TARGET);
  }

  // Track what we've already injected this document so repeated rule updates don't
  // stack <style>/<script> tags; re-inject only when the inject-relevant fields change.
  const injected = new Map(); // rule.id -> hash
  function fnv1a(str) {
    let h = 0x811c9dc5 >>> 0;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }
  function injectHash(r) {
    return fnv1a([r.matchType, r.pattern, (r.exclude || []).join(","), !!r.isCaseSensitive, r.action, (r.inject && r.inject.body) || ""].join("\u0000"));
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
    if (!trusted(ev)) return;
    if (ev.data && ev.data.type === "oro-main-ready") {
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
      if (!(r.inject && r.inject.body)) continue;
      // Skip if we've already injected this exact rule content into this document.
      const h = injectHash(r);
      if (injected.get(r.id) === h) continue;
      injected.set(r.id, h);
      if (r.action === "injectJS") {
        const s = document.createElement("script");
        s.textContent = r.inject.body;
        (document.head || document.documentElement).appendChild(s);
        s.remove();
      } else {
        const st = document.createElement("style");
        st.textContent = r.inject.body;
        (document.head || document.body || document.documentElement).appendChild(st);
      }
    }
  }

  // Kick off
  requestRules();
})();
