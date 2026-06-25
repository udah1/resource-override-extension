// Registers a DevTools panel that hosts the full rule manager (options.html).
// Reusing the options page avoids duplicating the editor/list logic; it talks to
// chrome.storage.local + the service worker, both available in the panel context.
chrome.devtools.panels.create(
  "Resource Override",
  "icons/icon32.png",
  "options.html",
  () => { /* panel created */ }
);
