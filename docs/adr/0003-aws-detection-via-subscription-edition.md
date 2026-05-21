# 0003 — Detect AWS vaults via subscription-edition substring

- **Date:** 2026-05-21
- **Status:** Accepted
- **Context:** Bulk AWS key rotation feature

## Context

The `regenerateKey` API does not distinguish AWS vs Azure vaults before being called — `provider` is only returned in the response. Rotating a non-AWS vault by accident would be a serious bug. We need to identify AWS vaults *before* invoking the destructive endpoint.

Network capture confirmed that a tenant's cloud provider is encoded in its subscription edition: `ADVANCED_CORE_AWS`, `ADVANCED_CORE_AZURE`, etc. A tenant holds vaults of only one provider, matching its edition.

## Decision

Filter tenants in the popup using `subscription.product.edition.includes('AWS')` (case-sensitive substring match). All vaults under an AWS-edition tenant are treated as AWS without an additional per-vault check.

The extension already fetches the subscriptions endpoint for the Export feature, so no new API call is required.

## Rationale

- Avoids needing a dedicated vault-metadata lookup endpoint.
- Per-vault provider checks would mean calling another API for each vault, adding latency on orgs with hundreds of vaults.
- Matches how the portal UI itself appears to scope features to a tenant's cloud provider.

## Consequences

- **Fragile assumption:** if Veeam ever introduces an AWS-backed edition without "AWS" in the name, or a multi-provider tenant, the filter silently misses vaults.
- Mitigated by post-rotation response check: the response `provider` field is captured in the CSV, so any non-AWS vault that slipped through would be visible after the fact (though the key would have already been rotated — see the post-rotation row).
- Recommended follow-up: when implementing, also assert `response.provider === "AWS"` after each rotation and flag anomalies in the CSV.
