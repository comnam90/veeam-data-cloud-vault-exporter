# 0007 — Use `chrome.scripting` to issue rotation POSTs from the page context

- **Date:** 2026-05-21
- **Status:** Accepted
- **Context:** Bulk AWS vault key rotation feature

## Context

The `regenerateKey` API endpoint (`POST /api/vault/api/cust-StorageAccount/regenerateKey`) uses the `sec-fetch-site` request header as a CSRF protection mechanism. The server requires `sec-fetch-site: same-origin` and silently rejects requests that do not meet this requirement — returning HTTP 200 with an empty response body rather than a 4xx error.

`sec-fetch-site` is a [forbidden request header](https://fetch.spec.whatwg.org/#forbidden-request-header); JavaScript cannot set or override it. The browser derives it automatically from the relationship between the initiating origin and the request URL:

- A fetch from `cloud.veeam.com` → `cloud.veeam.com` is `same-origin`.
- A fetch from a `chrome-extension://` popup → `cloud.veeam.com` is `cross-site`.

The extension popup therefore cannot issue this POST directly via `fetch()` regardless of what headers it sets. The export feature's GET requests are unaffected because the API's CSRF check only applies to mutating (non-idempotent) requests.

## Decision

Rotation POSTs use `chrome.scripting.executeScript` with `world: 'MAIN'` to inject the fetch call into the active tab's JavaScript context. Code running in `MAIN` world of a `cloud.veeam.com` tab executes with that page's origin, so the browser sets `sec-fetch-site: same-origin` and the request succeeds. The result (response body, status) is serialised and returned to the popup via the injection result.

This required adding `"scripting"` to the `permissions` array in `manifest.json`.

## Rationale

- **Content script (ISOLATED world):** Content scripts run in an isolated JS environment associated with the page origin. Fetches from a content script also carry `sec-fetch-site: same-origin` for requests to the same host, so this would also work. However, a persistent content script adds complexity (separate file, message-passing boilerplate, lifecycle management). The `executeScript` approach is on-demand, contained entirely within `popup.js`, and requires no additional files.
- **Service worker with fetch event:** Would allow intercepting and re-issuing the request but adds significant architecture (see [ADR 0004](0004-popup-only-architecture-in-v1.md)) and is deferred to v1.1.
- **Direct `fetch()` from popup:** Does not work — `sec-fetch-site: cross-site` is set by the browser and cannot be overridden.

## Consequences

- `manifest.json` declares `"scripting"` permission. On first install after this change, Chrome will prompt the user to re-approve the extension's permissions (or remove and re-add when loading as unpacked).
- The rotation feature requires the active tab to be on a `cloud.veeam.com` or `stage.cloud.veeam.com` Vault page when the rotation runs. This is already guaranteed by the extension's URL-context detection — the Rotate tab is only visible when the popup is open on a `/vault/*` page.
- The injected function is serialised via `.toString()` by the Chrome scripting API. It cannot close over variables from the popup's scope; all data must be passed via the `args` array.
- If the active tab navigates away from `cloud.veeam.com` during a rotation run, subsequent `executeScript` calls will fail (the tab is no longer in `host_permissions`). This is an edge case already covered by the popup-close warning (see [ADR 0004](0004-popup-only-architecture-in-v1.md)).
