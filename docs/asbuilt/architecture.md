# Wingman Flight Deck As-Built Architecture

Status: as-built working note  
Reviewed against live code on 2026-04-07

## Scope

This document describes the architecture currently implemented in the live `wingman-fd` repository. It is not a target-state design note.

Local repo path:

- `/Users/mini/code/wingmanbefree/wingman-fd`

Primary sources reviewed for this refresh:

- `README.md`
- `../README.md`
- `../ARCHITECTURE.md`
- `../design.md`
- `docs/architecture_alpine.md`
- `docs/runtime_ownership.md`
- `docs/design/target_alpine_dexie_archi.md`
- `vite.config.js`
- `package.json`
- `src/main.js`
- `src/app.js`
- `src/shell-state.js`
- `src/db.js`
- `src/api.js`
- `src/workspaces.js`
- `src/workspace-manager.js`
- `src/section-live-queries.js`
- `src/sync-manager.js`
- `src/sync-worker-client.js`
- `src/worker/sync-worker.js`
- `src/worker/sync-worker-runner.js`
- `src/channels-manager.js`
- `src/flows-manager.js`
- `src/connect-settings-manager.js`
- `src/agent-connect.js`
- `src/auth/nostr.js`
- `src/auth/secure-store.js`
- `src/crypto/workspace-keys.js`
- `src/crypto/group-keys.js`
- `src/service-worker-registration.js`
- `src/version-check.js`
- `src/sync-families.js`

## App Purpose

Wingman Flight Deck is the browser client for Wingman Be Free. As built today it is a local-first SPA that:

- signs users in with Nostr identities
- imports, creates, and switches workspace connections
- materializes workspace state into IndexedDB via Dexie
- renders chat, docs, tasks, reports, schedules, scopes, flows, approvals, people, and organisations from local rows
- manages workspace settings, sharing, and Agent Connect export in the browser
- queues optimistic writes locally in `pending_writes`
- syncs encrypted record families with Tower/SuperBased
- handles workspace group membership/key bootstrap separately from record-family sync

Important as-built nuance:

- jobs UI state exists in the main store, but `src/jobs-manager.js` is currently a placeholder surface that reports jobs as unavailable in this build
- triggers and harness settings are implemented browser-side, but they are not part of the generic record-family sync registry

## Runtime Boundaries

### 1. Browser main thread

The main thread still owns nearly all user-facing orchestration.

Current responsibilities include:

- bootstrapping from `src/main.js`
- assembling one Alpine store in `src/app.js`
- applying the extracted shell boundary from `src/shell-state.js`
- route/nav state, modal state, and page-level orchestration
- login/session handling
- workspace selection and profile hydration
- starting and stopping Dexie `liveQuery` subscriptions
- optimistic local writes into Dexie and `pending_writes`
- explicit non-sync API calls such as workspace, group, and storage operations
- bootstrapping decrypted group keys and workspace session keys, then bridging them to the sync worker
- clipboard/export flows such as Agent Connect package generation

Important as-built detail:

- the shell state has been partially extracted into `src/shell-state.js`, but the runtime is still one Alpine store registered as `Alpine.store('chat', storeObj)`
- `index.html` is still coupled to `$store.chat.*`
- `src/app.js` still contains inline default shell fields alongside the extracted shell module, so the shell boundary is real but not yet cleanly isolated

### 2. Browser persistence boundary

Persistence is split across three browser-side stores:

1. Shared Dexie DB in `src/db.js`: `wingman-fd-shared`
2. Workspace Dexie DB in `src/db.js`: `wingman-fd-ws-<workspaceDbKey>`
3. Secure auth Dexie DB in `src/auth/secure-store.js`: `CoworkerV4SecureAuth`

The shared DB holds:

- app settings
- storage image cache
- cached profiles
- address book
- cached workspace key blobs and registration flags

The current workspace DB holds:

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

The secure auth DB holds:

- encrypted or plain cached credentials
- a device-local AES key used to encrypt stored secrets when Web Crypto is available

As built, the UI still renders from Dexie-backed local state rather than raw Tower responses.

### 3. Sync worker boundary

Flight Deck has a real browser Web Worker boundary:

- worker entrypoint: `src/worker/sync-worker-runner.js`
- worker logic module: `src/worker/sync-worker.js`
- worker client: `src/sync-worker-client.js`

Worker-owned concerns in the current implementation:

- flushing `pending_writes`
- full sync runs (`runSync`)
- targeted family pulls
- materializing inbound records into Dexie
- login-time access pruning and stale-group-ref repair
- independent outbox flush timer
- SSE advisory stream handling for workspace change notifications
- extension signer bridge requests back to the main thread

Important as-built nuance:

- `src/sync-worker-client.js` does not currently execute sync logic on the main thread when worker creation fails
- instead, worker creation failure degrades sync and preserves queued writes for later retry
- `src/worker/sync-worker.js` still contains a comment saying it is reusable for a main-thread fallback path; that comment no longer matches the current client behavior

### 4. Service worker boundary

