// Runs in the page's MAIN world. Injected via scripting API (CSP-safe).
// Overrides fetch/XHR for AFTER-response rules; DNR handles IMMEDIATE.

(function() {
  if (window.__oroMainInstalled) return;
  window.__oroMainInstalled = true;

  const ORO = { enabled: true, rules: [] };

  const NULL_ORIGIN = location.origin === "null" || location.origin === "";
  const TARGET = NULL_ORIGIN ? "*" : location.origin;
  const trusted = (ev) => {
    if (!ev || ev.source !== window) return false;
    return NULL_ORIGIN ? (ev.origin === "null" || ev.origin === "") : ev.origin === location.origin;
  };

  const toAbs = (u) => { try { return new URL(u, location.href).href; } catch { return String(u||""); } };
  const matchUrl = (u, r, cs) => { try { return new RegExp(r, cs ? "" : "i").test(u); } catch { return false; } };

  const STATUS_TEXT = { 200:"OK",201:"Created",202:"Accepted",203:"Non-Authoritative Information",204:"No Content",205:"Reset Content",206:"Partial Content",301:"Moved Permanently",302:"Found",303:"See Other",304:"Not Modified",307:"Temporary Redirect",308:"Permanent Redirect",400:"Bad Request",401:"Unauthorized",403:"Forbidden",404:"Not Found",405:"Method Not Allowed",406:"Not Acceptable",409:"Conflict",410:"Gone",422:"Unprocessable Entity",429:"Too Many Requests",500:"Internal Server Error",501:"Not Implemented",502:"Bad Gateway",503:"Service Unavailable",504:"Gateway Timeout" };
  const statusTextFor = (s) => STATUS_TEXT[s] || "";
  // Per fetch spec, these statuses are "null body status" and the Response ctor throws if a body is supplied.
  const isNullBodyStatus = (s) => s === 101 || s === 103 || s === 204 || s === 205 || s === 304;

  const guessCT = (k, t) => {
    if (k && k !== "auto") {
      if (k === "json") return "application/json; charset=utf-8";
      if (k === "js") return "text/javascript; charset=utf-8";
      if (k === "css") return "text/css; charset=utf-8";
    }
    t = (t || "").trim();
    if (t.startsWith("{") || t.startsWith("[")) return "application/json; charset=utf-8";
    if (t.startsWith("/*") || t.includes("function") || t.includes("=>")) return "text/javascript; charset=utf-8";
    if (t.includes("{") && t.includes("}")) return "text/css; charset=utf-8";
    return "text/plain; charset=utf-8";
  };

  // Effective response header map for a mock: content-type plus the rule's header ops.
  function mockHeaderMap(rule, body) {
    const map = new Map();
    map.set("content-type", guessCT((rule.mock && rule.mock.kind) || "auto", body));
    if (Array.isArray(rule.headers)) for (const h of rule.headers) {
      if (!h || !h.header) continue;
      const op = (h.operation || "set").toLowerCase();
      const name = String(h.header).toLowerCase();
      if (op === "remove") map.delete(name);
      else map.set(name, h.value || "");
    }
    return map;
  }

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
    if (!trusted(ev) || !ev.data) return;
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
    const headers = new Headers({ "content-type": guessCT(kind, body) });
    if (Array.isArray(rule.headers)) for (const h of rule.headers) {
      const op=(h.operation||"set").toLowerCase();
      if(op==="set"&&h.header) headers.set(h.header,h.value||"");
      if(op==="remove"&&h.header) headers.delete(h.header);
    }
    if (rule.mock.waitForRealResponse) { try { await _fetch(req); } catch {} }
    const res = new Response(isNullBodyStatus(status) ? null : body, { status, statusText: statusTextFor(status), headers });
    // Constructed responses report url:"" and type:"default"; expose the request URL so
    // callers reading response.url behave like a real fetch.
    try { Object.defineProperty(res, "url", { value: abs, configurable: true }); } catch {}
    return res;
  };

  // ---- XHR ----
  // Page escape hatch: set window.ORO_XHR_HOOK = false to bypass the XHR hook entirely
  // (e.g. if a site's XHR wrapper is incompatible). Fetch mocks are unaffected.
  const xhrHookEnabled = () => window.ORO_XHR_HOOK !== false;
  (function(){
    const _open = XMLHttpRequest.prototype.open;
    const _send = XMLHttpRequest.prototype.send;
    const _protoAdd = XMLHttpRequest.prototype.addEventListener;
    const _protoRemove = XMLHttpRequest.prototype.removeEventListener;

    // Full XHR event surface we buffer/replay so libraries see a realistic lifecycle.
    const EV_TYPES = ["readystatechange", "loadstart", "progress", "load", "loadend", "error", "abort", "timeout"];

    // Coerce the mock body into the shape the caller expects per xhr.responseType.
    function buildXhrResponse(rt, mockBody) {
      try {
        if (rt === "" || rt === "text") return mockBody;
        if (rt === "json") { try { return JSON.parse(mockBody); } catch { return null; } }
        if (rt === "arraybuffer") return new TextEncoder().encode(mockBody).buffer;
        if (rt === "blob") return new Blob([mockBody]);
        if (rt === "document") { try { return new DOMParser().parseFromString(mockBody, "text/html"); } catch { return null; } }
      } catch {}
      return mockBody;
    }

    function applyMockProps(xhr, status, mockBody, rule) {
      const rt = xhr.responseType || "";
      const headerMap = mockHeaderMap(rule || { mock: {} }, mockBody);
      try { Object.defineProperty(xhr, "readyState", { configurable: true, value: 4 }); } catch {}
      try { Object.defineProperty(xhr, "status", { configurable: true, value: status }); } catch {}
      try { Object.defineProperty(xhr, "statusText", { configurable: true, value: statusTextFor(status) }); } catch {}
      // responseText is only valid when responseType is "" or "text" — mirror native behavior.
      try {
        Object.defineProperty(xhr, "responseText", {
          configurable: true,
          get() {
            if (rt !== "" && rt !== "text") throw new DOMException("responseText is only available if responseType is '' or 'text'.", "InvalidStateError");
            return mockBody;
          }
        });
      } catch {}
      try { Object.defineProperty(xhr, "response", { configurable: true, value: buildXhrResponse(rt, mockBody) }); } catch {}
      try { Object.defineProperty(xhr, "responseURL", { configurable: true, value: toAbs(xhr.__oroUrl || "") }); } catch {}
      try { Object.defineProperty(xhr, "getResponseHeader", { configurable: true, value(name) {
        const v = headerMap.get(String(name || "").toLowerCase());
        return v === undefined ? null : v;
      }}); } catch {}
      try { Object.defineProperty(xhr, "getAllResponseHeaders", { configurable: true, value() {
        let out = "";
        for (const [k, v] of headerMap) out += `${k}: ${v}\r\n`;
        return out;
      }}); } catch {}
    }

    // Invoke a buffered on* property handler plus any addEventListener listeners for `type`.
    function dispatch(xhr, type, event) {
      const b = xhr.__oroBuffered; if (!b) return;
      const onp = b.prop["on" + type];
      if (onp) try { onp.call(xhr, event); } catch {}
      for (const entry of (b.ev[type] || []).slice()) try { entry.fn.call(xhr, event); } catch {}
    }

    // Replay a plausible success lifecycle after a mock has been applied.
    function fireMockSuccess(xhr) {
      dispatch(xhr, "loadstart", new ProgressEvent("loadstart"));
      dispatch(xhr, "progress", new ProgressEvent("progress", { lengthComputable: false }));
      dispatch(xhr, "readystatechange", new Event("readystatechange"));
      dispatch(xhr, "load", new ProgressEvent("load"));
      dispatch(xhr, "loadend", new ProgressEvent("loadend"));
    }

    XMLHttpRequest.prototype.open = function(method, url, async = true, user, password) {
      this.__oroUrl = String(url);
      this.__oroMethod = String(method || "GET").toUpperCase();
      this.__oroCandidates = [];
      this.__oroBuffered = null;

      if (ORO.enabled && xhrHookEnabled()) {
        const abs = toAbs(this.__oroUrl || "");
        const cands = ORO.rules.filter(r =>
          r.enabled && r.action === "mockText" && r.mock && r.mock.mode === "after" &&
          r._compiledRegex && matchUrl(abs, r._compiledRegex, !!r.isCaseSensitive) &&
          methodMatches(this.__oroMethod, r)
        );
        if (cands.length) {
          // The request body isn't known until send(), so buffer the page's handlers for
          // every URL+method candidate and decide whether to mock once we can read the body.
          this.__oroCandidates = cands;
          this.__oroOrigAdd = _protoAdd;
          const origAdd = _protoAdd, origRemove = _protoRemove;
          const buffered = { ev: {}, prop: {} };
          for (const t of EV_TYPES) { buffered.ev[t] = []; buffered.prop["on" + t] = null; }
          this.__oroBuffered = buffered;

          this.addEventListener = function(type, listener, opts) {
            const arr = buffered.ev[type];
            if (arr && listener) {
              const fn = (typeof listener === "function") ? listener
                : (typeof listener.handleEvent === "function" ? (e) => listener.handleEvent(e) : null);
              if (fn) {
                const stub = function () { /* swallowed; replayed by ORO */ };
                arr.push({ fn, stub, raw: listener });
                return origAdd.call(this, type, stub, opts);
              }
            }
            return origAdd.call(this, type, listener, opts);
          };
          this.removeEventListener = function(type, listener, opts) {
            const arr = buffered.ev[type];
            if (arr) {
              const i = arr.findIndex(e => e.fn === listener || e.raw === listener);
              if (i >= 0) { const e = arr[i]; arr.splice(i, 1); return origRemove.call(this, type, e.stub, opts); }
            }
            return origRemove.call(this, type, listener, opts);
          };
          for (const t of EV_TYPES) {
            const on = "on" + t;
            Object.defineProperty(this, on, {
              configurable: true,
              set: (fn) => { buffered.prop[on] = fn; },
              get: () => buffered.prop[on]
            });
          }
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

      // No body match: run the real request and forward every real event to the buffered handlers.
      if (!rule) {
        const oa = xhr.__oroOrigAdd;
        for (const t of EV_TYPES) oa.call(xhr, t, (e) => dispatch(xhr, t, e));
        return _send.apply(this, arguments);
      }

      const mockBody = (rule.mock && rule.mock.body) || "";
      const status = (rule.mock && Number(rule.mock.status)) || 200;

      if (rule.mock && rule.mock.waitForRealResponse) {
        // Let the REAL XHR go through, swallow its completion, then replay with the mock.
        const oa = xhr.__oroOrigAdd;
        oa.call(xhr, "loadend", () => { applyMockProps(xhr, status, mockBody, rule); fireMockSuccess(xhr); }, { once: true });
        return _send.apply(this, arguments);
      }
      setTimeout(() => { applyMockProps(xhr, status, mockBody, rule); fireMockSuccess(xhr); }, 0);
    };
  })();

  window.postMessage({ type: "oro-main-ready" }, TARGET);
})();
