# Wingman Flight Deck As-Built Middleware

Status: as-built working note  
Reviewed against live code on 2026-04-07  
Companion docs:

- `docs/asbuilt/architecture.md`
- `docs/asbuilt/data model.md`

## Scope

This note describes the middleware and boundary layer Flight Deck actually runs today between:

- Alpine/UI actions on the main thread
- Dexie-backed local state
- worker-based sync orchestration
- Tower/SuperBased HTTP routes
- storage object delivery
- advisory live-update delivery

It focuses on current request paths, auth/signing boundaries, request and response shaping, background entry points, and live-update handling.

Primary files reviewed for this refresh:

- `docs/asbuilt/architecture.md`
- `docs/asbuilt/data model.md`
- `src/api.js`
- `src/sync-manager.js`
- `src/sync-worker-client.js`
- `src/worker/sync-worker.js`
- `src/worker/sync-worker-runner.js`
- `src/workspace-manager.js`
- `src/channels-manager.js`
- `src/docs-manager.js`
- `src/storage-image-manager.js`
- `src/people-profiles-manager.js`
- `src/workspaces.js`
- `src/auth/nostr.js`
- `src/auth/secure-store.js`
- `src/crypto/workspace-keys.js`

## Middleware Boundary Summary

| Boundary | Current owner | What it actually does |
| --- | --- | --- |
| UI -> explicit HTTP | `src/workspace-manager.js`, `src/channels-manager.js`, `src/docs-manager.js`, `src/storage-image-manager.js`, `src/people-profiles-manager.js` | Calls `src/api.js` directly for workspace CRUD, group/group-key refresh, storage, history, workspace-key mappings, and image downloads |
| UI -> backend discovery | `src/workspace-manager.js` | Calls unsigned `GET /health` directly with `fetch()` to discover `service_npub` for workspace identity normalization |
| UI -> sync middleware | `src/sync-manager.js` | Refreshes groups, starts sync cycles, starts and stops background cadence, starts worker outbox flush timer, and wires the SSE status loop back into the app store |
| Main thread -> worker | `src/sync-worker-client.js` | Queues sync RPCs, transfers decrypted group keys and workspace-key material, bridges NIP-07 auth requests, forwards SSE connect and disconnect commands, and surfaces degraded-worker failures back to the app |
| Worker -> backend | `src/worker/sync-worker.js` plus `src/api.js` | Flushes pending writes, runs heartbeat-first pull cycles, materializes record families, computes unread summary, and performs local access pruning |
| Record envelope shaping | `src/translators/` | Converts local intent into outbound record envelopes and converts pulled record envelopes into Dexie rows |
| Advisory live updates | `src/sync-manager.js`, `src/sync-worker-client.js`, `src/worker/sync-worker-runner.js` | Mints SSE auth, opens the workspace stream in the worker, debounces `record-changed` events into targeted family pulls, and maps stream status events back into app behavior |
| Storage/media delivery | `src/api.js`, `src/storage-image-manager.js` | Prepares uploads, uploads bytes, completes objects, downloads blobs, caches images in Dexie, and exposes blob URLs to the UI |

## Actual Request And Event Paths

### 1. Foreground and discovery HTTP calls

These bypass the sync worker and run on the main thread.

| Caller | Route(s) | Purpose | Response handling |
| --- | --- | --- | --- |
| `workspace-manager.js` | `GET /health` | discover backend `service_npub` for workspace identity | raw JSON read directly; not signed through `src/api.js` |
| `workspace-manager.js`, `connect-settings-manager.js` | `POST /api/v4/workspaces` | create workspace bootstrap | raw JSON normalized through `normalizeWorkspaceEntry()` |
| `workspace-manager.js` | `GET /api/v4/workspaces?member_npub=...` | load remote workspace list | raw JSON merged into local known-workspace list |
| `workspace-manager.js` | `POST /api/v4/workspaces/recover` | recover workspace identity for the current member | raw JSON normalized into a workspace entry |
| `workspace-manager.js` | `PATCH /api/v4/workspaces/:workspaceOwnerNpub` | update workspace profile fields | raw JSON merged back into known-workspace and profile state |
| `channels-manager.js` | `GET /api/v4/groups?npub=...` | refresh visible groups for the signed-in member | response is mapped to local group rows and persisted into Dexie |
| `channels-manager.js` | `GET /api/v4/groups/keys?member_npub=...` | fetch wrapped group keys for bootstrap | used to load in-memory group keys before sync and UI sharing flows |
| `channels-manager.js` | `POST /api/v4/groups`, `POST /api/v4/groups/:groupId/members`, `POST /api/v4/groups/:groupId/rotate`, `PATCH /api/v4/groups/:groupId`, `DELETE /api/v4/groups/:groupId/members/:memberNpub`, `DELETE /api/v4/groups/:groupId` | explicit group CRUD and membership operations | raw JSON mapped into local group rows, then `refreshGroups()` rehydrates canonical group state |
| `workspace-manager.js` | `POST /api/v4/storage/prepare` | prepare avatar/media upload | raw JSON used to choose backend-upload or direct-upload path |
| `workspace-manager.js` | `PUT /api/v4/storage/:objectId` or direct `upload_url` PUT | upload avatar bytes | backend JSON on fallback path, synthetic `{ object_id, size_bytes, content_type }` on direct-upload path |
| `workspace-manager.js` | `POST /api/v4/storage/:objectId/complete` | finalize upload | raw JSON |
| `docs-manager.js`, `sync-manager.js` | `GET /api/v4/records/:recordId/history?...` | document version history and task repair probes | history payload is either decoded through `inboundDocument()` for rendering or inspected directly for repair decisions |
| `people-profiles-manager.js` | `GET /api/v4/user/workspace-key-mappings?workspace_owner_npub=...` | map workspace session-key npubs back to real user npubs for display | raw JSON reduced into `_wsKeyDisplayMap` |
| `storage-image-manager.js` | `GET /api/v4/storage/:objectId/content` | fetch image blob | blob cached in Dexie and exposed via `blob:` URL |

