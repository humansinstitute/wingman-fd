# Wingman Flight Deck As-Built Architecture

Status: as-built working note  
Reviewed against live code on 2026-04-05

## Scope

This document describes the architecture currently implemented in the `wingman-fd` codebase, not the target-state architecture from design docs.

Local repo path:

- `/Users/mini/code/wingmanbefree/wingman-fd`

Primary source files reviewed for this note:

- `README.md`
- `../README.md`
- `../ARCHITECTURE.md`
- `../design.md`
- `docs/architecture_alpine.md`
- `docs/runtime_ownership.md`
- `docs/design/target_alpine_dexie_archi.md`
- `index.html`
- `vite.config.js`
- `src/main.js`
- `src/app.js`
- `src/db.js`
- `src/api.js`
- `src/workspaces.js`
- `src/workspace-manager.js`
- `src/section-live-queries.js`
- `src/sync-manager.js`
- `src/sync-worker-client.js`
- `src/worker/sync-worker.js`
- `src/worker/sync-worker-runner.js`
- `src/service-worker-registration.js`
- `src/version-check.js`
- `src/agent-connect.js`
- `src/sync-families.js`

## App Purpose

Wingman Flight Deck is the browser client for Wingman Be Free. In the current implementation it is a local-first single-page app that:

- signs users in with Nostr-based identities
- imports or creates workspace connections
- maintains per-workspace local materialized state in IndexedDB via Dexie
- renders chat, docs, tasks, reports, schedules, scopes, flows, approvals, people, and organisations from local state
- pushes outbound writes through a local outbox model
- syncs workspace records with Tower/SuperBased APIs
- exports Agent Connect packages for other agents or clients

The browser app is not the authority for workspace semantics. Tower remains the backend/source-of-truth contract owner.

## Runtime Boundaries

### 1. Browser main thread

The main thread owns UI orchestration and most user-facing control flow.

Current responsibilities include:

- bootstrapping from `src/main.js`
- creating one large Alpine store in `src/app.js`
- routing, modal state, section selection, and screen-level orchestration
- login/session handling
- workspace selection and local workspace profile hydration
- Dexie `liveQuery` subscriptions through `src/section-live-queries.js`
- optimistic local writes into Dexie and `pending_writes`
- explicit non-sync API calls such as workspace/group/storage operations
- bootstrapping crypto material and passing it to the sync worker

Important as-built detail:

- the app still uses a single Alpine store registered as `Alpine.store('chat', storeObj)`, even though it now owns much more than chat
- `index.html` is tightly coupled to that store name through `$store.chat.*`

### 2. IndexedDB / Dexie boundary

Dexie is the browser persistence boundary.

`src/db.js` currently defines:

- one shared DB: `wingman-fd-shared`
- one workspace DB at a time: `wingman-fd-ws-<workspaceDbKey>`

The shared DB holds:

- app settings
- storage image cache
- cached profiles
- address book
- workspace key mappings

The workspace DB holds materialized workspace tables including:

- `workspace_settings`
- `channels`
- `chat_messages`
- `groups`
- `documents`
- `directories`
- `reports`
- `tasks`
- `schedules`
- `comments`
- `audio_notes`
- `scopes`
- `flows`
- `approvals`
- `persons`
- `organisations`
- `pending_writes`
- `sync_state`
- `sync_quarantine`
- `read_cursors`

As built, the UI renders from Dexie-backed local state, not from raw Tower responses.

### 3. Sync worker boundary

Flight Deck now has a real browser Web Worker boundary:

- worker entrypoint: `src/worker/sync-worker-runner.js`
- worker logic module: `src/worker/sync-worker.js`
- worker client on main thread: `src/sync-worker-client.js`

Worker-owned concerns in the current implementation:

- flushing `pending_writes`
- sync rounds (`runSync`)
- pulling changed record families
- materializing inbound records into Dexie
- login-time pruning/repair helpers
- SSE stream handling for workspace change notifications
- independent background outbox flush timer

Important as-built nuance:

- the worker client falls back to importing `src/worker/sync-worker.js` on the main thread when `Worker` construction fails or is unavailable
- because of that fallback, "worker-owned" sync logic is architecturally separated in code, but not absolutely isolated at runtime in every environment

### 4. Service worker boundary

The service worker is separate from the sync worker.

Current service-worker role:

- build/version caching for the static app shell
- reload/update flow for new builds

