# Wingmen Live Session Drawer Step 1

## Tests That Must Pass

This step is design-only. The tests below are the first implementation deliverable for task `539eeac6-a5c7-444b-97f7-42a3ed2716e6`.

### 1. Route and drawer entry point

Target files:

- `tests/live-session-route.test.js` (new)
- `tests/live-session-drawer-rendering.test.js` (new)

Cases:

- Flight Deck either exposes a `live` section with `sessionid` route support, or explicitly mounts the drawer inside the owning live-session template if that template lands from another slice first.
- The session screen exposes a left-side drawer toggle button with a stable hook such as `live-session-drawer-toggle`.
- The drawer markup is not nested inside unrelated section guards.
- The drawer closes on backdrop click in mobile takeover mode.

### 2. Drawer state and responsive behavior

Target files:

- `tests/live-session-manager.test.js` (new)
- `tests/live-session-drawer-responsive.test.js` (new)

Cases:

- Store state includes `showLiveSessionDrawer`, `showNightWatchHistoryModal`, `activeLiveSessionId`, and draft/edit flags for goal, next action, and Night Watchman.
- Opening the drawer in desktop mode keeps the main session pane visible and adds the side-panel layout class.
- Opening the drawer in mobile mode hides or covers the main session pane and shows a dismissible overlay.
- Closing the drawer clears transient modal state without clearing the selected session snapshot.

### 3. Session metadata hydration and edits

Target files:

- `tests/live-session-manager.test.js` (new)
- `tests/live-session-translator.test.js` (new)
- `tests/live-session-db.test.js` (new)

Cases:

- Incoming session snapshots normalize into a stable local row shape without mutating the transport payload.
- Drawer fields render from the local materialized snapshot, not raw API responses.
- Goal and next-action editors initialize from the current session row, track dirty state, and submit only trimmed values.
- Night Watchman on/off toggles use a dedicated update path and optimistically update the local row while preserving the previous value on failure.
- Sparse refresh payloads do not blank previously known session metadata, related records, or history preview rows.

### 4. Related records and quick actions

Target files:

- `tests/live-session-manager.test.js` (new)
- `tests/live-session-drawer-rendering.test.js` (new)

Cases:

- Tasks, flows, docs, and related records normalize into explicit drawer sections with stable empty states.
- Clicking a task, flow, or doc row routes into the existing Flight Deck navigation helpers instead of hardcoding URLs.
- Project, app, and doc links render only when the upstream snapshot provides them.
- Destructive quick actions such as document removal require an explicit confirm path and remain hidden when the session payload does not advertise the capability.

### 5. Night Watchman history preview and modal path

Target files:

- `tests/live-session-history-modal.test.js` (new)
- `tests/live-session-manager.test.js` (new)

Cases:

- The drawer shows a bounded recent-history preview for Night Watchman triggers.
- Clicking a preview row opens a modal bound to the selected trigger event.
- The modal can be dismissed by backdrop click and close button.
- Empty-history and unavailable-history states are distinct.
- The modal still works when the drawer is open in mobile takeover mode.

### 6. CSS contract for drawer and modal

Target files:

- `tests/live-session-drawer-responsive.test.js` (new)
- `tests/live-session-drawer-rendering.test.js` (new)

Cases:

- Desktop CSS gives the live session workspace a two-pane layout with a left drawer and a visible main pane.
- Mobile CSS switches to a full-screen drawer takeover with the main pane hidden or covered.
- The Night Watchman history modal uses the existing modal layering rules and sits above the drawer overlay.
- Drawer scrolling is independent from the main session pane.

## Current Repo Findings

- `wingman-fd` does not currently contain a `live` nav section or a Wingmen Live session screen. The known route inventory is `status`, `chat`, `tasks`, `calendar`, `schedules`, `docs`, `reports`, `people`, `scopes`, `flows`, and `settings`.
- There is no existing Night Watchman or session-goal or next-action surface anywhere in this repo.
- The nearest edit surfaces are workspace automation settings in [index.html](/Users/mini/code/wingmanbefree/wingman-fd/index.html), [src/workspace-manager.js](/Users/mini/code/wingmanbefree/wingman-fd/src/workspace-manager.js), and [src/translators/settings.js](/Users/mini/code/wingmanbefree/wingman-fd/src/translators/settings.js).
- The nearest responsive side-panel pattern is the chat thread mobile takeover plus the desktop side-panel layouts in [index.html](/Users/mini/code/wingmanbefree/wingman-fd/index.html) and [src/styles.css](/Users/mini/code/wingmanbefree/wingman-fd/src/styles.css).
- The nearest history-modal pattern is the approval history modal in [index.html](/Users/mini/code/wingmanbefree/wingman-fd/index.html) and [src/styles.css](/Users/mini/code/wingmanbefree/wingman-fd/src/styles.css).
- `workspace_settings` and `agent_chat_triggers` are workspace-scoped records. They are not valid storage for per-session goal, next action, or Night Watchman history.

