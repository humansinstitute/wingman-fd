# Wingman Flight Deck As-Built Frontend

Status: as-built working note
Reviewed against live code on 2026-04-05
Companion docs:

- `docs/asbuilt/architecture.md`
- `docs/asbuilt/data model.md`
- `docs/asbuilt/middleware.md`

## Scope

This note documents the frontend that Flight Deck actually ships today:

- state ownership on the browser main thread
- how Dexie subscriptions repopulate UI state
- where the UI reads derived state instead of raw records
- how `index.html` is composed into sections, detail panes, and modals
- which UI patterns are reused across sections

It describes the live implementation, not the target architecture.

Primary files reviewed for this note:

- `index.html`
- `src/main.js`
- `src/app.js`
- `src/section-live-queries.js`
- `src/task-board-state.js`
- `src/unread-store.js`
- `src/workspace-manager.js`
- `src/channels-manager.js`
- `src/chat-message-manager.js`
- `src/docs-manager.js`
- `src/jobs-manager.js`
- `src/flows-manager.js`
- `src/scopes-manager.js`
- `src/persons-manager.js`
- `src/connect-settings-manager.js`
- `src/triggers-manager.js`
- `src/sync-manager.js`

## Frontend Runtime Shape

Flight Deck is still a single-page Alpine app booted from `src/main.js`. `initApp()` in `src/app.js` assembles one large store and registers it as `Alpine.store('chat', storeObj)`. The HTML is tightly coupled to that store name through `$store.chat.*`.

The current runtime split is:

- `src/main.js`: boot sequence, hard reset guard, service-worker registration, build/version checks, image modal setup
- `src/app.js`: root store state, lifecycle, route sync, common helpers, page-level navigation, section memory trimming
- mixin files under `src/`: domain-specific actions, computed state, optimistic writes, and detail interactions
- `index.html`: all view composition and most per-section local UI state through Alpine inline `x-data`

Important as-built characteristic:

- the app is modular in source layout, but not in runtime store layout
- domain state, modal state, derived UI state, and sync status still live in one Alpine store object

## State Ownership

### Root store

`src/app.js` owns:

- app/session state: login state, signer availability, selected workspace, backend URL, current route section
- top-level UI state: nav collapse, mobile nav, modal toggles, sync banners, error strings
- section arrays: `channels`, `messages`, `documents`, `directories`, `reports`, `tasks`, `schedules`, `flows`, `approvals`, `persons`, `organisations`, `scopes`
- selection/detail state: selected channel, active thread, selected doc, active task, selected report, selected board, approval/detail modal state
- generic reactive helpers: live subscription wrapper, route syncing, scroll anchoring hooks, markdown rendering, page title updates

### Domain mixins

The major ownership split inside the single store is:

| Area | Main owner | What it owns in practice |
| --- | --- | --- |
| Workspace identity and switcher | `src/workspace-manager.js` | current workspace getters, profile draft fields, workspace switching, workspace removal, workspace bootstrap prompts, workspace avatar/profile hydration |
| Connection and Agent Connect settings | `src/connect-settings-manager.js` | connection token input, backend save flow, connect modal, known host flow, default agent selection, Agent Connect export modal |
| Chat channels and groups | `src/channels-manager.js` | channel list refresh, group refresh/bootstrap, group CRUD modals, channel creation/settings, participant and group-derived labels |
| Chat messages and threads | `src/chat-message-manager.js` | main feed and thread derived lists, scroll anchoring, composer autosize, send/reply/delete flows, message local patching |
| Docs and comments | `src/docs-manager.js` | doc browser/editor state, block editing, autosave state, share modal, scope modal, move modal, comment thread state, version history |
| Tasks, board, and calendar | `src/task-board-state.js` plus task methods in `src/app.js` | board selection, task filtering, kanban/list grouping, scheduled-task calendar projection, scope-aware task assignment helpers |
| Scopes | `src/scopes-manager.js` | scope search, breadcrumbs, scope picker state, scope assignment flows for tasks/docs/channels, scope CRUD form state |
| Flows and approvals | `src/flows-manager.js` | flow editor state, pending approvals, approval history/filtering, approval preview panel, flow-linked task/doc navigation |
| People and organisations | `src/persons-manager.js` | person/org CRUD, bidirectional linking, augment flags, optimistic local writes |
| Profiles and suggestions | `src/people-profiles-manager.js` | sender/profile lookup, avatars, cached people suggestions, default-agent suggestions, group-member suggestions |
| Unread indicators | `src/unread-store.js` | nav dots, per-channel unread map, per-task unread map, read cursor writes |
| Sync lifecycle | `src/sync-manager.js` | background cadence, full sync/flush calls, repair tools, record status checks, worker orchestration |
| Triggers | `src/triggers-manager.js` | automation settings tab trigger CRUD and firing |
| Jobs | `src/jobs-manager.js` | jobs section shell and modal toggles, but current implementation is effectively a stub that marks jobs unavailable |

