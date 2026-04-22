# Wingman Flight Deck As-Built Data Model

Status: as-built working note
Reviewed against live code on 2026-04-07
Companion architecture note: `docs/asbuilt/architecture.md`

## Scope

This note describes the data model Flight Deck actually uses today in the browser client. It is grounded in the live Dexie schema, the current sync-family registry, the active translators, and the read-model code that subscribes Alpine state to IndexedDB.

Primary files reviewed for this note:

- `src/db.js`
- `src/workspaces.js`
- `src/workspace-manager.js`
- `src/api.js`
- `src/sync-families.js`
- `src/section-live-queries.js`
- `src/unread-store.js`
- `src/storage-image-manager.js`
- `src/access-pruner.js`
- `src/crypto/workspace-keys.js`
- `src/worker/sync-worker.js`
- `src/worker/sync-worker-runner.js`
- `src/translators/`
- `tests/schema-sync.test.js`
- `tests/scope-hierarchy-migration.test.js`

## Storage Boundaries

| Boundary | Technology | What it owns |
| --- | --- | --- |
| Tower / SuperBased | Remote HTTP APIs plus storage endpoints | Authoritative workspace records, groups, storage objects, remote cursors, workspace-key registration |
| Shared browser DB | IndexedDB via Dexie database `wingman-fd-shared` | Cross-workspace app settings, cached image blobs, cached profiles, address book entries, cached encrypted workspace-key blobs |
| Workspace browser DB | IndexedDB via Dexie database `wingman-fd-ws-<workspaceDbKey>` | Materialized workspace records, groups, outbox rows, sync metadata, unread cursors, sync quarantine |
| Browser memory | Alpine state, live-query subscriptions, object-URL cache, worker state | Derived view state and short-lived caches only |

Important boundary rule:

- Flight Deck renders from Dexie-backed local rows, not directly from Tower responses.

## Workspace Identity And Partitioning

- The shared DB is always `wingman-fd-shared`.
- Each workspace DB name is `wingman-fd-ws-${workspaceDbKey}`.
- `workspaceDbKey` is usually the normalized `workspaceKey`, not just the owner npub.
- `buildWorkspaceKey()` prefers `service:<serviceNpub>::workspace:<owner>` and falls back to `url:<directHttpsUrl>::workspace:<owner>` or plain `workspace:<owner>`.
- This means the same workspace owner can map to separate local DBs when the service identity or backend URL differs.
- `knownWorkspaces` entries in shared `app_settings` preserve the metadata needed to reopen the correct workspace DB later.

## Dexie Schema

### Shared DB

The shared DB is currently on schema version 2.

| Table | Primary key / index | Current role |
| --- | --- | --- |
| `app_settings` | `++id` | Single persisted settings row for backend URL, selected workspace, known workspaces, known hosts, imported token, and similar client preferences |
| `storage_image_cache` | `&object_id, cached_at` | Blob cache for storage-backed images with LRU-style eviction |
| `profiles` | `pubkey` | 24-hour Nostr profile cache |
| `address_book` | `npub, last_used_at` | Mention and identity suggestion cache |
| `workspace_keys` | `&workspace_owner_npub, user_npub, ws_key_npub` | Cached encrypted workspace session-key blobs plus registration flag |

Important nuance:

- `storage_image_cache` is keyed by the stored `object_id` string, but the app usually writes a backend-aware composite cache key produced by `storageImageCacheKey(objectId, backendUrl)`.
- The image resolver still falls back to the raw object id for older cache entries, then rewrites them under the backend-aware key.

### Workspace DB

The workspace DB is currently on schema version 6.

