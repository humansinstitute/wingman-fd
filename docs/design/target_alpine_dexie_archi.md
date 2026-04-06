# Design: Target Alpine + Dexie Architecture

**Status:** Draft
**Date:** 2026-03-31

---

## Problem Statement

Flight Deck currently behaves like a local-first app in principle, but its browser runtime has drifted into a shape that keeps too much data, too many subscriptions, and too much derived state hot at once.

Current symptoms:

- Firefox content process grows into multi-GB memory use while idle
- CPU stays high even on low-content or empty views
- navigation can become unresponsive after the app has been open for some time
- unread / last-read indicators can become incorrect or stale

The root cause is not a single bad list or one broken page. It is the current runtime model:

- one large Alpine root store
- broad always-on Dexie `liveQuery` subscriptions
- background sync mutating Dexie underneath those subscriptions
- large domain collections copied into Alpine arrays
- derived state recomputed from those arrays in the root runtime

This document describes the target model, the gaps from the current implementation, and the work packages required to get there.

## Goals

1. Keep Dexie as the local source of truth for rendered app state.
2. Move sync and materialization work into a dedicated Web Worker.
3. Shrink Alpine responsibility to:
   - app shell state
   - active section state
   - local component state
4. Subscribe only to the data needed by the current screen.
5. Make unread state cheap and correct.
6. Support paging / windowing by default for large collections.
7. Avoid full-app reactive churn on small Dexie changes.

## Non-Goals

- Full framework rewrite as the first move
- Replacing Dexie
- Replacing local-first behavior with direct backend rendering
- Building every view from ad hoc imperative IndexedDB reads

## Current Design Decisions

The current intended direction is:

- Dexie remains the durable local source of truth for both read state and write state.
- UI writes land in Dexie first and create outbox entries locally.
- A dedicated Web Worker is the only runtime that flushes the outbox remotely.
- Remote writes should be described as encrypted Superbased record sync, not as a permanently present app-specific backend dependency.
- The Alpine root store should shrink to shell/runtime state only.
- Each major section should have its own store.
- Section stores should consume a shared section-query adapter layer rather than talking to Dexie tables ad hoc.
- Large navigation/list projections should move into Dexie projection tables.
- Active detail views should remain mostly computed on demand.
- Unread state shown in nav/list shells should be stored as cheap summary/projection rows.
- Unread state for the currently open item can remain dynamic.
- Alpine should be retained until the worker split and section-scoped query architecture are in place and evaluated.

The runtime ownership contract for the rollout is captured in
[`docs/runtime_ownership.md`](../runtime_ownership.md). WP1 should keep that
document authoritative so later workpackages can stay disjoint.

## Target State

### 1. Runtime Layers

The target runtime should be split into four layers:

1. **Dexie**
   - local persisted source of truth
   - stores materialized records and selected precomputed view rows

2. **Dedicated Web Worker**
   - owns background sync orchestration
   - owns materialization and normalization
   - writes into Dexie
   - does not render UI

3. **Alpine Stores**
   - root shell store
   - section stores
   - local component state

4. **Templates / Components**
   - render only from the currently active section store and local UI state

### 2. Alpine Store Split

Target store split:

- **root shell store**
  - auth
  - workspace selection
  - route / nav
  - sync status
  - global notices / errors
  - build/update state

- **chat store**
  - channel list projection
  - selected channel projection
  - paged/windowed message view
  - active thread state

- **tasks store**
  - board / scope selection
  - paged or filtered task projection
  - task detail state
  - comments for active task

- **docs store**
  - folder/document browser projection
  - selected doc state
  - comments for active doc

- **reports store**
  - report list projection
  - selected report state

- **local component state**
  - modal open/close flags
  - editor buffers
  - mention menus
  - drag state
  - local selection UI

The key rule is:

**large domain collections should not all live simultaneously in one root reactive object.**

### 3. Dexie Role

Dexie should remain the durable local state boundary, but with more explicit separation between:

- base materialized tables
- view-oriented projection tables
- lightweight summary tables
- pending write / outbox state

Examples of candidate projection/summary tables:

- unread summary by section
- unread summary by channel
- report list rows
- recent activity rows
- task board projection rows
- doc browser projection rows

This does not mean every page must have a dedicated table immediately. It means expensive derived queries should be allowed to move out of the Alpine runtime and into explicit stored projections where it helps.

### 3.1 Write-State Role

Dexie should also remain the first durable landing point for user writes.

Target write flow:

