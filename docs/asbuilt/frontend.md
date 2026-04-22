# Wingman Flight Deck As-Built Frontend

Status: as-built working note  
Reviewed against live code on 2026-04-07
Companion docs:

- `docs/asbuilt/architecture.md`
- `docs/asbuilt/data model.md`
- `docs/asbuilt/middleware.md`

## Scope

This note documents the frontend Flight Deck actually ships today:

- the Alpine app shell and URL-backed section routing
- which module owns shell state versus section display state
- how Dexie `liveQuery` subscriptions repopulate UI state
- where refresh stops at "flush writes" versus where it also pulls and rematerializes
- the current seams between local persisted rows and user-facing managers
- shell-adjacent integrations such as page title updates and service-worker registration

It describes the live implementation, not the target architecture.

Primary files reviewed for this refresh:

- `index.html`
- `src/main.js`
- `src/app.js`
- `src/shell-state.js`
- `src/task-board-state.js`
- `src/unread-store.js`
- `src/section-live-queries.js`
- `src/sync-manager.js`
- `src/sync-worker-client.js`
- `src/workspace-manager.js`
- `src/channels-manager.js`
- `src/docs-manager.js`
- `src/chat-message-manager.js`
- `src/flows-manager.js`
- `src/triggers-manager.js`
- `src/persons-manager.js`
- `src/people-profiles-manager.js`
- `src/storage-image-manager.js`
- `src/page-title.js`
- `src/service-worker-registration.js`

## Frontend Runtime Shape

Flight Deck is still a single-page Alpine app booted from `src/main.js`.

`src/main.js` currently does four things in order:

1. run the hard-reset guard
2. call `initApp()`
3. register the build service worker
4. start build-version checking and the global image modal

`initApp()` in `src/app.js` still assembles one large store and registers it as `Alpine.store('chat', storeObj)`. `index.html` remains coupled to that store through `$store.chat.*`.

Important as-built nuance:

- `src/app.js` still contains a large inline store definition with many shell defaults and legacy shell methods
- `src/shell-state.js` is now the authoritative shell boundary and is mixed in first through `applyMixins(...)`
- runtime state is therefore still one Alpine store, but the shell extraction is real even though the old inline definitions still exist in source as fallback structure

## App Shell And Section Routing

### Shell ownership

`src/shell-state.js` owns the app-level shell boundary:

- session and identity state
- selected workspace context
- nav section, nav collapse, mobile nav, and workspace switcher chrome
- sync status banners and sync-progress modal state
- connect/bootstrap modal state
- route parsing, route application, and history synchronization
- login/logout lifecycle

It also exports `SHELL_STATE_KEYS` and `SHELL_METHOD_NAMES`, which make the boundary explicit in tests instead of leaving it informal.

### Actual route model

The shell route model is URL-backed but selective.

Dedicated path segments exist for:

- `status` -> `/flight-deck`
- `chat` -> `/chat`
- `tasks` -> `/tasks`
- `calendar` -> `/calendar`
- `docs` -> `/docs`
- `reports` -> `/reports`
- `people` -> `/people`
- `schedules` -> `/schedules`
- `scopes` -> `/scopes`
- `settings` -> `/settings`

Query params currently carry detail state for:

- `workspacekey`
- `scopeid`
- `channelid`
- `threadid`
- `folderid`
- `docid`
- `commentid`
- `versioning`
- `reportid`
- `taskid`
- `view`
- `descendants`

Important current limitation:

- `flows` is a real nav section in `index.html`, but `getRoutePath()` has no `flows` case, so the URL falls back to `/flight-deck`
- `jobs` is also missing from `getRoutePath()`, and the nav item is hard-hidden in `index.html` with `x-show="false"`

### Route application and section switching

`applyRouteFromLocation()` in `src/shell-state.js` does more than cosmetic URL sync. It restores live section state by:

- switching workspaces when the slug or `workspacekey` points elsewhere
- restoring the shared task/doc/report scope selection from `scopeid`
- selecting the active chat channel and optional thread
- opening a document or folder and optional comment/versioning state
- restoring report selection
- restoring task detail and task board/list view mode

After applying the route it immediately calls `startWorkspaceLiveQueries()` and then normalizes the URL back through `syncRoute(true)`.

`navigateTo(section)` is also shell-owned. It:

- trims stale section arrays with `clearInactiveSectionData()`
- marks `chat` and `docs` as read on navigation
- revalidates task-board state for `tasks`, `calendar`, and `reports`
- restarts workspace live queries
- ensures background sync is running

## Display State Ownership

### `src/shell-state.js`

Shell state owns the cross-section chrome and lifecycle, not the section data arrays themselves.

In practice it owns:

- session/login/error state
- workspace selection and bootstrap prompts
- connect modal steps and known hosts
- current route section and route/history wiring
- sync session summary, SSE status, and catch-up overlay state

### `src/app.js`

`src/app.js` still owns most concrete section state and many cross-domain selectors.

