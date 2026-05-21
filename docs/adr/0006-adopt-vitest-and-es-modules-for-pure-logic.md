# 0006 — Adopt Vitest and ES modules for new pure-logic code

- **Date:** 2026-05-21
- **Status:** Accepted (supersedes [ADR 0001](0001-extend-popup-js-rather-than-modularise.md))
- **Context:** Bulk AWS key rotation feature

## Context

[ADR 0001](0001-extend-popup-js-rather-than-modularise.md) committed to extending `popup.js` with no modules, no test framework, and no package manager — matching the original `CLAUDE.md` description of the project. The bulk-rotation feature being designed now changes the cost/benefit on three points:

- The worker pool in `runRotationPool` has non-trivial concurrency behaviour (limit of 5 in-flight, pool drains correctly, errors don't kill the batch). Verifying this by hand on a real Veeam tenant with a disposable AWS vault is slow and risky.
- `rotateOne` performs destructive POSTs. The defensive `provider !== 'AWS'` anomaly check and the success/failure paths are exactly the kind of branching that unit tests catch regressions in.
- `formatRotationCsv` produces credentials-bearing output rows. A typo in escaping or a missing field would be hard to spot in a manual smoke test until it bit a real customer.

These three are all pure functions. Testing them does not require running Chrome.

## Decision

For new code only, adopt:

- **Vitest** as the test runner. ESM-native, zero-config, fast. Tests live in `tests/`. Run with `npm test`.
- **ES modules** for pure-logic files under `lib/`. Initially: `lib/csv-utils.js` (just `escapeCSV`, moved from `popup.js` so both Export and Rotate can import it) and `lib/rotation.js` (the rotation pure functions: `isAwsTenant`, `rotateOne`, `runRotationPool`, `formatRotationCsv`).
- **`popup.html`** changes `<script src="popup.js" defer>` to `<script type="module" src="popup.js">`. The vendored Flatpickr classic scripts continue to load as classic scripts before the module — they register globals (`flatpickr`, `monthSelectPlugin`) that the module reads from `globalThis`.
- **`popup.js`** stays the orchestrator: tab switching, state machines, DOM event wiring, fetch calls that hit the user's session. It imports pure helpers from `lib/`.

**Scope of testing:**

- **In scope:** new rotation pure functions, and `escapeCSV` (since we move it to make it importable — adding a test for the moved function verifies the toolchain works on familiar code).
- **Out of scope:** existing CSV helpers (`isDateInRange`, `convertSummaryDataToCsv`, `convertAllDataToCsv`), DOM-coupled state-machine handlers, popup lifecycle. These remain manually verified per the project's existing convention. A future retrofit can grow coverage incrementally.

## Rationale

- The cost of introducing Vitest is small: one `package.json`, one `devDependencies` entry, no config file. The extension still ships unbundled and unminified directly from the repo.
- ES modules in MV3 popup contexts are well-supported by Chromium-family browsers and Edge.
- Splitting pure logic into `lib/` aligns with the brainstorming-skill principle that "smaller, well-bounded units are easier for you to work with — you reason better about code you can hold in context at once."
- Keeping UI/orchestration in `popup.js` preserves the core principle of ADR 0001 (one place to read the destructive code path during review) without forcing pure logic to live there too.

## Consequences

- New top-level files: `package.json`, `.gitignore` (for `node_modules/`), `lib/`, `tests/`.
- Developers now need Node.js 20+ installed to run tests. The extension itself does not depend on Node.
- `CLAUDE.md` must be updated to reflect: tests exist, npm is used for the test runner, ES modules are allowed in `popup.js`.
- ADR 0001 is superseded but its rationale (extend `popup.js` for orchestration, don't prematurely modularise UI) remains a design principle — only the absolute "no modules / no test suite" parts are revisited.
- Future features should default to: pure logic in `lib/` with tests; UI/orchestration in `popup.js` with manual verification. Retrofit existing pure logic into `lib/` opportunistically when nearby work demands it, not as a standalone effort.
