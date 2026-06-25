# Privacy Policy — Resource Override Pro

_Last updated: 2026-06-25_

Resource Override Pro ("the extension") is a developer tool that redirects, mocks, and
modifies network requests and injects user-authored JavaScript/CSS into web pages you choose.

## Summary

**The extension does not collect, store, transmit, sell, or share any personal data.**
It has no analytics, no telemetry, no tracking, and makes no network requests of its own
to any external server.

## What data the extension stores

The only data the extension stores is the configuration you create yourself:

- The override **rules** you define (URL patterns, match settings, redirect targets,
  mock bodies, headers, injected JS/CSS, etc.).
- Your **preferences** (e.g. master enable/disable, theme variant, light/dark mode).
- Diagnostic **rule errors** (e.g. an invalid regex you entered), used only to show you
  which rules failed to apply.

This data is stored **locally on your device** using the browser's `chrome.storage.local`
API. It never leaves your machine through the extension, and it is not accessible to the
developer or any third party.

## How the extension interacts with web pages

To do its job, the extension requires broad host access (`<all_urls>`) and the ability to
modify requests and inject scripts:

- It uses the `declarativeNetRequest` API to redirect, block, or modify request/response
  headers for URLs that match **rules you create**.
- It injects a request-mocking hook and any **JavaScript/CSS you author** into pages that
  match your rules.
- It reads request URLs, methods, and (for body-matching rules) request bodies **only in
  the page being processed and only to evaluate your rules**. This information is used
  in-memory at request time and is **never collected, logged, or transmitted**.

These capabilities act solely according to the rules you configure. The extension takes no
action on sites for which you have not created a matching rule.

## Remote code

The extension does **not** download or execute any remote code. Any JavaScript or CSS that
runs on a page is content **you wrote and saved** in your own rules.

## Data sharing

None. No data is shared with the developer or any third party, because none is collected.

## Permissions and why they are needed

- **`declarativeNetRequest`** — redirect/block requests and modify response headers.
- **`storage`** — save your rules and preferences locally.
- **`scripting`** — inject your own JS/CSS and the request-mocking hook into targeted pages.
- **`tabs`** — notify open tabs when rules change so overrides apply without a manual reload.
- **`host_permissions` (`<all_urls>`)** — overrides can target any site you choose, so the
  extension must be able to act on any URL you configure.

## Changes to this policy

If this policy changes, the updated version will be published in this repository with a new
"Last updated" date.

## Contact

For questions about this policy, open an issue on the project repository:
<https://github.com/udah1/resource-override-extension>
