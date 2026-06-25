
import { wildcardToRegex, guessContentType, toDataUrl, normalizeResourceTypes, compilePattern } from "./utils.js";

const RULES_KEY = "oro_rules";
const MASTER_ENABLED_KEY = "oro_master_enabled";
const LAST_RULE_ID_KEY = "oro_last_rule_id";
const DNR_ID_START = 1000;

async function getStorage(keys) { return await chrome.storage.local.get(keys); }
async function setStorage(obj) { return await chrome.storage.local.set(obj); }

async function ensureDefaults() {
  const { [RULES_KEY]: rules, [MASTER_ENABLED_KEY]: enabled, [LAST_RULE_ID_KEY]: lastId } = await getStorage([RULES_KEY, MASTER_ENABLED_KEY, LAST_RULE_ID_KEY]);
  const updates = {};
  if (!Array.isArray(rules)) updates[RULES_KEY] = [];
  if (typeof enabled !== "boolean") updates[MASTER_ENABLED_KEY] = true;
  if (typeof lastId !== "number") updates[LAST_RULE_ID_KEY] = DNR_ID_START;
  if (Object.keys(updates).length) await setStorage(updates);
}

function nextRuleIdGen(start) { let current = start; return () => (++current); }

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
  // Tuck the badge into the bottom-right corner (pushed right + down) so it
  // overlaps the icon as little as possible. Chrome's native badge can't be moved,
  // so we render our own here.
  const r = 38;
  const cx = size - r + 8;   // shift right (slightly off the right edge)
  const cy = size - r + 8;   // shift down  (slightly off the bottom edge)

  // White outline ring for contrast against the icon, then the green disc.
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, r - 6, 0, Math.PI * 2);
  ctx.fillStyle = "#22C55E";
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const fontPx = label.length >= 3 ? 34 : (label.length === 2 ? 44 : 52);
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


function buildDnrRuleFromDescriptor(desc, getId) {
  if (!desc.enabled) return null;
  if (desc.action === "injectJS" || desc.action === "injectCSS") return null;
  if (desc.action === "mockText" && desc.mock && desc.mock.mode === "after") return null; // handled in page hook

  const id = getId();
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


async function rebuildDynamicRules() {
  const { [RULES_KEY]: rules, [MASTER_ENABLED_KEY]: masterEnabled, [LAST_RULE_ID_KEY]: lastId } = await getStorage([RULES_KEY, MASTER_ENABLED_KEY, LAST_RULE_ID_KEY]);
  const getId = nextRuleIdGen(lastId || DNR_ID_START);

  const toAdd = [];
  if (masterEnabled !== false) {
    for (const r of (rules || [])) {
      const d = buildDnrRuleFromDescriptor(r, getId);
      if (d) toAdd.push(d);
    }
  }
  const newLastId = toAdd.reduce((m, r) => Math.max(m, r.id), lastId || DNR_ID_START);
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: Array.from({length: Math.max(0,(lastId||DNR_ID_START)+1000)}, (_,i)=>i).filter(x=>x>=DNR_ID_START && x<= (lastId||DNR_ID_START)+1000),
    addRules: toAdd
  });
  await setStorage({ [LAST_RULE_ID_KEY]: newLastId });

  // notify tabs
  chrome.tabs.query({}, tabs => {
    for (const t of tabs) {
      if (t.id) chrome.tabs.sendMessage(t.id, { type: "oro-rules-updated" }).catch(()=>{});
    }
  });

  await updateBadge();
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
      await setStorage({ [MASTER_ENABLED_KEY]: !!msg.enabled });
      await rebuildDynamicRules();
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