It directly owns arrays and selection state for:

- channels, messages, audio notes, groups
- documents, directories, doc comments, doc editor buffers
- reports and selected report state
- tasks, schedules, task comments, task detail state
- flows, approvals, approval preview state
- persons and organisations
- status/dashboard derived state such as recent changes

It also still owns cross-domain getters such as:

- `selectedDocument`, `selectedDirectory`, `selectedReport`
- `currentFolderBreadcrumbs`
- `currentDocumentTitle`

### `src/task-board-state.js`

`src/task-board-state.js` owns the derived display state for tasks and the shared board/scope picker model.

Actual responsibilities now include:

- task board options including `All`, `Recent`, and conditional `Unscoped`
- selected board validation and persistence to local storage
- selected board scope resolution
- board-scoped task filtering, tag filtering, and assignee filtering
- kanban columns, list groups, and scheduled-task calendar projection
- reusable scope/board labels used outside the tasks section

This module is display-state-heavy rather than transport-heavy: it works from `this.tasks`, `this.scopes`, and `this.selectedBoardId`, not from remote responses.

### `src/unread-store.js`

`src/unread-store.js` owns unread indicators, but not all unread derivation is local-only.

Current model:

- nav-level chat/docs unread and per-channel unread prefer worker-computed `sync_state.unread_summary`
- per-task unread still computes a local item map from `tasks` plus `read_cursors`
- `tasks:nav` may be auto-seeded the first time tasks exist locally but no cursor exists yet
- navigating to `chat` or `docs` marks the section read; tasks remain item-level until opened or cleared

## Live Query Wiring

`src/section-live-queries.js` is the current read-side subscription plan. It manages three buckets per store instance:

- shared subscriptions
- workspace subscriptions
- detail subscriptions

It re-syncs those buckets whenever workspace identity or section/detail state changes.

### Shared subscriptions

Always on after app start:

- `address-book` -> `getAddressBookPeople()` -> `applyAddressBookPeople(...)`

### Workspace subscriptions

Always on for a selected workspace:

- `ws:flows` -> `getFlowsByOwner(ownerNpub)` -> `applyFlows(...)`

Section-gated subscriptions:

| Section | Workspace subscriptions |
| --- | --- |
| `status` | windowed reports, scopes, pending approvals |
| `chat` | channels, audio notes |
| `docs` | directories, windowed documents, scopes |
| `tasks` | tasks, scopes |
| `calendar` | tasks, schedules, scopes |
| `reports` | windowed reports, scopes |
| `schedules` | schedules |
| `scopes` | scopes |
| `flows` | pending approvals, scopes |
| `people` | persons, organisations |

Important drift from the older frontend note:

- flows are always-on
- approvals are not always-on; they are subscribed in `status` and `flows`

### Detail subscriptions

Detail reads are section-specific:

- `chat` -> selected channel messages
- `tasks` -> selected task row plus task comments
- `docs` -> selected document row plus doc comments
- `reports` -> selected report row

The detail handlers guard against stale callbacks by checking that the workspace and selected record are still current before mutating store state.

### Unread bootstrap coupling

`startWorkspaceLiveQueries()` also owns unread bootstrap timing:

- when workspace key or owner changes, it resets `hasBootstrappedUnreadTracking`
- after the new workspace subscriptions are in place, it calls `initUnreadTracking()` once

## Refresh Boundaries

### Main-thread orchestration in `src/sync-manager.js`

`src/sync-manager.js` owns when the app refreshes and how aggressive that refresh is.

`ensureBackgroundSync()` currently:

- registers a visibility listener
- starts the worker-side independent flush timer
- opens the SSE stream
- decides whether to show the catch-up overlay
- schedules the next background tick

`getSyncCadenceMs()` widens polling when SSE is connected and otherwise uses the fast cadence for:

- `chat` with a selected channel
- `docs`
- `tasks`
- `calendar`
- `schedules`
- `scopes`

Everything else falls back to idle cadence.

### Flush-only boundary

`flushAndBackgroundSync()` is intentionally write-side only.

It:

1. calls `flushOnly(...)` through `src/sync-worker-client.js`
2. updates `lastSuccessAt` on success
3. refreshes sync status if writes were pushed
4. always re-arms background sync in `finally`

It does not:

- run heartbeat
- pull families
- rematerialize rows directly

The UI depends on SSE and later background sync to pull fresh rows back into Dexie.

### Full sync boundary

`performSync()` is the heavier refresh path.

It currently:

1. refreshes groups and group keys on the main thread
2. may clear sync state for an initial backfill if the workspace looks empty
3. calls `runSync(...)` in the worker
4. refreshes workspace settings and task-board setup after worker completion
5. refreshes sync status and optionally status recent changes

This is the boundary where a user-visible "manual sync" actually means heartbeat/pull/apply, not just push.

### Worker-client boundary

`src/sync-worker-client.js` is now strictly a worker RPC client.

Current behavior:

