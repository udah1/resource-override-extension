// Shared theme manager: two independent axes
//  - variant: visual skin (devtools | saas | terminal)
//  - mode:    color mode (system | light | dark), default "system" (follows OS)
// Applied as attributes on <html>: data-variant, data-mode (resolved), data-mode-pref (raw choice).

export const VARIANTS = [
  ["devtools", "DevTools Pro"],
  ["saas", "Clean Light"],
  ["terminal", "Terminal"],
];
export const MODES = ["system", "light", "dark"];

// Each variant has its own natural default color mode.
const DEFAULT_MODE = { devtools: "dark", saas: "light", terminal: "dark" };

const VKEY = "oro_theme_variant";
const MMKEY = "oro_theme_modes"; // per-variant mode map: { devtools, saas, terminal }

const mql = window.matchMedia("(prefers-color-scheme: dark)");
const state = { variant: "devtools", modes: {} };
const listeners = [];

function currentMode() {
  return state.modes[state.variant] || DEFAULT_MODE[state.variant] || "system";
}

function effectiveMode(mode) {
  return mode === "system" ? (mql.matches ? "dark" : "light") : mode;
}

function apply() {
  const r = document.documentElement;
  const mode = currentMode();
  r.setAttribute("data-variant", state.variant);
  r.setAttribute("data-mode", effectiveMode(mode));
  r.setAttribute("data-mode-pref", mode);
}

function notify() {
  const snap = getTheme();
  for (const fn of listeners) { try { fn(snap); } catch {} }
}

export function getTheme() {
  const mode = currentMode();
  return { variant: state.variant, mode, effective: effectiveMode(mode) };
}

export function onThemeChange(fn) { listeners.push(fn); }

export async function initTheme() {
  try {
    const d = await chrome.storage.local.get([VKEY, MMKEY]);
    if (VARIANTS.some(v => v[0] === d[VKEY])) state.variant = d[VKEY];
    if (d[MMKEY] && typeof d[MMKEY] === "object") {
      for (const [k, v] of Object.entries(d[MMKEY])) {
        if (MODES.includes(v)) state.modes[k] = v;
      }
    }
  } catch {}
  apply();

  mql.addEventListener("change", () => { if (currentMode() === "system") { apply(); notify(); } });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    let changed = false;
    if (changes[VKEY] && changes[VKEY].newValue && changes[VKEY].newValue !== state.variant) { state.variant = changes[VKEY].newValue; changed = true; }
    if (changes[MMKEY] && changes[MMKEY].newValue && typeof changes[MMKEY].newValue === "object") { state.modes = { ...changes[MMKEY].newValue }; changed = true; }
    if (changed) { apply(); notify(); }
  });

  return getTheme();
}

export async function setVariant(variant) {
  if (!VARIANTS.some(v => v[0] === variant)) return;
  state.variant = variant;
  apply(); notify();
  try { await chrome.storage.local.set({ [VKEY]: variant }); } catch {}
}

export async function setMode(mode) {
  if (!MODES.includes(mode)) return;
  state.modes[state.variant] = mode;
  apply(); notify();
  try { await chrome.storage.local.set({ [MMKEY]: { ...state.modes } }); } catch {}
}

export async function cycleMode() {
  const i = MODES.indexOf(currentMode());
  await setMode(MODES[(i + 1) % MODES.length]);
}

export const MODE_ICONS = {
  system: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
  light: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/></svg>',
  dark: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>',
};

// Wires a cycle button + a <select> and keeps them in sync with theme state.
export function bindThemeControls({ modeBtn, variantSelect } = {}) {
  function refresh() {
    const t = getTheme();
    if (modeBtn) {
      modeBtn.innerHTML = MODE_ICONS[t.mode];
      const label = t.mode === "system" ? `System (${t.effective})` : t.mode[0].toUpperCase() + t.mode.slice(1);
      modeBtn.title = "Color mode: " + label;
      modeBtn.setAttribute("aria-label", "Color mode: " + label);
    }
    if (variantSelect) variantSelect.value = t.variant;
  }
  if (modeBtn) modeBtn.addEventListener("click", () => cycleMode());
  if (variantSelect) variantSelect.addEventListener("change", (e) => setVariant(e.target.value));
  onThemeChange(refresh);
  refresh();
}
