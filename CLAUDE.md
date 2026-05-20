# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

A Chrome Manifest V3 extension that exports Veeam Data Cloud **Vault** usage data to CSV by calling VDC's internal APIs using the user's existing logged-in browser session. It is intentionally not on the Chrome Web Store — users install it as an "unpacked extension."

The extension only activates on Vault pages (`/vault/*` under `cloud.veeam.com` or `stage.cloud.veeam.com`). On other VDC services (M365, Entra ID) or non-VDC sites it shows an inactive message.

## Build / test / lint

**The extension itself has no build step** — Chrome loads the source directly from the repo root. A `package.json` exists solely for Vitest, used to unit-test pure logic in `lib/`. There is no linter.

- **Run locally:** `chrome://extensions` → enable Developer mode → "Load unpacked" → select the repo root. After editing `popup.js` / `popup.html` / `manifest.json` / files under `lib/`, click the reload button on the extension card.
- **Run tests:** `npm install` once, then `npm test` (Vitest). Requires Node.js 20+. Tests cover only pure logic in `lib/`; UI and state-machine behaviour is verified manually by loading the unpacked extension. See [ADR 0006](docs/adr/0006-adopt-vitest-and-es-modules-for-pure-logic.md).
- **Debug:** Right-click the extension popup → "Inspect" opens DevTools for the popup. `console.log` calls in `popup.js` and `lib/` go there.
- **Package a release:** Zip the repo contents **excluding** `node_modules/`, `tests/`, `package.json`, `package-lock.json`, and the `docs/` tree (manifest at the top level). The existing `veeam-data-cloud-vault-exporter-vX.Y.Z.zip` at the repo root is the artifact pattern.

## Architecture

Top-level files of substance:

- **`manifest.json`** — MV3 manifest. `host_permissions` lists the two VDC origins; `content_security_policy` restricts `script-src` to `'self'`, which is why dependencies are vendored locally rather than loaded from a CDN.
- **`popup.html`** — Single popup UI containing three sibling `<div>`s (`#activeView`, `#inactiveView`, `#wrongServiceView`). `popup.js` toggles which one is visible based on the active tab's URL. All CSS is inline in a `<style>` block. The popup script is loaded as `<script type="module" src="popup.js">` so it can import pure helpers from `lib/`.
- **`popup.js`** — UI and orchestration: tab switching, state machines, DOM event wiring, and the `fetch` calls that ride the user's session cookies. Single `DOMContentLoaded` handler. Imports pure helpers from `lib/`.
- **`lib/`** — Pure-logic ES modules, unit-tested with Vitest. New pure functions with non-trivial behaviour belong here, not in `popup.js`. (DOM-coupled code stays in `popup.js`.)
- **`tests/`** — Vitest tests for `lib/` modules.

Vendored dependencies (do not edit): `flatpickr.min.js`, `flatpickr.min.css`, `flatpickr-monthSelect.js`, `flatpickr-monthSelect.css`. License lives in `licenses/`. The Flatpickr classic scripts load before `popup.js` so their globals (`flatpickr`, `monthSelectPlugin`) are available when the module evaluates.

### Runtime flow in `popup.js`

1. `initializePopup()` reads the active tab URL and decides which view to show. If on `/vault/*`, it also detects environment (prod vs staging) to set `API_BASE_URL`, and inspects the path to choose an export mode.
2. The export modes are mutually exclusive and chosen by URL/checkbox, not by a dropdown:
   - **Single-tenant** — URL matches `/vault(/app)?/tenant/<uuid>`. Captures `activeTenantId` and filters the workloads list to that tenant. Filename becomes `veeam_data_cloud_<TenantName>_export_<date>.csv`.
   - **Summary-only** — URL is `/vault/manage`. Shows the "Tenants summary only" checkbox; if checked, skips the per-tenant `STORAGE_STATS` fanout (the slow part) and emits the 12-column summary CSV.
   - **All tenants (detailed)** — Default. Fetches `STORAGE_STATS` per tenant in parallel via `Promise.allSettled` and emits the 16-column wide CSV with one row per (tenant × vault × month).
3. The four API endpoints (`ME`, `SUBSCRIPTIONS`, `WORKLOAD_TENANTS`, `STORAGE_STATS`) are built from `API_BASE_URL` in `buildApiEndpoints()`. The org ID comes from `/me`. Calls rely on the user's session cookies — there is no auth handling in this code.
4. Failed per-tenant fetches do not abort the export; they are pushed as N/A rows and a warning is shown.

### Two CSV formats live in `popup.js`

- `convertSummaryDataToCsv()` — 12-column tenant-only output.
- `convertAllDataToCsv()` — 16-column detailed output with date-range filtering applied row-by-row via `isDateInRange()`. **Date format conversion is load-bearing here:** the API returns months as `"M/YYYY"` (e.g. `"5/2025"`), the UI/Flatpickr uses `"YYYY-MM"` (e.g. `"2025-05"`). `isDateInRange` normalizes the former to the latter before string-comparing.

Both write through `triggerCsvDownload()`, which uses an `<a download>` blob URL (not the `chrome.downloads` API, despite that permission being declared).

## Conventions

- **Production and staging share URL patterns.** Don't reintroduce environment-specific path matching — `1.1.1` explicitly unified them (see `CHANGELOG.md`). Environment detection is hostname-only.
- **Releasing requires three files to move together:** `manifest.json` `version`, `CHANGELOG.md` (Keep-a-Changelog format, dated), and any version references in `README.md`. The repo also ships a versioned zip at the root.
- **Commit messages** follow Conventional Commits (`feat:`, `fix:`, `chore:`) based on `git log`.