- serializes requests through a queue
- lazily creates the worker
- retries worker recreation up to two times
- bridges NIP-07 auth requests back to the main thread
- posts decrypted group keys and workspace-key material into the worker
- exposes degraded-worker failure rather than falling back to main-thread sync logic

Important as-built detail:

- if the worker cannot be created or recovered, sync is degraded and queued writes remain in Dexie for later retry
- there is no current main-thread sync fallback path even though older comments in worker code still imply one

## Data-To-UI Manager Seams

The store is monolithic at runtime, but the read/write seams are now more explicit at the manager level.

| Area | Current owner | What the seam actually is |
| --- | --- | --- |
| Workspace display and switching | `src/workspace-manager.js` | Merges `knownWorkspaces` with local profile snapshots, opens/switches/deletes workspace DBs, loads remote workspace lists, saves workspace profile and harness settings, and owns the workspace switcher menu |
| Channels and groups | `src/channels-manager.js` | Applies Dexie channel rows to the visible list, filters channels for the viewer, refreshes group metadata and wrapped group keys from explicit APIs, and owns group CRUD/bootstrap flows |
| Chat message display | `src/chat-message-manager.js` | Derives ranked main feed and thread windows from `messages`, owns scroll anchoring and composer autosize, and applies selected-channel message updates from live queries |
| Docs and comments | `src/docs-manager.js` | Owns document/folder selection state, editor buffer state, merged share display, comment modal state, and direct record-history reads for versioning |
| Flows and approvals | `src/flows-manager.js` | Applies live Dexie flow rows, derives scope-filtered flow and approval lists, owns flow-editor form state, and drives approval preview/history UI |
| Triggers | `src/triggers-manager.js` | Treats `workspaceTriggers` as workspace-settings substate, not a separate sync family; saves through `saveHarnessSettings({ triggerOnly: true })` and fires trigger events over Nostr |
| Persons and organisations | `src/persons-manager.js` | Pure local-first CRUD for person/org rows; writes to Dexie, adds pending writes, then uses `flushAndBackgroundSync()` |
| Profile and suggestion resolution | `src/people-profiles-manager.js` | Resolves display identities, maps workspace-key npubs back to user npubs, hydrates Nostr profile data, and maintains the address-book suggestion cache |
| Storage-backed images | `src/storage-image-manager.js` | Resolves backend-aware cache keys, downloads blobs through `src/api.js`, writes them into shared Dexie cache, replaces `img[data-storage-object-id]` sources, and preserves scroll anchors while images hydrate |

Two manager seams worth calling out explicitly:

- `workspace-manager.js` is where `workspace_settings` becomes shell/UI state, including harness URL and trigger arrays
- `people-profiles-manager.js` is the display seam that prevents workspace session-key identities from leaking raw into user-facing labels when a workspace-key mapping exists

## Shell Integration

### Page title handling

`src/page-title.js` builds the document title and is called through the store getter `currentDocumentTitle`.

It currently has explicit title cases for:

- `status`
- `chat`
- `tasks`
- `calendar`
- `schedules`
- `docs`
- `people`
- `scopes`
- `settings`

Current limitation:

- `reports`, `flows`, and `jobs` have no explicit title case, so they currently fall through to the default chat title branch

That is an as-built behavior, not a guessed intent.

### Service worker integration

`src/service-worker-registration.js` is separate from the sync worker and only handles app-shell update behavior.

As built today it:

- registers only outside Vite dev mode
- versions the registration URL with the current build id
- listens for `controllerchange` and reloads once activation is requested
- exposes `forceRefreshToLatestBuild()` for an explicit skip-waiting/reload flow

It does not participate in Dexie sync, records, or SSE.

## Current Frontend Constraints And Quirks

- The runtime is still one Alpine store even though shell, task-board, unread, sync, and manager seams are now extracted in source.
- `clearInactiveSectionData()` manually evicts inactive section arrays; Dexie live queries re-warm them on demand.
- Flows are always kept warm because task/approval behavior depends on them outside the `flows` section.
- Approvals are not always warm; they are section-gated to `status` and `flows`.
- `jobs` state still exists in the store and `src/jobs-manager.js`, but the nav entry is hard-hidden and the manager only reports that jobs are unavailable.
- The route model is incomplete for `flows` and `jobs`.
- The document-title helper is also incomplete for `reports`, `flows`, and `jobs`.

## As-Built Summary

Flight Deck’s frontend is currently a single-store Alpine SPA with a real but partial shell extraction.

The practical boundaries are:

- `src/shell-state.js` owns navigation, routing, session, and shell sync state
- `src/section-live-queries.js` decides which Dexie rows stay warm in memory for the current section
- manager mixins own domain-specific read-model shaping and local-first mutations
- `src/sync-manager.js` separates flush-only writes from heavier pull/rematerialize sync

The app is therefore local-first in behavior and more modular in source than it is in runtime shape, but the runtime still centralizes into one Alpine store and one `index.html` shell.
