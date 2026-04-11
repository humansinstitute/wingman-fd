# Wingmen Live Session Drawer Step 1

## Scope

This is the step-1 design artifact for task `539eeac6-a5c7-444b-97f7-42a3ed2716e6`.

The brief asked for a left-side session metadata drawer on the Wingmen Live session screen with:

1. session metadata display
2. editing for Night Watchman on/off, current goal, and current next action
3. related tasks, flows, and records
4. Night Watchman trigger history with a click-through modal
5. mobile takeover mode
6. desktop side-panel mode

This step does not land production code or production tests. It defines the correct implementation boundary, the test plan, the exact upstream files that own the work, and the limited Flight Deck interoperability follow-up that may be needed later.

Latest board correction from Pete on 2026-04-11:

- "THIS IS ALL WRONG YOU BUILT THIS IN FLIGHT DECK not in ~/code/wingmen"

That correction is now treated as authoritative. Any follow-up implementation task for this drawer should target `~/code/wingmen` first and treat the local Flight Deck slice only as prior investigation or optional deep-link follow-up.

## Tests That Must Pass

The real implementation belongs primarily in `../../wingmen`, so the test plan is split into owning tests there and optional later FD integration tests here.

### 1. Live drawer shell and route ownership

Owning test files in `../../wingmen`:

- `src/ui/views/live-view*.test.js`
- `src/ui/live/*.test.js`

Cases:

- `/live` and `/live/:id` continue to resolve to the existing live session screen.
- The session screen exposes a left-drawer entry point with a stable selector.
- The drawer mounts into the existing live session layout rather than a duplicate screen.
- Mobile opening applies takeover mode and dismissal affordances.
- Desktop opening keeps the main session pane visible and shows a side-by-side panel.

### 2. Session metadata edits

Owning test files in `../../wingmen`:

- `src/server/session-api-routes.test.ts`
- `src/ui/services/sessions*.test.js`
- `src/ui/nightwatch/*.test.js`

Cases:

- goal edits still go through `PATCH /api/sessions/:id/metadata`
- next-action edits still go through `PATCH /api/sessions/:id/metadata`
- `nextActionTemplate` remains preserved and editable where the drawer exposes it
- enabling Night Watch still updates metadata first, then calls the existing enable endpoint
- disabling Night Watch still goes through the existing disable endpoint

### 3. Related record rendering

Owning test files in `../../wingmen`:

- `src/ui/views/live-view*.test.js`

Cases:

- task chips render from `taskIds`
- flow affordances render from `flowId`
- flow-run labels render from `flowRunId`
- session project metadata renders from `project`
- links remain hidden when the corresponding metadata fields are absent

Optional later tests in `wingman-fd` only if deep-link integration is added:

- `tests/live-session-deep-links.test.js` (new)

Cases:

- Flight Deck can resolve task, flow, and doc ids received from Wingmen into existing local navigation helpers

### 4. Night Watch history preview and modal

Owning test files in `../../wingmen`:

- `src/ui/nightwatch/*.test.js`
- `src/ui/views/live-view*.test.js`

Cases:

- the drawer shows a bounded recent-history preview
- clicking a history row opens a modal or detail view
- modal dismissal works from close button and backdrop
- empty-history and unavailable-history states are distinct
- the first implementation can filter existing global reports by `sessionId`

### 5. Drawer CSS contract

Owning test files in `../../wingmen`:

- `src/ui/views/live-view*.test.js`
- CSS contract tests where that repo currently keeps responsive assertions

Cases:

- desktop uses a two-pane layout
- mobile uses a full takeover drawer
- drawer scrolling is independent from the session transcript
- history modal layers above the drawer overlay

## Current Flight Deck Findings

