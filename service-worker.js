
import { wildcardToRegex, guessContentType, toDataUrl, normalizeResourceTypes, compilePattern } from "./utils.js";

const RULES_KEY = "oro_rules";
const MASTER_ENABLED_KEY = "oro_master_enabled";
const RULE_ERRORS_KEY = "oro_rule_errors";
const LEGACY_LAST_ID_KEY = "oro_last_rule_id";
const DNR_ID_START = 1000;
const TEMP_ID_START = 900000; // disjoint range for non-matching validation probes
const MAX_DYNAMIC_RULES = (chrome.declarativeNetRequest && chrome.declarativeNetRequest.MAX_NUMBER_OF_DYNAMIC_RULES) || 5000;

function cid() { return String(Date.now()) + "-" + Math.random().toString(36).slice(2, 8); }

async function getStorage(keys) { return await chrome.storage.local.get(keys); }
async function setStorage(obj) { return await chrome.storage.local.set(obj); }

// Coerce stored rules into a consistent shape and guarantee unique string ids.
// Runs on upgrade/startup (not only on import) so legacy data can't break the rebuild.
function normalizeRules(rules) {
  if (!Array.isArray(rules)) return { rules: [], changed: true };
  let changed = false;
  const seen = new Set();
  const out = rules.map(r => {
    const o = (r && typeof r === "object") ? { ...r } : {};
    if (typeof o.id !== "string" || !o.id || seen.has(o.id)) { o.id = cid(); changed = true; }
    seen.add(o.id);
    if (typeof o.enabled !== "boolean") { o.enabled = true; changed = true; }
    if (typeof o.matchType !== "string") { o.matchType = "wildcard"; changed = true; }
    if (typeof o.pattern !== "string") { o.pattern = ""; changed = true; }
    if (!Array.isArray(o.exclude)) { o.exclude = (o.exclude == null || o.exclude === "") ? [] : [].concat(o.exclude); changed = true; }
    if (typeof o.action !== "string") { o.action = "redirectUrl"; changed = true; }
    return o;
  });
  return { rules: out, changed };
}

async function ensureDefaults() {
  const data = await getStorage([RULES_KEY, MASTER_ENABLED_KEY, LEGACY_LAST_ID_KEY]);
  const updates = {};
  const norm = normalizeRules(data[RULES_KEY]);
  if (!Array.isArray(data[RULES_KEY]) || norm.changed) updates[RULES_KEY] = norm.rules;
  if (typeof data[MASTER_ENABLED_KEY] !== "boolean") updates[MASTER_ENABLED_KEY] = true;
  if (Object.keys(updates).length) await setStorage(updates);
  if (LEGACY_LAST_ID_KEY in data) { try { await chrome.storage.local.remove(LEGACY_LAST_ID_KEY); } catch {} }
}

const ICON_PATHS = { 16: "icons/icon16.png", 32: "icons/icon32.png", 48: "icons/icon48.png", 128: "icons/icon128.png" };
let _baseIconBitmap = null;

async function getBaseIcon() {
  if (_baseIconBitmap) return _baseIconBitmap;
  const resp = await fetch(chrome.runtime.getURL("icons/icon128.png"));
  const blob = await resp.blob();
  _baseIconBitmap = await createImageBitmap(blob);
  return _baseIconBitmap;
}

async function drawIconWithBadge(count) {
  const size = 128;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  const base = await getBaseIcon();
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(base, 0, 0, size, size);

  const label = count > 99 ? "99+" : String(count);
  // Tuck the badge into the bottom-right corner, pushed further off the edge so a
  // slightly larger disc still hides as little of the icon as possible. Chrome's
  // native badge can't be moved, so we render our own here.
  const r = 42;
  const cx = size - r + 16;  // shift right (well off the right edge)
  const cy = size - r + 16;  // shift down  (well off the bottom edge)

  // White outline ring for contrast against the icon, then the red disc.
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, r - 6, 0, Math.PI * 2);
  ctx.fillStyle = "#EF4444";
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const fontPx = label.length >= 3 ? 36 : (label.length === 2 ? 46 : 54);
  ctx.font = `bold ${fontPx}px -apple-system, "Helvetica Neue", Arial, sans-serif`;
  ctx.fillText(label, cx, cy + 2);

  return ctx.getImageData(0, 0, size, size);
}

