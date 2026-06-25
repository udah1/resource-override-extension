
export const DEFAULT_RESOURCE_TYPES = [
  "main_frame","sub_frame","stylesheet","script","image","font","media","xmlhttprequest","ping","csp_report","websocket","other"
];
export function wildcardToRegex(pattern) {
  if (!pattern) return ".*";
  const escaped = pattern.replace(/[-\/\\^$+?.()|[\]{}]/g, "\\$&");
  return "^" + escaped.replace(/\*/g, ".*") + "$";
}
export function guessContentType(kind, body) {
  if (kind && kind !== "auto") {
    if (kind === "json") return "application/json; charset=utf-8";
    if (kind === "js")   return "text/javascript; charset=utf-8";
    if (kind === "css")  return "text/css; charset=utf-8";
  }
  const t = (body || "").trim();
  if (t.startsWith("{") || t.startsWith("[")) return "application/json; charset=utf-8";
  if (t.startsWith("/*") || t.includes("function") || t.includes("=>")) return "text/javascript; charset=utf-8";
  if (t.includes("{") && t.includes("}")) return "text/css; charset=utf-8";
  return "text/plain; charset=utf-8";
}
export function prettyfy(kind, text) {
  const t = (text || "");
  if (kind === "json") {
    try { return JSON.stringify(JSON.parse(t), null, 2); } catch { return t; }
  }
  const withBreaks = t.replace(/;/g, ";\n").replace(/{/g, "{\n").replace(/}/g, "\n}\n");
  const lines = withBreaks.split(/\r?\n/);
  let depth = 0, out = [];
  for (let line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { out.push(""); continue; }
    if (trimmed.startsWith("}")) depth = Math.max(0, depth - 1);
    out.push("  ".repeat(depth) + trimmed);
    if (trimmed.endsWith("{")) depth += 1;
  }
  return out.join("\n");
}
export function toDataUrl(body, contentType) {
  const b64 = btoa(unescape(encodeURIComponent(body || "")));
  return `data:${contentType};base64,${b64}`;
}
export function normalizeResourceTypes(types) {
  const set = new Set(DEFAULT_RESOURCE_TYPES);
  return (Array.isArray(types) ? types : DEFAULT_RESOURCE_TYPES).filter(t => set.has(t));
}
export function compilePattern(rule) {
  if (rule.matchType === "regex") {
    return rule.pattern || ".*";
  } else {
    return wildcardToRegex(rule.pattern || "*");
  }
}
export function matchUrlWithCompiledRegex(url, compiledRegex, caseSensitive=false) {
  try {
    const re = new RegExp(compiledRegex, caseSensitive ? "" : "i");
    return re.test(url);
  } catch (e) {
    console.warn("Bad regex", compiledRegex, e);
    return false;
  }
}