| Table | Primary key / key fields | Current role |
| --- | --- | --- |
| `workspace_settings` | `&workspace_owner_npub` | Workspace profile row plus harness URL and trigger definitions |
| `channels` | `record_id`, `*group_ids`, `scope_id`, `scope_l1_id`...`scope_l5_id` | Chat containers |
| `chat_messages` | `record_id`, `channel_id`, `parent_message_id`, `updated_at` | Channel and thread messages |
| `groups` | `group_id`, `owner_npub`, `*member_npubs` | Group membership and epoch identity cache from group APIs |
| `documents` | `record_id`, `parent_directory_id`, `scope_id`, `scope_l1_id`...`scope_l5_id` | Document rows |
| `directories` | `record_id`, `parent_directory_id` | Directory rows |
| `reports` | `record_id`, `declaration_type`, `surface`, `generated_at`, `*group_ids`, scope indexes | Generated report rows |
| `tasks` | `record_id`, `parent_task_id`, `state`, `*predecessor_task_ids`, `flow_id`, `flow_run_id`, `flow_step`, scope indexes | Task rows |
| `schedules` | `record_id`, `active`, `repeat` | Schedule rows |
| `comments` | `record_id`, `target_record_id`, `target_record_family_hash`, `parent_comment_id` | Polymorphic threaded comments |
| `audio_notes` | `record_id`, `target_record_id`, `target_record_family_hash`, `transcript_status` | Storage-backed audio attachments |
| `scopes` | `record_id`, `level`, `parent_id`, `l1_id`...`l5_id` | Canonical five-level scope hierarchy |
| `flows` | `record_id`, `scope_id`, `*group_ids`, scope indexes | Flow definitions |
| `approvals` | `record_id`, `flow_id`, `flow_run_id`, `flow_step`, `status`, `approval_mode`, `*group_ids`, `*task_ids`, scope indexes | Flow approval / decision rows |
| `persons` | `record_id`, scope indexes | CRM-style person rows |
| `organisations` | `record_id`, scope indexes | CRM-style organisation rows |
| `pending_writes` | `++row_id`, `record_id`, `record_family_hash`, `created_at` | Local outbox |
| `sync_state` | `key` | Per-workspace sync cursors and worker-derived metadata |
| `sync_quarantine` | `&key`, `family_hash`, `record_id`, `last_seen_at` | Repeatedly skipped inbound records |
| `read_cursors` | `&record_id`, `cursor_key`, `viewer_npub`, `read_until` | Per-viewer unread markers |

## Current Schema Evolution

Workspace DB migrations in `src/db.js` currently evolve like this:

1. v1: original workspace tables
2. v2: added `read_cursors`
3. v3: added `reports`
4. v4: switched scope indexes from legacy semantic slots to canonical `scope_l1_id` through `scope_l5_id`
5. v5: added `flows` and `approvals`
6. v6: added `persons` and `organisations`

Shared DB migrations currently evolve like this:

1. v1: `app_settings`, `storage_image_cache`, `profiles`, `address_book`
2. v2: added `workspace_keys`

There is still a one-time legacy migration path from the old `CoworkerV4` IndexedDB database into the shared DB.

## Sync Families

`src/sync-families.js` registers 15 synced record families:

- `settings`
- `channel`
- `chat_message`
- `directory`
- `document`
- `report`
- `task`
- `schedule`
- `comment`
- `audio_note`
- `scope`
- `flow`
- `approval`
- `person`
- `organisation`

Important as-built boundaries:

- `groups` are not a sync family. They are fetched through the group APIs and materialized into the workspace-local `groups` table separately.
- `workspace_settings` is the only place where shared automation settings live today. Trigger definitions are stored inside that row’s `triggers` array.
- The Jobs UI has Alpine state, but `src/jobs-manager.js` currently marks jobs as unavailable and there is no local `jobs` or `job_runs` Dexie table.

Published schema coverage is currently aligned with the live registry:

- `tests/schema-sync.test.js` expects the same 15 family ids as `SYNC_FAMILY_OPTIONS`.
- The older gap where local code ran ahead of published schema coverage is no longer present in this repo snapshot.

## Materialization Path

The runtime write and read path is:

1. Local edits create or update a workspace row with `sync_status: 'pending'`.
2. The matching outbound translator builds a record envelope.
3. The envelope is stored in `pending_writes`.
4. The worker flushes `pending_writes` to `/api/v4/records/sync` in batches.
5. The worker checks freshness using `/api/v4/records/heartbeat` when available, or falls back to full pulls.
6. Pulled envelopes are dispatched by `record_family_hash` to the matching inbound translator.
7. The translator normalizes transport payloads into local row shapes and the DB helper upserts the row.
8. `sync_state` cursors advance only after a family applies cleanly.
9. Alpine view state is repopulated from Dexie `liveQuery` subscriptions.

SSE is advisory only:

- The worker listens on `/api/v4/workspaces/<owner>/stream`.
- `record-changed` events only identify which families need a pull.
- Actual row data still arrives through the normal records pull and translator path.

## Core Entity Shapes

### Shared-browser entities

