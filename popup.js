import { initTheme, bindThemeControls } from "./theme.js";

const MASTER_ENABLED_KEY = "oro_master_enabled";
const enabledEl = document.getElementById("masterEnabled");
const reloadBtn = document.getElementById("reload");
const openOptionsBtn = document.getElementById("openOptions");

async function init() {
  const data = await chrome.storage.local.get([MASTER_ENABLED_KEY]);
  const enabled = (typeof data[MASTER_ENABLED_KEY] === "boolean") ? data[MASTER_ENABLED_KEY] : true;
  enabledEl.checked = enabled;
}
init();

enabledEl.addEventListener("change", async (e) => {
  await chrome.runtime.sendMessage({ type: "oro-toggle-master", enabled: e.currentTarget.checked });
});

// Keep the toggle in sync if it's changed elsewhere (options page, another popup).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[MASTER_ENABLED_KEY]) enabledEl.checked = changes[MASTER_ENABLED_KEY].newValue !== false;
});
reloadBtn.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id) chrome.tabs.reload(tab.id);
});
openOptionsBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());

initTheme().then(() => {
  bindThemeControls({
    modeBtn: document.getElementById("modeToggle"),
    variantSelect: document.getElementById("variantSelect"),
  });
});