async function updateBadge() {
  try {
    const { [RULES_KEY]: rules, [MASTER_ENABLED_KEY]: masterEnabled } = await getStorage([RULES_KEY, MASTER_ENABLED_KEY]);
    const on = masterEnabled !== false;
    const count = on ? (rules || []).filter(r => r && r.enabled).length : 0;

    // Always keep the native badge cleared (we draw our own corner badge).
    try { await chrome.action.setBadgeText({ text: "" }); } catch {}

    if (count > 0 && typeof OffscreenCanvas !== "undefined") {
      const imageData = await drawIconWithBadge(count);
      await chrome.action.setIcon({ imageData });
    } else {
      // No active rules → restore the plain icon.
      await chrome.action.setIcon({ path: ICON_PATHS });
    }
  } catch (e) { /* action API may be unavailable in some contexts */ }
}


function buildDnrRuleFromDescriptor(desc, id) {
  if (!desc.enabled) return null;
  if (desc.action === "injectJS" || desc.action === "injectCSS") return null;
  if (desc.action === "mockText" && desc.mock && desc.mock.mode === "after") return null; // handled in page hook

  const resourceTypes = normalizeResourceTypes(desc.resourceTypes);
  const condition = { resourceTypes };

  if (desc.matchType === "regex") {
    condition.regexFilter = desc.pattern || ".*";
  } else {
    condition.urlFilter = desc.pattern && desc.pattern.length ? desc.pattern : "*";
  }

  if (Array.isArray(desc.exclude) && desc.exclude.length) {
    const exParts = desc.exclude.map(p => (desc.matchType === "regex" ? `(${p})` : `(${wildcardToRegex(p)})`));
    condition.excludedRegexFilter = exParts.join("|");
  }

  const rule = { id, priority: desc.priority || 1, action: {}, condition };

  if (desc.action === "redirectUrl") {
    rule.action.type = "redirect";
    rule.action.redirect = { url: desc.redirectUrl };
  } else if (desc.action === "mockText") {
    const kind = (desc.mock && desc.mock.kind) || "auto";
    const contentType = guessContentType(kind, desc.mock?.body || "");
    const dataUrl = toDataUrl(desc.mock?.body || "", contentType);
    rule.action.type = "redirect";
    rule.action.redirect = { url: dataUrl };
  } else if (desc.action === "modifyHeaders") {
    rule.action.type = "modifyHeaders";
    const hdrs = (desc.headers || []).map(h => {
      const op = (h.operation || "set").toLowerCase();
      const item = { header: h.header, operation: op === "remove" ? "remove" : "set" };
      if (item.operation === "set") item.value = h.value ?? "";
      return item;
    });
    if (desc.exposeHeaders) {
      const setNames = (desc.headers || []).filter(h => (h.operation || "set").toLowerCase() !== "remove" && h.header).map(h => h.header.trim()).filter(Boolean);
      if (setNames.length) {
        hdrs.push({ header: "Access-Control-Expose-Headers", operation: "set", value: setNames.join(", ") });
      }
    }
    rule.action.responseHeaders = hdrs;
  } else if (desc.action === "block") {
    rule.action.type = "block";
  } else {
    return null;
  }
  return rule;
}


async function regexOk(regex, isCaseSensitive) {
  try {
    const res = await chrome.declarativeNetRequest.isRegexSupported({ regex, isCaseSensitive: !!isCaseSensitive });
    return !!(res && res.isSupported);
  } catch { return false; }
}

// Validate each candidate's ACTION by briefly adding it under a guaranteed
// non-matching condition in a disjoint temp-id range (so it can never intercept
// real traffic), then removing it. Returns the rules DNR accepts. Regex conditions
// are already validated up-front via isRegexSupported, so probes use a urlFilter.
async function probeGoodRules(candidates, idToUser, errors) {
  const good = [];
  let tempId = TEMP_ID_START;
  for (const rule of candidates) {
    const probe = {
      id: tempId++,
      priority: rule.priority,
      action: rule.action,
      condition: { urlFilter: "|https://oro-probe.invalid/__never__", resourceTypes: ["main_frame"] }
    };
    try {
      await chrome.declarativeNetRequest.updateDynamicRules({ addRules: [probe] });
      good.push(rule);
    } catch (e) {
      errors.push({ ruleId: idToUser.get(rule.id) ?? null, reason: "rejected by DNR: " + e, at: Date.now() });
    } finally {
      try { await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [probe.id] }); } catch {}
    }
  }
  return good;
}