| Entity | Storage | Notes |
| --- | --- | --- |
| App settings | `app_settings` | One JSON-like row used for backend URL, selected workspace key, known workspaces, known hosts, connection token, and similar client preferences |
| Known workspace entry | nested in `app_settings.knownWorkspaces` | Normalized by `normalizeWorkspaceEntry()`; includes `workspaceKey`, owner npub, backend URL, service npub, group defaults, wrapped workspace nsec metadata, and connection token |
| Cached storage image | `storage_image_cache` | Persisted as a blob row keyed by raw or backend-aware object id string |
| Cached profile | `profiles` | 24-hour TTL cache of fetched Nostr profile data |
| Address book person | `address_book` | Recent people cache for mentions and identity lookup |
| Workspace key cache | `workspace_keys` | Encrypted workspace-session-key blob plus registration status |

### Workspace-local entities

| Entity | Storage | Current local row characteristics |
| --- | --- | --- |
| Workspace settings | `workspace_settings` | `workspace_name`, `workspace_description`, `workspace_avatar_url`, `wingman_harness_url`, `triggers`, `group_ids`, versioning and sync fields |
| Group | `groups` | Stable `group_id`, rotating `group_npub`, owner, member npubs, API-fetched rather than sync-family-driven |
| Scope | `scopes` | `level`, `parent_id`, canonical lineage slots `l1_id`...`l5_id`, `group_ids` |
| Channel | `channels` | `title`, `participant_npubs`, `group_ids`, `scope_id`, `scope_l1_id`...`scope_l5_id` |
| Chat message | `chat_messages` | `channel_id`, optional `parent_message_id`, `body`, `attachments`, derived `sender_npub` |
| Directory | `directories` | `title`, optional `parent_directory_id`, scope lineage, `scope_policy_group_ids`, normalized `shares`, `group_ids` |
| Document | `documents` | `title`, `content`, optional `parent_directory_id`, scope lineage, `scope_policy_group_ids`, normalized `shares`, `group_ids` |
| Report | `reports` | `title`, `surface`, `generated_at`, raw `metadata`, `declaration_type`, object `payload`, scope lineage, `group_ids` |
| Task | `tasks` | `title`, `description`, `state`, `priority`, `parent_task_id`, `board_group_id`, assignee, schedule date, tags, predecessors, flow linkage, references, shares, scope lineage, `group_ids` |
| Schedule | `schedules` | `title`, `description`, `time_start`, `time_end`, `days`, `timezone`, `assigned_group_id`, `repeat`, `shares`, `group_ids` |
| Comment | `comments` | `target_record_id`, `target_record_family_hash`, optional `parent_comment_id`, optional `anchor_line_number`, `comment_status`, `body`, `attachments` |
| Audio note | `audio_notes` | Target record refs, storage object id, MIME type, duration, transcript fields, summary, `group_ids` |
| Flow | `flows` | `title`, `description`, ordered `steps`, optional `next_flow_id`, scope lineage, `scope_policy_group_ids`, normalized `shares`, `group_ids` |
| Approval | `approvals` | Flow run linkage, `task_ids`, `status`, `approval_mode`, decision fields, artifact refs, optional revision task, scope lineage, normalized `shares`, `group_ids` |
| Person | `persons` | `title`, `description`, `contacts`, `organisation_links`, `augment_please`, `tags`, scope lineage, normalized `shares`, `group_ids` |
| Organisation | `organisations` | `title`, `description`, `positioning`, `contacts`, `person_links`, `augment_please`, `tags`, scope lineage, normalized `shares`, `group_ids` |
| Pending write | `pending_writes` | Outbound record envelope plus family hash and created timestamp |
| Sync state | `sync_state` | `sync_since:<familyHash>` cursors plus derived values like `unread_summary` |
| Sync quarantine | `sync_quarantine` | Family hash, record id, timestamps, skip count, last error context |
| Read cursor | `read_cursors` | Deterministic per-viewer cursors keyed by `cursor_key` and stored under a hashed `record_id` |

## Relationships

- One workspace identity maps to one workspace DB keyed by `workspaceDbKey`.
- One workspace has one logical `workspace_settings` row keyed by `workspace_owner_npub`.
- Scopes form a self-referential tree through `parent_id`.
- Every scope also carries denormalized lineage through `l1_id`...`l5_id`.
- Channels, documents, directories, reports, tasks, flows, approvals, persons, and organisations can all attach to a scope through `scope_id` plus denormalized lineage columns.
- Channels have many chat messages through `channel_id`.
- Chat messages can thread through `parent_message_id`.
- Directories form a tree through `parent_directory_id`.
- Documents belong to a directory through `parent_directory_id`.
- Tasks form a hierarchy through `parent_task_id` and a dependency graph through `predecessor_task_ids`.
- Tasks can be linked to flow execution through `flow_id`, `flow_run_id`, and `flow_step`.
- Approvals link to flows through `flow_id`, `flow_run_id`, and `flow_step`, and to tasks through `task_ids`.
- Comments and audio notes are polymorphic attachments that target another record by `target_record_id` plus `target_record_family_hash`.
- Persons and organisations are linked by arrays on each side: `organisation_links` on person rows and `person_links` on organisation rows.
- Directory, document, task, flow, approval, person, and organisation rows preserve explicit `shares` arrays as part of the local row shape.