## Refresh And Subscription Behavior

### Initialization and workspace bootstrap

`init()` in `src/app.js` does the current boot sequence:

1. starts signer and route watchers
2. migrates legacy IndexedDB if needed
3. starts shared live queries before login
4. loads persisted settings and known workspaces
5. resolves invite token or saved connection token
6. hydrates known workspace profile snapshots from local DBs
7. attempts auto-login
8. selects the saved or first known workspace
9. bootstraps the selected workspace by refreshing groups, flows, key mappings, route state, sync status, and unread tracking

### Dexie live queries

`src/section-live-queries.js` is the main read-side refresh plan.

Shared subscriptions:

- address book is always subscribed once the app starts

Always-on workspace subscriptions:

- flows
- approvals

Section-gated workspace subscriptions:

- `status`: windowed reports, scopes
- `chat`: channels, audio notes
- `docs`: directories, windowed documents, scopes
- `tasks`: tasks, scopes
- `calendar`: tasks, schedules, scopes
- `reports`: windowed reports, scopes
- `schedules`: schedules
- `scopes`: scopes
- `flows`: scopes
- `people`: persons, organisations

Detail subscriptions:

- `chat`: selected channel messages
- `tasks`: selected task row and its comments
- `docs`: selected document row and its comments
- `reports`: selected report row

Important as-built behavior:

- live queries are recreated whenever `navSection`, workspace owner, workspace key, or the selected detail target changes
- `createLiveSubscription()` in `src/app.js` coalesces Dexie notifications to one callback per animation frame
- the store trims inactive arrays with `clearInactiveSectionData()` when navigating, so Dexie remains authoritative and Alpine only keeps the active domain warm

### Background refresh

`src/sync-manager.js` determines polling cadence:

- fast cadence for `chat`, `docs`, `tasks`, `calendar`, `schedules`, and `scopes`
- idle cadence elsewhere
- no background cadence when hidden, logged out, or missing workspace/backend context

The current freshness path is:

1. main-thread timer calls `performSync({ silent: true })`
2. sync worker flushes pending writes
3. worker heartbeats per-family cursors
4. stale families are pulled and materialized into Dexie
5. Dexie updates fan back into Alpine through live queries
6. unread summary from `sync_state` is reused by `src/unread-store.js`

### Unread refresh behavior

Unread indicators are not driven directly from visible arrays alone.

Current model:

- worker writes `unread_summary` into `sync_state`
- `src/unread-store.js` prefers that summary for nav dots and channel unread state
- per-task unread borders are still computed against `tasks` plus read cursors
- navigation to `chat` and `docs` marks those nav cursors as read
- tasks remain item-level until the user opens or explicitly clears them

## Data-To-UI Boundary

The frontend boundary is intentionally layered even though the runtime store is monolithic.

### 1. Transport and sync layer

Owned by:

- `src/api.js`
- `src/sync-manager.js`
- `src/sync-worker-client.js`
- worker code described in `docs/asbuilt/middleware.md`

The UI does not render transport responses directly except for a few explicit foreground utilities such as workspace CRUD, storage upload/download, record history, and key-mapping lookup.

### 2. Local persisted rows

Dexie tables are the primary render source. Managers and live queries read from local tables such as:

- `channels`, `chat_messages`, `audio_notes`
- `documents`, `directories`, `comments`
- `tasks`, `schedules`, `scopes`
- `reports`, `flows`, `approvals`
- `persons`, `organisations`

### 3. Store-level derived read models

The store then derives UI-focused shapes that are not themselves persisted:

- chat main-feed and thread windows
- filtered task boards, kanban columns, list groups, calendar projections
- scope trees and board-picker options
- doc browser rows, breadcrumbs, block views, selected comment replies
- flight-deck report cards and derived metric/timeseries/table render data
- workspace display overlays from known workspace entries plus local profile snapshots
- unread flags and per-item unread maps

### 4. Template rendering

`index.html` mostly renders:

- store arrays for list screens
- store getters for detail panes and derived labels
- inline local `x-data` only for micro-state such as menu open/close, typeahead highlight index, or expandable cards

Important as-built rule:

- view code usually renders normalized local rows or computed getters, not raw record envelopes and not raw API payloads

## View Composition

### Shell

The top-level view is:

- auth and bootstrap surfaces when logged out or missing workspace context
- main app layout when logged in
- left sidebar with section nav, current-scope picker, and workspace switcher
- single main-content outlet switched by `navSection`

### Main sections

Current first-class sections in `index.html` are:

