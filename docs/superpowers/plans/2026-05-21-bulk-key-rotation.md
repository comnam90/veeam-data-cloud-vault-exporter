# Bulk AWS Vault Key Rotation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second feature to the popup (alongside the existing CSV export) that bulk-rotates AWS vault keys, scoped by URL context (all tenants on `/vault/manage`, single tenant on `/vault/tenant/<id>`), and emits a CSV containing the newly issued credentials plus per-vault success/failure rows.

**Architecture:** `popup.js` remains the UI/orchestration layer; pure rotation logic lives in `lib/rotation.js` (ES module) with `escapeCSV` extracted into `lib/csv-utils.js` so both Export and Rotate can share it. The popup script is loaded as a module via `<script type="module">`. AWS tenants are identified via subscription-edition substring match. Rotation uses a fixed-concurrency (5) worker pool of fetch POSTs; results land in a CSV. (See [ADR 0006](../../adr/0006-adopt-vitest-and-es-modules-for-pure-logic.md), which supersedes [ADR 0001](../../adr/0001-extend-popup-js-rather-than-modularise.md).)

**Tech Stack:** Chrome Manifest V3 extension. Vanilla JavaScript, no bundler. Vitest for unit tests of `lib/*` pure functions. Manual verification via `chrome://extensions` → Developer mode → Load unpacked for DOM/UI changes. Node 20+ required for tests.

**Spec:** [`docs/superpowers/specs/2026-05-21-bulk-key-rotation-design.md`](../specs/2026-05-21-bulk-key-rotation-design.md)

**ADRs that shape this plan:**
- [0002 — tab-based Export/Rotate UI](../../adr/0002-tab-based-rotate-export-ui.md)
- [0003 — AWS detection via subscription-edition substring](../../adr/0003-aws-detection-via-subscription-edition.md)
- [0004 — popup-only architecture in v1 (no service worker)](../../adr/0004-popup-only-architecture-in-v1.md)
- [0005 — type-to-confirm phrase `ROTATE`](../../adr/0005-type-to-confirm-fixed-phrase.md)
- [0006 — Vitest + ES modules for new pure logic](../../adr/0006-adopt-vitest-and-es-modules-for-pure-logic.md)

**Verification model:** Pure-logic tasks follow standard TDD (test → fail → implement → pass → commit). DOM/UI tasks substitute manual verification via Chrome reload, mirroring the spec's testing plan. The "Reload extension" step throughout this plan means: open `chrome://extensions`, click the reload button on the "Veeam Data Cloud Vault Exporter" card, then re-open the popup on the named URL.

---

## Task 1: Bootstrap Vitest, ES modules, and extract `escapeCSV`

**Why first:** Establishes the test infrastructure described in ADR 0006 before any feature work depends on it. Moving `escapeCSV` into `lib/csv-utils.js` (with a regression test) demonstrates the toolchain end-to-end on familiar code, and gives both Export and Rotate a shared import point.

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `lib/csv-utils.js`
- Create: `tests/csv-utils.test.js`
- Modify: `popup.html` (script tag → `type="module"`)
- Modify: `popup.js` (remove local `escapeCSV`, add import)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "veeam-data-cloud-vault-exporter-extension",
  "private": true,
  "version": "1.2.0",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
```

- [ ] **Step 3: Install dependencies**

Run: `npm install`
Expected: creates `node_modules/` and `package-lock.json`. No error output.

- [ ] **Step 4: Write the failing test for `escapeCSV`**

Create `tests/csv-utils.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { escapeCSV } from '../lib/csv-utils.js';

