# Wingman Flight Deck As-Built Middleware

Status: as-built working note  
Reviewed against live code on 2026-04-05  
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

It focuses on current request paths, auth/signing filters, request and response shaping, background entry points, and live-update delivery.

Primary files reviewed for this note:

- `src/api.js`
- `src/sync-manager.js`
- `src/sync-worker-client.js`
- `src/worker/sync-worker.js`
- `src/worker/sync-worker-runner.js`
- `src/docs-manager.js`
- `src/storage-image-manager.js`
- `src/people-profiles-manager.js`
- `src/workspace-manager.js`
- `src/auth/nostr.js`
- `src/crypto/group-keys.js`
- `src/crypto/workspace-keys.js`
- `src/translators/record-crypto.js`
- `src/translators/group-refs.js`
- `src/storage-payloads.js`
- `src/workspaces.js`

## Middleware Boundary Summary

| Boundary | Current owner | What it actually does |
| --- | --- | --- |
| UI -> explicit HTTP | `src/workspace-manager.js`, `src/docs-manager.js`, `src/storage-image-manager.js`, `src/people-profiles-manager.js` | Calls `src/api.js` directly for workspace CRUD, storage, version history, key mappings, and image downloads |
| UI -> sync middleware | `src/sync-manager.js` | Starts sync cycles, repair pulls, login prune, and background cadence; hands transport work to `src/sync-worker-client.js` |
| Main thread -> worker | `src/sync-worker-client.js` | Queues sync RPCs, transfers decrypted group/workspace keys, bridges NIP-07 auth requests, and falls back to in-process sync when Worker startup fails |
| Worker -> backend | `src/worker/sync-worker.js` plus `src/api.js` | Flushes pending writes, runs heartbeat-first pull cycles, materializes record families, computes unread summary, and performs local access pruning |
| Record envelope shaping | `src/translators/` | Converts local intent into outbound record envelopes and converts pulled record envelopes into Dexie rows |
| Storage/media delivery | `src/api.js`, `src/storage-image-manager.js` | Prepares uploads, uploads bytes, completes objects, downloads blobs, caches images in Dexie, and exposes blob URLs to the UI |

## Actual Request Paths

### 1. Explicit foreground HTTP calls

These bypass the sync worker and call `src/api.js` directly from the main thread.

| Caller | Route(s) | Purpose | Response handling |
| --- | --- | --- | --- |
| `workspace-manager.js` | `POST /api/v4/workspaces` | create workspace bootstrap | raw JSON returned by `api.js`, then normalized through `normalizeWorkspaceEntry()` |
| `workspace-manager.js` | `GET /api/v4/workspaces?member_npub=...` | load remote workspace list | raw JSON merged into local known-workspace list |
| `workspace-manager.js` | `POST /api/v4/workspaces/recover` | recover workspace identity | raw JSON normalized into workspace entry |
| `workspace-manager.js` | `POST /api/v4/storage/prepare` | prepare avatar/media upload | raw JSON used to choose upload path |
| `workspace-manager.js` | `PUT /api/v4/storage/:objectId` or direct `upload_url` PUT | upload avatar bytes | backend JSON on fallback path, synthetic `{ object_id, size_bytes, content_type }` on direct-upload path |
| `workspace-manager.js` | `POST /api/v4/storage/:objectId/complete` | finalize upload | raw JSON |
| `docs-manager.js` | `GET /api/v4/records/:recordId/history?...` | document version history | result versions are decoded through `inboundDocument()` before rendering |
| `sync-manager.js` | `GET /api/v4/records/:recordId/history?...` | task repair probe | raw history used to decide whether to rebuild a family |
| `people-profiles-manager.js` | `GET /api/v4/workspaces/:owner/key-mappings` | map workspace session keys to real user npubs | raw JSON reduced into `_wsKeyDisplayMap` |
| `storage-image-manager.js` | `GET /api/v4/storage/:objectId/content` | fetch image blob | blob cached in Dexie and exposed via `blob:` URL |

### 2. Write-side sync path

The normal record-write path is local-first:

1. A UI manager updates a local Dexie row with `sync_status: 'pending'`.
2. A family-specific outbound translator builds a Tower record envelope.
3. `addPendingWrite()` stores `{ record_id, record_family_hash, envelope, created_at }` in `pending_writes`.
4. `sync-manager.js` triggers either:
   - `flushAndBackgroundSync()` for fast write delivery, or
   - `performSync()` for a full push/pull round.
5. `sync-worker-client.js` queues the request and sends it to the dedicated worker when available.
6. `sync-worker.js` calls `syncRecords()` in batches of 25.
7. Tower accepts, rejects, or defers records.
8. Accepted records are removed from `pending_writes`; deferred rows remain queued.
9. A later pull re-materializes the authoritative row into the runtime table.

### 3. Read-side sync path

The current background read path is heartbeat-first polling:

1. `performSync()` calls `runSync()` through `sync-worker-client.js`.
2. The worker flushes pending writes first.
3. The worker posts `/api/v4/records/heartbeat` with per-family cursors from `sync_state`.
4. If Tower returns `stale_families`, only those families are pulled with `GET /api/v4/records`.
5. If heartbeat fails, the worker falls back to pulling all registered families.
6. Each record envelope is routed to the matching inbound translator.
7. The translated Dexie row is upserted into the family table.
8. The family cursor `sync_since:<familyHash>` advances only when that family applied with no skipped records.
9. If new records landed, the worker recomputes `unread_summary` in `sync_state`.

## Auth And Request Filters

### Transport auth

All HTTP routes in `src/api.js` go through a signed fetch helper that adds:

- `Authorization: Nostr <base64-event>`
- `Content-Type: application/json` when a request body is present
- `AbortSignal.timeout(...)`

The auth event is built in `src/auth/nostr.js` as NIP-98 `kind 27235` with tags:

- `u` for request URL
- `method` for HTTP verb
- `payload` for a SHA-256 of the serialized body on `POST`/`PUT`/`PATCH`

### Which key signs the request

`createApiAuthHeader()` in `src/api.js` uses this precedence:

1. active workspace session key secret, but only if Tower registration has been confirmed
2. otherwise the logged-in user signer via stored auth method

That means the browser will prefer workspace-key NIP-98 auth for normal workspace traffic once the key is registered, but it can still fall back to the user signer.

### Group write proofs

`POST /api/v4/records/sync` adds a second auth layer for non-owner writes:

- `syncRecords()` builds `group_write_tokens`
- each token is another NIP-98 header signed with the relevant group key
- the key is resolved from `write_group_id` or `write_group_npub`

If the required group key is not loaded, Flight Deck does not fail the whole batch. It marks affected record ids as deferred and leaves those pending writes in Dexie for a later retry.

### Read filters

The worker shapes read requests with explicit filter fields:

- `owner_npub`: workspace tenancy boundary
- `viewer_npub`: viewer-specific access filter on the backend
- `record_family_hash`: family-scoped pull
- `since`: per-family cursor for incremental sync

Foreground history calls also pass `owner_npub` and usually `viewer_npub`.

Important as-built rule:

- local access pruning in `src/access-pruner.js` is a cache cleanup step, not a security boundary
- Tower is still the authoritative read filter through owner payload access and group payload decryptability

## Request And Response Shaping

### `src/api.js`

`src/api.js` is intentionally thin:

- it serializes JSON bodies
- it signs requests
- it returns raw JSON, bytes, or blobs
- it annotates thrown errors with `status`, `method`, `requestUrl`, and `responseText`

It does not normalize most response bodies into app-ready shapes.

### Workspace and storage shaping

Main-thread callers do the shaping after transport:

- `normalizeWorkspaceEntry()` in `src/workspaces.js` reconciles workspace CRUD/list responses into a stable `workspaceKey`, backend identity, connection token, and profile fields
- `buildStoragePrepareBody()` in `src/storage-payloads.js` normalizes `owner_group_id`, `access_group_ids`, content metadata, and optional filename before `POST /api/v4/storage/prepare`
- `storage-image-manager.js` converts storage blobs into backend-aware cache keys and `blob:` URLs

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

