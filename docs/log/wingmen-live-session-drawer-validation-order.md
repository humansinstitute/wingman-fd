# Wingmen Live Session Drawer Validation And Order

## Context

The design doc already identified `../../wingmen` as the owning implementation repo, but the execution order and validation commands were still implicit.

## Decision

Use an upstream-first sequence:

1. extend drawer-focused upstream tests
2. adjust upstream drawer state only if needed
3. update upstream drawer rendering and behavior
4. adjust upstream API contracts only if tests prove the current ones are insufficient
5. keep any later Flight Deck deep-link work separate

## Validation

Confirmed upstream command support on April 13, 2026:

- [../../wingmen/package.json](/Users/mini/code/wingmen/package.json) exposes `bun test`
- there is no upstream `build` script for this feature handoff

Consequences:

- the real next implementation pass should validate with `cd /Users/mini/code/wingmen && bun test`
- Flight Deck validation remains local only if a later interoperability slice is explicitly added here
