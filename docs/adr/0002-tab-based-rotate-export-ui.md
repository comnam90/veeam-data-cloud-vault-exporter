# 0002 — Tab-based UI for Export and Rotate

- **Date:** 2026-05-21
- **Status:** Accepted
- **Context:** Bulk AWS key rotation feature

## Context

The popup must host both the existing Export feature and the new Rotate feature. Options considered: a separate section below the export button, a top-level tab switcher, a hidden-by-default toggle, or a fully separate view.

## Decision

Top-of-popup tabs: `[ Export ] [ Rotate ]` inside `#activeView`. Each tab content lives in its own `<section>`. URL context (single-tenant vs all-tenants) flows into both tabs identically.

## Rationale

- User explicitly chose tabs over the recommended "section below export" because the visual separation makes the destructive feature easier to find without it getting mixed into the everyday export workflow.
- Tabs train the user to make a deliberate context switch before performing a destructive action.
- Both tabs reuse the same URL-based context detection, so adding a tab does not duplicate logic.

## Consequences

- Slightly more HTML/CSS than a single-section layout.
- Tab-switching must be disabled during a rotation run to prevent the user navigating away mid-batch.
- Establishes a pattern that future features (e.g., per-vault selection) can extend without revisiting the layout decision.
