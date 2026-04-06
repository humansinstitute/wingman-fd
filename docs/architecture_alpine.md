# Alpine + Dexie Runtime Notes

Status: working note
Last updated: 2026-03-31

This document describes how `wingman-fd` currently uses Alpine and Dexie, where the important runtime seams are, and why the current shape is showing scaling pressure.

It is intentionally narrower than `../ARCHITECTURE.md`. That file explains repo boundaries. This file explains the browser runtime inside Flight Deck.

## 1. Current runtime model

Flight Deck is a local-first browser app with one large Alpine store backed by Dexie.

At a high level:

1. `src/main.js` boots the app, service worker, version check, and image modal.
2. `src/app.js` creates a single Alpine store with:
   - long-lived app/session/workspace state
   - large materialized collections such as channels, messages, tasks, docs, schedules, scopes, reports
   - UI-only state such as selections, open modals, filters, editor buffers, and route state
3. Dexie in `src/db.js` stores the local materialized tables.
4. `liveQuery` subscriptions read Dexie and push rows into the Alpine store.
5. background sync in `src/sync-manager.js` and `src/worker/sync-worker.js` mutates Dexie as remote data arrives.
6. Alpine templates render from the store, not from direct backend responses.

This means Dexie is the persistence and replication boundary, while Alpine is the main in-memory view model.

## 2. What Alpine currently owns

The main Alpine store in `src/app.js` is doing three jobs at once:

- app shell state
  - auth/session
  - workspace selection
  - route/nav state
  - sync status
- materialized domain state
  - `channels`
  - `messages`
  - `documents`
  - `directories`
  - `tasks`
  - `schedules`
  - `scopes`
  - `reports`
  - `groups`
  - `audioNotes`
  - `addressBookPeople`
- derived/render state
  - selected items
  - search/filter results
  - unread maps
  - open-thread / open-task / open-doc state
  - editor buffers and modal state

That is convenient, but it means a single reactive root is carrying both tiny UI state and large data collections.

## 3. What Dexie currently owns

Dexie owns the local tables and is the source for most materialized data:

- `chat_messages`
- `channels`
- `documents`
- `directories`
- `tasks`
- `schedules`
- `scopes`
- `reports`
- `groups`
- `audio_notes`
- `comments`
- `read_cursors`
- `pending_writes`
- `sync_state`

The store is not querying Dexie ad hoc for every render. Instead, Dexie data is loaded into Alpine arrays and then rendered from memory.

That gives good local responsiveness, but it also means:

- large arrays stay resident in memory
- replacing an array can trigger broad reactive work
- derived getters can re-run across large collections

## 4. Live-query shape today

The important current behavior is in `src/app.js`:

- `startSharedLiveQueries()` subscribes to address-book data
- `startWorkspaceLiveQueries()` subscribes to most workspace tables at once

Current workspace-wide subscriptions include:

- channels
- audio notes
- directories
- documents
- reports
- tasks
- schedules
- scopes

Chat then adds a selected-channel message live query on top.

This means the app is effectively running with broad always-on subscriptions for most of the workspace, regardless of which section is visible.

## 5. Sync and mutation flow

The sync path is:

1. `src/sync-manager.js` schedules background sync.
2. `performSync()` calls `runSync()` in `src/worker/sync-worker.js`.
3. `runSync()`:
   - flushes pending writes
   - checks heartbeat / stale families
   - fetches changed records
   - materializes them into Dexie tables
4. Dexie changes trigger `liveQuery` subscriptions.
5. `liveQuery` handlers copy rows into Alpine arrays and sometimes run additional side effects.

This gives good data freshness, but it creates a sensitive loop:

- sync mutates Dexie
- Dexie emits
- Alpine arrays are replaced or recomputed
- derived state and templates update

If any handler also writes back into Dexie or updates unrelated tables, the churn multiplies.

## 6. Unread / last-read system

Unread state currently uses `read_cursors` in Dexie and logic in `src/unread-store.js`.

It tracks:

- `chat:nav`
- `chat:channel:<id>`
- `tasks:nav`
- `tasks:item:<id>`
- `docs:nav`

Important nuance:

- unread is not purely presentational
- it causes IndexedDB reads and writes
- it used to run on a 30-second timer even while the rest of the app was idle
- it also writes cursors when the user navigates or opens a channel/task

This subsystem is small conceptually, but it is global and always relevant, so it can become a surprising source of churn if implemented as repeated full-table scans.

## 7. Why the current shape is struggling

The current problem is not “Alpine is bad” or “Dexie is bad” in isolation.

The issue is the combination of:

- one large Alpine root store
- broad always-on live subscriptions
- background sync mutating Dexie underneath those subscriptions
- large in-memory arrays copied into Alpine
- derived getters rebuilding filtered/sorted projections
- secondary subsystems like unread and profile hydration also touching Dexie

That combination has several failure modes:

### 7.1 Full-collection churn

A live query returns an entire collection. Even if one record changed, the app often handles a whole array.

Examples:

- all tasks for owner
- all reports for owner
- all documents for owner
- all channels for owner

