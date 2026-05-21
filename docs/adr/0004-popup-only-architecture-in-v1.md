# 0004 — Popup-only rotation in v1 (no service worker)

- **Date:** 2026-05-21
- **Status:** Accepted (revisit at v1.1)
- **Context:** Bulk AWS key rotation feature

## Context

Manifest V3 popup windows terminate their JavaScript context when closed. If the user closes the popup mid-rotation, in-flight `regenerateKey` requests are cancelled and any successfully-rotated keys whose responses had not yet been written to the in-memory `results` array are lost. This is a real data-loss risk: the old key has been invalidated server-side but the new credentials never reach the CSV.

Two architectures considered: keep all rotation logic in the popup, or move it to an MV3 service worker driven by message-passing from the popup.

## Decision

Keep rotation in the popup for v1. Mitigate via:

1. A persistent "Keep this window open — closing it stops rotation" warning during the Running state.
2. Disabling tab switching while a run is in flight.
3. Optionally, a `beforeunload` confirm dialog (drop if it proves unreliable inside an extension popup during testing).

## Rationale

- A service-worker architecture would require introducing `chrome.runtime` message-passing, persistent state for in-progress runs, and notification-based progress UI. Significant scope creep for v1.
- The existing Export feature is also popup-only and has not produced complaints, suggesting users keep the window open for short-running operations.
- Bulk rotation on a 1000-vault org at 5 concurrency averaging 1 s per call is still under 4 minutes — long but bounded.

## Consequences

- Closing the popup mid-rotation may leave the org partially rotated with no record of which keys are now invalid. The user must re-run the preview to spot the gap.
- v1.1 candidate: service-worker-backed rotation with persistent progress, survives popup close.
- Implementation must surface the warning prominently and make tab buttons obviously disabled.
