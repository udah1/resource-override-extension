// Runs in the page's MAIN world. Injected via scripting API (CSP-safe).
// Overrides fetch/XHR for AFTER-response rules; DNR handles IMMEDIATE.

(function() {
  if (window.__oroMainInstalled) return;
  window.__oroMainInstalled = true;

  const ORO = { enabled: true, rules: [] };
  const toAbs = (u) => { try { return new URL(u, location.href).href; } catch { return String(u||""); } };
  const matchUrl = (u, r, cs) => { try { return new RegExp(r, cs ? "" : "i").test(u); } catch { return false; } };

  const methodMatches = (method, r) => {
    const want = (r.method || "*").toUpperCase();
    if (!want || want === "*") return true;
    return String(method || "GET").toUpperCase() === want;
  };

  const bodyToText = (body) => {
    try {
      if (body == null) return "";
      if (typeof body === "string") return body;
      if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) return body.toString();
      if (typeof FormData !== "undefined" && body instanceof FormData) return "";
      if (typeof Blob !== "undefined" && body instanceof Blob) return "";
      if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return "";
      const s = String(body);
      return s === "[object Object]" ? "" : s;
    } catch { return ""; }
  };

  const ruleHasBodyMatch = (r) => !!(r.bodyMatch && r.bodyMatch.type && r.bodyMatch.type !== "none" && r.bodyMatch.value);

  const bodyMatches = (bodyText, r) => {
    if (!ruleHasBodyMatch(r)) return true;
    const text = bodyText || "";
    const val = r.bodyMatch.value;
    try {
      if (r.bodyMatch.type === "contains") return text.includes(val);
      if (r.bodyMatch.type === "equals") return text.trim() === String(val).trim();
      if (r.bodyMatch.type === "regex") return new RegExp(val).test(text);
    } catch { return false; }
    return false;
  };

  async function readFetchBody(init, req) {
    try {
      if (init && "body" in init) {
        const t = bodyToText(init.body);
        if (t) return t;
      }
      if (req && typeof req.clone === "function") return await req.clone().text();
    } catch {}
    return "";
  }

  window.addEventListener("message", (ev) => {
    if (!ev || !ev.data) return;
    const d = ev.data;
    if (d.type === "oro-update-rules" && d.payload) {
      ORO.enabled = !!d.payload.enabled;
      ORO.rules = Array.isArray(d.payload.rules) ? d.payload.rules : [];
    }
  });

  // ---- Fetch ----
  const _fetch = window.fetch.bind(window);
  window.fetch = async function(input, init) {
    const req = (typeof input === 'string' || (input && !('clone' in input))) ? new Request(input, init) : input;
    const abs = toAbs(req.url || input);
    if (!ORO.enabled) return _fetch(req);
    const method = (init && init.method) || (req && req.method) || "GET";
    const candidates = ORO.rules.filter(r =>
      r.enabled && r.action === "mockText" && r.mock && r.mock.mode === "after" &&
      r._compiledRegex && matchUrl(abs, r._compiledRegex, !!r.isCaseSensitive) &&
      methodMatches(method, r)
    );
    if (!candidates.length) return _fetch(req);
    const bodyText = candidates.some(ruleHasBodyMatch) ? await readFetchBody(init, req) : "";
    const matches = candidates.filter(r => bodyMatches(bodyText, r));
    if (!matches.length) return _fetch(req);
    const rule = matches[matches.length - 1];
    const body = (rule.mock && rule.mock.body) || "";
    const status = (rule.mock && Number(rule.mock.status)) || 200;
    const kind = (rule.mock && rule.mock.kind) || "auto";
    const guessCT = (k,t)=>{ if(k!=="auto"){ if(k==="json")return"application/json; charset=utf-8"; if(k==="js")return"text/javascript; charset=utf-8"; if(k==="css")return"text/css; charset=utf-8"; } t=(t||"").trim(); if(t.startsWith("{")||t.startsWith("["))return"application/json; charset=utf-8"; if(t.startsWith("/*")||t.includes("function")||t.includes("=>"))return"text/javascript; charset=utf-8"; if(t.includes("{")&&t.includes("}"))return"text/css; charset=utf-8"; return"text/plain; charset=utf-8"; };
    const headers = new Headers({ "content-type": guessCT(kind, body) });
    if (Array.isArray(rule.headers)) for (const h of rule.headers) {
      const op=(h.operation||"set").toLowerCase();
      if(op==="set"&&h.header) headers.set(h.header,h.value||"");
      if(op==="remove"&&h.header) headers.delete(h.header);
    }
    if (rule.mock.waitForRealResponse) { try { await _fetch(req); } catch {} }
    return new Response(body, { status, headers });
  };

  // ---- XHR ----
  (function(){
    const _open = XMLHttpRequest.prototype.open;
    const _send = XMLHttpRequest.prototype.send;
    const _protoAdd = XMLHttpRequest.prototype.addEventListener;

    function applyMockProps(xhr, status, mockBody) {
      try { Object.defineProperty(xhr, "readyState", { configurable: true, value: 4 }); } catch {}
      try { Object.defineProperty(xhr, "status", { configurable: true, value: status }); } catch {}
      try { Object.defineProperty(xhr, "responseText", { configurable: true, value: mockBody }); } catch {}
      try { Object.defineProperty(xhr, "statusText", { configurable: true, value: (String(status) === '200' ? 'OK' : '') }); } catch {}
      try { Object.defineProperty(xhr, "response", { configurable: true, value: mockBody }); } catch {}
    }

    function fireBuffered(xhr, withLoad) {
      const b = xhr.__oroBuffered;
      const evRS = new Event("readystatechange");
      const evLoad = new Event("load");
      const evLE = new Event("loadend");
      if (b.onreadystatechange_prop) try { b.onreadystatechange_prop.call(xhr, evRS); } catch {}
      for (const fn of b.readystatechange) try { fn.call(xhr, evRS); } catch {}
      if (withLoad) {
        if (b.onload_prop) try { b.onload_prop.call(xhr, evLoad); } catch {}
        for (const fn of b.load) try { fn.call(xhr, evLoad); } catch {}
      }
      if (b.onloadend_prop) try { b.onloadend_prop.call(xhr, evLE); } catch {}
      for (const fn of b.loadend) try { fn.call(xhr, evLE); } catch {}
    }

    XMLHttpRequest.prototype.open = function(method, url, async=true, user, password) {
      this.__oroUrl = String(url);
      this.__oroMethod = String(method || "GET").toUpperCase();
      this.__oroCandidates = [];
      this.__oroBuffered = { load: [], readystatechange: [], loadend: [], error: [], abort: [], onreadystatechange_prop: null, onload_prop: null, onloadend_prop: null };

      if (ORO.enabled) {
        const abs = toAbs(this.__oroUrl || "");
        const cands = ORO.rules.filter(r =>
          r.enabled && r.action === "mockText" && r.mock && r.mock.mode === "after" &&
          r._compiledRegex && matchUrl(abs, r._compiledRegex, !!r.isCaseSensitive) &&
          methodMatches(this.__oroMethod, r)
        );
        if (cands.length) {
          // The request body isn't known until send(), so buffer completion handlers for
          // every URL+method candidate and decide whether to mock once we can read the body.
          this.__oroCandidates = cands;
          this.__oroOrigAdd = _protoAdd;
          const origAdd = _protoAdd;
          this.addEventListener = function(type, listener, opts) {
            if (type === "load" || type === "readystatechange" || type === "loadend") {
              this.__oroBuffered[type].push(listener);
              return origAdd.call(this, type, function(){/* swallow; replayed later */}, opts);
            }
            return origAdd.call(this, type, listener, opts);
          };
          Object.defineProperty(this, "onreadystatechange", {
            configurable: true,
            set: (fn) => { this.__oroBuffered.onreadystatechange_prop = fn; },
            get: () => this.__oroBuffered.onreadystatechange_prop
          });
          Object.defineProperty(this, "onload", {
            configurable: true,
            set: (fn) => { this.__oroBuffered.onload_prop = fn; },
            get: () => this.__oroBuffered.onload_prop
          });
          Object.defineProperty(this, "onloadend", {
            configurable: true,
            set: (fn) => { this.__oroBuffered.onloadend_prop = fn; },
            get: () => this.__oroBuffered.onloadend_prop
          });
        }
      }
      return _open.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function(body) {
      const xhr = this;
      const cands = xhr.__oroCandidates || [];
      if (!ORO.enabled || !cands.length) {
        return _send.apply(this, arguments);
      }

      const bodyText = cands.some(ruleHasBodyMatch) ? bodyToText(body) : "";
      const matches = cands.filter(r => bodyMatches(bodyText, r));
      const rule = matches.length ? matches[matches.length - 1] : null;

      // No body match: let the real request run and replay the buffered handlers with real data.
      if (!rule) {
        const onDone = () => fireBuffered(xhr, xhr.status !== 0);
        xhr.__oroOrigAdd.call(xhr, "loadend", onDone, { once: true });
        return _send.apply(this, arguments);
      }

      const mockBody = (rule.mock && rule.mock.body) || "";
      const status = (rule.mock && Number(rule.mock.status)) || 200;

      if (rule.mock && rule.mock.waitForRealResponse) {
        // Let the REAL XHR go through, swallow its completion, then replay with the mock.
        const onRealDone = () => { applyMockProps(xhr, status, mockBody); fireBuffered(xhr, true); };
        xhr.__oroOrigAdd.call(xhr, "loadend", onRealDone, { once: true });
        return _send.apply(this, arguments);
      } else {
        setTimeout(() => { applyMockProps(xhr, status, mockBody); fireBuffered(xhr, true); }, 0);
        return;
      }
    };
  })();

  window.postMessage({ type: "oro-main-ready" }, "*");
})();