describe('escapeCSV', () => {
  it('returns empty string for null', () => {
    expect(escapeCSV(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(escapeCSV(undefined)).toBe('');
  });

  it('passes through simple strings unchanged', () => {
    expect(escapeCSV('hello')).toBe('hello');
  });

  it('doubles embedded double-quotes per RFC 4180', () => {
    expect(escapeCSV('Acme "Co"')).toBe('Acme ""Co""');
  });

  it('stringifies non-string values', () => {
    expect(escapeCSV(42)).toBe('42');
  });

  it('handles strings with multiple internal quotes', () => {
    expect(escapeCSV('a"b"c"d')).toBe('a""b""c""d');
  });
});
```

- [ ] **Step 5: Run the test and confirm it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../lib/csv-utils.js'` (or similar resolver error). This confirms Vitest is running and the test is wired correctly; the function just doesn't exist yet.

- [ ] **Step 6: Create `lib/csv-utils.js`**

```js
// Escapes a value for inclusion inside a CSV field per RFC 4180:
// internal double-quotes are doubled. Returns '' for null/undefined.
// Caller is responsible for wrapping the result in surrounding double-quotes.
export function escapeCSV(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/"/g, '""');
}
```

- [ ] **Step 7: Run the test and confirm it passes**

Run: `npm test`
Expected: 6 passing tests, 0 failing.

- [ ] **Step 8: Switch popup.html script tag to module**

In `popup.html`, find the line:

```html
  <script src="popup.js" defer></script>
```

Replace it with:

```html
  <script type="module" src="popup.js"></script>
```

Keep the Flatpickr `<script>` tags above it unchanged — they remain classic scripts and run before the module body. The relative ordering (flatpickr first, popup.js last) must be preserved so `flatpickr` and `monthSelectPlugin` are global by the time popup.js evaluates.

- [ ] **Step 9: Add the import to popup.js and remove the local `escapeCSV`**

At the top of `popup.js` — **outside** the `DOMContentLoaded` handler — add:

```js
import { escapeCSV } from './lib/csv-utils.js';
```

Then inside the `DOMContentLoaded` handler, find the existing `escapeCSV` function definition (around the comment `// CSV Escape helper function - escapes quotes per RFC 4180`) and delete it. The full block to remove:

```js
  // CSV Escape helper function - escapes quotes per RFC 4180
  function escapeCSV(value) {
    if (value === null || value === undefined) return '';
    const stringValue = String(value);
    // Escape quotes by doubling them
    return stringValue.replace(/"/g, '""');
  }
```

All call sites elsewhere in popup.js (in `convertSummaryDataToCsv`, `convertAllDataToCsv`) continue to call `escapeCSV(...)` unchanged — they pick up the imported binding from module scope.

- [ ] **Step 10: Reload extension and smoke-test Export**

1. Reload extension.
2. Open popup on `https://stage.cloud.veeam.com/vault/manage`.
3. Run `Export to CSV` (summary checkbox unchecked). Verify CSV downloads and contains correctly-escaped tenant names (e.g., a tenant name with `&` or `"` if any exists in the org, otherwise just confirm the file is well-formed CSV).
4. Open DevTools console for the popup. Confirm no errors about module loading or missing imports.

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json .gitignore lib/ tests/ popup.html popup.js
git commit -m "feat(tooling): add Vitest and extract escapeCSV to lib/csv-utils.js"
```

---

## Task 2: Refactor — extract `fetchAllTenantStats` helper (popup.js)

**Why now:** Both Export and Rotate need the per-tenant stats fan-out. Extracting it as a no-behaviour-change refactor before adding Rotate keeps the refactor commit reviewable in isolation. It stays in `popup.js` because it has side effects (network + progress updates) and is not a unit-testable pure function.

**Files:**
- Modify: `popup.js`

- [ ] **Step 1: Add the helper inside the `DOMContentLoaded` handler**

Add this function just before `convertAllDataToCsv` (or at any helper-style position in the handler — place it after the `triggerCsvDownload` helper):

```js
  // Fetches storage-stats for each tenant in `tenants` with limited error-tolerance.
  // Returns { allTenantStats, failedTenants }. Failed tenants are still included in
  // allTenantStats with statsData: [] so downstream consumers see them as N/A rows.
  async function fetchAllTenantStats(tenants, onProgress) {
    let completed = 0;
    const total = tenants.length;

    const statPromises = tenants.map(async (tenant) => {
      const statsUrl = API_ENDPOINTS.STORAGE_STATS(tenant.id);
      const response = await fetch(statsUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status} for tenant "${tenant.displayName}"`);
      const data = await response.json();
      completed++;
      if (onProgress) onProgress(completed, total);
      return { tenantName: tenant.displayName, tenantId: tenant.id, statsData: data.storageStatistics };
    });

    const results = await Promise.allSettled(statPromises);
    const allTenantStats = [];
    const failedTenants = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        allTenantStats.push(result.value);
      } else {
        const tenant = tenants[index];
        failedTenants.push(tenant.displayName);
        console.error(`Failed to fetch data for tenant "${tenant.displayName}":`, result.reason.message);
        allTenantStats.push({
          tenantName: tenant.displayName,
          tenantId: tenant.id,
          statsData: []
        });
      }
    });

    return { allTenantStats, failedTenants };
  }
```

- [ ] **Step 2: Replace the inline block in the export click handler**

In the existing `exportButton.addEventListener('click', ...)` block, find the block that starts with `statusEl.textContent = \`Fetching stats: 0/${filteredWorkloads.length} (0%)\`;` and ends just before `// Step 4: Call the detailed CSV export function with dynamic filename`. Replace that entire block with:

```js
        // Step 3: Fetch the detailed stats for each tenant in parallel
        statusEl.textContent = `Fetching stats: 0/${filteredWorkloads.length} (0%)`;

        const { allTenantStats, failedTenants } = await fetchAllTenantStats(
          filteredWorkloads,
          (completed, total) => {
            const percentage = Math.round((completed / total) * 100);
            statusEl.textContent = `Fetching stats: ${completed}/${total} (${percentage}%)`;
          }
        );
```

- [ ] **Step 3: Reload and verify Export still works**

1. Reload extension.
2. On `/vault/manage`: run `Export to CSV` unchecked — progress text advances `Fetching stats: N/M (X%)`, CSV downloads with the 16-column detailed format, ≥1 data row.
3. On `/vault/tenant/<aws-tenant-id>`: run `Export Tenant to CSV` — single-tenant filename + only that tenant's rows.

- [ ] **Step 4: Commit**

```bash
git add popup.js
git commit -m "refactor: extract fetchAllTenantStats helper from export click handler"
```

---

## Task 3: Add `isAwsTenant` (TDD) and `REGENERATE_KEY` endpoint

**Files:**
- Create: `lib/rotation.js`
- Modify: `tests/` (new test file `tests/rotation.test.js`)
- Modify: `popup.js`

- [ ] **Step 1: Write the failing test for `isAwsTenant`**

Create `tests/rotation.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { isAwsTenant } from '../lib/rotation.js';

describe('isAwsTenant', () => {
  it('returns true for an edition string containing AWS', () => {
    const tenant = { subscriptionId: 's1' };
    const subs = new Map([['s1', { product: { edition: 'ADVANCED_CORE_AWS' } }]]);
    expect(isAwsTenant(tenant, subs)).toBe(true);
  });

  it('returns false for an edition string containing AZURE only', () => {
    const tenant = { subscriptionId: 's1' };
    const subs = new Map([['s1', { product: { edition: 'ADVANCED_CORE_AZURE' } }]]);
    expect(isAwsTenant(tenant, subs)).toBe(false);
  });

  it('returns false when the subscription is not in the map', () => {
    const tenant = { subscriptionId: 'missing' };
    const subs = new Map();
    expect(isAwsTenant(tenant, subs)).toBe(false);
  });

  it('returns false when subscription.product is undefined', () => {
    const tenant = { subscriptionId: 's1' };
    const subs = new Map([['s1', {}]]);
    expect(isAwsTenant(tenant, subs)).toBe(false);
  });

  it('returns false when subscription.product.edition is undefined', () => {
    const tenant = { subscriptionId: 's1' };
    const subs = new Map([['s1', { product: {} }]]);
    expect(isAwsTenant(tenant, subs)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, confirm failure**

Run: `npm test`
Expected: FAIL — `Cannot find module '../lib/rotation.js'`.

- [ ] **Step 3: Create `lib/rotation.js` with `isAwsTenant`**

```js
// Pure helpers for the bulk AWS vault key rotation feature.
// See docs/superpowers/specs/2026-05-21-bulk-key-rotation-design.md
// and docs/adr/0006-adopt-vitest-and-es-modules-for-pure-logic.md.

// Returns true iff the tenant's subscription edition string contains "AWS".
// See docs/adr/0003-aws-detection-via-subscription-edition.md.
export function isAwsTenant(tenant, subscriptionsMap) {
  const sub = subscriptionsMap.get(tenant.subscriptionId);
  const edition = sub?.product?.edition || '';
  return edition.includes('AWS');
}
```

- [ ] **Step 4: Run test, confirm pass**

Run: `npm test`
Expected: 11 passing (6 from csv-utils, 5 from rotation), 0 failing.

- [ ] **Step 5: Add `REGENERATE_KEY` endpoint to `buildApiEndpoints`**

In `popup.js`, replace the existing `buildApiEndpoints` function with:

```js
  const buildApiEndpoints = (baseUrl) => {
    return {
      ME: `${baseUrl}/me`,
      SUBSCRIPTIONS: (orgId) => `${baseUrl}/subscriptions-svc/organizations/${orgId}/subscriptions`,
      WORKLOAD_TENANTS: (orgId) => `${baseUrl}/workload-tenants-svc/organizations/${orgId}/workload-tenants?workloadType=VAULT`,
      STORAGE_STATS: (tenantId) => `${baseUrl}/vault/api/cust-StorageAccount/collectionStorageUsedStatistics?wl_tenant_id=${tenantId}`,
      REGENERATE_KEY: (storageName, tenantId) =>
        `${baseUrl}/vault/api/cust-StorageAccount/regenerateKey` +
        `?storageName=${encodeURIComponent(storageName)}` +
        `&wl_tenant_id=${encodeURIComponent(tenantId)}`
    };
  };
```

- [ ] **Step 6: Import `isAwsTenant` into popup.js**

At the top of `popup.js`, add an import line below the existing `escapeCSV` import:

```js
import { escapeCSV } from './lib/csv-utils.js';
import { isAwsTenant } from './lib/rotation.js';
```

- [ ] **Step 7: Reload and verify nothing regressed**

1. Reload extension.
2. Confirm popup still loads and Export still works on `/vault/manage` and on a tenant page.
3. No console errors about the new import.

- [ ] **Step 8: Commit**

```bash
git add popup.js lib/rotation.js tests/rotation.test.js
git commit -m "feat: add isAwsTenant helper and REGENERATE_KEY endpoint"
```

---

## Task 4: HTML + CSS for tabs and Rotate tab structure (with tab switcher)

**Files:**
- Modify: `popup.html`
- Modify: `popup.js`

- [ ] **Step 1: Wrap existing content in `#exportTab` and add tab nav + Rotate tab**

In `popup.html`, find the `<div id="activeView">` block. Replace its inner content (everything between `<div id="activeView">` and the closing `</div>` of `#activeView`) with:

```html
    <h3>VDC Data Exporter</h3>

    <nav class="tabs">
      <button type="button" class="tab tab-active" data-tab="export">Export</button>
      <button type="button" class="tab" data-tab="rotate">Rotate</button>
    </nav>

    <section id="exportTab">
      <div id="filters">
        <label id="tenantsSummaryLabel" style="display: none; margin-bottom: 12px;">
          <input type="checkbox" id="tenantsSummaryOnly">
          <span>Export tenants summary only</span>
        </label>

        <label>
          <input type="checkbox" id="filterByDate">
          <span>Filter by date range</span>
        </label>
        <div id="dateInputs">
          <label>
            From:
            <input type="text" id="dateFrom" placeholder="Select month" readonly>
          </label>
          <label>
            To:
            <input type="text" id="dateTo" placeholder="Select month" readonly>
          </label>
        </div>
      </div>

      <button id="exportButton">Export to CSV <span class="button-hint">(Enter)</span></button>

      <p id="status"></p>

      <div class="shortcuts">
        Shortcuts: Enter = Export, Esc = Close
      </div>
    </section>

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
        <label for="rotatePhrase">Type <code>ROTATE</code> to confirm:</label>
        <input id="rotatePhrase" type="text" autocomplete="off" spellcheck="false">
      </div>

      <div id="rotateProgress" hidden>
        <progress id="rotateBar" value="0" max="100"></progress>
        <p id="rotateProgressText">Rotating 0 / 0 vaults…</p>
        <p class="keep-open-warning">Keep this window open — closing it stops rotation.</p>
      </div>

      <button id="rotateButton">Preview affected vaults</button>

      <p id="rotateStatus"></p>
    </section>
```

- [ ] **Step 2: Add CSS for tabs, rotate-tab content, progress, status, warnings**

In the `<style>` block inside `popup.html`, append these rules just before the closing `</style>`:

```css
    /* Tab nav */
    .tabs {
      display: flex;
      gap: 4px;
      margin: 0 0 16px 0;
      border-bottom: 1px solid var(--vdc-grey-15);
    }

    .tab {
      flex: 1;
      width: auto;
      padding: 10px 12px;
      background: transparent;
      color: var(--vdc-grey-60);
      border: none;
      border-bottom: 2px solid transparent;
      border-radius: 0;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: none;
      transition: color 0.15s ease, border-color 0.15s ease;
    }

    .tab:hover {
      transform: none;
      box-shadow: none;
      color: var(--vdc-grey-90);
      background: transparent;
    }

    .tab.tab-active {
      color: var(--vdc-grey-90);
      border-bottom-color: var(--vdc-green);
    }

    .tab:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      color: var(--vdc-grey-30);
    }

    /* Rotate tab content */
    .rotate-intro {
      margin: 0 0 8px 0;
      font-size: 13px;
      color: var(--vdc-grey-70);
      line-height: 1.5;
    }

    .rotate-sensitive-note {
      margin: 0 0 16px 0;
      font-size: 12px;
      color: var(--vdc-orange);
      font-weight: 500;
    }

    #rotatePreview {
      margin: 0 0 16px 0;
      padding: 12px 14px;
      background: var(--vdc-grey-5);
      border-radius: 8px;
      border: 1px solid var(--vdc-grey-15);
      font-size: 13px;
      line-height: 1.6;
    }

    #rotatePreview .preview-examples {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      color: var(--vdc-grey-70);
    }

    #rotatePreview .preview-more {
      font-size: 12px;
      color: var(--vdc-grey-60);
    }

    #rotatePreview .preview-warning {
      margin-top: 8px;
      font-size: 12px;
      color: var(--vdc-orange);
    }

    #rotateConfirm {
      margin: 0 0 16px 0;
    }

    #rotateConfirm label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      color: var(--vdc-grey-70);
      margin-bottom: 6px;
    }

    #rotateConfirm code {
      background: var(--vdc-grey-10);
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 12px;
    }

    #rotatePhrase {
      width: 100%;
      padding: 9px 12px;
      font-size: 14px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      border: 1.5px solid var(--vdc-grey-15);
      border-radius: 6px;
      background: var(--vdc-white);
      color: var(--vdc-grey-90);
      height: 40px;
    }

    #rotatePhrase:focus {
      outline: none;
      border-color: var(--vdc-green);
      box-shadow: 0 0 0 3px rgba(0, 209, 95, 0.12);
    }

    /* Progress */
    #rotateProgress {
      margin: 0 0 16px 0;
    }

    #rotateBar {
      width: 100%;
      height: 10px;
      border-radius: 6px;
      overflow: hidden;
      appearance: none;
      -webkit-appearance: none;
    }

    #rotateBar::-webkit-progress-bar {
      background: var(--vdc-grey-10);
      border-radius: 6px;
    }

    #rotateBar::-webkit-progress-value {
      background: linear-gradient(90deg, var(--vdc-green) 0%, var(--vdc-green-hover) 100%);
      border-radius: 6px;
      transition: width 0.2s ease;
    }

    #rotateProgressText {
      margin: 8px 0 4px 0;
      font-size: 13px;
      font-weight: 600;
      color: var(--vdc-grey-90);
    }

    .keep-open-warning {
      margin: 0;
      font-size: 12px;
      color: var(--vdc-orange);
      font-weight: 500;
    }

    #rotateStatus {
      margin-top: 16px;
      font-size: 13px;
      text-align: left;
      padding: 12px 14px;
      border-radius: 8px;
      font-weight: 500;
      display: none;
    }

    #rotateStatus:not(:empty) {
      display: block;
    }

    #rotateStatus.error {
      color: var(--vdc-red);
      background: linear-gradient(135deg, rgba(220, 53, 69, 0.12) 0%, rgba(220, 53, 69, 0.08) 100%);
      border-left: 3px solid var(--vdc-red);
    }

    #rotateStatus.success {
      color: var(--vdc-green-dark);
      background: linear-gradient(135deg, rgba(0, 209, 95, 0.12) 0%, rgba(0, 209, 95, 0.08) 100%);
      border-left: 3px solid var(--vdc-green);
    }

    #rotateStatus.warning {
      color: var(--vdc-orange);
      background: linear-gradient(135deg, rgba(253, 126, 20, 0.12) 0%, rgba(253, 126, 20, 0.08) 100%);
      border-left: 3px solid var(--vdc-orange);
    }
```

- [ ] **Step 3: Add tab-switcher JS in popup.js**

Inside the `DOMContentLoaded` handler, after the existing `exportButton.focus();` line (around line 174 in the current file), add:

```js
  // Tab switcher
  const tabButtons = document.querySelectorAll('.tab');
  const exportTab = document.getElementById('exportTab');
  const rotateTab = document.getElementById('rotateTab');

  function switchTab(name) {
    tabButtons.forEach(btn => {
      const isActive = btn.dataset.tab === name;
      btn.classList.toggle('tab-active', isActive);
    });
    exportTab.hidden = name !== 'export';
    rotateTab.hidden = name !== 'rotate';
  }

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      switchTab(btn.dataset.tab);
    });
  });
```

- [ ] **Step 4: Reload and verify the tabbed UI**

1. Reload extension.
2. Open popup on `/vault/manage`. Two tabs visible at top; Export is active and shows the existing filters + Export button.
3. Click `Rotate`. Export content hides; intro paragraph + sensitive-note + `[Preview affected vaults]` button appear.
4. Click `Export`. Switches back; running an Export still works.
5. Click `[Preview affected vaults]`. Nothing happens (button is not wired yet). No console errors.
6. Open popup on a non-VDC page. Confirm `#inactiveView` still shows.

- [ ] **Step 5: Commit**

```bash
git add popup.html popup.js
git commit -m "feat: add tab nav with Export and Rotate tabs"
```

---

## Task 5: Preview state (Idle → Preview / Empty)

**Files:**
- Modify: `popup.js`

- [ ] **Step 1: Add rotation state and view helpers to popup.js**

Inside the `DOMContentLoaded` handler, after the tab-switcher block from Task 4 and **before** the existing `exportButton.addEventListener('click', ...)` block, add:

```js
  // ----- Rotation state -----
  let rotationInFlight = false;
  let vaultsToRotate = [];           // [{ tenantId, tenantName, storageName, vaultName }]
  let enumerationFailedTenants = []; // names of tenants whose stats fetch failed

  const rotateButton = document.getElementById('rotateButton');
  const rotatePreview = document.getElementById('rotatePreview');
  const rotateConfirm = document.getElementById('rotateConfirm');
  const rotatePhrase = document.getElementById('rotatePhrase');
  const rotateProgress = document.getElementById('rotateProgress');
  const rotateBar = document.getElementById('rotateBar');
  const rotateProgressText = document.getElementById('rotateProgressText');
  const rotateStatus = document.getElementById('rotateStatus');

  // Minimal HTML escaper for preview rendering.
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function setRotateStateIdle() {
    rotatePreview.hidden = true;
    rotatePreview.innerHTML = '';
    rotateConfirm.hidden = true;
    rotatePhrase.value = '';
    rotateProgress.hidden = true;
    rotateButton.textContent = 'Preview affected vaults';
    rotateButton.disabled = false;
    vaultsToRotate = [];
    enumerationFailedTenants = [];
  }

  function setRotateStatePreview(tenantsCount, singleTenantName) {
    rotateStatus.textContent = '';
    rotateStatus.className = '';

    const total = vaultsToRotate.length;
    const examples = vaultsToRotate.slice(0, 3).map(v => v.vaultName);
    const remaining = total - examples.length;

    const headline = singleTenantName
      ? `<strong>${total.toLocaleString()} AWS vaults</strong> in tenant <em>${escapeHtml(singleTenantName)}</em> will be rotated.`
      : `<strong>${tenantsCount.toLocaleString()} AWS tenants, ${total.toLocaleString()} AWS vaults</strong> will be rotated.`;

    let html = `<p>${headline}</p>`;
    if (examples.length > 0) {
      html += `<p class="preview-examples">Examples: ${examples.map(e => `<code>${escapeHtml(e)}</code>`).join(', ')}</p>`;
    }
    if (remaining > 0) {
      html += `<p class="preview-more">+ ${remaining.toLocaleString()} more vaults</p>`;
    }
    if (enumerationFailedTenants.length > 0) {
      const names = enumerationFailedTenants.map(escapeHtml).join(', ');
      html += `<p class="preview-warning">⚠️ ${enumerationFailedTenants.length} tenant(s) couldn't be enumerated and will be skipped: ${names}</p>`;
    }

    rotatePreview.innerHTML = html;
    rotatePreview.hidden = false;
    rotateConfirm.hidden = false;
    rotatePhrase.value = '';
    rotateProgress.hidden = true;
    rotateButton.textContent = 'Rotate AWS Keys';
    rotateButton.disabled = true; // remains disabled until ROTATE is typed (Task 6)
  }

  function setRotateStateEmpty(message) {
    rotatePreview.innerHTML = `<p>${escapeHtml(message)}</p>`;
    rotatePreview.hidden = false;
    rotateConfirm.hidden = true;
    rotatePhrase.value = '';
    rotateProgress.hidden = true;
    rotateButton.textContent = 'Preview affected vaults';
    rotateButton.disabled = false;
  }
```

- [ ] **Step 2: Add the `runEnumeration` function and wire the Preview button**

Immediately after the helpers in Step 1, add:

```js
  async function runEnumeration() {
    rotateButton.disabled = true;
    rotateStatus.textContent = 'Enumerating AWS tenants…';
    rotateStatus.className = '';

    try {
      const meResponse = await fetch(API_ENDPOINTS.ME);
      if (!meResponse.ok) throw new Error('Could not fetch user data. Are you logged in?');
      const orgId = (await meResponse.json()).organizationId;
      if (!orgId) throw new Error('Organization ID not found.');

      const [subscriptionsResponse, workloadsResponse] = await Promise.all([
        fetch(API_ENDPOINTS.SUBSCRIPTIONS(orgId)),
        fetch(API_ENDPOINTS.WORKLOAD_TENANTS(orgId))
      ]);
      if (!subscriptionsResponse.ok) throw new Error('Could not fetch subscriptions.');
      if (!workloadsResponse.ok) throw new Error('Could not fetch workload tenants.');

      const subscriptionsData = await subscriptionsResponse.json();
      const workloadsData = await workloadsResponse.json();
      const subscriptionsMap = new Map(subscriptionsData.subscriptions.subscriptions.map(s => [s.id, s]));

      if (!workloadsData || workloadsData.length === 0) {
        setRotateStateEmpty('No workload tenants found.');
        rotateStatus.textContent = '';
        return;
      }

      let awsTenants = workloadsData.filter(t => isAwsTenant(t, subscriptionsMap));
      let singleTenantName = null;

      if (activeTenantId) {
        const thisTenant = workloadsData.find(t => t.id === activeTenantId);
        if (!thisTenant) {
          setRotateStateEmpty(`Tenant ${activeTenantId} not found in this organization.`);
          rotateStatus.textContent = '';
          return;
        }
        if (!isAwsTenant(thisTenant, subscriptionsMap)) {
          const edition = subscriptionsMap.get(thisTenant.subscriptionId)?.product?.edition || 'an unknown edition';
          setRotateStateEmpty(`This tenant uses ${edition} — only AWS vaults can be rotated.`);
          rotateStatus.textContent = '';
          return;
        }
        awsTenants = [thisTenant];
        singleTenantName = thisTenant.displayName;
      }

      if (awsTenants.length === 0) {
        setRotateStateEmpty('No AWS tenants found in this organization — nothing to rotate.');
        rotateStatus.textContent = '';
        return;
      }

      rotateStatus.textContent = `Enumerating vaults: 0/${awsTenants.length}`;
      const { allTenantStats, failedTenants } = await fetchAllTenantStats(
        awsTenants,
        (done, total) => {
          rotateStatus.textContent = `Enumerating vaults: ${done}/${total}`;
        }
      );
      enumerationFailedTenants = failedTenants;

      vaultsToRotate = [];
      allTenantStats.forEach(({ tenantId, tenantName, statsData }) => {
        if (!statsData || statsData.length === 0) return;
        statsData.forEach(storage => {
          vaultsToRotate.push({
            tenantId,
            tenantName,
            storageName: storage.storageName,
            vaultName: storage.displayName
          });
        });
      });

      if (vaultsToRotate.length === 0) {
        setRotateStateEmpty(
          enumerationFailedTenants.length > 0
            ? `Couldn't enumerate any AWS vaults (${enumerationFailedTenants.length} tenant fetch error(s)).`
            : 'No AWS vaults found in scope.'
        );
        rotateStatus.textContent = '';
        return;
      }

      setRotateStatePreview(awsTenants.length, singleTenantName);
      rotateStatus.textContent = '';

    } catch (err) {
      console.error('Rotation enumeration failed:', err);
      rotateStatus.className = 'error';
      rotateStatus.textContent = err.message;
      rotateButton.disabled = false;
    }
  }

  rotateButton.addEventListener('click', () => {
    if (rotationInFlight) return;
    // In Idle state, button kicks off enumeration. (Preview-state click is wired in Task 7.)
    if (rotateConfirm.hidden) {
      runEnumeration();
    }
  });

  setRotateStateIdle();
```

- [ ] **Step 3: Reload and verify preview rendering**

1. Reload extension.
2. On `/vault/manage`: switch to Rotate → click `Preview affected vaults`. Expected: status briefly shows "Enumerating AWS tenants…" then "Enumerating vaults: N/M", then preview appears with `<N> AWS tenants, <M> AWS vaults will be rotated.` plus up to 3 example vault names and a `+ X more` line if total > 3. Greyed `[Rotate AWS Keys]` button + confirm input shown.
3. On `/vault/tenant/<aws-tenant-id>`: Rotate → Preview. Expected: single-tenant headline `<M> AWS vaults in tenant <name> will be rotated.`
4. On `/vault/tenant/<azure-tenant-id>`: Rotate → Preview. Expected: empty-state message `This tenant uses <edition> — only AWS vaults can be rotated.`, no confirm input, button still says `Preview affected vaults`.
5. If your test org has any failed-stats-fetch tenants, confirm the `⚠️ N tenant(s) couldn't be enumerated…` warning appears.

- [ ] **Step 4: Commit**

```bash
git add popup.js
git commit -m "feat: implement Rotate tab preview state and enumeration"
```

---

## Task 6: Type-to-confirm logic

**Files:**
- Modify: `popup.js`

- [ ] **Step 1: Add the input listener**

In `popup.js`, find the line `setRotateStateIdle();` from Task 5. Immediately above it, add:

```js
  // Type-to-confirm: enable the rotate button only when the phrase matches exactly.
  // See docs/adr/0005-type-to-confirm-fixed-phrase.md.
  const CONFIRM_PHRASE = 'ROTATE';
  rotatePhrase.addEventListener('input', () => {
    if (rotateConfirm.hidden) return;
    rotateButton.disabled = rotatePhrase.value.trim() !== CONFIRM_PHRASE;
  });
```

- [ ] **Step 2: Reload and verify**

1. Reload extension. On `/vault/manage`: Rotate → Preview → wait for preview.
2. Type `r` → button stays disabled.
3. Type `rotate` (lowercase) → still disabled.
4. Clear and type `ROTATE` → button enables.
5. Append a space (`ROTATE `) → still enabled (we `trim()`).
6. Append a char (`ROTATEX`) → disables.
7. Clear → disabled.

- [ ] **Step 3: Commit**

```bash
git add popup.js
git commit -m "feat: gate rotate button behind type-to-confirm phrase ROTATE"
```

---

## Task 7: Add `rotateOne` and `runRotationPool` (TDD)

**Files:**
- Modify: `lib/rotation.js`
- Modify: `tests/rotation.test.js`

**Approach:** Both are pure (no DOM), `rotateOne` uses an injected `fetch`. No popup.js integration in this task — Task 8 wires them in.

- [ ] **Step 1: Write failing tests for `rotateOne`**

Append to `tests/rotation.test.js`:

```js
import { rotateOne } from '../lib/rotation.js';

const sampleVault = {
  tenantId: 't1',
  tenantName: 'Acme',
  storageName: 's1',
  vaultName: 'V'
};
const sampleUrl = 'https://example.test/regenerateKey';
const fixedNow = () => new Date('2026-05-21T12:34:56.000Z');

describe('rotateOne', () => {
  it('returns Success result with response body on 200', async () => {
    const body = {
      accessKey: 'AK', secretKey: 'SK',
      storageName: 's1', tenantName: 'Acme', vaultName: 'V', provider: 'AWS'
    };
    const fetchImpl = async (url, init) => {
      expect(url).toBe(sampleUrl);
      expect(init.method).toBe('POST');
      expect(init.body).toBe('{}');
      return { ok: true, status: 200, json: async () => body };
    };
    const result = await rotateOne(sampleVault, sampleUrl, { fetch: fetchImpl, now: fixedNow });
    expect(result.error).toBe(null);
    expect(result.anomaly).toBe(null);
    expect(result.response).toEqual(body);
    expect(result.timestamp).toBe('2026-05-21T12:34:56.000Z');
    expect(result.vault).toEqual(sampleVault);
  });

  it('returns Failed result on HTTP 4xx with body text', async () => {
    const fetchImpl = async () => ({
      ok: false, status: 400, statusText: 'Bad Request',
      text: async () => 'invalid storage'
    });
    const result = await rotateOne(sampleVault, sampleUrl, { fetch: fetchImpl, now: fixedNow });
    expect(result.error).toBe('HTTP 400: invalid storage');
    expect(result.response).toBe(null);
    expect(result.anomaly).toBe(null);
  });

  it('falls back to statusText when body text is empty', async () => {
    const fetchImpl = async () => ({
      ok: false, status: 500, statusText: 'Internal Server Error',
      text: async () => ''
    });
    const result = await rotateOne(sampleVault, sampleUrl, { fetch: fetchImpl, now: fixedNow });
    expect(result.error).toBe('HTTP 500: Internal Server Error');
  });

  it('returns Failed result when fetch throws', async () => {
    const fetchImpl = async () => { throw new Error('network down'); };
    const result = await rotateOne(sampleVault, sampleUrl, { fetch: fetchImpl, now: fixedNow });
    expect(result.error).toBe('network down');
    expect(result.response).toBe(null);
  });

  it('flags provider anomaly when response.provider !== AWS', async () => {
    const body = {
      accessKey: 'AK', secretKey: 'SK',
      storageName: 's1', tenantName: 'Acme', vaultName: 'V', provider: 'AZURE'
    };
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => body });
    const result = await rotateOne(sampleVault, sampleUrl, { fetch: fetchImpl, now: fixedNow });
    expect(result.error).toBe(null);
    expect(result.anomaly).toBe('Expected provider AWS, got AZURE');
    expect(result.response).toEqual(body);
  });
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `npm test`
Expected: 5 new `rotateOne` tests fail with `rotateOne is not a function` (or similar — the function is not yet exported).

- [ ] **Step 3: Implement `rotateOne`**

Append to `lib/rotation.js`:

```js
// Performs one POST to regenerateKey for the given vault.
// Always resolves (never throws); errors are captured in the returned record so
// the worker pool can collect both successes and failures uniformly.
// Result shape:
//   { vault, response | null, error | null, anomaly | null, timestamp }
// `deps.fetch` and `deps.now` are injectable for testing.
export async function rotateOne(vault, regenerateKeyUrl, deps = {}) {
  const fetchImpl = deps.fetch || globalThis.fetch;
  const nowFn = deps.now || (() => new Date());
  const timestamp = nowFn().toISOString();
  try {
    const response = await fetchImpl(regenerateKeyUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}'
    });
    if (!response.ok) {
      let text = '';
      try { text = await response.text(); } catch (_) { /* ignore */ }
      return {
        vault,
        response: null,
        error: `HTTP ${response.status}: ${text || response.statusText}`,
        anomaly: null,
        timestamp
      };
    }
    const data = await response.json();
    // Defensive provider check; see docs/adr/0003-aws-detection-via-subscription-edition.md.
    const anomaly = data.provider !== 'AWS'
      ? `Expected provider AWS, got ${data.provider}`
      : null;
    return { vault, response: data, error: null, anomaly, timestamp };
  } catch (err) {
    return {
      vault,
      response: null,
      error: err.message || String(err),
      anomaly: null,
      timestamp
    };
  }
}
```

- [ ] **Step 4: Run, confirm pass**

Run: `npm test`
Expected: all 16 tests pass (6 csv-utils + 5 isAwsTenant + 5 rotateOne).

- [ ] **Step 5: Write failing tests for `runRotationPool`**

Append to `tests/rotation.test.js`:

```js
import { runRotationPool } from '../lib/rotation.js';

describe('runRotationPool', () => {
  it('processes every item exactly once', async () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const seen = [];
    const results = await runRotationPool(items, async (n) => {
      seen.push(n);
      return n * 2;
    }, { concurrency: 3 });
    expect(results.length).toBe(10);
    expect(new Set(results)).toEqual(new Set([2,4,6,8,10,12,14,16,18,20]));
    expect(new Set(seen)).toEqual(new Set(items));
  });

  it('respects the concurrency limit', async () => {
    let inFlight = 0;
    let max = 0;
    const worker = async () => {
      inFlight++;
      max = Math.max(max, inFlight);
      await new Promise(r => setTimeout(r, 5));
      inFlight--;
      return 'ok';
    };
    await runRotationPool(Array.from({ length: 20 }, (_, i) => i), worker, { concurrency: 4 });
    expect(max).toBeLessThanOrEqual(4);
    expect(max).toBeGreaterThan(1); // sanity: pool actually parallelised
  });

  it('calls onProgress after each completion with cumulative done count', async () => {
    const calls = [];
    await runRotationPool([1, 2, 3], async (n) => n, {
      concurrency: 2,
      onProgress: (done, total) => calls.push([done, total])
    });
    expect(calls.length).toBe(3);
    expect(calls.map(([d]) => d).sort()).toEqual([1, 2, 3]);
    expect(calls.every(([, t]) => t === 3)).toBe(true);
  });

  it('handles empty input', async () => {
    const results = await runRotationPool([], async () => 'x');
    expect(results).toEqual([]);
  });

  it('defaults to concurrency 5', async () => {
    let inFlight = 0;
    let max = 0;
    const worker = async () => {
      inFlight++;
      max = Math.max(max, inFlight);
      await new Promise(r => setTimeout(r, 3));
      inFlight--;
    };
    await runRotationPool(Array(12).fill(0), worker);
    expect(max).toBeLessThanOrEqual(5);
  });
});
```

- [ ] **Step 6: Run, confirm failure**

Run: `npm test`
Expected: 5 new `runRotationPool` tests fail with import / undefined errors.

- [ ] **Step 7: Implement `runRotationPool`**

Append to `lib/rotation.js`:

```js
// Limited-concurrency worker pool.
// Calls `worker(item)` for each item in `items`, with at most `concurrency`
// invocations in flight at a time. Collects every result (including any thrown
// errors that `worker` happens to surface — though in practice `rotateOne` never
// throws). Calls `onProgress(done, total)` after each completion.
export async function runRotationPool(items, worker, options = {}) {
  const concurrency = options.concurrency ?? 5;
  const onProgress = options.onProgress || (() => {});
  const total = items.length;
  const results = [];
  const queue = [...items];
  const inFlight = new Set();
  let done = 0;

  while (queue.length > 0 || inFlight.size > 0) {
    while (inFlight.size < concurrency && queue.length > 0) {
      const item = queue.shift();
      const p = Promise.resolve(worker(item))
        .then(r => {
          results.push(r);
          done++;
          onProgress(done, total);
        })
        .finally(() => { inFlight.delete(p); });
      inFlight.add(p);
    }
    if (inFlight.size > 0) await Promise.race(inFlight);
  }

  return results;
}
```

- [ ] **Step 8: Run, confirm all pass**

Run: `npm test`
Expected: 21 tests pass (6 + 5 + 5 + 5).

- [ ] **Step 9: Commit**

```bash
git add lib/rotation.js tests/rotation.test.js
git commit -m "feat(lib): add rotateOne and runRotationPool with unit tests"
```

---

## Task 8: Wire Running state in popup.js (uses imported pool)

**Files:**
- Modify: `popup.js`

**⚠️ This task is the first that performs destructive writes. Verify on staging against a single disposable test vault only.**

For this commit, do **not** yet emit the CSV — log results to the console so the integration can be verified before adding the CSV-writing step. Task 9 adds the CSV.

- [ ] **Step 1: Add imports for `rotateOne` and `runRotationPool`**

At the top of `popup.js`, update the existing import line:

```js
import { isAwsTenant, rotateOne, runRotationPool } from './lib/rotation.js';
```

- [ ] **Step 2: Replace the existing rotateButton click handler**

In the rotation section of `popup.js`, find the existing `rotateButton.addEventListener('click', ...)` block from Task 5. Replace its entire body with:

```js
  rotateButton.addEventListener('click', async () => {
    if (rotationInFlight) return;

    // Idle / Empty / re-clicked-after-empty: kick off enumeration.
    if (rotateConfirm.hidden) {
      runEnumeration();
      return;
    }

    // Preview → Running. Type-to-confirm guard.
    if (rotatePhrase.value.trim() !== CONFIRM_PHRASE) return;

    rotationInFlight = true;
    rotateButton.disabled = true;

    rotatePreview.hidden = true;
    rotateConfirm.hidden = true;
    rotateProgress.hidden = false;
    rotateBar.value = 0;
    rotateBar.max = vaultsToRotate.length;
    rotateProgressText.textContent = `Rotating 0 / ${vaultsToRotate.length} vaults…`;
    rotateStatus.textContent = '';
    rotateStatus.className = '';

    try {
      const worker = async (vault) => {
        const url = API_ENDPOINTS.REGENERATE_KEY(vault.storageName, vault.tenantId);
        return rotateOne(vault, url);
      };
      const results = await runRotationPool(vaultsToRotate, worker, {
        concurrency: 5,
        onProgress: (done, total) => {
          rotateBar.value = done;
          const pct = total === 0 ? 0 : Math.round((done / total) * 100);
          rotateProgressText.textContent = `Rotating ${done} / ${total} (${pct}%)`;
        }
      });

      // TEMP: log results to console; Task 9 replaces this with CSV download.
      console.log('Rotation results:', results);
      const successCount = results.filter(r => r.error == null).length;
      const failureCount = results.length - successCount;
      rotateStatus.className = failureCount > 0 ? 'warning' : 'success';
      rotateStatus.textContent = failureCount > 0
        ? `⚠️ ${successCount} rotated, ${failureCount} failed (CSV not yet implemented; see console).`
        : `✅ ${successCount} rotated (CSV not yet implemented; see console).`;
    } catch (err) {
      console.error('Rotation pool failed:', err);
      rotateStatus.className = 'error';
      rotateStatus.textContent = err.message;
    } finally {
      rotationInFlight = false;
      rotateButton.disabled = false;
      rotatePreview.hidden = true;
      rotatePreview.innerHTML = '';
      rotateConfirm.hidden = true;
      rotatePhrase.value = '';
      rotateProgress.hidden = true;
      rotateButton.textContent = 'Preview affected vaults';
      vaultsToRotate = [];
      enumerationFailedTenants = [];
    }
  });
