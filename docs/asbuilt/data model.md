# Wingman Flight Deck As-Built Data Model

Status: as-built working note
Reviewed against live code on 2026-04-05
Companion architecture note: `docs/asbuilt/architecture.md`

## Scope

This document describes the data model Flight Deck actually uses today in the browser client. It treats live code as the source of truth and uses `docs/asbuilt/architecture.md` as the required companion artifact.

Primary files reviewed for this note:

- `src/db.js`
- `src/workspaces.js`
- `src/workspace-manager.js`
- `src/api.js`
- `src/sync-families.js`
- `src/section-live-queries.js`
- `src/unread-store.js`
- `src/storage-image-manager.js`
- `src/people-profiles-manager.js`
- `src/worker/sync-worker.js`
- `src/worker/sync-worker-runner.js`
- `src/access-pruner.js`
- `src/crypto/workspace-keys.js`
- `src/translators/`
- `tests/schema-sync.test.js`
- `tests/scope-hierarchy-migration.test.js`

## Storage Boundaries

| Boundary | Technology | What it owns |
| --- | --- | --- |
| Tower / SuperBased | Remote HTTP APIs plus storage endpoints | Authoritative workspace records, groups, workspace membership, storage objects, sync cursors on the server side |
| Shared browser DB | IndexedDB via Dexie database `wingman-fd-shared` | Cross-workspace app settings, cached storage blobs, cached profiles, address book entries, cached workspace session key blobs |
| Workspace browser DB | IndexedDB via Dexie database `wingman-fd-ws-<workspaceDbKey>` | Materialized workspace records, outbox rows, sync metadata, read cursors, local repair/quarantine state |
| Browser memory | Alpine store, worker state, object-URL cache, failure TTL maps | Derived read models and UI caches only; not authoritative persistent state |

Important as-built boundary rule:

- Flight Deck renders from Dexie-backed local rows, not directly from Tower responses.

## Core Entities

### Shared-browser entities

| Entity | Storage | Key | Notes |
| --- | --- | --- | --- |
| App settings | `app_settings` | auto row id | Single JSON-like settings row containing backend selection, current workspace, known workspaces, known hosts, tokens, and similar client preferences |
| Known workspace entry | inside `app_settings.knownWorkspaces` | `workspaceKey` | Normalized from connection token plus backend metadata; not its own Dexie table |
| Storage image cache entry | `storage_image_cache` | `object_id` | Blob cache for workspace avatars and storage-backed images; app usually keys by a backend-aware cache key, not raw object id alone |
| Profile cache entry | `profiles` | `pubkey` | 24-hour cache of fetched Nostr profile data |
| Address book person | `address_book` | `npub` | Recently used person identities for mentions, group member selection, and display fallback |
| Workspace session key cache | `workspace_keys` | `workspace_owner_npub` | Encrypted workspace session key blob cached per workspace in the browser, with registration status |

### Workspace-local entities

| Entity | Storage | Key | Notes |
| --- | --- | --- | --- |
| Workspace settings | `workspace_settings` | `workspace_owner_npub` | One logical settings row per workspace, synced as a records family |
| Group | `groups` | `group_id` | Local access and write-authorization model; loaded from group APIs, not from the records-family sync path |
| Scope | `scopes` | `record_id` | Canonical 5-level hierarchy using `level`, `parent_id`, and lineage slots `l1_id` through `l5_id` |
| Channel | `channels` | `record_id` | Chat container with participants, group access, and optional scope lineage |
| Chat message | `chat_messages` | `record_id` | Message row linked to a channel and optionally a parent message |
| Directory | `directories` | `record_id` | Hierarchical doc container with optional scope lineage and share model |
| Document | `documents` | `record_id` | Rich content row under a directory with shares and scope lineage |
| Report | `reports` | `record_id` | Generated output row with `metadata`, `declaration_type`, `payload`, and scope lineage |
| Task | `tasks` | `record_id` | Work item with state, priority, assignee, predecessors, flow linkage, references, scope lineage, and shares |
| Schedule | `schedules` | `record_id` | Calendar-like recurring or timed entry with assignment metadata and group access |
| Comment | `comments` | `record_id` | Polymorphic threaded comment targeting another record family |
| Audio note | `audio_notes` | `record_id` | Storage-backed audio attachment targeting another record family |
| Flow | `flows` | `record_id` | Workflow definition with ordered `steps`, optional chaining, scope lineage, and shares |
| Approval | `approvals` | `record_id` | Review/decision object tied to a flow run and one or more tasks |
| Person | `persons` | `record_id` | Workspace CRM-style person record with contacts, organisation links, tags, scope lineage, and shares |
| Organisation | `organisations` | `record_id` | Workspace CRM-style organisation record with contacts, person links, tags, scope lineage, and shares |
| Pending write | `pending_writes` | `row_id` | Local outbox row holding the outbound record envelope to push to Tower |
| Sync state entry | `sync_state` | `key` | Local per-workspace metadata such as sync cursors, prune timestamps, and unread summary |
| Sync quarantine entry | `sync_quarantine` | `family_hash:record_id` | Tracks repeatedly skipped inbound records, usually because they could not be decrypted or materialized cleanly |
| Read cursor | `read_cursors` | `record_id` | Per-viewer read markers for nav sections, channels, and tasks |

