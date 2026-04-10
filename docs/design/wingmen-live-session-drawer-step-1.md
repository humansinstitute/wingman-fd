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
- [../../wingmen/src/ui/styles.css](/Users/mini/code/wingmen/src/ui/styles.css)

Expected work:

- add a left-drawer shell to the live session layout
- move or duplicate the relevant current `Cmd` items into the drawer
- preserve the existing transcript/composer flow
- add mobile takeover behavior
- add desktop side-panel behavior
- add a Night Watch history preview section and click-through modal

### 2. Use existing metadata and Night Watch write paths

Do not invent a new Flight Deck sync family or Dexie table for runtime session metadata.

Use the existing upstream session APIs:

- `updateSessionMetadataApi(sessionId, metadata)` for goal and next-action edits
- `enableNightWatch(sessionId, opts)`
- `disableNightWatch(sessionId)`
- `fetchNightWatchSessionState(sessionId)`
- `fetchNightWatchReports()`

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
- [../../wingmen/src/ui/styles.css](/Users/mini/code/wingmen/src/ui/styles.css)
- [../../wingmen/src/ui/services/sessions.js](/Users/mini/code/wingmen/src/ui/services/sessions.js)
- [../../wingmen/src/ui/nightwatch/api.js](/Users/mini/code/wingmen/src/ui/nightwatch/api.js)
- [../../wingmen/src/ui/nightwatch/cmd-toggle.js](/Users/mini/code/wingmen/src/ui/nightwatch/cmd-toggle.js)
- [../../wingmen/src/ui/nightwatch/enable-modal.js](/Users/mini/code/wingmen/src/ui/nightwatch/enable-modal.js)
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
- Reusing `workspace_settings` or `agent_chat_triggers` for session runtime data would leak per-session state into workspace-scoped records.
- Filtering global Night Watch reports client-side is acceptable for the first slice but may become noisy if the report volume grows.
- Moving `Cmd` actions into a drawer can regress focus and keyboard handling if it does not preserve the current menu accessibility behavior.

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
2. Which current `Cmd` actions should move into the drawer in the first delivery versus remain in the menu temporarily?
3. For Flight Deck deep links, should Wingmen rely only on `taskIds`, `flowId`, and `flowRunId`, or should it add explicit Flight Deck record link fields later?