### 2. Write-side sync path

The normal record-write path is local-first:

1. A UI manager updates a local Dexie row with `sync_status: 'pending'`.
2. The matching outbound translator builds a Tower record envelope.
3. `addPendingWrite()` stores `{ record_id, record_family_hash, envelope, created_at }` in `pending_writes`.
4. Most UI write flows call `flushAndBackgroundSync()`, which sends `flushOnly()` through `src/sync-worker-client.js`.
5. The worker runs `flushPendingWrites()` and batches writes in groups of 25 to `POST /api/v4/records/sync`.
6. `syncRecords()` adds `group_write_tokens` for each non-owner write group when the required group key is loaded.
7. Tower accepts, rejects, or defers records.
8. Accepted and rejected rows are removed from `pending_writes`; deferred rows remain queued for later retry when keys are available.
9. A later pull re-materializes the authoritative row into the runtime table.

Important as-built nuance:

- `flushAndBackgroundSync()` is intentionally write-only. It does not heartbeat or pull.
- If `flushOnly()` fails, the main thread logs the failure, keeps queued writes in Dexie, and still schedules background sync.

### 3. Read-side sync path

The current background read path is group-bootstrap plus heartbeat-first sync:

1. `performSync()` in `src/sync-manager.js` first calls `refreshGroups()` on the main thread.
2. `refreshGroups()` fetches both group metadata and wrapped group keys, persists group rows, and bootstraps in-memory group keys needed for decryption and write proofs.
3. `performSync()` then calls `runSync()` through `src/sync-worker-client.js`.
4. The worker flushes pending writes first.
5. The worker posts `POST /api/v4/records/heartbeat` with per-family cursors from `sync_state`.
6. If Tower returns `stale_families`, only those families are pulled with `GET /api/v4/records`.
7. If heartbeat fails, the worker falls back to pulling all registered families.
8. Each record envelope is routed to the matching inbound translator.
9. The translated Dexie row is upserted into the family table.
10. The family cursor `sync_since:<familyHash>` advances only when that family applied with no skipped records.
11. When rows changed, the worker may prune inaccessible local cache rows and recompute `unread_summary` in `sync_state`.

### 4. Live-update delivery

SSE is now wired and active as the primary low-latency freshness path.

Main-thread path:

1. `ensureBackgroundSync()` starts the worker flush timer and calls `connectSSEStream()`.
2. `connectSSEStream()` mints a NIP-98 `GET` token for `/api/v4/workspaces/:owner/stream`.
3. It prefers the active workspace session key for signing if Tower registration is confirmed; otherwise it falls back to the logged-in user signer.
4. It strips the `Nostr ` prefix and sends the base64 event token to the worker through `connectSSE()`.

Worker path:

1. `src/sync-worker-runner.js` opens `EventSource` against `GET /api/v4/workspaces/:ownerNpub/stream?token=...`.
2. If present, it also sends `last_event_id`.
3. `record-changed` events are deduplicated by family and debounced for 300 ms.
4. Recently flushed local writes are echo-suppressed for 30 seconds by `record_id:version`.
5. The worker responds by calling `pullRecordsForFamilies()` for the stale family hashes and posts `pull-complete` status back to the main thread.
6. `group-changed` posts a status that makes the main thread run `refreshGroups({ minIntervalMs: 0 })`.
7. `catch-up-required` posts a status that makes the main thread set the catch-up flag and schedule an immediate background sync.
8. On disconnect, the worker backs off exponentially and asks the main thread for a fresh token via `token-needed`.
9. After repeated failures, the worker posts `fallback-polling`, and the app widens back to polling-only freshness.

