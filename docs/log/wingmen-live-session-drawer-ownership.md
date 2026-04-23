# Wingmen Live Session Drawer Ownership

## Context

Task `539eeac6-a5c7-444b-97f7-42a3ed2716e6` asks for a session-metadata drawer, session goal and next-action editing, Night Watchman on/off, related-record links, and Night Watchman trigger history.

The original risk in `wingman-fd` was that an implementation here could try to reuse:

- `workspace_settings`
- the retired Agent Chat trigger workspace records

Neither is correct for per-session runtime state.

## Decision

The production implementation for the session drawer belongs in `../../wingmen`, not in `wingman-fd`.

Why:

- `../../wingmen` already owns the `/live` session route
- `../../wingmen` already owns the current live `Cmd` menu
- `../../wingmen` already exposes session metadata APIs
- `../../wingmen` already exposes per-session Night Watch toggle APIs
- `../../wingmen` already stores Night Watch report cards

`wingman-fd` should only participate later if the owning live drawer needs explicit deep-link interoperability into Flight Deck task, flow, or doc records.

## Consequences

- Do not add a duplicate live-session screen to Flight Deck.
- Do not create a Tower-synced record family for session runtime metadata.
- Do not extend `workspace_settings` or the retired Agent Chat trigger workspace records to carry session goal, next action, or Night Watch history.
- Target the real UI work to `../../wingmen/src/ui/views/live-view.js` and related session/nightwatch modules.
- Keep any later Flight Deck work narrow and integration-focused.

## Current Working Tree Note

This repo's current dirty tree already contains a partial Flight Deck-first `live` slice:

- `index.html` has a `Live` nav entry and stub drawer markup
- `src/live-manager.js` exists as an untracked local module
- `tests/live-manager.test.js` and `tests/live-rendering.test.js` exist as untracked local tests

Treat that as in-progress conflicting work, not as an ownership override. The next implementation pass should reconcile it explicitly rather than extending it by accident.
