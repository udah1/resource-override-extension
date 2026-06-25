
import { DEFAULT_RESOURCE_TYPES, prettyfy, compilePattern, matchUrlWithCompiledRegex, wildcardToRegex } from "./utils.js";
import { initTheme, bindThemeControls } from "./theme.js";

const RULES_KEY = "oro_rules";
const MASTER_ENABLED_KEY = "oro_master_enabled";

const ACTION_META = {
  redirectUrl: { label: "redirect", cls: "redirect" },
  mockText: { label: "mock", cls: "mock" },
  modifyHeaders: { label: "headers", cls: "headers" },
  injectJS: { label: "inject js", cls: "inject" },
  injectCSS: { label: "inject css", cls: "inject" },
  block: { label: "block", cls: "block" },
};

const ICONS = {
  edit: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  dup: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  del: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
};

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

const els = {
  masterEnabled: document.getElementById("masterEnabled"),
  exportBtn: document.getElementById("exportBtn"),
  importBtn: document.getElementById("importBtn"),
  importFile: document.getElementById("importFile"),

  editorTitle: document.getElementById("editorTitle"),
  newRuleBtn: document.getElementById("newRuleBtn"),
  form: document.getElementById("ruleForm"),
  ruleId: document.getElementById("ruleId"),
  name: document.getElementById("name"),
  enabled: document.getElementById("enabled"),
  matchType: document.getElementById("matchType"),
  pattern: document.getElementById("pattern"),
  exclude: document.getElementById("exclude"),
  caseSensitive: document.getElementById("caseSensitive"),

  testMatchBtn: document.getElementById("testMatchBtn"),
  testMatchPanel: document.getElementById("testMatchPanel"),
  testUrl: document.getElementById("testUrl"),
  testMatchResult: document.getElementById("testMatchResult"),
  action: document.getElementById("action"),
  priority: document.getElementById("priority"),

  redirectUrlRow: document.getElementById("redirectUrlRow"),
  redirectUrl: document.getElementById("redirectUrl"),

  mockRow: document.getElementById("mockRow"),
  mockKind: document.getElementById("mockKind"),
  mockStatus: document.getElementById("mockStatus"),
  mockMode: document.getElementById("mockMode"),
  waitForReal: document.getElementById("waitForReal"),
  mockBody: document.getElementById("mockBody"),
  prettyBtn: document.getElementById("prettyBtn"),

  bodyMatchRow: document.getElementById("bodyMatchRow"),
  bodyMethod: document.getElementById("bodyMethod"),
  bodyMatchType: document.getElementById("bodyMatchType"),
  bodyMatchValue: document.getElementById("bodyMatchValue"),

  headersRow: document.getElementById("headersRow"),
  headersList: document.getElementById("headersList"),
  addHeaderBtn: document.getElementById("addHeaderBtn"),
  exposeHeaders: document.getElementById("exposeHeaders"),

  injectRow: document.getElementById("injectRow"),
  injectBody: document.getElementById("injectBody"),
  prettyInjectBtn: document.getElementById("prettyInjectBtn"),

  resourceTypes: document.getElementById("resourceTypes"),
  rules: document.getElementById("rules"),
  saveBtn: document.getElementById("saveBtn"),
  resetBtn: document.getElementById("resetBtn"),
};

let state = { rules: [], masterEnabled: true };

function cid() { return String(Date.now()) + "-" + Math.random().toString(36).slice(2,8); }

async function load() {
  const data = await chrome.storage.local.get([RULES_KEY, MASTER_ENABLED_KEY]);
  state.rules = Array.isArray(data[RULES_KEY]) ? data[RULES_KEY] : [];
  state.masterEnabled = (typeof data[MASTER_ENABLED_KEY] === "boolean") ? data[MASTER_ENABLED_KEY] : true;
  els.masterEnabled.checked = !!state.masterEnabled;
  renderRules();
}
load();

els.masterEnabled.addEventListener("change", async (e) => {
  const enabled = !!e.currentTarget.checked;
  await chrome.runtime.sendMessage({ type: "oro-toggle-master", enabled });
});

function renderResourceTypeChips(currentSelection) {
  const selected = new Set(Array.isArray(currentSelection) && currentSelection.length ? currentSelection : DEFAULT_RESOURCE_TYPES);
  els.resourceTypes.innerHTML = "";
  for (const t of DEFAULT_RESOURCE_TYPES) {
    const d = document.createElement("div");
    d.className = "chip" + (selected.has(t) ? " selected" : "");
    d.textContent = t;
    d.dataset.type = t;
    d.addEventListener("click", () => {
      d.classList.toggle("selected");
    });
    els.resourceTypes.appendChild(d);
  }
}