## Proposed Implementation Changes

### 1. Ownership and data flow

Source of truth:

- Session metadata, Night Watchman state, and Night Watchman trigger history should be treated as operational session data owned by Wingmen, not as Tower-synced workspace records.
- Flight Deck should read and update that data through the already-configured `workspaceHarnessUrl` when available.

Flight Deck shape:

- Add a dedicated FD-side adapter boundary for live-session data instead of leaking operational payloads into Alpine templates.
- Materialize the latest session snapshot and Night Watchman history preview into workspace-local Dexie tables so the drawer can render from local state and survive refreshes.

Recommended local tables:

- `live_sessions`: `&session_id, workspace_owner_npub, updated_at, status`
- `live_session_night_watch_events`: `&event_id, session_id, triggered_at`

Recommended transport-to-local split:

- transport shape comes from the Wingmen operational API
- local row shape is Dexie-friendly and merge-safe
- render shape is exposed through computed helpers in a new live-session manager mixin

### 2. Route and screen shell

Preferred FD path:

- Add a `live` route with `sessionid` query support.
- Add a dedicated live-session template in `index.html`.
- Add shell-state routing for selecting a session and toggling the drawer.

If the owning session screen lands in another repo first:

- Keep the FD work limited to the drawer manager, local materialization, and reusable markup/CSS contract.
- Do not fake a placeholder `live` screen solely to satisfy the drawer task.

### 3. Drawer UX

Desktop:

- The drawer lives on the left and opens beside the main session pane.
- The session pane stays interactive and visible.

Mobile:

- Opening the drawer takes over the screen with an overlay and dismiss control.
- The main session pane is hidden or fully covered until the drawer closes.

Drawer content:

- session summary metadata
- Night Watchman enabled state
- current goal editor
- current next-action editor
- related tasks, flows, docs, and associated records
- quick links for project, app, and docs when present
- destructive actions only when explicitly advertised by the upstream session payload
- Night Watchman history preview with a modal detail path

### 4. Edit paths

Recommended write methods in the new manager:

- `saveLiveSessionGoal(sessionId, goal)`
- `saveLiveSessionNextAction(sessionId, nextAction)`
- `setNightWatchmanEnabled(sessionId, enabled)`
- `openNightWatchHistoryEvent(eventId)`

Write behavior:

- optimistic local update in Dexie
- background API write through the harness URL
- rollback to the prior local row on failure
- preserve unrelated metadata fields during partial updates

### 5. Related records behavior

- Task, flow, and doc records should route through existing Flight Deck helpers such as `navigateTo`, task-detail openers, and doc openers.
- Project, app, and doc links that are external to Flight Deck should stay as data-driven links from the session payload.
- The drawer must not invent synthetic workspace records for related links that do not already exist upstream.

### 6. Night Watchman history modal

- Reuse the approval-history modal architecture: overlay, scrollable panel, close affordances, and click-through row behavior.
- Keep preview rows in the drawer bounded to a small list such as the latest 5 events.
- Open the modal from a preview-row click or a “View all history” affordance.
- Modal content should support a detail view for one selected event plus a list/table view for nearby entries if the API returns them.

## Exact Files And Subsystems Expected To Change

Primary FD files:

- [index.html](/Users/mini/code/wingmanbefree/wingman-fd/index.html)
  - live-session template or drawer mount point
  - drawer entry button
  - Night Watchman history modal markup
- [src/styles.css](/Users/mini/code/wingmanbefree/wingman-fd/src/styles.css)
  - drawer layout
  - mobile takeover overlay
  - modal layering
- [src/route-helpers.js](/Users/mini/code/wingmanbefree/wingman-fd/src/route-helpers.js)
  - `live` route and `sessionid` parsing if FD owns the route