## Relationships Between Entities

- One workspace identity maps to one workspace Dexie database at a time, keyed by `workspaceDbKey`.
- One workspace has one logical `workspace_settings` row, keyed by `workspace_owner_npub`.
- One workspace has many groups, scopes, channels, directories, documents, reports, tasks, schedules, comments, audio notes, flows, approvals, persons, and organisations.
- Scopes form a self-referential tree through `parent_id`; each scope also carries denormalized lineage columns `l1_id` through `l5_id`.
- Channels, documents, directories, reports, tasks, flows, approvals, persons, and organisations can all attach to a scope through `scope_id` plus denormalized lineage columns.
- Channels have many chat messages through `chat_messages.channel_id`.
- Chat messages may thread through `parent_message_id`.
- Directories form a tree through `parent_directory_id`; documents belong to a directory through `parent_directory_id`.
- Tasks form a tree through `parent_task_id` and a dependency graph through `predecessor_task_ids`.
- Tasks can reference flows through `flow_id`, `flow_run_id`, and `flow_step`.
- Approvals link to flows through `flow_id`, `flow_run_id`, and `flow_step`, and to tasks through `task_ids`.
- Comments and audio notes are polymorphic attachments: both carry `target_record_id` plus `target_record_family_hash`.
- Persons and organisations are linked by arrays on each side: `organisation_links` on person rows and `person_links` on organisation rows.
- Access-bearing content carries `group_ids`; documents, directories, tasks, flows, approvals, persons, and organisations also carry explicit `shares` payloads that preserve the richer share semantics used on the wire.

Important as-built nuance:

- `comments` and `chat_messages` do not carry their own `group_ids`. Their visibility is derived from their parent target or channel, and the access pruner cascade deletes them when the parent becomes inaccessible.

## Ownership And Tenancy Rules

- The top-level tenancy boundary is the workspace owner npub. Remote fetch and sync calls are scoped by `owner_npub`.
- The browser persistence boundary is stricter than the UI boundary: shared data lives in `wingman-fd-shared`, while all materialized workspace records live in `wingman-fd-ws-<workspaceDbKey>`.
- `workspaceDbKey` is not just the owner npub. It can also include service identity or backend URL, so the same workspace owner can be distinguished across backend identities if needed.
- In practice, workspace-local queries are usually filtered by `owner_npub === workspaceOwnerNpub`, which means Flight Deck treats most synced rows as workspace-owned records rather than personal records.
- Actor attribution is separate from tenancy. Chat messages and comments expose `sender_npub` from `signature_npub` or `owner_npub`; approvals also track approver fields; tasks track assignees separately.
- Non-owner viewers only keep local rows they can still access through current group membership. The workspace owner skips local access pruning and can see all rows.
- Group identity has two forms in the model:
  - Stable product identity: `group_id`
  - Rotating crypto identity: `group_npub`
- Local rows are normalized toward stable `group_id` references when possible, and stale `group_npub` references are repaired on login.
- Workspace session keys are browser-local encrypted blobs. They are generated client-side, encrypted to the real user identity, cached in the shared DB, and only used for API auth after Tower registration is confirmed.

## Schema Sources And Materialization Paths

### Schema sources

- `src/sync-families.js` is the registry of record families that participate in sync and names the target Dexie table for each family.
- `src/translators/` is the main source of truth for payload shape and local row shape. Each family defines:
  - the family hash
  - inbound translation from record envelope to Dexie row
  - outbound translation from local intent to record envelope
- `src/db.js` defines the local storage schema, indexes, and browser-only operational tables.
- `src/workspaces.js` defines the normalized workspace identity model that decides how local workspace databases are partitioned.

### Published schema compatibility

- Repo-local tests still validate the older published schema subset for:
  - `audio_note`
  - `channel`
  - `chat_message`
  - `comment`
  - `directory`
  - `document`
  - `report`
  - `schedule`
  - `scope`
  - `settings`
  - `task`
- As built, the live sync family registry is broader and also includes:
  - `flow`
  - `approval`
  - `person`
  - `organisation`
- That means the local code model has moved ahead of the repo-local published-schema coverage test.

### Local schema evolution

Dexie workspace schema versions currently evolve like this:

1. v1: original single-workspace record tables
2. v2: added `read_cursors`
3. v3: added `reports`
4. v4: switched local scope indexes from legacy semantic slots to canonical `scope_l1_id` through `scope_l5_id`
5. v5: added `flows` and `approvals`
6. v6: added `persons` and `organisations`