## Access And Tenancy Rules

- Workspace ownership is the top-level tenancy boundary. Sync and group APIs are scoped by workspace owner npub.
- The browser persistence boundary is stricter than the UI boundary: shared data lives in `wingman-fd-shared`, while workspace materialization lives in `wingman-fd-ws-<workspaceDbKey>`.
- Group identity is intentionally dual:
  - stable product identity: `group_id`
  - rotating crypto identity: `group_npub`
- Local rows are normalized toward stable `group_id` references when translators can resolve them.
- `normalizeShareGroupRefs()` preserves both stable ids and current `group_npub` values inside share objects.
- Workspace session keys are cached browser-side encrypted blobs and are separate from the real user identity.

Important as-built pruning nuance:

- `comments` do not carry `group_ids`; they are removed only when their target record is pruned.
- `chat_messages` do not carry `group_ids`; they are removed only when their channel is pruned.
- `audio_notes` do carry `group_ids` and are pruned directly.
- `src/access-pruner.js` currently prunes only `channels`, `scopes`, `tasks`, `documents`, `directories`, `reports`, `schedules`, and `audio_notes`.
- `flows`, `approvals`, `persons`, and `organisations` all have local `group_ids`, but they are not in the current prune list and this repo snapshot does not show a second pruning pass for them.

That last point is an as-built fact, not an inferred design intent.

## Read Models And Derived State

The current read-model layer is split between Dexie queries in `src/db.js`, the live-query planner in `src/section-live-queries.js`, and main-thread unread helpers in `src/unread-store.js`.

Current live-query behavior:

- Shared always-on subscription: address book.
- Workspace always-on subscription: flows.
- Section-gated subscriptions: channels, audio notes, directories, documents, tasks, schedules, scopes, reports, pending approvals, persons, and organisations depending on `navSection`.
- Detail subscriptions: selected channel messages, selected task plus task comments, selected document plus doc comments, and selected report.

Memory behavior:

- `clearInactiveSectionData()` in `src/app.js` deliberately clears inactive section arrays from Alpine memory.
- Dexie stays authoritative and repopulates those arrays when the user returns to the section.

Unread model:

- `read_cursors` stores `chat:nav`, `docs:nav`, `tasks:nav`, per-channel, and per-task item cursors.
- The worker precomputes `unread_summary` into `sync_state`.
- `unread-store.js` prefers that worker summary and only falls back to direct DB scans when needed.

Storage image model:

- Resolved images are cached in shared IndexedDB as blobs.
- Memory holds object URLs and a short-lived failure cache.
- Image resolution is backend-aware to avoid colliding object ids across Tower origins.

## Translator And Payload Shape Notes

- Every synced family has an inbound translator and an outbound translator.
- Most families use a payload shape with `data`.
- Reports are different: they materialize from `metadata` plus `data`.
- Group-backed families usually derive local `group_ids` from `record.group_payloads`.
- Docs, tasks, flows, approvals, persons, and organisations also normalize `shares` into richer local rows.
- Schedules still accept the legacy inbound field `assigned_to_npub` and normalize it into `assigned_group_id`.
- Scope levels are canonicalized to `l1` through `l5`, with legacy semantic names like `product`, `project`, and `deliverable` accepted only as compatibility input.

## As-Built Summary

Flight Deck’s implemented data model is a local-first, workspace-partitioned materialized view over Tower records. Its most important current characteristics are:

- one shared browser DB plus one workspace DB per normalized workspace identity
- 15 synced record families plus separately fetched groups
- translator-owned row shaping between Tower envelopes and Dexie tables
- section-scoped Dexie `liveQuery` subscriptions as the main read-model layer
- explicit write-side operational tables: `pending_writes`, `sync_state`, `sync_quarantine`, and `read_cursors`
- trigger definitions stored inside `workspace_settings`, with no separate jobs persistence yet
- a real as-built access-pruning gap: some group-bearing families are materialized with `group_ids` but are not currently included in `access-pruner.js`