The service worker is separate from the sync worker.

Current service-worker role:

- cache the static app shell
- version the cache per build
- coordinate reload to the latest build
- treat navigation as network-first and assets as stale-while-revalidate

It is generated by the Vite plugin in `vite.config.js` and registered from `src/service-worker-registration.js`.

It does not own sync, records, or IndexedDB materialization.

### 5. Remote/backend boundary

`src/api.js` is the browser transport layer for Tower/SuperBased HTTP calls outside the worker module.

The codebase assumes a backend exposing `/api/v4/...` routes for:

- groups and group keys
- workspaces
- records sync/history/summary
- storage prepare/upload/complete/content
- workspace event streaming

Authentication/signing seams include:

- NIP-98 request signing
- NIP-07 extension support
- direct secret and bunker login flows
- workspace session keys for owner-payload and API-auth signing
- group keys for group-targeted record encryption/decryption

## Major Subsystems

### App shell and reactive state

`src/app.js` remains the dominant orchestration unit. The store is mixin-composed, but runtime state is still centralized.

Current major store slices include:

- shell state from `src/shell-state.js`
- workspace management
- sync lifecycle
- channels and chat message management
- docs management
- flows and approvals
- task board and calendar state
- people/profile handling
- connect settings and Agent Connect export
- triggers
- placeholder jobs UI state
- unread tracking
- section-scoped live query coordination

### Workspace bootstrap and identity handling

Workspace identity and connection handling are split across:

- token parsing/building in `src/superbased-token.js`
- workspace normalization/merge logic in `src/workspaces.js`
- workspace CRUD/switch/profile flows in `src/workspace-manager.js`

Key implemented ideas:

- known workspaces carry backend metadata, service npub, app npub, relay hints, and connection token data
- workspace identity is separate from signed-in actor identity
- workspaces are keyed by owner plus service npub or backend URL, not just by owner npub
- workspace switching opens a workspace-specific Dexie DB
- workspace metadata can be rehydrated from saved tokens even if current remote discovery is sparse

### Signing and crypto model

Identity and crypto are explicitly layered:

- login/session credentials are handled in `src/auth/nostr.js` and cached through `src/auth/secure-store.js`
- workspace session keys are generated, cached, decrypted, and bridged from `src/crypto/workspace-keys.js`
- group keys are bootstrapped from wrapped keys and cached in memory via `src/crypto/group-keys.js`

Important as-built details:

- the workspace session key becomes the preferred signing identity for NIP-98 auth only after registration is confirmed
- the worker receives raw decrypted group keys and serialized workspace-key material from the main thread
- extension signing remains a bridged capability; the worker cannot access `window.nostr` directly

### Local materialization and subscriptions

Read-side behavior is split between Dexie helpers in `src/db.js` and subscription planning in `src/section-live-queries.js`.

Current live subscription model:

- shared: address book
- always-on workspace data: flows
- section-scoped data:
  - `status`: windowed reports, scopes, pending approvals
  - `chat`: channels, audio notes
  - `docs`: directories, windowed documents, scopes
  - `tasks`: tasks, scopes
  - `calendar`: tasks, schedules, scopes
  - `reports`: windowed reports, scopes
  - `schedules`: schedules
  - `scopes`: scopes
  - `flows`: pending approvals, scopes
  - `people`: persons, organisations
- detail-scoped data:
  - selected channel messages
  - selected task row plus task comments
  - selected document plus doc comments
  - selected report row

Important as-built nuance:

- the app is more section-scoped than older docs described
- `clearInactiveSectionData()` in `src/shell-state.js` actively clears inactive section arrays as a memory boundary
- windowed helpers exist for documents, reports, tasks, and chat/thread message reads, but the current section subscription plan only uses windowed reads for documents, reports, and chat messages
- groups are not kept live via section `liveQuery`; they are refreshed explicitly from `/groups` and `/groups/keys`, then cached into Dexie and the main store

### Sync, outbox, and reconciliation

Sync behavior is split across:

- UI lifecycle/control in `src/sync-manager.js`
- worker bridge in `src/sync-worker-client.js`
- worker runtime in `src/worker/sync-worker-runner.js`
- materialization logic in `src/worker/sync-worker.js`

Implemented sync model:

1. UI writes local rows and `pending_writes`.
2. Fast paths can call `flushOnly`.
3. Full sync runs flush pending writes, check staleness/freshness, pull changed families, and materialize into Dexie.
4. Dexie writes trigger `liveQuery` subscribers, which refresh Alpine state.
5. SSE events can trigger family-specific pulls or a catch-up/full-sync request.

As-built worker behavior that matters:

- the worker runs its own 2-second flush timer once background sync is enabled
- SSE is advisory only; actual data still comes from pull requests
- SSE reconnect/token refresh is coordinated back through the main thread
- if sync cannot start because no worker is available, the UI surfaces degradation rather than silently switching runtime modes

### Translator and family registry seam

Record-family translation lives under `src/translators/`.

The current sync family registry in `src/sync-families.js` covers:

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

This is the key seam between:

- encrypted transport payloads
- local Dexie row shape
- rendered UI state

### Group management outside record-family sync

Groups are architecturally important but are not part of the generic sync-family registry.

Current group flow:

- fetch groups and wrapped keys explicitly via `/api/v4/groups` and `/api/v4/groups/keys`
- bootstrap/decrypt wrapped keys on the main thread
- cache group rows into the workspace DB
- keep decrypted group keys only in memory, then export them to the worker

This is a distinct subsystem from generic records sync and is a common place where identity and crypto bugs would surface.

### Storage and media

Storage-aware behavior is distributed across:

- `src/api.js`
- `src/storage-payloads.js`
- `src/storage-image-manager.js`
- shared Dexie image cache

The implementation is backend-aware. That matters because different known workspaces may resolve against different Tower origins.

### Agent Connect export

`src/agent-connect.js` builds the exported `coworker_agent_connect` package. It is surfaced from `src/connect-settings-manager.js`.

As built, the package includes:

- `kind: coworker_agent_connect`
- `version: 5`
- workspace identity
- app identity
- service/backend URLs
- `connection_token`
- helper URLs such as `llms.txt`, docs, OpenAPI, and health

## Entry Points

### Browser HTML entry

- `index.html`

The page still boots Alpine from the root template and calls into `$store.chat.init()`.

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

`initApp()` assembles the store, applies mixins, registers `Alpine.store('chat', ...)`, and starts Alpine.

### Sync worker entry

- `src/worker/sync-worker-runner.js`

This is the actual `new Worker(...)` target used by `src/sync-worker-client.js`.

### Build entry

- `vite.config.js`

Vite builds the SPA from repo-root `index.html` and emits static assets into `dist/`.

## Build and Deploy Shape

### Build shape

This repo is a Vite SPA.

Implemented build facts:

- source HTML is repo-root `index.html`
- source JS starts at `src/main.js`
- source CSS is `src/styles.css`
- output goes to `dist/`
- the sync worker is bundled as a separate worker asset/chunk
- the Vite build plugin writes `dist/version.json`
- the same plugin emits a build-specific `dist/service-worker.js`
- `.build-meta.json` is updated during `bun run build`

### Run shape

`package.json` currently provides:

- `bun run dev`
- `bun run start`
- `bun run build`
- `bun run preview`
- `bun run test`
- `bun run test:e2e`

### Deploy shape

Repo docs describe Flight Deck as a static build deployed separately from Tower.

Observed certainty:

- the codebase clearly builds a static `dist/` site
- the generated service worker and version check are designed for static deployment

Observed limitation:

- this repo does not itself contain the full production deployment automation; deployment expectations live in sibling docs and external runtime setup

## Architectural Seams That Matter For Maintenance

### 1. One Alpine store still dominates the runtime

The codebase has real mixin and shell-boundary extraction, but the UI still converges on a single store named `chat`. Template and store decomposition are incomplete.

### 2. Shared DB, workspace DB, and secure auth DB are different concerns

Bugs around workspace switching, credential lifetime, or cache invalidation usually come from crossing those boundaries incorrectly.

### 3. Worker isolation is real, but sync availability depends on worker creation

The current implementation no longer falls back to running sync on the main thread. If worker creation fails, sync is degraded and queued writes remain local.

### 4. Service worker and sync worker are different systems

This repo has both:

- a service worker for build caching/version rollover
- a sync worker for records/outbox/SSE work

Confusing them will lead to wrong fixes.

### 5. Groups are not just another record family

Group rows are cached locally, but membership and wrapped-key bootstrap come from explicit group endpoints and in-memory crypto state, not from the generic sync-family loop.

### 6. Translators remain the contract seam

For record families, safe changes usually require coordinated updates to:

- `src/translators/*`
- `src/sync-families.js`
- `src/db.js`
- affected UI/state code
- tests
- shared schemas in `../sb-publisher` when payload shape changes

### 7. Workspace identity, signer identity, and group identity must stay separate

The codebase distinguishes:

- signed-in actor/session identity
- workspace owner identity
- workspace session key identity
- stable group IDs
- rotating group npubs

Most high-risk bugs in this repo will come from collapsing those identities.

### 8. Backend-aware asset and workspace resolution matters

Known workspaces can point at different backend origins. Storage cache keys, content URLs, and workspace identity merging all assume backend awareness.

### 9. The subscription model is transitional, not final-state

The app has moved toward section-scoped `liveQuery` ownership and explicit inactive-section clearing, but it still copies result sets into the root store and still keeps some cross-cutting data live.

## Current Architectural Summary

As built today, Flight Deck is a Vite-built static SPA with one dominant Alpine store, a partially extracted shell-state boundary, Dexie-backed local materialization, a real sync Web Worker with no implemented main-thread fallback, explicit group/key bootstrap outside generic record sync, backend-aware workspace switching, and browser-side Agent Connect export. The runtime is materially more section-scoped than earlier docs suggested, but it is still a transitional architecture centered on one root store and Dexie-driven local state.