- [src/shell-state.js](/Users/mini/code/wingmanbefree/wingman-fd/src/shell-state.js)
  - `live` section routing
  - drawer open/close UI state
- [src/app.js](/Users/mini/code/wingmanbefree/wingman-fd/src/app.js)
  - store assembly and any still-local defaults until shell extraction catches up
- [src/api.js](/Users/mini/code/wingmanbefree/wingman-fd/src/api.js)
  - harness-backed fetch/update helpers for session metadata and Night Watchman history
- [src/db.js](/Users/mini/code/wingmanbefree/wingman-fd/src/db.js)
  - `live_sessions` and `live_session_night_watch_events` tables plus helpers
- [src/section-live-queries.js](/Users/mini/code/wingmanbefree/wingman-fd/src/section-live-queries.js)
  - live-session subscriptions if FD owns the screen
- `src/live-session-manager.js` (new)
  - drawer state
  - session draft/edit methods
  - related-record helpers
  - Night Watchman history modal state
- `src/translators/live-sessions.js` (new)
  - transport-to-local normalization
  - merge logic for sparse refresh payloads

Expected test files:

- `tests/live-session-route.test.js` (new)
- `tests/live-session-manager.test.js` (new)
- `tests/live-session-drawer-rendering.test.js` (new)
- `tests/live-session-drawer-responsive.test.js` (new)
- `tests/live-session-history-modal.test.js` (new)
- `tests/live-session-translator.test.js` (new)
- `tests/live-session-db.test.js` (new)

Likely adjacent repo follow-up, not part of this FD step:

- Wingmen operational API and UI ownership in `../wingmen` still needs confirmation before production implementation.

## Validation Commands

Design-step commands:

- `git diff --check`

Implementation-step commands:

- `bun run test tests/live-session-route.test.js tests/live-session-manager.test.js tests/live-session-drawer-rendering.test.js tests/live-session-drawer-responsive.test.js tests/live-session-history-modal.test.js tests/live-session-translator.test.js tests/live-session-db.test.js`
- `bun run build`

## Risks

- The largest blocker is ownership ambiguity: this repo does not currently own a live-session screen, while the requested data is runtime/session data that likely originates in `../wingmen`.
- Reusing `workspace_settings` for per-session metadata would couple unrelated lifecycles and leak one session’s goal or next action across the whole workspace.
- Reusing `agent_chat_triggers` would conflate legacy workspace automation diagnostics with active session controls.
- If the harness API returns sparse payloads, careless local replacement logic could erase known related-record links or history preview rows.
- Mobile takeover can easily regress focus handling and scroll locking if it is implemented ad hoc instead of following the existing overlay patterns.

## Fallback Plans

- If FD route ownership is not confirmed in time, keep the manager, Dexie materialization, drawer markup, and modal contract reusable so the same implementation can mount inside whichever repo owns the session screen.
- If Dexie persistence is too large for the first production slice, keep the API adapter and manager boundaries identical and temporarily back the drawer with in-memory state only. This is an implementation fallback, not the preferred end state.
- If the Night Watchman history endpoint is not ready, block the history modal feature behind an explicit unavailable state. Do not fabricate history from unrelated records or client logs.

## Explicit Non-Goals

- Do not repurpose `workspace_settings` or `agent_chat_triggers` for session-scoped metadata.
- Do not redesign the entire Wingmen Live session screen beyond the drawer shell and modal path needed for this task.
- Do not migrate the full existing CMD menu in this step. Only provide the drawer slots and data-driven quick-action surface needed for the accepted targets.
- Do not start dev servers in this step.
- Do not change Tower contracts in this repo.

## Backend-Contract Questions Still Open

1. Does Flight Deck actually own the long-lived Wingmen Live session screen, or should FD only provide reusable drawer and related-record navigation while `../wingmen` owns the main screen shell?
2. What is the canonical operational endpoint for reading and writing session goal, next action, and Night Watchman state off `workspaceHarnessUrl`?
3. What fields are guaranteed for session metadata: session label, runtime status, started-at, last-active-at, project link, app link, doc link, and destructive-action capabilities?
4. What is the stable shape for Night Watchman trigger history rows and modal-detail payloads?
5. Are related-record references returned as Flight Deck record ids, external URLs, or both?