There is also a one-time legacy migration path from the old `CoworkerV4` IndexedDB database into the new shared DB layout.

### Materialization path

The materialization path is:

1. Tower returns record envelopes through `/api/v4/records` or stale-family SSE follow-up pulls.
2. The sync worker chooses the inbound translator by `record_family_hash`.
3. The translator decrypts or unwraps payload content and normalizes it into the local row shape.
4. `src/db.js` upsert helpers persist the row into the appropriate workspace table.
5. Sync cursors in `sync_state` advance only when a family fully materializes without skipped records.
6. Dexie `liveQuery` subscriptions repopulate Alpine arrays and detail views.

## Derived Caches And Read Models

- Section-scoped `liveQuery` subscriptions in `src/section-live-queries.js` are the main read-model layer. They selectively keep only the active domain loaded into Alpine state.
- Flows and approvals are always-on workspace subscriptions because other editors depend on them even when the user is not viewing the flows section.
- Windowed query helpers are used for chat messages, documents, reports, comments, and tasks so large tables do not fully hydrate into the UI at once.
- `clearInactiveSectionData()` in `src/app.js` deliberately drops inactive domain arrays from memory. Dexie remains authoritative and will rehydrate them when the section becomes active again.
- `read_cursors` is a per-viewer read model keyed by deterministic SHA-256 record ids derived from `viewer_npub + cursor_key`.
- The worker computes an `unread_summary` object and stores it in `sync_state` so the main thread can avoid expensive unread scans after every sync.
- `sync_quarantine` is a derived operational table for problematic inbound records rather than domain data.
- `pending_writes` is the local write-side model, separate from the read-side materialized tables.
- `storage_image_cache` is a derived binary cache for storage-backed images. The app uses backend-aware cache keys and keeps an in-memory object-URL map plus a short-lived failure cache.
- `profiles` and `address_book` are shared caches that improve display and mention UX but are not authoritative workspace records.
- Workspace switcher profile cards are a derived read model assembled from normalized known workspace entries plus per-workspace `workspace_settings` snapshots.

## Important Runtime Data Flows

### 1. Workspace bootstrap and database selection

1. Shared `app_settings` loads known workspaces, selected workspace key, backend URL, and connection token.
2. `src/workspaces.js` normalizes workspace identity into `workspaceKey`.
3. Flight Deck opens `wingman-fd-ws-<workspaceDbKey>` for the selected workspace.
4. A snapshot of that workspace's `workspace_settings` row is used to hydrate workspace name, description, and avatar even before a fresh sync finishes.

### 2. Optimistic write and outbox flow

1. UI code creates or updates a local row in a workspace table with `sync_status: 'pending'`.
2. The matching outbound translator builds a record envelope.
3. The envelope is stored in `pending_writes`.
4. The worker flush timer or explicit sync sends the envelope batch to `/api/v4/records/sync`.
5. Deferred writes stay queued when the required group key is not loaded yet.
6. A later pull re-materializes the authoritative synced version back into the runtime tables.

### 3. Pull, heartbeat, and cursor advancement

1. A sync cycle pushes pending writes first.
2. The worker calls `/api/v4/records/heartbeat` with local family cursors.
3. If the backend reports stale families, only those families are pulled.
4. If heartbeat is unavailable, Flight Deck falls back to pulling all known families.
5. `sync_state` stores per-family `sync_since:<familyHash>` cursors only after clean family application.

### 4. Access pruning and group-ref repair

1. Group rows are refreshed separately from record-family sync.
2. On login or workspace selection, Flight Deck repairs stale `group_npub` references to stable `group_id` values where possible.
3. It then prunes local rows whose `group_ids` no longer intersect with the viewer's current group membership.
4. Channel pruning cascades to chat messages, and record pruning cascades to comments targeting those records.

### 5. SSE-driven partial refresh

1. The worker maintains an SSE connection to `/api/v4/workspaces/<owner>/stream`.
2. `record-changed` events are debounced by family hash.
3. The worker pulls only the affected families and materializes them into Dexie.
4. The SSE path is advisory only; actual row data still comes through the normal pull/materialization flow.

### 6. Media and profile hydration

- Storage-backed images resolve through backend-aware download URLs, then cache into `storage_image_cache` and an in-memory object-URL map.
- Nostr profile lookups cache into `profiles` and backfill `address_book`.
- Workspace-key-to-user mappings fetched from Tower let the UI display real user identities instead of workspace session key npubs.

## As-Built Summary

The implemented Flight Deck data model is a local-first, workspace-partitioned materialized view over Tower records. Its most important characteristics are:

- a split between shared browser state and per-workspace state
- record-family translators as the seam between transport and runtime rows
- group-based tenancy and access repair layered on top of workspace ownership
- explicit write-side operational tables (`pending_writes`, `sync_state`, `sync_quarantine`, `read_cursors`)
- several browser-only derived read models that are critical to runtime behavior even though they are not authoritative domain records