It is emitted by the Vite build plugin in `vite.config.js` and registered from `src/service-worker-registration.js`.

It does not own data sync or record materialization.

### 5. Remote/backend boundary

`src/api.js` is the browser transport layer for Tower/SuperBased HTTP calls.

The codebase assumes a backend exposing `/api/v4/...` routes for:

- groups
- workspaces
- records sync/history/summary
- storage prepare/upload/complete/content
- workspace event streaming

Authentication and signing boundaries include:

- NIP-98 authenticated HTTP requests
- NIP-07 extension bridging for public key and event signing
- direct secret/bunker flows in auth code
- workspace session keys and group keys for encrypted record handling

## Major Subsystems

### App shell and reactive state

`src/app.js` remains the main orchestration unit. The store is assembled from mixins, but runtime state is still centralized in one Alpine store.

Notable mixin-driven areas include:

- workspace management
- sync management
- channels and chat message management
- docs management
- flows management
- scopes/task board state
- audio recording and storage image handling
- unread tracking
- section-scoped live queries
- people/profile handling

### Workspace bootstrap and identity handling

Workspace identity and selection are split across:

- token parsing in `src/superbased-token.js`
- workspace normalization in `src/workspaces.js`
- workspace CRUD/switching/profile flows in `src/workspace-manager.js`

Key implemented ideas:

- known workspaces carry backend metadata and connection tokens
- workspace selection opens a workspace-specific Dexie database
- workspace identity is not collapsed into signed-in actor identity
- workspace metadata can be recovered from saved connection tokens

### Local data materialization and subscriptions

Dexie access helpers live in `src/db.js`.

Reactive read-side behavior is currently split between:

- broad app methods in `src/app.js`
- section/detail subscription management in `src/section-live-queries.js`

As built, section subscriptions are more selective than older docs imply:

- `navSection` controls which workspace tables stay live
- chat/messages/docs/reports can use windowed queries
- some data is still always on, notably flows and approvals
- `clearInactiveSectionData()` in `src/app.js` is used as a memory boundary when switching sections

The current code is therefore in a transitional state:

- more section-scoped than the older "everything always hot" model
- not yet split into multiple Alpine stores

### Sync, outbox, and reconciliation

Sync behavior is split across:

- UI lifecycle/control in `src/sync-manager.js`
- worker/client bridge in `src/sync-worker-client.js`
- worker runtime in `src/worker/sync-worker-runner.js`
- materialization logic in `src/worker/sync-worker.js`

Implemented sync model:

1. UI writes local rows and `pending_writes`.
2. Flush-only paths can push pending writes quickly.
3. Full sync runs can flush, heartbeat/check freshness, pull record families, and materialize into Dexie.
4. Dexie updates trigger `liveQuery` subscribers, which refresh the Alpine store.
5. SSE events can trigger family-specific pull refreshes.

### Translators and family registry

Record-family translation lives under `src/translators/`.

The current family registry in `src/sync-families.js` covers:

- settings
- channel
- chat_message
- directory
- document
- report
- task
- schedule
- comment
- audio_note
- scope
- flow
- approval
- person
- organisation

This is the main seam between:

- transport/encrypted record shape
- local Dexie row shape
- rendered UI state

### Storage and media

Storage-aware behavior is distributed across:

- `src/api.js`
- `src/storage-payloads.js`
- `src/storage-image-manager.js`
- shared image cache in Dexie

The current implementation is backend-aware. That matters because known workspaces may point at different backend origins.

### Agent Connect export

`src/agent-connect.js` builds the `coworker_agent_connect` package currently exported by Flight Deck.

This package includes:

- workspace identity
- app identity
- service/backend URLs
- connection token
- helper URLs such as `llms.txt`, docs, OpenAPI, and health

## Entry Points

### Browser HTML entry

- `index.html`

The page bootstraps Alpine with:

- `x-data`
- `x-init="$store.chat.init()"`

### Frontend boot entry

- `src/main.js`

Boot sequence:

1. optional hard reset check
2. `initApp()`
3. service worker registration
4. version polling startup
5. image modal startup

### Alpine app entry

- `src/app.js`

`initApp()` builds the main store, applies mixins, registers `Alpine.store('chat', ...)`, and starts Alpine.

### Sync worker entry

- `src/worker/sync-worker-runner.js`