```text
UI action
  -> section store action
  -> local domain row update in Dexie
  -> pending write / outbox row in Dexie
  -> UI reflects local state immediately
  -> Web Worker sync round flushes pending writes to remote
  -> worker applies remote ack / returned record state into Dexie
  -> active section subscription updates UI if needed
```

This means the browser should not wait for remote confirmation before local state changes become visible.

Design rule:

- **the UI writes locally first**
- **the worker is responsible for remote delivery**
- **Dexie is the durable handoff boundary between UI and sync**

### 3.2 Write-State Invariants

The target model should preserve these invariants:

1. UI code does not write directly to the backend.
2. UI code writes:
   - updated local row(s)
   - pending write / outbox envelope
3. Worker code is the only runtime that should flush the outbox to the remote sync transport. In practice this means translating local pending writes into encrypted Superbased sync records for remote delivery, not assuming a permanently present app-specific backend.
4. Remote success or reconciliation updates must land in Dexie before the UI reflects them.
5. Failed writes should remain visible locally as pending/error state rather than disappearing.

This keeps the app local-first and prevents UI flows from splitting into separate “local path” and “remote path” implementations.

### 4. Worker Role

The sync path should move into a dedicated **Web Worker**, not a service worker.

Target worker responsibilities:

- flush pending writes / outbox entries
- polling / push-triggered sync cadence
- pending write flush
- heartbeat / stale-family detection
- remote record fetch
- record translation / normalization
- projection table updates
- unread summary updates
- postMessage notifications back to the main thread for status only

Important:

- the existing `src/worker/sync-worker.js` is a module, not a real browser worker
- the target state requires a real `new Worker(...)` boundary
- the service worker should remain limited to build/update caching concerns

### 4.1 Write Handling in the Worker

The worker should own the network-side write lifecycle:

- batch pending writes
- push to remote
- handle retry / backoff
- reconcile returned versions
- mark pending rows as synced or errored
- preserve local pending rows when remote push fails

The worker should not be responsible for creating UI intent. It should only consume the outbox created by UI actions.

### 5. Subscription Model

Current behavior subscribes broadly to most workspace tables regardless of the active page.

Target behavior:

- subscribe only to data needed by the current section
- subscribe to detail/comment data only when the corresponding item is open
- unsubscribe when the section or selected detail target changes

Examples:

#### Chat section

- channels projection
- selected channel message window
- active thread replies only if a thread is open

#### Tasks section

- task board projection for selected board/filter state
- active task comments only if task detail is open

#### Docs section

- doc browser projection for selected folder/scope/search
- selected document content
- selected doc comments only if comment panel is open

#### Reports section

- report list projection
- selected report detail

The UI should not keep all of chat, tasks, docs, reports, schedules, scopes, and comments live at once.

### 6. Paging and Windowing

All large list-like views should assume paging/windowing.

Target defaults:

- message feeds: newest-N window with “load older”
- thread replies: windowed
- tasks: board/list windows and/or paged projections
- docs browser: directory-based paging or virtualized rows
- reports: paged list if report volume grows

Windowing is not an optional optimization. It is part of the target runtime contract.

### 7. Unread / Last-Read Model

Unread state should stop depending on repeated broad scans from the UI runtime.

Target behavior:

- read cursors remain persisted in Dexie
- worker updates or derives unread summaries as data changes
- Alpine reads cheap unread summaries
- per-channel/per-task unread checks do not require repeated whole-table scans

The UI should write read cursors when the user consumes content, but it should not repeatedly recompute global unread state by scanning large tables on timers.

## Conceptual Flow

Target flow:

```text
Remote encrypted record sync transport
  -> Web Worker sync/materialization
  -> Dexie base tables + projection tables
  -> active section liveQuery / Dexie adapter
  -> section Alpine store
  -> component render
```

The root shell store sits alongside this, holding only shell/runtime state:

```text
auth + workspace + route + sync status + notices
```

Write flow in the same model:

```text
User edits data
  -> section store action
  -> Dexie local row update + outbox entry
  -> active section UI reflects local optimistic state
  -> Web Worker flushes outbox
  -> remote response reconciled into Dexie
  -> active section subscription reflects final state
```

## Current Gaps

### Gap 1: Root store is too broad

Current state in `src/app.js`:

- root store contains both shell state and most domain collections
- unrelated updates share one reactive graph

Target:

- root store contains shell/runtime state only
- domain slices move to section stores

### Gap 2: Workspace subscriptions are too broad

Current state:

- `startWorkspaceLiveQueries()` subscribes to most workspace tables regardless of visible section

Target:

- section-scoped subscriptions only
- detail-scoped subscriptions only when opened

### Gap 3: Sync work is still main-thread coupled

Current state:

- the app imports `src/worker/sync-worker.js` as a module
- sync/materialization still participates in main-thread runtime pressure
- UI-triggered writes and sync lifecycle are still more tightly coupled than the target model wants

Target:

- dedicated browser Web Worker
- main thread only receives state/status events and reads Dexie
- worker owns remote write flushing from Dexie outbox state

### Gap 4: Some view derivation still happens in Alpine over large arrays

Current state:

- filtered/sorted projections are still computed in store getters and helpers

Target:

- move expensive repeated projections into:
  - scoped Dexie queries
  - projection tables
  - store-level cached selectors with narrow inputs

### Gap 5: Unread is still too UI-driven

Current state:

- unread derives from cursor scans and broad collection checks in the UI runtime

Target:

- unread summary rows or narrowly scoped derived queries
- UI reads cheap summaries instead of doing repeated broad scans

### Gap 6: Live-query handlers have been too side-effectful

Current state:

- handlers have historically:
  - normalized data
  - rewritten Dexie rows
  - refreshed auxiliary state
  - touched address-book/profile state

Target:

- live-query handlers should mostly:
  - read
  - assign to the active store
  - avoid writing back into Dexie

## Work Packages

### WP1: Define Runtime Boundaries

Goal:

- document the runtime ownership rules in code and docs

Deliverables:

- store ownership map
- worker ownership map
- subscription ownership map
- “no liveQuery write-back” rule

Files:

- `docs/architecture_alpine.md`
- this document
- `docs/runtime_ownership.md`

Ordering:

- WP1 is the prerequisite contract pass.
- WP2 can dispatch the worker boundary in parallel with WP1 once the ownership map is stable.
- WP3 and WP4 should use the contract to avoid overlapping writes with the worker/runtime split.
- follow-up comments in `src/app.js`

### WP2: Introduce Real Web Worker Sync Runtime

Goal:

- move sync/materialization off the main thread
- move remote write flushing fully behind the worker boundary

Deliverables:

- dedicated worker entrypoint
- worker bootstrap and lifecycle from main thread
- worker message protocol for:
  - sync status
  - error notices
  - manual sync requests
  - optional write-flush triggers

Files likely affected:

- new worker bootstrap file
- `src/sync-manager.js`
- `src/worker/sync-worker.js`
- `src/main.js`

### WP3: Split Root Store into Shell + Section Stores

Goal:

- reduce Alpine root-store breadth

Deliverables:

- root shell store
- chat store
- tasks store
- docs store
- reports store

Files likely affected:

- `src/app.js`
- extracted store modules for each section
- `src/main.js`

### WP4: Replace Workspace-Wide Subscriptions with Section-Scoped Subscriptions

Goal:

- stop keeping most workspace data live all the time

Deliverables:

- section subscription lifecycle
- detail subscription lifecycle
- explicit subscription teardown on route changes

Examples:

- chat route mounts chat subscriptions, unmounts others
- reports route does not keep tasks/docs/messages live

### WP5: Add Projection / Summary Tables Where Needed

Goal:

- move expensive repeated derivations out of Alpine

Candidate projections:

- unread summary rows
- report list rows
- recent activity rows
- task board rows
- doc browser rows

This should be incremental, not all-or-nothing.

### WP5.1: Formalize the Outbox / Pending Write Contract

Goal:

- make write-state ownership explicit and stable

Deliverables:

- documented outbox row shape
- write helper boundary for UI actions
- worker-side flush contract
- reconciliation rules for:
  - success
  - retryable failure
  - non-retryable failure
  - remote version conflict

The important point is that this contract should be framework-independent. Whether the UI remains Alpine or changes later, the write path should still be:

```text
UI -> Dexie local write + outbox -> Worker -> Remote -> Dexie reconcile
```

### WP6: Standardize Paging / Windowing

Goal:

- ensure all large collections are windowed by default

Deliverables:

- paging policy by section
- shared helpers where appropriate
- explicit UX for “load older” / “load more”

### WP7: Rebuild Unread as a Cheap Summary System

Goal:

- make unread correct and cheap

Deliverables:

- clear rules for:
  - section unread
  - channel unread
  - task unread
  - doc unread
- summary rows or cheap scoped queries
- read cursor update semantics based on actual consumed content, not generic timestamps only

### WP8: Add Profiling and Guardrails

Goal:

- prevent regression after refactor

Deliverables:

- runtime counters in dev mode
- logging around:
  - active subscriptions
  - sync duration
  - rows applied per family
  - projection rebuild cost
- tests for store/subscription lifecycle

## Migration Strategy

This should be done incrementally.

Recommended order:

1. stop the worst churn and write-back loops
2. make subscriptions section-scoped
3. move sync into real Web Worker
4. split root store into shell + section stores
5. introduce projection tables where profiling shows repeated hot derivation
6. tighten unread around summary rows

Do not start with a framework rewrite.

## Framework Question

Would another framework help?

Potentially, yes, but only after the architecture above is improved.

What a different framework could help with:

- clearer component/store boundaries
- more profiling tooling
- more explicit memoization and derived state control

What it would not solve by itself:

- broad Dexie subscriptions
- main-thread sync/materialization
- projection churn
- unread scan cost
- write-back loops

So the target state described here should be pursued whether or not the UI framework changes later.

## Acceptance Criteria

The target architecture is succeeding when:

- idle CPU stays low on empty views
- memory does not steadily climb while idle
- switching sections does not keep unrelated large collections live
- unread indicators remain correct without periodic full scans
- sync/materialization does not block the main thread
- page responsiveness remains stable after long sessions

## Open Questions

1. Which projections should be stored in Dexie first, and which should remain computed on demand?
2. Should each section store read Dexie directly, or should there be a shared section-query adapter layer?
3. Which unread summaries belong in projection tables versus cheap dynamic queries?
4. How much of the current app can remain in Alpine before a framework change becomes worthwhile?

## Recommended Answers

### 1. Which projections should be stored in Dexie first?

Store in Dexie first:

- channel list rows with unread, last message preview, participant summary, and sort key
- task board/list rows that already join task metadata, scope metadata, assignee state, and stable ordering fields
- doc browser rows for directory/document listing, especially where folder, title, updated-at, and lightweight status need to be sorted and filtered repeatedly
- report list rows and recent activity rows that are expensive to rebuild from multiple base tables
- section-level unread summary rows and high-fanout per-channel unread summary rows

Keep computed on demand at first:

- currently selected item detail
- currently open thread replies
- currently open comment pane data
- small per-view filters and presentation-only transforms
- one-off detail joins where the cardinality is low and the result is not shared widely

Rule of thumb:

- if a projection is needed for navigation, badges, sorting, or large scrolling lists, it should probably live in Dexie
- if a projection is detail-only, cheap, and scoped to one open item, compute it on demand

### 2. Should section stores read Dexie directly?

Use a shared section-query adapter layer.

Recommended shape:

- section store owns view state and user actions
- section-query adapter owns Dexie queries, liveQuery lifecycles, paging cursors, and projection selection
- Dexie remains the durable source of truth underneath that adapter

Reasons:

- avoids each store re-implementing liveQuery setup/teardown and paging rules
- gives one place to enforce section-scoped subscriptions
- makes it easier to swap Alpine stores or even the UI framework later without rewriting Dexie access everywhere
- keeps query semantics and projection choices testable outside the component/store layer

The store should not know table details if it can avoid it. It should consume a narrow domain-facing adapter API.

### 3. Which unread summaries should be stored versus queried dynamically?

Store as projection/summary rows:

- section unread counts
- per-channel unread counts or at least per-channel unread booleans plus latest unread timestamp
- per-task unread/comment attention summary where task lists need badges
- per-doc unread/comment attention summary where doc lists need badges

Keep dynamic:

- unread state for the currently open item
- exact "first unread" anchor resolution for the active channel/thread/task when opening it
- small-scope checks against a visible page of rows

Rule of thumb:

- if unread is shown in a list, sidebar, badge, or nav shell, store it
- if unread is only needed for one open item right now, compute it dynamically

### 4. How much can remain in Alpine?

Alpine can remain responsible for:

- the root shell store
- section view state
- local editor/modal/selection state
- active paged result windows fed from Dexie adapters
- optimistic pending/error UI markers already persisted in Dexie

Alpine should stop owning:

- broad workspace-wide domain arrays
- always-hot copies of most Dexie tables
- expensive multi-table derivations
- global unread scans
- sync/materialization logic

A framework change becomes worth serious consideration only if, after the worker split and section-scoped query architecture are in place, Alpine still makes it difficult to:

- isolate reactive updates to the active section
- reason about subscription lifecycle
- profile or test derived state boundaries
- maintain complex editor or virtualization behavior without store sprawl

That means the likely trigger is not data volume alone. The trigger is whether Alpine still creates boundary/control problems after the data-flow architecture is corrected.

## Current Recommendation

Proceed with the target architecture using Alpine + Dexie first.

The critical next move is:

**replace broad always-on workspace subscriptions with section-scoped subscriptions, and move sync/materialization into a dedicated Web Worker.**

That will answer the framework question with much better evidence than a rewrite debate today.