```

- [ ] **Step 3: Reload and verify against a single disposable test vault**

⚠️ **Use staging and a vault you can afford to invalidate.**

1. Reload extension.
2. Open popup on `/vault/tenant/<disposable-aws-tenant-id>` containing exactly one AWS vault (or scoped to a vault you can disposably rotate).
3. Switch to Rotate → click Preview → confirm it shows the expected single vault → type `ROTATE` → click `Rotate AWS Keys`.
4. Expected during run: preview disappears, progress bar appears, text advances `Rotating 1 / 1 (100%)`, "Keep this window open" warning visible.
5. Expected after run: status reads `✅ 1 rotated (CSV not yet implemented; see console).` DevTools console shows a `Rotation results:` array with one entry containing non-empty `response.accessKey`, `response.secretKey`, `response.provider === 'AWS'`.
6. Verify server-side that the old key is now invalid and the new key works (use the AWS CLI/SDK against the vault).
7. Force a failure path: in DevTools → Network, set up a 500 override for the regenerateKey URL pattern. Run again. Confirm the result record carries `error: "HTTP 500: …"` and the batch completes.

- [ ] **Step 4: Commit**

```bash
git add popup.js
git commit -m "feat: wire rotation worker pool into popup Running state"
```

---

## Task 9: Add `formatRotationCsv` (TDD) and wire CSV download

**Files:**
- Modify: `lib/rotation.js`
- Modify: `tests/rotation.test.js`
- Modify: `popup.js`

- [ ] **Step 1: Write failing tests for `formatRotationCsv`**

Append to `tests/rotation.test.js`:

```js
import { formatRotationCsv } from '../lib/rotation.js';

