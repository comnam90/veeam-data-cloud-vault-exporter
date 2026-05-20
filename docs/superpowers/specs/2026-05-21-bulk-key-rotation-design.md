# Bulk AWS Vault Key Rotation — Design

- **Date:** 2026-05-21
- **Status:** Draft — awaiting user review
- **Author:** Ben Thomas
- **Scope:** Adds a second feature alongside CSV export: bulk key rotation for AWS vaults, scoped by URL context (all tenants or single tenant).

## Summary

Add a Rotate tab to the popup that calls `regenerateKey` against every AWS vault in scope, then downloads a CSV containing the new credentials. URL context determines scope:

- On `/vault/manage` (or any non-tenant Vault page) → all AWS tenants in the organisation.
- On `/vault/tenant/<id>` → AWS vaults in that single tenant.

Per-vault rotation in the existing portal UI already covers the single-vault case, so this feature focuses on the two bulk tiers.

## Context

The portal exposes `POST /api/vault/api/cust-StorageAccount/regenerateKey?storageName=<name>&wl_tenant_id=<id>` with an empty JSON body. The response is synchronous and returns the new credentials:

```json
{
  "accessKey":   "AKIA...",
  "secretKey":   "hZz...",
  "storageName": "vdcvault9149017727246643",
  "tenantName":  "Ben Thomas - AWS - Advanced Core",
  "vaultName":   "btvltadvcoreaws02",
  "provider":    "AWS"
}
```

Vault provider is determined by the parent tenant's subscription edition: a tenant with `subscription.product.edition` containing `"AWS"` (e.g., `ADVANCED_CORE_AWS`) holds only AWS vaults. This lets us filter at the tenant level using data the extension already fetches, with no new discovery endpoint required.

## Goals

- Rotate AWS vault keys in bulk at two URL-scoped tiers.
- Capture every response (including failures) in a single CSV the user can hand to downstream systems.
- Make the destructive nature of the action obvious; require deliberate confirmation.
- Reuse existing fetch/CSV plumbing rather than parallel implementations.

## Non-goals

