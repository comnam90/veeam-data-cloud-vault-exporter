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