- `status`: Flight Deck landing page with scope picker, report cards, recent changes, and pending approvals side panel
- `chat`: channel list in sidebar, main feed, thread panel, per-message actions, audio attachments
- `tasks`: create/filter/bulk bar, kanban or list view, task detail panel
- `calendar`: scope-aware calendar projection of scheduled tasks
- `docs`: folder/document browser and document editor with block comments and sharing/scope overlays
- `reports`: report list plus detail pane, with fullscreen modal for a selected report
- `schedules`: recurring schedule list and editor modal
- `flows`: flow cards/editor plus approval banner, approval detail modal, approval history overlay
- `scopes`: five-level card/tree presentation plus navigator drawer and create/edit modal
- `people`: people and organisations subtabs, list views, editor forms, link pickers
- `jobs`: present only when a harness URL exists, but current behavior is mostly placeholder/unavailable
- `settings`: tabbed workspace, connection, automation, data, and sharing/admin surfaces

### Detail and overlay model

The app uses section-local detail states rather than route-level subcomponents:

- tasks detail replaces the task list inside the same section
- docs editor replaces the browser inside the same section
- chat thread opens beside the main feed
- approvals, reports, doc comments, doc moves, group edits, workspace connect/bootstrap, audio recorder, and record status/version tools are overlays or modals on top of the section shell

### Route model

Route state is lightweight and URL-backed:

- workspace slug and `workspacekey`
- `scopeid` shared across multiple sections
- section-specific detail ids such as `channelid`, `threadid`, `docid`, `folderid`, `commentid`, `reportid`, `taskid`

This keeps browser history aligned with selected workspace, scope, and open detail target without introducing a router framework.

## Reusable UI Building Blocks

The current reusable building blocks are pattern-level, not component files.

### Scope and board pickers

Used in:

- sidebar focus panel
- Flight Deck hero
- calendar board selector
- task board selector
- scope assignment popovers

Common behavior:

- text input plus filtered option list
- keyboard highlight index in local `x-data`
- shared labels from task-board/scope helpers

### Modal shell

Most overlays use the same pattern:

- backdrop with `x-show`
- centered card container
- close button or click-away close
- action row with `btn-cancel` / `btn-confirm`

This pattern is reused for:

- workspace connect/bootstrap
- agent connect export
- docs share/scope/move/comment/version flows
- groups
- report modal
- approval detail/history
- record status/version tools

### Action menus

Small `details` or inline `x-data` action menus recur across:

- task cards/detail
- docs toolbar/editor
- chat messages
- people/organisation records
- groups

They generally expose secondary actions such as status checks, version history, delete, scope, share, or move.

### Identity chips and fallbacks

Repeated identity UI primitives:

- avatar image or initials fallback
- sender name plus shortened identity subtitle
- workspace avatar/name/meta rows
- suggestion rows for people, groups, and default agent selection

These all rely on the same profile-resolution layer rather than section-specific fetches.

### Scope pills

Scope pills appear in:

- docs browser rows
- doc title/header
- folder breadcrumb meta
- channel settings
- scope modals

They reuse shared helpers for:

- level badge styling
- title/breadcrumb tooltip
- unscoped fallback state

### Status indicators

Repeated status visuals include:

- unread nav dots and per-channel/task unread markers
- sync dots for docs and chat messages
- state/priority badges for tasks and schedules
- approval status badges
- count badges in columns, calendars, and side panels

### Markdown surfaces

Rendered markdown is reused in:

- chat posts
- doc preview blocks
- approval previews
- report text cards

The same markdown rendering boundary is used, with image hydration layered on top for storage-backed media.

### Audio cards

Audio-note and draft cards are reused across:

- chat composer
- thread composer
- doc comments
- message/document attachment previews

The card pattern stays consistent even though the owning state lives in different arrays.

## Current Frontend Constraints And Quirks

- The frontend is still a single Alpine store, so section concerns are source-modular but runtime-coupled.
- Section memory is manually trimmed when navigating away; data rehydrates from Dexie when the section becomes active again.
- Jobs are visible behind harness gating, but the current jobs manager is a placeholder rather than a complete frontend subsystem.
- Flows and approvals are intentionally kept subscribed even outside the flows section because task and status surfaces depend on them.
- Some explicit foreground API calls still bypass the sync path for utilities like version history, workspace CRUD, and storage object work, but rendered domain data still comes back through local rows.

## As-Built Summary

Flight Deck’s frontend is currently a single-store Alpine SPA layered on top of Dexie and a sync worker. The important practical boundaries are:

- Dexie is the render source
- `section-live-queries.js` decides which data is warm in memory
- manager mixins own domain-specific mutations and detail behavior
- `index.html` composes one section shell at a time with shared modal and picker patterns

The frontend is therefore local-first in behavior, but still centralized in runtime structure: one store, one template file, many domain mixins, and Dexie/liveQuery as the main reactive backbone.
