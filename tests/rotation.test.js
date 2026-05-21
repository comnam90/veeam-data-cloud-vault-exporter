import { describe, it, expect } from 'vitest';
import { isAwsTenant } from '../lib/rotation.js';
import { rotateOne } from '../lib/rotation.js';
import { runRotationPool } from '../lib/rotation.js';
import { formatRotationCsv } from '../lib/rotation.js';

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

  it('captures result even when worker rejects', async () => {
    const items = ['ok', 'fail', 'ok2'];
    const worker = async (x) => {
      if (x === 'fail') throw new Error('worker exploded');
      return x;
    };
    const results = await runRotationPool(items, worker, { concurrency: 2 });
    expect(results.length).toBe(3);
    const failed = results.find(r => r.error);
    expect(failed?.error).toBe('worker exploded');
  });
});

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