Important as-built nuance:

- SSE is advisory only. Actual row data still arrives through the normal records pull and translator path.
- The code comment in the worker says `catch-up-required` should trigger a full sync, but the current main-thread handler only schedules an immediate background sync; it does not force `forceFull: true`.

## Auth And Session Boundaries

### Browser login/session state

User login credentials live in two places:

- in-memory signer state in `src/auth/nostr.js`
- device-local secure storage in `src/auth/secure-store.js`

`src/auth/secure-store.js` persists one `credentials` row in Dexie database `CoworkerV4SecureAuth` with:

- `method`
- `pubkey`
- optional encrypted `secretHex`
- optional encrypted bunker URI
- a 7-day expiry window

If Web Crypto is available, secrets are AES-GCM encrypted with a device-local key in the same secure DB. If decryption fails or the record expires, the credential cache is cleared.

### Signed transport auth

All signed HTTP routes in `src/api.js` go through a fetch helper that adds:

- `Authorization: Nostr <base64-event>`
- `Content-Type: application/json` when a body is present
- `AbortSignal.timeout(...)`

The auth event is built in `src/auth/nostr.js` as NIP-98 `kind 27235` with tags:

- `u` for request URL
- `method` for HTTP verb
- `payload` for a SHA-256 of the serialized body on `POST` and other body-bearing requests

### Which key signs the request

`createApiAuthHeader()` in `src/api.js` uses this precedence:

1. active workspace session key secret, but only if Tower registration has been confirmed
2. otherwise the logged-in user signer

That means the browser will prefer workspace-key NIP-98 auth for normal workspace traffic only after registration is confirmed.

### Workspace session-key boundary

`src/crypto/workspace-keys.js` keeps the active workspace session key in memory and also caches an encrypted workspace-key blob in shared Dexie.

The middleware boundary matters here:

- local owner-payload crypto can use the workspace key before Tower registration
- API auth may not use that key until `registered === true`
- the worker receives only the serialized workspace-key payload from the main thread

### Worker auth bridge boundary

The worker cannot call `window.nostr` directly.

When a worker-side operation needs extension auth:

1. `src/worker/sync-worker-runner.js` posts `sync-worker:auth-request`
2. `src/sync-worker-client.js` resolves that on the main thread with `getExtensionPublicKey()` or `signEventWithExtension()`
3. the result is posted back as `sync-worker:auth-response`

### Connection token boundary

`connectionToken` is a workspace bootstrap and identity-normalization artifact, not an HTTP auth credential.

As built today:

- `src/workspaces.js` parses and regenerates it to normalize workspace identity and backend metadata
- the SSE path explicitly does not use it for stream auth
- signed HTTP and SSE auth both use NIP-98 instead

### Group write proofs

`POST /api/v4/records/sync` adds a second auth layer for non-owner writes:

- `syncRecords()` builds `group_write_tokens`
- each token is another NIP-98 header signed with the relevant group key
- the key is resolved from `write_group_id` or `write_group_npub`

If the required group key is not loaded, Flight Deck does not fail the whole batch. It marks those record ids as deferred and leaves their pending writes in Dexie for a later retry.

## Request And Response Shaping

### `src/api.js`

`src/api.js` is intentionally thin:

- it serializes JSON bodies
- it signs requests
- it returns raw JSON, bytes, or blobs
- it annotates thrown errors with `status`, `method`, `requestUrl`, and `responseText`

It does not normalize most response bodies into app-ready shapes.

### Workspace and identity shaping

Main-thread callers do the shaping after transport:

- `normalizeWorkspaceEntry()` in `src/workspaces.js` reconciles workspace CRUD, list, and token-derived responses into a stable `workspaceKey`, backend identity, connection token, and profile fields
- `workspace-manager.js` merges raw workspace CRUD responses into known-workspace state rather than rendering them directly
- `people-profiles-manager.js` reduces workspace-key mapping responses into a display-only rewrite map instead of persisting them as a sync family

### Group bootstrap shaping

Group refresh is a middleware seam of its own:

- `channels-manager.js` maps raw group API responses into local group rows
- wrapped key responses are fed into `bootstrapWrappedGroupKeys()`
- the resulting in-memory keyring is what the sync worker depends on for record decryptability and write proofs

### Storage/media shaping

