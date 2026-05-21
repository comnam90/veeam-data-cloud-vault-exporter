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