If the collection is large, the cost is not just the Dexie query. It is also:

- array allocation
- list comparison
- derived recomputation
- Alpine reactivity work
- DOM diff/update work

### 7.2 Global heat from local side effects

Several handlers do more than just assign rows:

- remember people
- update page title
- normalize selected state
- recompute unread
- reopen or refresh editor state

Those are all reasonable individually, but when attached to broad subscriptions they create global heat.

### 7.3 Feedback-loop risk

The most dangerous pattern is any live-query handler that writes to Dexie while processing Dexie results.

That creates a loop:

1. Dexie emits
2. handler runs
3. handler writes normalized or auxiliary data back to Dexie
4. Dexie emits again

Even if the loop stabilizes eventually, it can still create severe CPU and memory pressure.

### 7.4 Alpine root-store breadth

Alpine works best when reactive state is relatively small and local to a component or a narrow store.

In Flight Deck, the root store is carrying:

- routing
- sync
- tasks
- chat
- docs
- reports
- scopes
- schedules
- comments
- profile cache
- unread state

That means unrelated updates can still dirty the same top-level reactive object graph.

## 8. Has Alpine or Dexie hit a limit?

Yes, but the limit is in how they are being used together, not in the libraries alone.

### Alpine

Alpine is fine for:

- local UI state
- small to medium collections
- simple computed state
- low-ceremony templates

Alpine is weak for:

- very large long-lived reactive object graphs
- broad store-wide derived computation
- applications where most features are mounted off one global store

### Dexie

Dexie is fine for:

- local persistence
- indexed lookup
- local-first state
- targeted live queries

Dexie becomes expensive when:

- many broad `liveQuery` subscriptions are active at once
- each subscription returns whole collections
- writes happen frequently underneath those subscriptions
- query handlers do extra side effects or re-writes

### Combined assessment

If Flight Deck kept:

- Dexie for persistence
- Alpine for local UI state
- but moved away from “all domain data lives reactively in one giant root store”

then the current stack could still be workable.

If it keeps the current pattern, swapping frameworks alone will not fully solve the issue.

## 9. Would another framework help?

Possibly, but only if the data-flow architecture also changes.

### What a different framework could help with

A framework like React, Vue, or Svelte could help with:

- clearer component boundaries
- more explicit memoization / derived-state control
- easier section-level mounting and unmounting
- better tooling for profiling re-renders
- more disciplined state partitioning

### What it would not fix by itself

A framework swap would not automatically fix:

- broad Dexie live subscriptions
- full-array replacement churn
- unread scans over large tables
- writing to Dexie from subscription handlers
- background sync mutating too many live projections at once

If the same architecture were ported 1:1 to another framework, the app would likely still struggle, just with different symptoms.

### Practical answer

The first move should be architectural, not a rewrite:

1. narrow live subscriptions to the active section
2. reduce global Alpine state breadth
3. move unread to cheap targeted queries or summary rows
4. stop subscription handlers from mutating Dexie
5. keep large data collections outside the root reactive object where possible

After that, reassess whether Alpine is still the right fit.

## 10. Likely next refactor steps

### A. Section-scoped live queries

Instead of subscribing to most workspace tables all the time, subscribe only to what the active section needs.

Examples:

- `chat`: channels, selected channel messages, maybe groups
- `tasks`: tasks, scopes, maybe comments for the active task
- `docs`: directories, documents, comments for selected doc
- `reports`: reports and scopes only

This is the single highest-value change.

### B. Separate UI state from data state

Keep Alpine responsible for:

- selected IDs
- open modals
- filters
- route state
- editor buffers

Move large data collections behind narrower stores or adapters instead of one giant root object.

### C. Make unread cheap

Unread should not need repeated full-table scans.

Better options:

- liveQuery a minimal unread summary
- maintain per-section unread summary rows
- compute unread on sync apply rather than on timers

### D. Avoid write-back in reactive readers

Live-query handlers should not normalize and write back into Dexie during the same reactive pass.

If normalization is required:

- do it during sync materialization
- or do it in memory only
- or do it via explicit maintenance jobs, not from live readers

### E. Treat profile/address-book hydration as a background concern

Profile enrichment should be batched and throttled. It should not turn ordinary view updates into persistent Dexie churn.

## 11. Current conclusion

The app is not failing because Alpine or Dexie are inherently unsuitable.

It is failing because the current runtime model is too broad:

- too much data is live at once
- too many subscriptions are active at once
- too much global state is reactive at once
- too many auxiliary systems piggyback on those updates

If those are narrowed, the current stack may still be viable.

If they are not narrowed, a framework rewrite will mostly move the problem around rather than remove it.

## 12. Runtime Ownership Contract

The rollout should follow a strict ownership split documented in
[`docs/runtime_ownership.md`](./runtime_ownership.md).

Practical rules:

- the root shell store owns only app-shell concerns
- section stores own section-specific collections and detail state
- the worker owns sync, normalization, projections, and unread maintenance
- `liveQuery` handlers only read and assign; they do not write back into Dexie

This contract exists to keep the performance workpackages independent enough to dispatch in parallel without overlapping writes or ownership.