- `wingman-fd` does not currently contain a `live` nav section or a Wingmen Live session screen.
- `wingman-fd` does not currently contain a Night Watchman runtime surface.
- `workspace_settings` and `agent_chat_triggers` are workspace-scoped records and are not valid storage for per-session runtime metadata.
- The closest local UI patterns are:
  - responsive side panels in [index.html](/Users/mini/code/wingmanbefree/wingman-fd/index.html) and [src/styles.css](/Users/mini/code/wingmanbefree/wingman-fd/src/styles.css)
  - the approval history modal in [index.html](/Users/mini/code/wingmanbefree/wingman-fd/index.html) and [src/styles.css](/Users/mini/code/wingmanbefree/wingman-fd/src/styles.css)
  - workspace automation settings in [src/workspace-manager.js](/Users/mini/code/wingmanbefree/wingman-fd/src/workspace-manager.js)

## Dirty Tree Divergence

The current dirty tree already contains an in-flight Flight Deck implementation that conflicts with the confirmed ownership boundary above.

Observed local files:

- modified [index.html](/Users/mini/code/wingmanbefree/wingman-fd/index.html) now contains:
  - a `Live` sidebar entry
  - `navSection === 'live'`
  - a stub `live-session-drawer`
  - a stub Night Watch report modal
- untracked [src/live-manager.js](/Users/mini/code/wingmanbefree/wingman-fd/src/live-manager.js)
- untracked [tests/live-manager.test.js](/Users/mini/code/wingmanbefree/wingman-fd/tests/live-manager.test.js)
- untracked [tests/live-rendering.test.js](/Users/mini/code/wingmanbefree/wingman-fd/tests/live-rendering.test.js)

Those local changes appear to assume a Flight Deck-owned `/live` surface. They should be treated as another session's in-progress work, not as proof that the ownership decision changed.

Implication:

- do not silently extend that FD-first slice without explicit confirmation
- if that slice continues, it should be consciously re-scoped as an interoperability experiment or moved to the owning `../../wingmen` repo
- the next implementer should reconcile the dirty-tree work against the upstream ownership evidence before landing production code

### Follow-up Validation For Pete's "No Visible Drawer" Review Comment

The current local Flight Deck slice does explain why no drawer became visibly available from this repo, even after a PM2 restart and Cloudflare cache clear:

- the local drawer is only a stub in [index.html](/Users/mini/code/wingmanbefree/wingman-fd/index.html) and it is gated by `liveDrawerOpen`
- `liveDrawerOpen` still initializes to `false` in [src/app.js](/Users/mini/code/wingmanbefree/wingman-fd/src/app.js), so the drawer is hidden by default instead of rendering as a visible desktop side panel
- [src/styles.css](/Users/mini/code/wingmanbefree/wingman-fd/src/styles.css) still has no `.live-session-*` or `.live-nightwatch-*` CSS contract, so there is no completed FD drawer layout to ship
- [src/app.js](/Users/mini/code/wingmanbefree/wingman-fd/src/app.js) still omits a `live` case in `getRoutePath()`, so `navigateTo('live')` syncs browser history back to `/flight-deck` instead of a stable `/live` route

That combination means the dirty-tree FD slice was not a real shipped implementation of the requested drawer. A restart or cache clear could not make it appear because the visible drawer behavior was never completed here.

## Adjacent Repo Findings

The brief did prove a second-repo inspection was required. The actual Wingmen Live implementation already exists in `../../wingmen`.

Owning live UI:

- [../../wingmen/src/ui/views/live-view.js](/Users/mini/code/wingmen/src/ui/views/live-view.js)
- [../../wingmen/src/ui/app.js](/Users/mini/code/wingmen/src/ui/app.js)
- [../../wingmen/src/ui/index.html](/Users/mini/code/wingmen/src/ui/index.html)
- [../../wingmen/src/ui/styles.css](/Users/mini/code/wingmen/src/ui/styles.css)

Owning session metadata API:

- [../../wingmen/src/ui/services/sessions.js](/Users/mini/code/wingmen/src/ui/services/sessions.js)
- [../../wingmen/src/server/session-api-routes.ts](/Users/mini/code/wingmen/src/server/session-api-routes.ts)
- [../../wingmen/src/sessions/session-metadata.ts](/Users/mini/code/wingmen/src/sessions/session-metadata.ts)

Owning Night Watch APIs and storage:

- [../../wingmen/src/ui/nightwatch/api.js](/Users/mini/code/wingmen/src/ui/nightwatch/api.js)
- [../../wingmen/src/nightwatch/nightwatch-api.ts](/Users/mini/code/wingmen/src/nightwatch/nightwatch-api.ts)
- [../../wingmen/src/nightwatch/nightwatch-store.ts](/Users/mini/code/wingmen/src/nightwatch/nightwatch-store.ts)
- [../../wingmen/src/ui/nightwatch/cmd-toggle.js](/Users/mini/code/wingmen/src/ui/nightwatch/cmd-toggle.js)
- [../../wingmen/src/ui/nightwatch/enable-modal.js](/Users/mini/code/wingmen/src/ui/nightwatch/enable-modal.js)

Confirmed existing upstream routes and payload seams:

- `GET /api/sessions/:id/metadata`
- `PATCH /api/sessions/:id/metadata`
- `GET /api/nightwatch/sessions/:id`
- `POST /api/nightwatch/sessions/:id/enable`
- `POST /api/nightwatch/sessions/:id/disable`
- `GET /api/nightwatch/reports`

Confirmed normalized metadata fields upstream:

- `project`
- `goal`
- `nextAction`
- `nextActionPayload`
- `nextActionTemplate`
- `bindingType`
- `bindingId`
- `flowId`
- `flowRunId`
- `taskIds`

Confirmed Night Watch report-card fields upstream:

- `id`
- `sessionId`
- `sessionName`
- `workingDirectory`
- `status`
- `summary`
- `reasoning`
- `inputMode`
- `inputRaw`
- `cycleCount`
- `createdAt`

Validated follow-up against the owning live screen:

- the current upstream live session surface in [../../wingmen/src/ui/views/live-view.js](/Users/mini/code/wingmen/src/ui/views/live-view.js) still wires Night Watch through `addNightWatchToggle(...)` in the existing command menu flow
- no left-side session metadata drawer shell, drawer layout, or drawer modal wiring is present there yet

Implication:

- Pete's "no visible drawer" report matches the current owning code state
- the missing drawer is not explained by stale deployment or cache behavior in Flight Deck
- the real implementation work remains upstream in `../../wingmen`

Status after follow-up:

- the owning live-session drawer implementation has now been landed upstream in `../../wingmen`
- upstream commit: `56f6955` (`Add live session drawer`)
- the Flight Deck action for this follow-up is evidence only; no additional `wingman-fd` production wiring was required for the drawer itself
- authenticated desktop verification was completed on April 11, 2026 against a local upstream `wingmen` instance on `http://127.0.0.1:3022/live/188931f3-a3fb-4d27-b2af-6e258decd277`
- that run rendered a visible `Session Drawer` with `Session metadata`, `Night Watch`, `Related records`, and `Night Watch history` sections for the exact flow-run-bound session Pete was reviewing
- the rendered drawer showed the expected flow-run evidence in UI: binding `27fd8894-fa2d-4445-b0e8-0b85ebe0984e`, flow `3efa0719-b4df-48d1-92b4-4e92be40cdad`, Night Watch enabled state, and session-specific history entries from the reflection check-ins
- remaining manual gap: mobile takeover behavior was not browser-verified in this pass

### Current Upstream Acceptance Coverage

The upstream implementation is no longer hypothetical. The following owning tests now exist in `../../wingmen` and cover most of the requested acceptance surface:

- [../../wingmen/src/ui/live/session-drawer.test.js](/Users/mini/code/wingmen/src/ui/live/session-drawer.test.js)
- [../../wingmen/src/ui/views/live-view.test.js](/Users/mini/code/wingmen/src/ui/views/live-view.test.js)

Covered by automated upstream tests:

- drawer mode selection for desktop versus mobile
- desktop default-visible behavior until the user explicitly hides the drawer
- mobile visibility gated by drawer open state
- session metadata rendering for goal and current next action
- related-record extraction from `project`, `bindingType`, `bindingId`, `flowId`, `flowRunId`, and `taskIds`
- Night Watch history filtering by session id
- newest-first Night Watch history sorting
- bounded history preview length
- distinct empty-history and unavailable-history states
- Night Watch report modal rendering including summary, reasoning, input, and cycle count
- live-view integration for desktop side-by-side layout
- live-view integration for mobile overlay composition with backdrop and modal layering

Still only manually evidenced in the current record:

- authenticated browser verification against a real live session
- exact visual polish and layout behavior on mobile hardware
- any future deep-link handoff into Flight Deck records

One additional implementation seam is now explicit upstream:

- drawer state is owned in [../../wingmen/src/ui/state/index.js](/Users/mini/code/wingmen/src/ui/state/index.js) as `state.liveDrawer`

Implication:

- any further production work on this feature should extend the upstream drawer/state/tests rather than reviving the local `wingman-fd` experiment

## Design Decision

The real production implementation for this task belongs in `../../wingmen`, not in `wingman-fd`.

Reasoning:

- the live session route already exists there
- the current `Cmd` menu already exists there
- the session metadata update path already exists there
- the Night Watch toggle and report-card APIs already exist there
- duplicating `/live` inside Flight Deck would create a second runtime control plane

Flight Deck should only participate later if the owning Wingmen drawer needs explicit deep-link interoperability for Flight Deck task, flow, or doc records.

## Implementation Changes

### 1. Owning UI changes in `../../wingmen`

Add the drawer to the existing live session surface in:

- [../../wingmen/src/ui/views/live-view.js](/Users/mini/code/wingmen/src/ui/views/live-view.js)
- [../../wingmen/src/ui/live/session-drawer.js](/Users/mini/code/wingmen/src/ui/live/session-drawer.js)
- [../../wingmen/src/ui/styles.css](/Users/mini/code/wingmen/src/ui/styles.css)

Expected work:

- add a left-drawer shell to the live session layout
- move or duplicate the relevant current `Cmd` items into the drawer
- preserve the existing transcript/composer flow
- add mobile takeover behavior
- add desktop side-panel behavior
- add a Night Watch history preview section and click-through modal

### 1a. First drawer migration boundary

The current upstream live view in [../../wingmen/src/ui/views/live-view.js](/Users/mini/code/wingmen/src/ui/views/live-view.js) already contains a broad `Cmd` menu surface. The first drawer slice should stay narrow and only absorb the session-oriented controls that match this task's acceptance targets.

Move into the drawer in the first delivery:

- session metadata display
- goal editing
- current next-action editing
- Night Watch enabled or disabled state
- Night Watch toggle
- related-record display from `project`, `bindingType`, `bindingId`, `flowId`, `flowRunId`, and `taskIds`
- Night Watch history preview plus report modal path

Keep in `Cmd` for the first delivery:

- `Git` submenu
- `Gitea` submenu
- `App` submenu actions such as `App card`, `Go to site`, `Restart`, and `Stop`
- `Open Web View` or `Close Web View`
- `Open Artifact` or `Close Artifact`
- transcript utilities such as `Scroll to end`, `Last question`, and `Copy chat`
- `Rename session`
- `Attach image`
- `Upload file`
- `Record voice note`
- `Terminal` submenu
- destructive `Stop Session`

Rationale:

- those menu items are broader live-runtime controls rather than session metadata controls
- moving them in the first slice would broaden the drawer from a metadata surface into a full control plane rewrite
- the confirmed acceptance targets do not require migrating them yet
- requirement 6 says the drawer will absorb more of `Cmd` over time, which implies an incremental migration rather than an all-at-once move

### 2. Use existing metadata and Night Watch write paths

Do not invent a new Flight Deck sync family or Dexie table for runtime session metadata.

Use the existing upstream session APIs:

- `updateSessionMetadataApi(sessionId, metadata)` for goal and next-action edits
- `enableNightWatch(sessionId, opts)`
- `disableNightWatch(sessionId)`
- `fetchNightWatchSessionState(sessionId)`
- `fetchNightWatchReports()`

Important contract details confirmed upstream:

