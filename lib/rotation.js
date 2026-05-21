import { escapeCSV } from './csv-utils.js';

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
      credentials: 'include',
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
    // Handle 204 No Content or any empty-body success response gracefully.
    let data;
    try { data = await response.json(); } catch (_) { data = null; }
    if (!data) {
      return { vault, response: null, error: 'API returned empty response body — rotation may not have occurred', anomaly: null, timestamp };
    }
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

// Limited-concurrency worker pool.
// Calls `worker(item)` for each item in `items`, with at most `concurrency`
// invocations in flight at a time. Collects every result (including any thrown
// errors that `worker` happens to surface — though in practice `rotateOne` never
// throws). Calls `onProgress(done, total)` after each completion.
export async function runRotationPool(items, worker, options = {}) {
  const concurrency = Math.max(1, options.concurrency ?? 5);
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
        .catch(err => {
          results.push({ vault: item, response: null, error: err.message || String(err), anomaly: null, timestamp: new Date().toISOString() });
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