async function doRebuild() {
  const data = await getStorage([RULES_KEY, MASTER_ENABLED_KEY]);
  const rules = Array.isArray(data[RULES_KEY]) ? data[RULES_KEY] : [];
  const masterEnabled = data[MASTER_ENABLED_KEY] !== false;
  const errors = [];
  const toAdd = [];
  const idToUser = new Map();

  if (masterEnabled) {
    for (let index = 0; index < rules.length; index++) {
      const r = rules[index];
      const id = DNR_ID_START + index; // disabled/after/inject reserve a slot but emit nothing
      let rule;
      try { rule = buildDnrRuleFromDescriptor(r, id); }
      catch (e) { errors.push({ ruleId: r && r.id, reason: "build failed: " + e, at: Date.now() }); continue; }
      if (!rule) continue;
      if (rule.condition.regexFilter && !(await regexOk(rule.condition.regexFilter, r.isCaseSensitive))) {
        errors.push({ ruleId: r.id, reason: "unsupported regexFilter", at: Date.now() }); continue;
      }
      if (rule.condition.excludedRegexFilter && !(await regexOk(rule.condition.excludedRegexFilter, r.isCaseSensitive))) {
        errors.push({ ruleId: r.id, reason: "unsupported excludedRegexFilter", at: Date.now() }); continue;
      }
      idToUser.set(id, r.id);
      toAdd.push(rule);
    }
  }

  if (toAdd.length > MAX_DYNAMIC_RULES) {
    errors.push({ ruleId: null, reason: `too many active rules (${toAdd.length} > ${MAX_DYNAMIC_RULES})`, at: Date.now() });
    toAdd.length = MAX_DYNAMIC_RULES;
  }

  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.map(r => r.id); // live rules + any orphaned temp probes

  try {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules: toAdd });
  } catch (e) {
    // Atomic update failed → nothing changed (old rules still live). Find the bad ones
    // without touching live traffic, then apply only the good rules.
    const good = await probeGoodRules(toAdd, idToUser, errors);
    try {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules: good });
    } catch (e2) {
      errors.push({ ruleId: null, reason: "final DNR update failed: " + e2, at: Date.now() });
      // Leave existing rules as-is (degraded). Do not retry-loop.
    }
  }

  await setStorage({ [RULE_ERRORS_KEY]: errors });

  // notify tabs
  chrome.tabs.query({}, tabs => {
    for (const t of tabs) {
      if (t.id) chrome.tabs.sendMessage(t.id, { type: "oro-rules-updated" }).catch(() => {});
    }
  });

  await updateBadge();
}

// Single-flight with coalescing: overlapping triggers collapse into one trailing run,
// and each run re-reads storage so it always applies the latest snapshot.
let _rebuilding = false;
let _rebuildQueued = false;
async function rebuildDynamicRules() {
  if (_rebuilding) { _rebuildQueued = true; return; }
  _rebuilding = true;
  try {
    do { _rebuildQueued = false; await doRebuild(); } while (_rebuildQueued);
  } finally {
    _rebuilding = false;
  }
}

chrome.runtime.onInstalled.addListener(async () => { await ensureDefaults(); await rebuildDynamicRules(); });
chrome.runtime.onStartup.addListener(async () => { await ensureDefaults(); await rebuildDynamicRules(); });
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;
  if (changes[RULES_KEY] || changes[MASTER_ENABLED_KEY]) { await rebuildDynamicRules(); }
});


chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg && msg.type === "oro-get-rules-for-content") {
      const { [RULES_KEY]: rules, [MASTER_ENABLED_KEY]: masterEnabled } = await getStorage([RULES_KEY, MASTER_ENABLED_KEY]);
      const enabled = masterEnabled !== false;
      const forContent = (rules || []).filter(r => r.enabled && ( (r.action === "mockText" && r?.mock) || r.action === "injectJS" || r.action === "injectCSS" ));
      for (const r of forContent) { r._compiledRegex = compilePattern(r); }
      sendResponse({ enabled, rules: forContent });
    } else if (msg && msg.type === "oro-toggle-master") {
      // storage.onChanged triggers the (coalesced) rebuild — no explicit call needed.
      await setStorage({ [MASTER_ENABLED_KEY]: !!msg.enabled });
      sendResponse({ ok: true });
    } else if (msg && msg.type === "oro-inject-main-hook") {
      const tabId = sender?.tab?.id;
      if (tabId) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ["page-hook.js"],
            world: "MAIN"
          });
          sendResponse({ ok: true });
        } catch (e) {
          sendResponse({ ok: false, error: String(e) });
        }
      } else {
        sendResponse({ ok: false, error: "No tabId" });
      }
    }
  })();
  return true;
});
