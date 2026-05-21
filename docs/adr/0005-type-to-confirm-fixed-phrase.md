# 0005 — Type-to-confirm with the fixed phrase `ROTATE`

- **Date:** 2026-05-21
- **Status:** Accepted
- **Context:** Bulk AWS key rotation feature

## Context

Bulk key rotation is irreversible: invalidating an old key cannot be undone, and any system using it stops working immediately. The confirmation step needs to defend against muscle-memory misclicks, accidental Enter-key triggering, and double-clicks.

Options considered: native `confirm()` dialog, two-step button (red on second click), preview + tenant-name typing, preview + fixed-phrase typing.

## Decision

Show a preview of the vaults about to be affected, then require the user to type `ROTATE` (uppercase, exact match) into an input field. The confirm button stays `disabled` until `input.value.trim() === 'ROTATE'`. Same phrase for both tiers (all-tenants and single-tenant).

The preview itself is bounded: at most three example vault names plus a `"+ N more"` summary, so a 1000-vault org does not flood the popup.

## Rationale

- A fixed phrase is simpler to implement and explain than per-tenant name typing.
- Per-tenant name typing was rejected because it doesn't scale to the all-tenants tier (no single "name" to type) and produces inconsistent UX across tiers.
- "ROTATE" is short enough to type quickly when the user is intentional, long enough that it cannot be triggered by accident.
- Strict equality (no case folding, no fuzzy match) prevents subtle bypasses.

## Consequences

- Implementation is a single input-listener + button-disabled toggle. No state machine for typing progress.
- If the phrase ever needs to change (e.g., translation), it changes in one place.
- The confirmation step does not require the user to identify the *scope* (which tenants) by typing, only their *intent*. The preview list is the scope guard; the typing is the intent guard.