This is the actual `new Worker(...)` target used by `src/sync-worker-client.js`.

### Build entry

- `vite.config.js`

Vite builds the SPA from the root `index.html` and emits static assets to `dist/`.

## Build and Deploy Shape

### Build shape

This repo is a Vite SPA.

Implemented build facts:

- source HTML is the repo-root `index.html`
- source JS starts at `src/main.js`
- source CSS is `src/styles.css`
- build output goes to `dist/`
- the sync worker is bundled as a separate worker asset/chunk
- a Vite plugin writes `dist/version.json`
- the same plugin emits a build-specific `dist/service-worker.js`
- `.build-meta.json` is updated during `bun run build`

### Run shape

Package scripts currently provide:

- `bun run dev`
- `bun run start`
- `bun run build`
- `bun run preview`
- `bun run test`
- `bun run test:e2e`

### Deploy shape

Repo docs describe Flight Deck as a built static site deployed separately from Tower.

Observed certainty:

- the codebase clearly builds a static `dist/` site
- service worker and versioning are designed for static deployment

Uncertainty:

- shared docs mention PM2/Wingman app management for local dev and CapRover/live static deployment for production, but this repo does not contain deployment automation or infra manifests for that step

## Integration Points

### Tower / SuperBased backend

Flight Deck integrates with Tower/SuperBased for:

- workspace creation/listing/recovery/update
- group management and rotation
- record sync/history/freshness
- storage prepare/upload/complete/content
- workspace event streaming

### Nostr auth and signing

Flight Deck integrates with Nostr-facing auth for:

- login via extension, bunker, ephemeral, or direct secret paths
- NIP-98 request signing
- extension signing bridge used by the sync worker

### Shared schema publication

`README.md` states that published record-family manifests live in:

- `../sb-publisher/schemas/flightdeck`

Tests are expected to validate Flight Deck outbound payloads against those published schemas.

### Cross-client compatibility

The broader workspace docs position Flight Deck and Yoke as peer clients that share:

- connection-token semantics
- record-family hashes
- workspace/group semantics
- storage metadata rules

## Architectural Seams That Matter For Maintenance

### 1. Single-store centralization is still real

The codebase has been refactored into mixins and section query helpers, but the UI still hangs off one Alpine store named `chat`. Changing section ownership or state lifetime still tends to converge on `src/app.js` and `index.html`.

### 2. Shared DB versus workspace DB is a hard boundary

Some state is intentionally global and some is workspace-scoped. Bugs around workspace switching usually involve crossing that line incorrectly.

Key examples:

- cached profiles/address book live in the shared DB
- records/outbox/read cursors live in the workspace DB

### 3. Worker separation is real but not absolute

The intended sync boundary is the Web Worker, but `src/sync-worker-client.js` can execute the same sync module on the main thread as a fallback. Any maintenance work that assumes "sync can never run on the main thread" would be unsafe.

### 4. Service worker and sync worker are different systems

This repo has both:

- a service worker for build caching/version rollover
- a sync worker for records/outbox/SSE work

Confusing them will lead to incorrect fixes.

### 5. Translators are the contract seam

For record families, safe changes usually require coordinated updates to:

- `src/translators/*`
- `src/sync-families.js`
- `src/db.js`
- affected UI/state code
- tests
- shared schemas in `../sb-publisher` when payload shape changes

### 6. Workspace identity, signer identity, and group identity must stay separate

The codebase distinguishes:

- signed-in actor/session identity
- workspace owner identity
- workspace session key identity
- stable group IDs
- rotating group npubs

Maintenance bugs are likely if those concepts are collapsed or reused interchangeably.

### 7. Backend-aware asset resolution matters

Known workspaces can point at different backend origins. Storage caches and content URLs must remain backend-aware rather than assuming one global backend.

### 8. Section-scoped subscriptions are partial, not complete

The current code has moved toward section-scoped `liveQuery` subscriptions, but it still keeps some cross-cutting data live and still copies result sets into the root store. Performance or memory work should treat the current runtime as transitional, not as already fully decomposed.

## Current Architectural Summary

As built today, Flight Deck is a Vite-built SPA with one Alpine root store, Dexie-backed local materialization, a real sync Web Worker plus main-thread fallback path, backend-aware workspace switching, record-family translators, and a static-site deployment model. The code is clearly moving toward narrower section ownership, but the implemented runtime is still centered on a single main store and shared app shell.
