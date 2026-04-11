# Wingmen Live Session Drawer Acceptance Audit

## Context

The original step-1 brief was written as if the drawer still needed design and implementation planning. After follow-up inspection, the owning implementation already exists upstream in `../../wingmen`, so the remaining risk is no longer "what should we build?" but "what is already covered, and what still needs follow-up evidence?"

## Findings

The owning implementation now has dedicated automated coverage in:

- [../../wingmen/src/ui/live/session-drawer.test.js](/Users/mini/code/wingmen/src/ui/live/session-drawer.test.js)
- [../../wingmen/src/ui/views/live-view.test.js](/Users/mini/code/wingmen/src/ui/views/live-view.test.js)

Those tests currently cover:

- desktop versus mobile drawer mode
- default desktop visibility until user dismissal
- mobile overlay visibility behavior
- goal and current next-action rendering
- related-record extraction and display inputs
- session-scoped Night Watch history filtering
- newest-first history sorting
- bounded history preview
- distinct empty and unavailable history states
- report modal content rendering
- live-view desktop side-panel composition
- live-view mobile backdrop and modal composition

The owning implementation also now has a dedicated UI state surface in:

- [../../wingmen/src/ui/state/index.js](/Users/mini/code/wingmen/src/ui/state/index.js)

where `state.liveDrawer` holds:

- open or closed state
- user-toggled state
- save-in-flight state
- Night Watch reports error state
- report modal selection state
- goal drafts
- next-action drafts

## Remaining Gaps

The following items are still not fully closed by the current record:

- authenticated mobile browser verification of takeover behavior
- any future Flight Deck deep-link navigation from task, flow, or doc identifiers
- a decision on whether Night Watch history should keep filtering the global reports endpoint or gain a dedicated per-session endpoint later

## Consequences

- Future work should extend the upstream implementation and tests, not restart the feature in `wingman-fd`.
- The local `wingman-fd` dirty-tree `live` experiment should be treated as conflicting work until someone explicitly reconciles it against the upstream owner.