function resetForm() {
  els.editorTitle.textContent = "Add Rule";
  els.ruleId.value = "";
  els.name.value = "";
  els.enabled.checked = true;
  els.matchType.value = "wildcard";
  els.pattern.value = "";
  els.exclude.value = "";
  els.caseSensitive.checked = false;
  els.action.value = "redirectUrl";
  els.priority.value = "1";
  els.redirectUrl.value = "";
  els.mockKind.value = "json";
  els.mockStatus.value = "200";
  els.mockMode.value = "immediate";
  els.waitForReal.checked = false;
  els.mockBody.value = "";
  els.bodyMethod.value = "*";
  els.bodyMatchType.value = "none";
  els.bodyMatchValue.value = "";
  els.headersList.innerHTML = "";
  els.injectBody.value = "";
  if (els.testMatchPanel) { els.testMatchPanel.hidden = true; els.testMatchBtn.classList.remove("active"); els.testMatchBtn.textContent = "Test match"; }
  if (els.testUrl) els.testUrl.value = "";
  setTestResult("", "");
  renderResourceTypeChips();
  updateActionVisibility();
}

function updateActionVisibility() {
  const act = els.action.value;
  els.redirectUrlRow.classList.toggle("active", act === "redirectUrl");
  els.mockRow.classList.toggle("active", act === "mockText");
  els.bodyMatchRow.classList.toggle("active", act === "mockText" && els.mockMode.value === "after");
  els.headersRow.classList.toggle("active", act === "modifyHeaders");
  els.injectRow.classList.toggle("active", act === "injectJS" || act === "injectCSS");
  const pill = document.getElementById("editorTypePill");
  if (pill) {
    const m = ACTION_META[act];
    pill.className = "pill" + (m ? " " + m.cls : "");
    pill.textContent = m ? m.label : "";
  }
}

function refreshActiveHighlight() {
  const cur = els.ruleId.value;
  els.rules.querySelectorAll(".item").forEach(it => {
    it.classList.toggle("active", !!cur && it.dataset.id === String(cur));
  });
}

function setTestResult(cls, text) {
  els.testMatchResult.className = "test-result" + (cls ? " " + cls : "");
  els.testMatchResult.textContent = text;
}

function evaluateTestMatch() {
  if (!els.testMatchPanel || els.testMatchPanel.hidden) return;
  const url = els.testUrl.value.trim();
  if (!url) { setTestResult("", ""); return; }

  const matchType = els.matchType.value;
  const caseSensitive = els.caseSensitive.checked;
  const rule = { matchType, pattern: els.pattern.value.trim() };

  // Validate regex up front so we can give a clearer message than "no match".
  const compiled = compilePattern(rule);
  try { new RegExp(compiled); } catch {
    setTestResult("invalid", "Invalid regex pattern");
    return;
  }

  const matched = matchUrlWithCompiledRegex(url, compiled, caseSensitive);

  const exParts = els.exclude.value.trim()
    ? els.exclude.value.split(",").map(s => s.trim()).filter(Boolean)
    : [];
  let excludedBy = null;
  for (const p of exParts) {
    const exRe = matchType === "regex" ? p : wildcardToRegex(p);
    try { new RegExp(exRe); } catch { continue; }
    if (matchUrlWithCompiledRegex(url, exRe, caseSensitive)) { excludedBy = p; break; }
  }

  if (matched && !excludedBy) {
    setTestResult("ok", "✓ Matches — this rule would apply");
  } else if (matched && excludedBy) {
    setTestResult("warn", `✗ Pattern matches, but URL is excluded by “${excludedBy}”`);
  } else {
    setTestResult("fail", "✗ No match");
  }
}

function toggleTestPanel() {
  const willShow = els.testMatchPanel.hidden;
  els.testMatchPanel.hidden = !willShow;
  els.testMatchBtn.classList.toggle("active", willShow);
  els.testMatchBtn.textContent = willShow ? "Hide match" : "Test match";
  if (willShow) {
    els.testUrl.focus();
    evaluateTestMatch();
  }
}

function addHeaderRow(h = { header: "", operation: "set", value: "" }) {
  const headerVal = (h && h.header) ? h.header : "";
  const op = (h && h.operation) ? h.operation : "set";
  const valueVal = (h && typeof h.value === "string") ? h.value : "";

  const row = document.createElement("div");
  row.className = "header-row";
  row.innerHTML = `
    <input placeholder="Header name" value="${headerVal.replace(/"/g,'&quot;')}">
    <select>
      <option value="set" ${op !== "remove" ? "selected": ""}>set</option>
      <option value="remove" ${op === "remove" ? "selected": ""}>remove</option>
    </select>
    <input placeholder="Value" value="${valueVal.replace(/"/g,'&quot;')}">
    <button type="button" title="Delete">✕</button>
  `;
  const delEl = row.querySelector("button");
  delEl.addEventListener("click", () => row.remove());
  els.headersList.appendChild(row);
}

