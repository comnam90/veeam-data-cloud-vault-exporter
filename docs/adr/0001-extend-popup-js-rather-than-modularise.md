# 0001 — Extend `popup.js` rather than split into modules

- **Date:** 2026-05-21
- **Status:** Superseded by [ADR 0006](0006-adopt-vitest-and-es-modules-for-pure-logic.md) (also 2026-05-21)
- **Context:** Bulk AWS key rotation feature

## Context

Adding bulk key rotation grows `popup.js` from ~520 to roughly 850 lines. Options considered: extend the existing file, split rotation into a new `<script>` file, or hybrid with shared helpers extracted.

## Decision

Extend `popup.js`. All rotation logic lives in the same `DOMContentLoaded` handler as the existing export code.

## Rationale

- `CLAUDE.md` explicitly states the project convention: "All logic. ~520 lines, single `DOMContentLoaded` handler. No modules, no bundling."
- The destructive nature of key rotation benefits from being readable in one place during review.
- Splitting introduces a structural pattern the project hasn't used before and would require careful state-sharing across files (no module system, no bundler).
- Grow-then-split is healthier than premature modularisation in a no-build-tools project.

## Consequences

- `popup.js` becomes harder to navigate at ~850 lines; mitigated by clear section comments.
- If a third major feature is added, splitting becomes worth revisiting.
- Vault enumeration is extracted into a shared helper (`fetchAllTenantStats`) — one small refactor that both Export and Rotate call.
