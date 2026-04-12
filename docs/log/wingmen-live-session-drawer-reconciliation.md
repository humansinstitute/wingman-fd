# Wingmen Live Session Drawer Reconciliation Note

## Context

This repo's dirty tree contains a partial Flight Deck-first `live` implementation:

- [index.html](/Users/mini/code/wingmanbefree/wingman-fd/index.html)
- [src/live-manager.js](/Users/mini/code/wingmanbefree/wingman-fd/src/live-manager.js)
- [tests/live-manager.test.js](/Users/mini/code/wingmanbefree/wingman-fd/tests/live-manager.test.js)
- [tests/live-rendering.test.js](/Users/mini/code/wingmanbefree/wingman-fd/tests/live-rendering.test.js)

The confirmed production owner is now upstream in `../../wingmen`, where the drawer already exists in:

- [../../wingmen/src/ui/live/session-drawer.js](/Users/mini/code/wingmen/src/ui/live/session-drawer.js)
- [../../wingmen/src/ui/views/live-view.js](/Users/mini/code/wingmen/src/ui/views/live-view.js)
- [../../wingmen/src/ui/state/index.js](/Users/mini/code/wingmen/src/ui/state/index.js)
- [../../wingmen/src/ui/live/session-drawer.test.js](/Users/mini/code/wingmen/src/ui/live/session-drawer.test.js)

## Decision

Reconcile by intent, not by file migration.

What to preserve conceptually from the local FD-first experiment:

- mobile versus desktop drawer mode split
- related-record extraction from session metadata
- session-scoped Night Watch report filtering
- Night Watch report modal open or close state as dedicated UI state

What not to preserve as production direction:

- a duplicate Flight Deck-owned `/live` route
- FD-local rendering assertions that treat `index.html` as the drawer owner
- a second local session-drawer state model that competes with upstream `state.liveDrawer`

## Consequences

- The next real implementation pass should extend upstream tests or code where needed.
- The local FD-first files should not be expanded just to keep parity with upstream behavior.
- If Pete later chooses to remove the local experiment, that removal should happen explicitly and separately from drawer feature work.
