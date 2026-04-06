# Start Run Button Styling Fix

## Problem

The Start Run button in the flow start confirmation dialog and the flow card Start button had inconsistent styling:

1. `btn-primary` lacked `:focus`, `:disabled` pseudo-class styles, making it incomplete as a button system component.
2. The Cancel button in the flow-start-confirm dialog had no CSS class at all.
3. The flow card "Start" button used a one-off `btn-start-flow` class with hardcoded blue colors instead of the established button system.

## Decision

- Added `:focus` (ring-style box-shadow) and `:disabled` (opacity + cursor) states to `btn-primary` to complete the interactive state coverage.
- Applied `btn-secondary` to the Cancel button in the confirmation dialog.
- Replaced `btn-start-flow` with `btn-primary btn-small` on the flow card Start button and removed the one-off CSS rules.

## Rationale

All buttons should use the shared `btn-primary` / `btn-secondary` / `btn-danger` / `btn-small` system. One-off classes create visual drift and miss interactive states. The `:focus` ring is important for keyboard accessibility. The `:disabled` state prevents confusion when a button is non-interactive.

## Files changed

- `src/styles.css` — added `btn-primary:focus` and `btn-primary:disabled`, removed `.btn-start-flow` rules
- `index.html` — applied `btn-secondary` to Cancel button, replaced `btn-start-flow` with `btn-primary` on flow card Start button
- `tests/start-run-button.test.js` — new test file covering all assertions