- `PATCH /api/sessions/:id/metadata` accepts either a flat object or `{ metadata: ... }`
- metadata updates merge into the existing metadata object on both live and stored sessions rather than replacing the whole object
- normalization trims string fields and drops empty-string values back to `undefined`
- clearing a field is therefore done by patching it to an empty string, which normalizes back to unset
- `nextAction` is an enum upstream, not free text. Allowed values are `none`, `reflect`, `stop`, and `restart`
- `nextActionPayload` remains the free-text companion field
- `nextActionTemplate` is a separate stored field used by the Night Watch enable flow
- `bindingType` is also constrained upstream to `thread`, `task`, or `flow_run`

Current upstream UX nuance:

- the drawer metadata form in [../../wingmen/src/ui/live/session-drawer.js](/Users/mini/code/wingmen/src/ui/live/session-drawer.js) currently edits `goal` and `nextActionPayload`
- the Night Watch enable path in [../../wingmen/src/ui/nightwatch/session-toggle.js](/Users/mini/code/wingmen/src/ui/nightwatch/session-toggle.js) patches `goal`, `nextAction`, and `nextActionTemplate` before enabling
- that means "current next action" is currently split across two concepts upstream:
  - enum action intent in `nextAction`
  - free-text operator detail in `nextActionPayload`

Implication:

- any follow-up UX change should decide explicitly whether the drawer should keep editing only `nextActionPayload`, or should also expose `nextAction` and `nextActionTemplate` directly

### 3. Related record display

The first implementation should stay narrow and data-driven:

- show tasks from `taskIds`
- show flow from `flowId`
- show flow-run label from `flowRunId`
- show project from `project`
- optionally show bound-record context from `bindingType` and `bindingId`

Do not promise generic record exploration in the first slice.

### 4. Night Watch history modal

The current report API is global, not per-session.

First-slice plan:

- fetch `GET /api/nightwatch/reports`
- filter client-side by `sessionId`
- show a bounded preview in the drawer
- open a modal or detail sheet from a report row

Current backend limitation confirmed upstream:

- `GET /api/nightwatch/reports` is global only
- the store currently returns the most recent 50 reports across all sessions, sorted newest-first
- there is no `sessionId` filter parameter and no dedicated `/api/nightwatch/sessions/:id/reports` route yet

Implication:

- the current drawer preview works for recent session activity
- it can silently miss older reports for a session if other sessions have produced enough newer reports to push them out of the global top-50 window

Preferred follow-up contract if the history experience needs to scale:

- `GET /api/nightwatch/sessions/:id/reports`

or

- `GET /api/nightwatch/reports?sessionId=:id&limit=:n`

### 5. Flight Deck follow-up only if deep links are needed

If the live drawer needs to jump into Flight Deck records, the likely FD files are:

- [src/app.js](/Users/mini/code/wingmanbefree/wingman-fd/src/app.js)
- [src/route-helpers.js](/Users/mini/code/wingmanbefree/wingman-fd/src/route-helpers.js)
- [src/workspace-manager.js](/Users/mini/code/wingmanbefree/wingman-fd/src/workspace-manager.js)

That follow-up should stay limited to:

- resolving task, flow, and doc ids into existing Flight Deck routes
- preserving the current workspace/backend context

It should not create a duplicate live-session store in Flight Deck.

## Exact Files And Subsystems Expected To Change

Owning implementation files in `../../wingmen`:

- [../../wingmen/src/ui/views/live-view.js](/Users/mini/code/wingmen/src/ui/views/live-view.js)
- [../../wingmen/src/ui/live/session-drawer.js](/Users/mini/code/wingmen/src/ui/live/session-drawer.js)
- [../../wingmen/src/ui/live/session-drawer.test.js](/Users/mini/code/wingmen/src/ui/live/session-drawer.test.js)
- [../../wingmen/src/ui/styles.css](/Users/mini/code/wingmen/src/ui/styles.css)
- [../../wingmen/src/ui/state/index.js](/Users/mini/code/wingmen/src/ui/state/index.js)
- [../../wingmen/src/ui/services/sessions.js](/Users/mini/code/wingmen/src/ui/services/sessions.js)
- [../../wingmen/src/ui/nightwatch/api.js](/Users/mini/code/wingmen/src/ui/nightwatch/api.js)
- [../../wingmen/src/ui/nightwatch/cmd-toggle.js](/Users/mini/code/wingmen/src/ui/nightwatch/cmd-toggle.js)
- [../../wingmen/src/ui/nightwatch/enable-modal.js](/Users/mini/code/wingmen/src/ui/nightwatch/enable-modal.js)
- [../../wingmen/src/ui/views/live-view.test.js](/Users/mini/code/wingmen/src/ui/views/live-view.test.js)
- [../../wingmen/src/server/session-api-routes.ts](/Users/mini/code/wingmen/src/server/session-api-routes.ts)
- [../../wingmen/src/nightwatch/nightwatch-api.ts](/Users/mini/code/wingmen/src/nightwatch/nightwatch-api.ts)

Possible later supporting files in `wingman-fd` only if cross-links are added:

- [src/app.js](/Users/mini/code/wingmanbefree/wingman-fd/src/app.js)
- [src/route-helpers.js](/Users/mini/code/wingmanbefree/wingman-fd/src/route-helpers.js)
- [src/workspace-manager.js](/Users/mini/code/wingmanbefree/wingman-fd/src/workspace-manager.js)

## Validation Commands

Design-step commands run here:

- `git diff --check`

Owning implementation validation for the real next step:

- `cd /Users/mini/code/wingmen && bun test`

If any Flight Deck deep-link follow-up is later added:

- `bun run test`
- `bun run build`

## Risks

- The biggest risk is implementing this in the wrong repo and ending up with two live-session control planes.
- A second concrete risk now exists in the current working tree: there is already partial FD-first live drawer wiring in progress, so an uncoordinated follow-up could merge contradictory assumptions into one UI.
- Reusing `workspace_settings` or `agent_chat_triggers` for session runtime data would leak per-session state into workspace-scoped records.
- Filtering global Night Watch reports client-side is acceptable for the first slice but may become noisy if the report volume grows.
- Moving `Cmd` actions into a drawer can regress focus and keyboard handling if it does not preserve the current menu accessibility behavior.
- Broadening the first drawer slice beyond metadata and Night Watch controls creates avoidable merge risk with the existing `Cmd` menu and with the dirty-tree FD-first experiment in this repo.
- The phrase "current next action" is ambiguous upstream because `nextAction`, `nextActionPayload`, and `nextActionTemplate` already have different roles and are not all edited from the same surface today.
- The current global Night Watch reports endpoint only returns the newest 50 reports overall, which can truncate session-specific history visibility without any explicit UI warning.

## Fallback Plans

- If the drawer itself cannot land immediately, first move the key session metadata and Night Watch affordances into a modal or side sheet within the existing Wingmen live view.
- If a per-session history endpoint does not land in the same pass, use the existing global report-card list filtered by `sessionId`.
- If Flight Deck deep-link interoperability is not ready, render related record ids as passive labels first and wire navigation in a later slice.

## Explicit Non-Goals

- Do not store session runtime metadata in `workspace_settings`.
- Do not store session runtime metadata in `agent_chat_triggers`.
- Do not add a duplicate `/live` route or duplicate live session screen to Flight Deck.
- Do not redesign the entire Wingmen Live surface beyond the requested drawer and modal path.
- Do not start dev servers in this step.
- Do not change Tower contracts in this repo.

## Remaining Questions

1. Should the first history slice use filtered global reports, or should `../../wingmen` add a dedicated per-session reports endpoint immediately?
2. Should the drawer continue editing only `nextActionPayload`, or should it also expose the enum `nextAction` and stored `nextActionTemplate` directly outside the Night Watch enable flow?
3. For Flight Deck deep links, should Wingmen rely only on `taskIds`, `flowId`, and `flowRunId`, or should it add explicit Flight Deck record link fields later?