- `ensureBackgroundSync()` chooses cadence and starts the worker flush timer
- `backgroundSyncTick()` calls `performSync({ silent: true })`
- `stopBackgroundSync()` stops the UI timer and the worker flush timer
- `runAccessPruneOnLogin()` triggers immediate post-login prune through the worker

Cadence is section-aware:

- fast cadence for chat, docs, tasks, calendar, schedules, and scopes
- idle cadence elsewhere
- no background cadence when there is no session, no backend, or the document is hidden

### Worker-side background loops

`src/worker/sync-worker-runner.js` owns the independent outbox timer:

- `startFlushTimer()` stores owner/backend/workspace context
- `tickFlush()` runs every 2 seconds
- `flushInProgress` prevents timer overlap with `runSync()` and `flushNow()`

This is intentionally separate from full sync so writes can reach Tower quickly even when the app is otherwise idle.

### Worker fallback behavior

If the browser cannot construct a `Worker`, `src/sync-worker-client.js` falls back to importing `src/worker/sync-worker.js` directly and invoking the same methods in-process. The code boundary remains the same, but runtime isolation is lost.

## Live Update And Event Delivery

### Active path today: heartbeat polling

The active live-update mechanism in this repo is the heartbeat-first background sync path described above. `performSync()` plus `runSync()` are what currently keep local data fresh.

### Implemented but not currently wired: worker SSE client

`src/worker/sync-worker-runner.js` contains a full SSE client for:

- `GET /api/v4/workspaces/:ownerNpub/stream?token=...`
- optional `last_event_id`
- event types:
  - `record-changed`
  - `group-changed`
  - `catch-up-required`
  - `connected`
  - `heartbeat`

Behavior in that worker path:

- `record-changed` events are deduplicated by family and debounced for 300 ms
- writes recently flushed by this client are echo-suppressed for 30 seconds by `recordId:version`
- debounced families are refreshed with `pullRecordsForFamilies()`
- `group-changed` only posts a status event back to the main thread
- `catch-up-required` signals that the stream cursor fell behind and a full sync should run
- reconnect uses exponential backoff and requests a fresh token from the main thread after disconnect

Important as-built finding:

- the main-thread functions `connectSSE()`, `disconnectSSE()`, and `setSSEStatusCallback()` exist in `src/sync-worker-client.js`
- but no current main-thread caller imports or invokes them

So the SSE delivery path is implemented in the worker protocol, but it is not presently activated by the Flight Deck app code in this repo snapshot.

## Middleware Notes By Area

### Docs/version history

- Version history is a foreground path, not worker sync.
- `docs-manager.js` fetches record versions directly from Tower.
- Each returned version is decoded with the same inbound translator used for sync so rendering reflects real record payload semantics.

### Workspace profile and harness settings

- Workspace settings edits are local-first and go through the outbox like other record families.
- Avatar binaries use explicit storage routes first, then the settings row references the storage object via `storage://...`.
- Saving harness settings forces an immediate flush-only attempt so the user gets fast feedback on push failures.

### Image hydration

- Storage image download is direct foreground middleware.
- The app first checks shared Dexie cache by backend-aware key.
- Cache miss falls through to signed blob download.
- The resulting blob is cached and exposed as a `blob:` URL, with a 60-second failure TTL to suppress hot-loop retries.

### Workspace key mapping and identity display

- `people-profiles-manager.js` fetches workspace key mappings out-of-band from record sync.
- The result is not materialized as a sync family.
- It is used only to rewrite displayed sender identities from workspace-key npubs to real user npubs.

## As-Built Summary

Flight Deck’s middleware is split cleanly in code even when runtime fallback collapses some boundaries:

- `src/api.js` is a thin signed transport layer
- `src/sync-manager.js` is the app-facing sync orchestrator
- `src/sync-worker-client.js` is the queueing and worker bridge
- `src/worker/sync-worker.js` is the real push/pull/materialization engine
- outbound and inbound translators are the main request/response shaping seam

The most important current runtime fact is that heartbeat-based polling is active, while the worker SSE path is implemented but not currently wired up by any main-thread caller in this repo state.