- Per-vault rotation in the popup — already in the portal UI.
- Non-AWS providers (Azure, etc.) — skipped silently in v1.
- Auto-retry on rate-limit / transient failures — surfaced as Failed rows; user can re-run.
- Service-worker-backed rotation that survives popup close — see [Future Work](#future-work).
- Automated test suite — the project does not have one and adding one is out of scope.

## Architecture

All new logic lives in `popup.js` within the existing single `DOMContentLoaded` handler. This matches the project convention stated in `CLAUDE.md` ("All logic. ~520 lines, single DOMContentLoaded handler. No modules, no bundling.") and keeps the destructive code path reviewable in one place.

Additions:

- **New endpoint** in `buildApiEndpoints()`:
  ```js
  REGENERATE_KEY: (storageName, tenantId) =>
    `${baseUrl}/vault/api/cust-StorageAccount/regenerateKey` +
    `?storageName=${encodeURIComponent(storageName)}` +
    `&wl_tenant_id=${encodeURIComponent(tenantId)}`
  ```
- **AWS filter helper**:
  ```js
  function isAwsTenant(tenant, subscriptionsMap) {
    const sub = subscriptionsMap.get(tenant.subscriptionId);
    const edition = sub?.product?.edition || '';
    return edition.includes('AWS');
  }
  ```
- **Vault-enumeration extraction**: the per-tenant `STORAGE_STATS` loop currently inlined in the export click handler is extracted into a shared helper `fetchAllTenantStats(workloads, statusElement)`. Both Export and Rotate call it.
- **Worker-pool rotator**: a fixed-concurrency (5) async pool that POSTs `regenerateKey` per vault and accumulates `{vault, response | error}` results.
- **Tab switcher**: two sibling `<section>` elements inside `#activeView` with a `<nav class="tabs">` toggling them.

No new global state beyond a `rotationInFlight` flag for double-click prevention. URL context detection (`activeTenantId`, `/vault/manage` path) feeds both tabs.

## UI

### HTML changes (`popup.html`)

Inside `#activeView`, the existing content moves into `#exportTab`. A new `#rotateTab` is added. A `<nav class="tabs">` above both toggles which is visible.

```html
<h3>VDC Data Exporter</h3>
<nav class="tabs">
  <button class="tab tab-active" data-tab="export">Export</button>
  <button class="tab" data-tab="rotate">Rotate</button>
</nav>

<section id="exportTab"> <!-- existing #filters, button, status --> </section>

<section id="rotateTab" hidden>
  <p class="rotate-intro">
    Regenerates AWS vault keys. <strong>Invalidates old keys immediately</strong> —
    any tools using them will stop working.
  </p>
  <p class="rotate-sensitive-note">
    The downloaded CSV contains live credentials. Store securely and delete after use.
  </p>
  <div id="rotatePreview" hidden></div>
  <div id="rotateConfirm" hidden>
    <label>Type <code>ROTATE</code> to confirm:</label>
    <input id="rotatePhrase" type="text" autocomplete="off">
  </div>
  <div id="rotateProgress" hidden>
    <progress id="rotateBar" value="0" max="100"></progress>
    <p id="rotateProgressText">Rotating 0 / N vaults…</p>
    <p class="keep-open-warning">Keep this window open — closing it stops rotation.</p>
  </div>
  <button id="rotateButton">Preview affected vaults</button>
  <p id="rotateStatus"></p>
</section>
```

Styling reuses the existing CSS variables and patterns. Tabs use a simple two-button row with an active state, matching the existing visual language (rounded corners, VDC green accents).

### Rotate-tab state machine

```
Idle ──[click Preview]──► Enumerating ──┬─► Preview ──[type ROTATE + click]──► Running ──► Done ──► Idle
                                        └─► Empty (no AWS / not AWS tenant) ──► Idle
                                                                                      ▲
                                                                                      └─[fatal error]
```

| State | Visible | Button | Disabled |
|---|---|---|---|
| Idle | intro, sensitive-note | `[Preview affected vaults]` | no |
| Enumerating | intro, status text | `[Preview affected vaults]` | yes |
| Preview | intro, `#rotatePreview`, `#rotateConfirm` | `[Rotate AWS Keys]` | until phrase matches |
| Empty | intro, message in `#rotatePreview` | `[Preview affected vaults]` | no |
| Running | intro, `#rotateProgress` | (hidden) | n/a |
| Done | intro, success/warning in `#rotateStatus` | `[Preview affected vaults]` | no |

While Running, tab switching is disabled.

### Preview rendering

The preview must handle organisations with 1000+ vaults without flooding the popup. Format:

> **5 tenants, 1,214 AWS vaults will be rotated.**
> Examples: `vault-alpha-01`, `vault-beta-prod`, `vault-gamma-02`
> + 1,211 more vaults
> ⚠️ 2 tenants couldn't be enumerated and will be skipped: *Tenant-X, Tenant-Y* (shown only when enumeration failures exist)

Example list shows up to 3 vault names. The "+ N more" line only appears when total > 3.

### Per-tier preview text

- All tenants: `"<N> AWS tenants, <M> AWS vaults will be rotated."`
- Single tenant (AWS): `"<M> AWS vaults in tenant <name> will be rotated."`
- Single tenant (non-AWS): `"This tenant uses <edition> — only AWS vaults can be rotated."` (button stays disabled; no confirm input shown)
- No AWS tenants found: `"No AWS tenants found in this organization — nothing to rotate."`

## Data flow

### Phase 1 — Enumeration (on `[Preview affected vaults]` click)

1. `GET API_ENDPOINTS.ME` → `orgId` (existing).
2. `GET API_ENDPOINTS.SUBSCRIPTIONS(orgId)` and `GET API_ENDPOINTS.WORKLOAD_TENANTS(orgId)` in parallel (existing).
3. Build `subscriptionsMap` (existing).
4. Filter workloads:
   - Apply `isAwsTenant(tenant, subscriptionsMap)`.
   - If `activeTenantId` is set, further filter to `tenant.id === activeTenantId`.
5. Call `fetchAllTenantStats(filteredWorkloads, statusEl)` (extracted helper). Returns `{allTenantStats, failedTenants}`.
6. Flatten `allTenantStats` into `vaultsToRotate = [{tenantId, tenantName, storageName, vaultName}, ...]`.
7. Transition to Preview (or Empty if zero vaults).

### Phase 2 — Rotation (on confirm-button click)

1. Hide preview/confirm, show `#rotateProgress`. Set `rotationInFlight = true`. Disable tab buttons.
2. Run the worker pool with concurrency 5:
   ```js
   async function runRotationPool(vaults, results, onProgress) {
     const queue = [...vaults];
     const inFlight = new Set();
     while (queue.length > 0 || inFlight.size > 0) {
       while (inFlight.size < 5 && queue.length > 0) {
         const v = queue.shift();
         const p = rotateOne(v).then(r => results.push(r))
                              .finally(() => { inFlight.delete(p); onProgress(); });
         inFlight.add(p);
       }
       if (inFlight.size > 0) await Promise.race(inFlight);
     }
   }
   ```
3. `rotateOne(v)` POSTs `REGENERATE_KEY(v.storageName, v.tenantId)` with empty body, returns `{vault: v, response, error, timestamp: new Date().toISOString()}`. Errors are caught and recorded; they never throw out of the task.
4. `onProgress()` updates the progress bar and text after each settle: `Rotating <done> / <total> (<pct>%)`.
5. When the pool drains, call `convertRotationResultsToCsv(results, baseFilename)` → `triggerCsvDownload()`.
6. Show summary: `"✅ <s> rotated"` or `"⚠️ <s> rotated, <f> failed — see CSV."` Re-enable tabs, set `rotationInFlight = false`.

### Reused vs new code

| Concern | Reused | New |
|---|---|---|
| Endpoint builder | `buildApiEndpoints` | `REGENERATE_KEY` entry |
| Auth | Session cookies via `host_permissions` (existing pattern — no fetch options needed) | — |
| Tenant + subscription fetch | Existing `Promise.all` block | — |
| Per-tenant vault stats | Extracted from `convertAllDataToCsv` into `fetchAllTenantStats` helper | helper signature |
| CSV escaping | `escapeCSV` | — |
| CSV download | `triggerCsvDownload` | — |
| AWS filter | — | `isAwsTenant` |
| Worker pool | — | `runRotationPool` |
| Type-to-confirm | — | input listener |
| Progress bar | — | `<progress>` + text |
| CSV writer | — | `convertRotationResultsToCsv` |

## CSV format

**Filenames** (mirroring existing export naming):
- All tenants: `veeam_data_cloud_key_rotation_<YYYY-MM-DD>.csv`
- Single tenant: `veeam_data_cloud_<TenantName>_key_rotation_<YYYY-MM-DD>.csv` (`TenantName` sanitised via existing `[^a-zA-Z0-9]/g` → `_`).

**Columns** (in order):

| # | Column | Source | Notes |
|---|---|---|---|
| 1 | `Timestamp` | `new Date().toISOString()` at row write time | ISO 8601 UTC |
| 2 | `TenantName` | Enumeration | Display name |
| 3 | `TenantId` | Enumeration | UUID |
| 4 | `VaultName` | Response `vaultName` (fallback: enumeration `displayName`) | Human label |
| 5 | `StorageName` | Response `storageName` (fallback: enumeration value) | Internal vault ID |
| 6 | `Provider` | Response `provider` (fallback: `"AWS"`) | Always AWS in v1 |
| 7 | `Status` | `"Success"` or `"Failed"` | |
| 8 | `AccessKey` | Response `accessKey`; empty on failure | **Sensitive** |
| 9 | `SecretKey` | Response `secretKey`; empty on failure | **Sensitive** |
| 10 | `Error` | `HTTP <status>: <message>` on failure; empty on success | |

All string values pass through `escapeCSV()` and are wrapped in double quotes, matching the existing CSV exports.

## Error handling

| Condition | Behaviour |
|---|---|
| Per-vault rotation fails (network, 4xx, 5xx) | Recorded as `Status=Failed` row with `Error` populated. Batch continues. |
| `GET /me` / `/subscriptions` / `/workload-tenants` fail | Abort before Preview. Show red error in `#rotateStatus`. Same as existing export. |
| Single tenant's `STORAGE_STATS` fails during enumeration | Exclude that tenant; surface in preview as a "skipped" warning. |
| No AWS tenants found | Empty state: message in `#rotatePreview`, confirm/button stay hidden. |
| Single-tenant mode on non-AWS tenant | "Not AWS" message; rotation button disabled. |
| User closes popup mid-rotation | v1: warning text only ("Keep this window open"). In-flight requests get cancelled by Chrome when the popup unloads; completed-but-unwritten rows are lost. Tracked as future work. |
| User navigates tab away from `/vault/*` | No effect on rotation. Session cookies + host_permissions keep the requests valid. |
| User double-clicks rotate | Button is `disabled` on first click; stays disabled until run finishes. |
| Type-to-confirm bypass attempts | Strict `value.trim() === 'ROTATE'` comparison. No keypress shortcuts that could trigger Enter. |
| Rate-limit / 429 | Recorded as Failed; no auto-retry. User can re-preview and re-run; only failed vaults will be in the resulting CSV if old keys were rotated successfully. |

## Testing plan

The project has no automated test suite (`CLAUDE.md`). Verification is manual.

**Staging smoke test:**

1. Load unpacked on staging. Open popup on `/vault/manage`. Confirm Rotate tab visible.
2. Click `[Preview affected vaults]`. Confirm preview shows only AWS tenants (verified against a mixed AWS/Azure org).
3. Type wrong phrase → button stays disabled. Type `ROTATE` → button enables.
4. Run rotation against **one disposable test vault**. Verify:
   - Progress bar advances visibly.
   - CSV downloads with the new credentials in a Success row.
   - The old key is invalidated server-side (verify by attempting to use the old key against AWS).
5. Navigate to `/vault/tenant/<aws-tenant-id>` → preview scoped to that tenant only.
6. Navigate to `/vault/tenant/<azure-tenant-id>` → "not AWS" message shown, button disabled.
7. Force a failure: temporarily block a vault's storageName via DevTools network override (return 500). Confirm Failed row appears in CSV with error text, batch continues, summary message shows the failure count.
8. Close the popup during rotation → confirm warning text was visible; verify (via re-preview) which vaults did/didn't rotate.

**Production smoke test:** repeat the key flows on production once staging passes.

## Release checklist

Per `CLAUDE.md` conventions, releasing requires three files to move together. Implementation work should plan for:

- `manifest.json` version bump (likely `1.3.0` — minor for new feature).
- `CHANGELOG.md` entry in Keep-a-Changelog format, dated.
- `README.md` updates: feature description, screenshots, version references.
- New versioned zip at repo root.

## Future work

- **Service-worker-backed rotation.** Move the worker pool to an MV3 service worker so the rotation survives popup close. Requires `chrome.runtime` message-passing between popup and worker, plus persistent state for in-progress runs.
- **Auto-retry with exponential backoff** for transient failures (429, 5xx).
- **Per-vault selection** in the preview (checkboxes) for partial rotation.
- **Auto-retry of just the Failed rows** from a previous run.
- **Other providers** (Azure, etc.) once their rotation endpoints are documented.

## Open questions

None at design time. To be revisited during implementation if behaviour discovered on staging diverges from the API shapes documented above.
