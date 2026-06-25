# Changelog

All notable changes to this project are documented here.

## [1.4.0]

### Service worker / DNR

- Rebuild the dynamic rule set deterministically from the stored rules array
  (positional ids `1000 + index`) and drop the legacy `oro_last_rule_id` counter,
  which could leak ids and accumulate orphaned dynamic rules.
- Pre-validate regex conditions with `declarativeNetRequest.isRegexSupported()` and
  apply all rules in a single atomic `updateDynamicRules`. If the atomic update is
  rejected, fall back to per-rule validation using **non-matching** probes in a
  disjoint id range so live traffic is never intercepted while probing.
- Record per-rule failures in `oro_rule_errors` storage instead of throwing away the
  whole rule set on one bad rule.
- Serialize rebuilds (single-flight + coalescing); each run re-reads storage so it
  always applies the latest snapshot.
- Guard against exceeding `MAX_NUMBER_OF_DYNAMIC_RULES`.

### Content script / options / popup

- Deduplicate JS/CSS injection per document (FNV-1a hash of the inject-relevant
  fields) so repeated rule updates no longer stack `<script>`/`<style>` tags.
- Harden `postMessage` in both directions: verify `event.source`/`event.origin` and
  use a concrete `targetOrigin` (with correct handling for `null`-origin documents).
- Delete rules by id (not list index) and reset the editor if the open rule is removed.
- Keep the master enable toggle in sync across the options page and popup via
  `storage.onChanged`.
- Validate and sanitize imported rule JSON; skip unknown/invalid entries and
  guarantee unique ids.

### Page hook (after-response mocks)

- Fetch: emit `null` bodies for null-body statuses (204/205/304…) and expose the
  request URL on the constructed `Response`.
- XHR: honor `responseType` (`""`/`text`/`json`/`arraybuffer`/`blob`/`document`),
  mirror native `responseText` behavior, expose `responseURL`, and surface mock
  response headers via `getResponseHeader`/`getAllResponseHeaders`.
- XHR: replay the full event lifecycle (`readystatechange`, `loadstart`, `progress`,
  `load`, `loadend`, `error`, `abort`, `timeout`), support `removeEventListener`,
  and add a `window.ORO_XHR_HOOK = false` page escape hatch to disable the XHR hook.

### DevTools

- Add a **Resource Override** panel in DevTools (via `devtools_page`) that hosts the
  full rule manager, so rules can be edited without leaving DevTools.

### Manifest

- Remove the unused `webNavigation` permission.
- Add `devtools_page`.
- Bump version to 1.4.0.