function collectHeaders() {
  const rows = els.headersList.querySelectorAll(".header-row");
  const out = [];
  rows.forEach(r => {
    const inputs = r.querySelectorAll("input, select");
    const header = inputs[0].value.trim();
    const operation = inputs[1].value;
    const value = inputs[2].value;
    if (header) out.push({ header, operation, value });
  });
  return out;
}

function renderRules() {
  els.rules.innerHTML = "";
  const countEl = document.getElementById("ruleCount");
  if (countEl) countEl.textContent = "· " + state.rules.length;
  if (!state.rules.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No rules yet. Click “+ New rule” to add one.";
    els.rules.appendChild(empty);
    return;
  }
  state.rules.forEach((r, idx) => {
    const item = document.createElement("div");
    item.className = "item" + (r.enabled ? "" : " disabled");
    item.dataset.id = r.id;
    if (els.ruleId.value && String(els.ruleId.value) === String(r.id)) item.classList.add("active");

    const meta = ACTION_META[r.action] || { label: r.action, cls: "" };
    const badges = [];
    if (r.action === "mockText") {
      const mode = (r.mock && r.mock.mode) || "immediate";
      badges.push(mode);
      if (mode === "after") {
        if (r.method && r.method !== "*") badges.push(r.method);
        if (r.bodyMatch && r.bodyMatch.value) badges.push("body");
      }
    }
    const badgeHtml = badges.length
      ? `<span class="badge${badges[0] === "after" ? " after" : ""}">${escapeHtml(badges.join(" · "))}</span>`
      : "";

    item.innerHTML = `
      <input type="checkbox" ${r.enabled ? "checked" : ""} title="Enable / disable">
      <div class="rule-main">
        <div class="name">${escapeHtml(r.name || "(no name)")} <span class="pill ${meta.cls}">${escapeHtml(meta.label)}</span> ${badgeHtml}</div>
        <div class="meta"><span class="url">${escapeHtml((r.matchType || "wildcard") + ": " + (r.pattern || "*"))}</span></div>
      </div>
      <div class="row-actions">
        <button class="icon-btn" data-act="edit" title="Edit">${ICONS.edit}</button>
        <button class="icon-btn" data-act="dup" title="Duplicate">${ICONS.dup}</button>
        <button class="icon-btn danger" data-act="del" title="Delete">${ICONS.del}</button>
      </div>
    `;
    const chk = item.querySelector('input[type="checkbox"]');
    chk.addEventListener("change", async () => {
      r.enabled = chk.checked;
      item.classList.toggle("disabled", !chk.checked);
      // If this rule is currently open in the editor, reflect the change there immediately.
      if (els.ruleId.value && String(els.ruleId.value) === String(r.id)) {
        els.enabled.checked = chk.checked;
      }
      await chrome.storage.local.set({ [RULES_KEY]: state.rules });
    });
    item.querySelector('[data-act="edit"]').addEventListener("click", () => {
      els.editorTitle.textContent = "Edit Rule";
      els.ruleId.value = r.id;
      els.name.value = r.name || "";
      els.enabled.checked = !!r.enabled;
      els.matchType.value = r.matchType || "wildcard";
      els.pattern.value = r.pattern || "";
      els.exclude.value = (r.exclude || []).join(", ");
      els.caseSensitive.checked = !!r.isCaseSensitive;
      els.action.value = r.action || "redirectUrl";
      els.priority.value = r.priority || 1;
      els.redirectUrl.value = r.redirectUrl || "";
      els.mockKind.value = (r.mock && r.mock.kind) || "json";
      els.mockStatus.value = (r.mock && (r.mock.status || 200)) || 200;
      els.mockMode.value = (r.mock && r.mock.mode) || "immediate";
      els.waitForReal.checked = !!(r.mock && r.mock.waitForRealResponse);
      els.mockBody.value = (r.mock && r.mock.body) || "";
      els.bodyMethod.value = r.method || "*";
      els.bodyMatchType.value = (r.bodyMatch && r.bodyMatch.type) || "none";
      els.bodyMatchValue.value = (r.bodyMatch && r.bodyMatch.value) || "";
      els.headersList.innerHTML = "";
      (r.headers || []).forEach(h => addHeaderRow(h));
      els.injectBody.value = (r.inject && r.inject.body) || "";
      renderResourceTypeChips(Array.isArray(r.resourceTypes) ? r.resourceTypes : DEFAULT_RESOURCE_TYPES);
      updateActionVisibility();
      refreshActiveHighlight();
    });
    item.querySelector('[data-act="dup"]').addEventListener("click", async () => {
      const copy = JSON.parse(JSON.stringify(r));
      copy.id = cid();
      copy.name = (copy.name || "") + " (copy)";
      state.rules.push(copy);
      await chrome.storage.local.set({ [RULES_KEY]: state.rules });
    });
    item.querySelector('[data-act="del"]').addEventListener("click", async () => {
      state.rules.splice(idx, 1);
      await chrome.storage.local.set({ [RULES_KEY]: state.rules });
    });
    els.rules.appendChild(item);
  });
}