const baseVault = {
  tenantId: 't1',
  tenantName: 'Acme',
  storageName: 'vault-storage',
  vaultName: 'vault-display'
};

describe('formatRotationCsv', () => {
  it('emits the header row when results are empty', () => {
    const csv = formatRotationCsv([]);
    expect(csv.trim()).toBe(
      'Timestamp,TenantName,TenantId,VaultName,StorageName,Provider,Status,AccessKey,SecretKey,Error'
    );
  });

  it('emits a Success row populated from the API response', () => {
    const csv = formatRotationCsv([{
      vault: baseVault,
      response: {
        accessKey: 'AK', secretKey: 'SK',
        storageName: 'vault-storage', tenantName: 'Acme', vaultName: 'vault-display',
        provider: 'AWS'
      },
      error: null,
      anomaly: null,
      timestamp: '2026-05-21T00:00:00.000Z'
    }]);
    const dataRow = csv.split('\n')[1];
    expect(dataRow).toBe(
      '"2026-05-21T00:00:00.000Z","Acme","t1","vault-display","vault-storage","AWS","Success","AK","SK",""'
    );
  });

  it('emits a Failed row with empty keys and Error populated', () => {
    const csv = formatRotationCsv([{
      vault: baseVault,
      response: null,
      error: 'HTTP 500: boom',
      anomaly: null,
      timestamp: '2026-05-21T00:00:00.000Z'
    }]);
    const dataRow = csv.split('\n')[1];
    expect(dataRow).toBe(
      '"2026-05-21T00:00:00.000Z","Acme","t1","vault-display","vault-storage","AWS","Failed","","","HTTP 500: boom"'
    );
  });

  it('combines API error and provider anomaly in the Error column', () => {
    const csv = formatRotationCsv([{
      vault: baseVault,
      response: {
        accessKey: 'AK', secretKey: 'SK',
        storageName: 'vault-storage', tenantName: 'Acme', vaultName: 'vault-display',
        provider: 'AZURE'
      },
      error: null,
      anomaly: 'Expected provider AWS, got AZURE',
      timestamp: '2026-05-21T00:00:00.000Z'
    }]);
    const dataRow = csv.split('\n')[1];
    expect(dataRow).toContain('"Expected provider AWS, got AZURE"');
    expect(dataRow).toContain('"AZURE"');
    expect(dataRow).toContain('"Success"');
  });

  it('falls back to enumeration fields when response is null', () => {
    const csv = formatRotationCsv([{
      vault: { tenantId: 't1', tenantName: 'Acme', storageName: 'fallback-storage', vaultName: 'fallback-vault' },
      response: null,
      error: 'HTTP 500: x',
      anomaly: null,
      timestamp: '2026-05-21T00:00:00.000Z'
    }]);
    const dataRow = csv.split('\n')[1];
    expect(dataRow).toContain('"fallback-storage"');
    expect(dataRow).toContain('"fallback-vault"');
    expect(dataRow).toContain('"AWS"');
  });

  it('escapes embedded double-quotes in tenant/vault names', () => {
    const csv = formatRotationCsv([{
      vault: { tenantId: 't1', tenantName: 'Acme "Inc"', storageName: 'storage', vaultName: 'v' },
      response: null,
      error: 'fail',
      anomaly: null,
      timestamp: '2026-05-21T00:00:00.000Z'
    }]);
    const dataRow = csv.split('\n')[1];
    expect(dataRow).toContain('"Acme ""Inc"""');
  });
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `npm test`
Expected: 6 new `formatRotationCsv` tests fail with import / undefined errors.

- [ ] **Step 3: Implement `formatRotationCsv`**

At the top of `lib/rotation.js`, add the import:

```js
import { escapeCSV } from './csv-utils.js';
```

Then append to the same file:

```js
const ROTATION_CSV_HEADERS = [
  'Timestamp', 'TenantName', 'TenantId', 'VaultName', 'StorageName',
  'Provider', 'Status', 'AccessKey', 'SecretKey', 'Error'
];

// Returns a fully-formed CSV string (header + one row per result) for rotation results.
// Caller is responsible for triggering the download.
export function formatRotationCsv(results) {
  let csv = ROTATION_CSV_HEADERS.join(',') + '\n';
  for (const { vault, response, error, anomaly, timestamp } of results) {
    const status = error == null ? 'Success' : 'Failed';
    const vaultName = response?.vaultName || vault.vaultName || '';
    const storageName = response?.storageName || vault.storageName || '';
    const provider = response?.provider || 'AWS';
    const accessKey = response?.accessKey || '';
    const secretKey = response?.secretKey || '';
    const errorText = [error, anomaly].filter(Boolean).join(' | ');

    csv += [
      `"${escapeCSV(timestamp)}"`,
      `"${escapeCSV(vault.tenantName)}"`,
      `"${escapeCSV(vault.tenantId)}"`,
      `"${escapeCSV(vaultName)}"`,
      `"${escapeCSV(storageName)}"`,
      `"${escapeCSV(provider)}"`,
      `"${escapeCSV(status)}"`,
      `"${escapeCSV(accessKey)}"`,
      `"${escapeCSV(secretKey)}"`,
      `"${escapeCSV(errorText)}"`
    ].join(',') + '\n';
  }
  return csv;
}
```

- [ ] **Step 4: Run, confirm pass**

Run: `npm test`
Expected: all 27 tests pass.

- [ ] **Step 5: Wire CSV download in popup.js**

Update the `rotation.js` import at the top of `popup.js`:

```js
import { isAwsTenant, rotateOne, runRotationPool, formatRotationCsv } from './lib/rotation.js';
```

In the `rotateButton` click handler, find the temp-log section from Task 8 — the block starting `// TEMP: log results to console` through the matching `rotateStatus.textContent = ...` line. Replace it with:

```js
      // Build base filename (mirrors export naming).
      let baseFilename = 'veeam_data_cloud_key_rotation';
      if (activeTenantId) {
        const sample = results[0]?.vault?.tenantName || 'tenant';
        const sanitized = sample.replace(/[^a-zA-Z0-9]/g, '_');
        baseFilename = `veeam_data_cloud_${sanitized}_key_rotation`;
      }

      const csv = formatRotationCsv(results);
      triggerCsvDownload(csv, baseFilename);

      const successCount = results.filter(r => r.error == null).length;
      const failureCount = results.length - successCount;
      const anomalyCount = results.filter(r => r.anomaly != null).length;

      if (failureCount === 0 && anomalyCount === 0) {
        rotateStatus.className = 'success';
        rotateStatus.textContent = `✅ ${successCount} rotated. CSV downloaded.`;
      } else if (anomalyCount === 0) {
        rotateStatus.className = 'warning';
        rotateStatus.textContent = `⚠️ ${successCount} rotated, ${failureCount} failed — see CSV.`;
      } else {
        rotateStatus.className = 'warning';
        rotateStatus.textContent = `⚠️ ${successCount} rotated, ${failureCount} failed, ${anomalyCount} provider anomaly(ies) — see CSV.`;
      }
```

- [ ] **Step 6: Reload and verify CSV download end-to-end**

1. Reload extension.
2. On `/vault/tenant/<disposable-aws-tenant-id>`: Rotate → Preview → ROTATE → run.
3. Expected: CSV downloads as `veeam_data_cloud_<TenantName>_key_rotation_<YYYY-MM-DD>.csv`. Open it:
   - Header row exactly: `Timestamp,TenantName,TenantId,VaultName,StorageName,Provider,Status,AccessKey,SecretKey,Error`
   - One Success row with non-empty `AccessKey` and `SecretKey`, empty `Error`.
4. Status shows `✅ 1 rotated. CSV downloaded.`
5. Test all-tenants filename (run on `/vault/manage` against a small disposable scope, or at minimum confirm filename pattern by stubbing): expect `veeam_data_cloud_key_rotation_<YYYY-MM-DD>.csv`.
6. Test forced failure (DevTools network 500 override): CSV contains a Failed row with the error string populated.

- [ ] **Step 7: Commit**

```bash
git add lib/rotation.js tests/rotation.test.js popup.js
git commit -m "feat: emit rotation results as CSV via formatRotationCsv"
```

---

## Task 10: Polish — disable tabs during rotation, beforeunload warning

**Files:**
- Modify: `popup.js`

- [ ] **Step 1: Disable tab buttons during a rotation**

In the `rotateButton` click handler in `popup.js`, find `rotationInFlight = true;` and immediately after it add:

```js
    tabButtons.forEach(btn => { btn.disabled = true; });
```

In the same handler's `finally` block, immediately after `rotationInFlight = false;` add:

```js
      tabButtons.forEach(btn => { btn.disabled = false; });
```

- [ ] **Step 2: Add `beforeunload` warning**

Just after the `setRotateStateIdle();` line near the end of the rotation section, append:

```js
  // Best-effort: warn the user if they try to close mid-rotation.
  // Chrome's extension-popup beforeunload behaviour is inconsistent; treat as
  // defence-in-depth, not a guarantee. See docs/adr/0004-popup-only-architecture-in-v1.md.
  window.addEventListener('beforeunload', (e) => {
    if (rotationInFlight) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
```

- [ ] **Step 3: Reload and verify**

1. Reload extension. Run a rotation on a disposable vault.
2. While the progress bar is moving, hover `Export` tab — should show disabled cursor and clicks should not switch tabs.
3. Attempt to close the popup mid-run (click outside, or press Esc if popup has Esc-to-close): note whether Chrome shows a confirm dialog. (Behaviour varies; the manual warning text in the UI is the load-bearing safeguard either way.)
4. After completion, confirm tab buttons re-enable.
5. Double-click `Rotate AWS Keys` quickly during Preview — only one rotation should start.

- [ ] **Step 4: Commit**

```bash
git add popup.js
git commit -m "feat: disable tab switching and warn on close during rotation"
```

---

## Task 11: Release prep — version bump, CHANGELOG, README

**Files:**
- Modify: `manifest.json`
- Modify: `CHANGELOG.md` (create if absent)
- Modify: `README.md`
- Modify: `package.json` (sync version field)

- [ ] **Step 1: Bump `manifest.json` version**

In `manifest.json`, change `"version": "1.2.0"` to:

```json
  "version": "1.3.0",
```

- [ ] **Step 2: Sync `package.json` version**

In `package.json`, change `"version": "1.2.0"` to `"version": "1.3.0"`.

- [ ] **Step 3: Add CHANGELOG entry**

If `CHANGELOG.md` does not exist, create it with this content; otherwise insert the new section above the most recent version.

```markdown
# Changelog

All notable changes to this project will be documented in this file. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.3.0] - 2026-05-21

### Added
- Bulk AWS vault key rotation (Rotate tab in the popup).
  - On `/vault/manage`: rotates AWS vault keys across every AWS tenant in the organisation.
  - On `/vault/tenant/<id>`: rotates AWS vault keys within that single tenant only.
  - Preview with affected tenant/vault counts and up to three example vault names before any rotation is run.
  - Type-to-confirm `ROTATE` gate before destructive action.
  - Progress bar showing rotation progress (limited concurrency: 5 in flight).
  - CSV output `veeam_data_cloud_key_rotation_<date>.csv` (or per-tenant variant) with `AccessKey`, `SecretKey`, `Status`, and `Error` columns for every attempted vault.
  - Defensive `provider !== 'AWS'` anomaly detection captured in the CSV's `Error` column.
- Vitest test suite covering the new pure logic in `lib/rotation.js` and `lib/csv-utils.js`. Run with `npm test`.

### Changed
- Popup layout now uses tabs (`Export`, `Rotate`); export behaviour is unchanged.
- `popup.js` loads as an ES module. Shared `escapeCSV` helper extracted to `lib/csv-utils.js`.
- `fetchAllTenantStats` extracted into a helper used by both Export and Rotate.
```

- [ ] **Step 4: Update `README.md`**

In `README.md`:

1. Replace any visible `1.2.0` references with `1.3.0` (including the zip filename pattern `veeam-data-cloud-vault-exporter-v1.3.0.zip`).

2. Add a new feature section under the existing features list (match the README's existing heading style):

```markdown
### Bulk AWS vault key rotation

The Rotate tab lets you regenerate keys in bulk for AWS vaults:

- **All tenants:** Open the popup on `/vault/manage`. The Rotate tab will rotate every AWS vault across every tenant in the organisation.
- **Single tenant:** Open the popup on `/vault/tenant/<id>`. The Rotate tab is scoped to that tenant's AWS vaults.

A preview shows how many tenants and vaults will be affected, with up to three example vault names. You must type `ROTATE` to enable the final action. The downloaded CSV contains the new `AccessKey` and `SecretKey` for every successful rotation, plus rows for any failures with their error message.

> ⚠️ **Rotating a key invalidates the previous one immediately.** Any tools using the old key will stop working. The downloaded CSV contains live credentials — store securely and delete after use.
```

3. If the README has a "Development" or "Contributing" section, add a sentence: `Run unit tests for pure logic with \`npm install && npm test\` (requires Node 20+). The extension itself still ships unbundled.`

- [ ] **Step 5: Reload and final smoke**

1. Reload extension. Confirm in `chrome://extensions` the version reads `1.3.0`.
2. Open popup. Verify Export tab still works.
3. Verify Rotate tab renders correctly (Preview button visible on `/vault/manage`).
4. Run `npm test` once more — all 27 tests should still pass.

- [ ] **Step 6: Commit**

```bash
git add manifest.json package.json package-lock.json CHANGELOG.md README.md
git commit -m "chore: bump version to 1.3.0 and document key rotation feature"
```

---

## Wrap-up

After Task 11:

- The branch contains 11 task commits plus the earlier docs commits.
- Re-run the full manual smoke test from the spec's "Testing plan" section against staging.
- Once staging is green, repeat the key flows on production.
- Open a PR from `feat/bulk-aws-key-rotation` to `main`. The PR body should link the spec and ADRs.
- Out of scope for this branch: building the release zip and any tests for existing pre-rotation pure functions. Both can be follow-ups.

---

## Self-review notes

**Spec coverage:**

- §Architecture (popup.js extension, new endpoint, helpers, worker pool) — Tasks 1–3, 7, 8.
- §UI (HTML, state machine, preview rendering, per-tier text) — Tasks 4, 5.
- §Data flow Phase 1 (enumeration) — Task 5.
- §Data flow Phase 2 (rotation) — Tasks 7, 8.
- §CSV format — Task 9.
- §Error handling (per-vault failures, enumeration failures, empty states, non-AWS tenant, popup close, double-click, type-to-confirm bypass) — Tasks 5, 6, 7, 8, 9, 10.
- §Testing plan — Tasks 1, 3, 7, 9 add automated coverage of pure logic; every DOM/UI task ends with a manual verification block.
- §Release checklist — Task 11.
- ADR 0003 defensive provider check — Task 7 (`anomaly` field in `rotateOne`), Task 9 (`anomaly` merged into CSV `Error`).
- ADR 0006 (Vitest + ES modules) — Task 1.

**Type/name consistency:**

- Helpers and their signatures, used consistently throughout:
  - `lib/csv-utils.js`: `escapeCSV(value)`
  - `lib/rotation.js`: `isAwsTenant(tenant, subscriptionsMap)`, `rotateOne(vault, regenerateKeyUrl, deps?)`, `runRotationPool(items, worker, options?)`, `formatRotationCsv(results)`
  - `popup.js`: `fetchAllTenantStats(tenants, onProgress)`, `setRotateStateIdle()`, `setRotateStatePreview(tenantsCount, singleTenantName)`, `setRotateStateEmpty(message)`, `runEnumeration()`, `escapeHtml(s)`
- State variables: `rotationInFlight`, `vaultsToRotate`, `enumerationFailedTenants`, `activeTenantId`, `CONFIRM_PHRASE` — referenced consistently.
- HTML IDs: `#exportTab`, `#rotateTab`, `#rotatePreview`, `#rotateConfirm`, `#rotatePhrase`, `#rotateProgress`, `#rotateBar`, `#rotateProgressText`, `#rotateButton`, `#rotateStatus` — referenced consistently.
- API endpoint name: `REGENERATE_KEY` (Tasks 3, 8).

**Placeholder scan:** none detected. Every code step contains complete code; every command contains expected output.