- `buildStoragePrepareBody()` in `src/storage-payloads.js` normalizes `owner_group_id`, `access_group_ids`, content metadata, and optional filename before `POST /api/v4/storage/prepare`
- `storage-image-manager.js` converts storage blobs into backend-aware cache keys and `blob:` URLs
- workspace-avatar upload stores the blob in the shared cache immediately so the UI can render the new image without waiting for a later fetch

### Record envelope shaping

Outbound translators all emit the same envelope pattern:

- `record_id`
- `owner_npub`
- `record_family_hash`
- `version`
- `previous_version`
- `signature_npub`
- `write_group_id` or `write_group_npub`
- `owner_payload`
- `group_payloads`

`owner_payload` is encrypted for the workspace owner path.  
`group_payloads` are encrypted per readable group and also carry group identity fields such as `group_id`, `group_npub`, `group_epoch`, and `write`.

### Inbound materialization

Inbound translators do the reverse:

- `decryptRecordPayload()` tries workspace-key owner decryption first
- then legacy owner decryption for the real signer
- then each `group_payload`

After decryption the translator maps transport fields into local Dexie rows, usually:

- flattening `record.group_payloads` into local `group_ids`
- moving `record.version`, `record.updated_at`, and `record_state` into row fields
- normalizing family-specific payload fields for the table schema

If no payload can be decrypted, the worker skips the record, logs diagnostics, and withholds the family cursor advance.

## Background Entry Points

### Main-thread schedulers

`src/sync-manager.js` is the main-thread entry point for background middleware:

- `ensureBackgroundSync()` starts the worker flush timer, starts SSE, and schedules the next background sync tick
- `backgroundSyncTick()` calls `performSync({ silent: true })`
- `stopBackgroundSync()` stops the UI timer, disconnects SSE, and stops the worker flush timer
- `runAccessPruneOnLogin()` triggers immediate login-time prune through the worker

Cadence is section-aware:

- wider heartbeat polling when SSE is connected
- fast cadence for chat, docs, tasks, calendar, schedules, and scopes when SSE is not connected
- idle cadence elsewhere
- no background cadence when there is no session, no backend, or the document is hidden

### Worker-side background loops

`src/worker/sync-worker-runner.js` owns the independent outbox timer:

- `startFlushTimer()` stores owner, backend, and workspace context
- `tickFlush()` runs every 2 seconds
- `flushInProgress` prevents timer overlap with `runSync()` and `flushNow()`

This is intentionally separate from full sync so writes can reach Tower quickly even when the app is otherwise idle.

### Worker degradation behavior

If the browser cannot construct a `Worker`, or if the worker crashes repeatedly, `src/sync-worker-client.js` does not run sync logic on the main thread.

Instead it:

- reports sync as unavailable or degraded
- preserves queued writes in Dexie
- retries worker creation a limited number of times
- throws surfaced errors back to the caller when recovery fails

The comment in `src/worker/sync-worker.js` still mentions a main-thread fallback path, but the current client code does not implement that runtime fallback.

## Middleware Notes By Area

### Docs and version history

- Version history is a foreground path, not worker sync.
- `docs-manager.js` fetches record versions directly from Tower.
- Returned versions are decoded with the same inbound translator used for sync so doc rendering reflects real record payload semantics.

### Workspace profile and harness settings

- Workspace profile edits are explicit `PATCH /api/v4/workspaces/:owner` calls.
- Shared harness and trigger settings remain local-first record-family writes in `workspace_settings`.
- Saving harness settings forces an immediate flush-only attempt so the user gets fast feedback on push failures.

### Image hydration

- Storage image download is direct foreground middleware.
- The app first checks shared Dexie cache by backend-aware key.
- Cache miss falls through to signed blob download.
- The resulting blob is cached and exposed as a `blob:` URL, with a 60-second failure TTL to suppress hot-loop retries.

### Workspace key mapping and identity display

- `people-profiles-manager.js` fetches workspace-key mappings out-of-band from record sync.
- The result is not materialized as a sync family.
- It is used only to rewrite displayed sender identities from workspace-key npubs to real user npubs.

## As-Built Summary

Flight Deck's middleware is split cleanly in code:

- `src/api.js` is the thin signed transport layer for explicit backend calls
- `src/sync-manager.js` is the app-facing orchestrator for groups, sync, timers, and SSE status
- `src/sync-worker-client.js` is the queueing and worker bridge
- `src/worker/sync-worker.js` is the real push, pull, materialization, prune, and unread engine
- outbound and inbound translators are the main request and response shaping seam

The most important current runtime facts are:

- group metadata and wrapped keys are refreshed on the main thread before sync
- heartbeat-first polling is still the authoritative pull path
- SSE is now live and advisory, not dormant
- worker degradation preserves queued writes instead of falling back to in-process sync