els.action.addEventListener("change", updateActionVisibility);
els.mockMode.addEventListener("change", updateActionVisibility);

els.testMatchBtn.addEventListener("click", toggleTestPanel);
els.testUrl.addEventListener("input", evaluateTestMatch);
els.pattern.addEventListener("input", evaluateTestMatch);
els.exclude.addEventListener("input", evaluateTestMatch);
els.matchType.addEventListener("change", evaluateTestMatch);
els.caseSensitive.addEventListener("change", evaluateTestMatch);
els.prettyBtn.addEventListener("click", () => {
  const kind = els.mockKind.value;
  els.mockBody.value = prettyfy(kind === "auto" ? "json" : kind, els.mockBody.value);
});
els.prettyInjectBtn.addEventListener("click", () => {
  const kind = (els.action.value === "injectCSS") ? "css" : "js";
  els.injectBody.value = prettyfy(kind, els.injectBody.value);
});
els.addHeaderBtn.addEventListener("click", () => addHeaderRow());
els.resetBtn.addEventListener("click", resetForm);
els.newRuleBtn.addEventListener("click", resetForm);

els.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = els.ruleId.value || cid();
  const resourceTypes = Array.from(els.resourceTypes.querySelectorAll(".chip.selected")).map(c => c.dataset.type);
  const desc = {
    id,
    name: els.name.value.trim(),
    enabled: els.enabled.checked,
    matchType: els.matchType.value,
    pattern: els.pattern.value.trim(),
    exclude: els.exclude.value.trim() ? els.exclude.value.split(",").map(s=>s.trim()).filter(Boolean) : [],
    isCaseSensitive: els.caseSensitive.checked,
    action: els.action.value,
    priority: Number(els.priority.value) || 1,
    resourceTypes
  };
  if (desc.action === "redirectUrl") {
    desc.redirectUrl = els.redirectUrl.value.trim();
  } else if (desc.action === "mockText") {
    desc.mock = {
      kind: els.mockKind.value,
      status: Number(els.mockStatus.value) || 200,
      mode: els.mockMode.value,
      waitForRealResponse: !!els.waitForReal.checked,
      body: els.mockBody.value
    };
    if (desc.mock.mode === "after") {
      desc.method = els.bodyMethod.value || "*";
      const bmType = els.bodyMatchType.value;
      if (bmType && bmType !== "none" && els.bodyMatchValue.value.trim()) {
        desc.bodyMatch = { type: bmType, value: els.bodyMatchValue.value };
      }
    }
  } else if (desc.action === "modifyHeaders") {
    desc.headers = collectHeaders();
  } else if (desc.action === "injectJS" || desc.action === "injectCSS") {
    desc.inject = { body: els.injectBody.value };
  }
  const idx = state.rules.findIndex(r => r.id === id);
  if (idx >= 0) { state.rules[idx] = desc; } else { state.rules.push(desc); }
  // Stay on the current rule after saving (don't reset to "Add Rule").
  els.ruleId.value = id;
  els.editorTitle.textContent = "Edit Rule";
  await chrome.storage.local.set({ [RULES_KEY]: state.rules });
  refreshActiveHighlight();
});

els.exportBtn.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state.rules, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "oro-rules.json"; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
els.importBtn.addEventListener("click", () => els.importFile.click());
els.importFile.addEventListener("change", async (e) => {
  const f = e.target.files[0]; if (!f) return;
  const text = await f.text();
  try { const list = JSON.parse(text); if (Array.isArray(list)) { state.rules = list; await chrome.storage.local.set({ [RULES_KEY]: state.rules }); } }
  catch { alert("Invalid JSON"); } finally { e.target.value = ""; }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[RULES_KEY]) { state.rules = changes[RULES_KEY].newValue || []; renderRules(); }
});

resetForm();


// ---- Theme (variant + light/dark/system) ----
initTheme().then(() => {
  bindThemeControls({
    modeBtn: document.getElementById("modeToggle"),
    variantSelect: document.getElementById("variantSelect"),
  });
});
