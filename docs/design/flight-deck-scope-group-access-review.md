# Flight Deck Scope, Group, Share & Access Review

**Date:** 2026-03-31
**Task:** `d1f664b1-d79c-45fc-ac56-aeb10d02041c`
**Scope:** `8c87556f-e48d-427a-851e-aa380e25ad60`
**Status:** Review — no code changes proposed yet

---

## 1. Problem Statement

Scope, group, share, and access control span Flight Deck (browser client) and Tower (authority backend) with multiple interacting subsystems: group creation and membership, epoch-based key rotation, scope hierarchy, record-level sharing, client-side access pruning, and server-side read/write authorization. Before making changes, we need a clear picture of how these pieces fit together, where the seams are inconsistent, and which risks should be addressed first.

---

## 2. How It Works Today

### 2.1 Groups — Creation and Membership

**Tower side** (`wingman-tower/src/services/groups.ts`, `routes/groups.ts`):

- A group is created with an `owner_npub`, `name`, `group_npub` (crypto identity), `group_kind` (`workspace_shared`, `private`, or `shared`), and an optional `private_member_npub`.
- Each group starts at **epoch 1** with one epoch row in `v4_group_epochs`.
- Members are enrolled in `v4_group_members` and receive wrapped keys in `v4_group_member_keys` at `key_version = 1`.
- Route-level authorization: only `owner_npub` or the workspace creator (`canManageWorkspace()`) can mutate groups.

**Flight Deck side** (`wingman-fd/src/channels-manager.js`):

- `createEncryptedGroup()` generates a new Nostr keypair (`createGroupIdentity()`), wraps the private key for each member, and calls Tower's `POST /api/v4/groups`.
- The group is stored locally in Dexie `groups` table (indexed by `group_id`, `owner_npub`, `*member_npubs`).

**Workspace bootstrap** (`wingman-tower/src/services/workspaces.ts`):

- `createWorkspace()` creates two groups in a transaction:
  1. **Default shared group** (`workspace_shared`) — all workspace members.
  2. **Private group** (`private`) — scoped to the creator with `private_member_npub`.
- The workspace row stores `default_group_id`.

### 2.2 Epoch Rotation

**Tower** (`services/groups.ts:rotateGroupEpoch`):

1. Calculates `nextEpoch = max(epoch) + 1`.
2. Marks the previous epoch as `superseded_at = NOW()`.
3. Inserts a new epoch row with a **new `group_npub`** (new keypair).
4. Deletes members not in the new roster from `v4_group_members`.
5. Issues new wrapped keys at `key_version = nextEpoch`.
6. Updates `v4_groups.group_npub` to the new value.

**Effect on records:**
- Old record payloads reference the old epoch's `group_npub` and `group_epoch`.
- The read-path join (`gmk.key_version = rgp.group_epoch AND gmk.revoked_at IS NULL`) controls whether a member can still decrypt a given payload.
- Removed members have all keys set to `revoked_at = NOW()`, blocking both old and new payload access.

### 2.3 Scope Hierarchy (l1–l5)

**Structure:** Scopes use a generic 5-level hierarchy (`l1` through `l5`). Each scope row carries `level`, `parent_id`, and precomputed lineage fields `l1_id` through `l5_id`.

**Flight Deck scope translator** (`translators/scopes.js`):
- Inbound: extracts `group_ids` from `record.group_payloads`.
- Outbound: takes `group_ids` array, builds encrypted `group_payloads` via `buildGroupPayloads()`.

**Scope creation** (`scopes-manager.js`):
- User assigns groups to a scope via `newScopeAssignedGroupIds`.
- At least one group is required.
- `shares` are built from group IDs via `buildScopeDefaultShares()`.
- The scope row stores `group_ids: [...]` and `shares: [...]`.

**Task board filtering** (`task-board-scopes.js`, `task-board-state.js`):
- Tasks are filtered to boards by matching their scope lineage at the board scope's depth.
- `matchesTaskBoardScope()` checks `refs[l${depth}Id] === boardScope.record_id`.
- Descendant inclusion is toggled by `showBoardDescendantTasks`.

### 2.4 Record-Level Sharing (Shares Model)

Records (tasks, documents, scopes) carry a `shares` array with entries like:

```json
{
  "type": "group" | "person",
  "group_npub": "...",
  "via_group_npub": "...",
  "access": "read" | "write",
  "npub": "..."
}
```

**How shares map to group payloads** (`translators/docs.js:buildGroupPayloads`):
- Each share entry contributes a `group_npub` to the group payload list.
- `access: 'write'` sets `can_write = true` on that group's payload.
- Person-type shares resolve through `via_group_npub`.

**Tasks translator** (`translators/tasks.js`):
- Inbound: extracts `group_ids` from `group_payloads`, normalizes `shares` and `board_group_id` via `buildGroupRefMap`.
- Outbound: re-encrypts for all groups derived from shares.

### 2.5 Server-Side Write Authorization

**Tower record sync** (`services/records.ts:syncRecords`):

Three gates for non-owner writes:

1. **Group write proof** — client provides a NIP-98 token signed by the group's current `group_npub`. Tower verifies it matches the current epoch.
2. **Membership check** — `authNpub` must exist in `v4_group_members` for the write group.
3. **Record-level write permission**:
   - New records (v1): must include a writable `group_payload` for the write group.
   - Updates: the prior version must have a `v4_record_group_payloads` row with `can_write = TRUE` for the write group.

Additional enforcements:
- `owner_npub` must match the workspace.
- `signature_npub` must match `authNpub`.
- Version chain: `previous_version` must equal current latest, `version` must be `current + 1`.

### 2.6 Server-Side Read Authorization

**Tower record fetch** (`services/records.ts:fetchRecords`):

- Owner (`viewerNpub === ownerNpub`) sees everything.
- Non-owners: visibility requires a `v4_record_group_payloads` row where the viewer holds a non-revoked key at the matching `group_epoch`.

```sql
JOIN v4_group_member_keys gmk
  ON gmk.group_id = rgp.group_id
 AND gmk.key_version = rgp.group_epoch
 AND gmk.member_npub = ${viewerNpub}
 AND gmk.revoked_at IS NULL
```

### 2.7 Client-Side Access Pruning

**Access pruner** (`access-pruner.js`):

- Runs on login (immediate) and during sync (hourly cooldown).
- Owner skips pruning entirely.
- Builds `accessibleGroupIds` set from local groups where viewer is a member.
- Scans `GROUP_BEARING_TABLES` (channels, scopes, tasks, documents, directories, reports, schedules, audio_notes).
- Records with empty `group_ids` are treated as always accessible.
- Cascade-deletes: messages of pruned channels, comments of pruned records.

### 2.8 Storage Access Control

**Tower storage** (`services/storage.ts`):

- **Upload auth**: workspace creator can upload workspace-owned objects; group members can upload group-owned objects.
- **Download auth** (`canAccessStorageObject()`):
  1. `is_public` → accessible by anyone.
  2. `owner_npub` or `created_by_npub` match → accessible.
  3. Workspace creator → accessible.
  4. Otherwise: must be member of at least one group in `access_group_ids`.

---

## 3. Identified Inconsistencies and Risks

### 3.1 Dual Identity for Groups: `group_id` vs `group_npub`

**Observation:** Groups are referenced by both stable UUID (`group_id`) and rotating crypto identity (`group_npub`). Both appear in `group_ids` arrays, shares, write-group references, and payload lookups.

**Risk:** Throughout the codebase, `resolveGroupId()` attempts to normalize, but there are paths where `group_npub` is stored as the canonical reference (e.g., `group_ids` extracted from `group_payloads` via `gp.group_id || gp.group_npub`). After an epoch rotation, `group_npub` changes, but old records still reference the old `group_npub` in their `group_ids` array. This creates:

- **Stale local references**: Dexie rows may contain old `group_npub` values in `group_ids` that no longer match the current group identity.
- **Pruner false positives**: The access pruner checks `record.group_ids` against `accessibleGroupIds`, which includes both `group_id` and `group_npub`. If a record only stored the old `group_npub` and the group has since rotated, the pruner might incorrectly remove it — unless the old `group_npub` is still in the accessible set. Currently `buildAccessibleGroupIds` only adds `group.group_npub` (current), not historical npubs.
- **Inconsistent normalization**: Some translators prefer `group_id`, others fall back to `group_npub`. The mapping depends on whether Tower returned a resolved `group_id` in the payload.

**Severity:** Medium-High. This is the most architecturally fragile seam.

**Recommendation:** Ensure all local `group_ids` arrays are normalized to stable UUIDs during inbound translation. Add a migration or repair pass that replaces stale `group_npub` references with `group_id`. Consider making the access pruner match against all known historical `group_npub` values, not just the current one.

### 3.2 Access Pruner Does Not Cover All Child Record Types

**Observation:** `GROUP_BEARING_TABLES` lists 8 tables. Cascade covers messages (via channel) and comments (via target). But:

- **`chat_messages`** are not in `GROUP_BEARING_TABLES` — they rely on channel cascade only.
- **`comments`** are not in `GROUP_BEARING_TABLES` — they rely on target cascade only.
- **`settings`** and **`workspace_settings`** are not pruned.

**Risk:** If a comment's target record is not itself in the pruned set (e.g., target is a record the viewer still has access to, but the comment was shared to a different group), the comment survives pruning when it should not. Comments don't carry their own `group_ids` — they inherit from the target. If the target is accessible but the comment was written in a group context the viewer lost access to, the comment persists locally even though the viewer can no longer decrypt it.

**Severity:** Low-Medium. In practice, comments are tied to their target's access, but this assumption may break if comments become independently shared.

**Recommendation:** Document the cascade assumption explicitly. If comments ever gain independent group scoping, revisit the pruner.

### 3.3 Empty `group_ids` = Always Accessible

**Observation:** `isInaccessible()` returns `false` for records with empty or missing `group_ids`. This means unscoped records are visible to all workspace members.

**Risk:** If a record accidentally loses its `group_ids` (bug in translator, bad sync payload, or version conflict), it becomes globally visible within the workspace. This is a fail-open design.

**Severity:** Medium. Intentional for backward compatibility, but could leak data if groups are stripped.

**Recommendation:** Consider adding a `visibility` flag or distinguishing between "intentionally unscoped" and "missing groups due to error". At minimum, add observability (log warnings) when records transition from grouped to ungrouped.

### 3.4 Tower Read Auth: `key_version = group_epoch` Join

**Observation:** The read-path join requires an exact match between the member's `key_version` and the payload's `group_epoch`. This is correct for forward secrecy but has an edge case:

**Risk:** When a member is added mid-lifecycle, they receive a key at the current epoch (e.g., epoch 3). They cannot see records encrypted at epochs 1 or 2 — even if the group's membership hasn't changed and the records are still semantically "shared" with the same group. This is by design for crypto correctness, but it may surprise users who expect a new team member to see all historical records in a shared group.

**Severity:** Low. This is a correct security property, but it's a UX gap that may need documentation or a re-encryption workflow.

**Recommendation:** Document this behavior. Consider a "re-share" or "re-encrypt" workflow for groups that want to grant historical access to new members.

### 3.5 Scope Group Assignment Is Disconnected from Task Group Assignment

**Observation:** Scopes carry their own `group_ids`. Tasks inherit group context from their board assignment via `buildTaskBoardAssignment()` and `getTaskBoardWriteGroup()`. But:

- A task's `group_ids` come from its `shares` array, which is built at creation time.
- If a scope's groups change later, existing tasks under that scope are not automatically re-shared.
- The scope's `group_ids` and the task's `group_ids` can drift apart.

**Risk:** A user removes a group from a scope, expecting tasks to become invisible to that group. But existing tasks retain their original `group_ids`. The scope is hidden, but the tasks remain accessible.

**Severity:** Medium. This is a consistency gap that could confuse users managing access at the scope level.

**Recommendation:** Either: (a) propagate scope group changes to child tasks, or (b) clearly document that scope group changes only affect new tasks, and provide a "re-sync access" action for bulk updates.

### 3.6 `board_group_id` Normalization Fragility

**Observation:** Tasks carry a `board_group_id` that determines which group context they belong to on the board. `normalizeTaskRowGroupRefs()` in `task-board-state.js` resolves this against the current group list. If the group is deleted or rotated and the reference isn't found, it falls through to the raw value.

**Risk:** Orphaned `board_group_id` references after group deletion. Tasks with stale `board_group_id` may not appear on any board or may error during write operations.

**Severity:** Low-Medium. Edge case but affects usability.

**Recommendation:** Add a repair step during sync that clears or remaps `board_group_id` when the referenced group no longer exists.

### 3.7 Storage Access Uses `group_id` Only, Not `group_npub`

**Observation:** `canAccessStorageObject()` checks `access_group_ids` via a direct UUID array match in `v4_group_members`. It does not use the epoch-gated join that records use.

**Risk:** This is actually simpler and more resilient — group membership is checked directly, not through epoch keys. But it means:
- A member removed from a group immediately loses storage access (correct).
- A member added at a later epoch can access storage objects shared to that group even if they were uploaded before the member joined (different from record behavior).

**Severity:** Low. The inconsistency between record access (epoch-gated) and storage access (membership-gated) is intentional but should be documented.

**Recommendation:** Document the difference. If storage objects need the same forward-secrecy guarantees as records, the storage ACL model would need epoch awareness.

### 3.8 `write_group_npub` vs `write_group_id` Ambiguity

**Observation:** The sync payload accepts either `write_group_id` (UUID) or `write_group_npub` (Nostr npub). `resolveWriteGroup()` in Tower tries both. Flight Deck's `buildWriteGroupFields()` uses a heuristic (`looksLikeUuid`) to decide which field to set.

**Risk:** If a `group_npub` happens to look like a UUID (unlikely but not impossible with certain encoding), the wrong resolution path would be taken. More practically, if the client sends a stale `group_npub` after rotation, `resolveWriteGroup()` joins on `g.group_npub = ${writeGroupNpub}` against the groups table's current `group_npub`. A rotated group would not match, causing a write rejection.

**Severity:** Low. The write rejection is correct behavior, but the error message may be confusing.

**Recommendation:** Prefer `write_group_id` over `write_group_npub` in all Flight Deck outbound code. The UUID is stable across rotations.

---

## 4. Data Model Summary

### Tower Schema (key tables)

| Table | Key Fields | Purpose |
|-------|-----------|---------|
| `v4_workspaces` | `workspace_owner_npub`, `creator_npub`, `default_group_id` | Workspace identity and bootstrap |
| `v4_groups` | `id`, `owner_npub`, `group_npub`, `group_kind`, `private_member_npub` | Group identity, current crypto npub |
| `v4_group_epochs` | `group_id`, `epoch`, `group_npub`, `superseded_at` | Key rotation history |
| `v4_group_members` | `group_id`, `member_npub` | Current membership |
| `v4_group_member_keys` | `group_id`, `member_npub`, `key_version`, `wrapped_group_nsec`, `revoked_at` | Wrapped keys per epoch |
| `v4_records` | `record_id`, `owner_npub`, `record_family_hash`, `version`, `owner_ciphertext` | Record versions |
| `v4_record_group_payloads` | `record_row_id`, `group_id`, `group_epoch`, `group_npub`, `ciphertext`, `can_write` | Per-group encrypted payloads |
| `v4_storage_objects` | `owner_npub`, `owner_group_id`, `access_group_ids`, `is_public` | Storage ACL |

### Flight Deck Dexie Schema (key tables)

| Table | Key Indexes | Group/Scope Fields |
|-------|------------|-------------------|
| `channels` | `record_id`, `*group_ids` | `group_ids`, `scope_l1_id`–`scope_l5_id` |
| `tasks` | `record_id`, `*group_ids` | `group_ids`, `board_group_id`, `shares`, `scope_id`, `scope_l1_id`–`scope_l5_id` |
| `scopes` | `record_id`, `level`, `parent_id` | `group_ids`, `shares`, `l1_id`–`l5_id` |
| `documents` | `record_id`, `*group_ids` | `group_ids`, `shares`, `scope_l1_id`–`scope_l5_id` |
| `groups` | `group_id`, `*member_npubs` | `group_npub`, `member_npubs` |

---

## 5. Component Interaction Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    Flight Deck (Browser)                 │
│                                                         │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────┐ │
│  │ Scopes   │  │ Task Board   │  │ Channels Manager  │ │
│  │ Manager  │  │ State        │  │ (Chat)            │ │
│  │          │  │              │  │                   │ │
│  │ group_ids│  │ board_group  │  │ group_ids         │ │
│  │ shares   │  │ shares       │  │ participant_npubs │ │
│  └────┬─────┘  └──────┬───────┘  └────────┬──────────┘ │
│       │               │                    │            │
│       ▼               ▼                    ▼            │
│  ┌────────────────────────────────────────────────┐     │
│  │           Translators (per family)             │     │
│  │  inbound: group_payloads → group_ids + shares  │     │
│  │  outbound: group_ids/shares → group_payloads   │     │
│  └───────────────────┬────────────────────────────┘     │
│                      │                                  │
│  ┌───────────────────▼────────────────────────────┐     │
│  │           Crypto Layer (group-keys.js)          │    │
│  │  encrypt/decrypt via group_npub + epoch         │    │
│  │  NIP-98 write proofs signed by group nsec       │    │
│  └───────────────────┬────────────────────────────┘     │
│                      │                                  │
│  ┌───────────────────▼────────────────────────────┐     │
│  │    Sync Worker + Access Pruner                  │    │
│  │  push: pending_writes → Tower                   │    │
│  │  pull: Tower → Dexie (via translators)          │    │
│  │  prune: remove records outside viewer's groups  │    │
│  └───────────────────┬────────────────────────────┘     │
└──────────────────────┼──────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────┐
│                      Tower (Backend)                      │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │  Workspaces  │  │   Groups     │  │   Records     │  │
│  │  default_grp │  │  epochs      │  │  version chain│  │
│  │  creator     │  │  members     │  │  group_payloads│ │
│  └──────────────┘  │  wrapped keys│  │  write auth   │  │
│                    └──────────────┘  │  read filter   │  │
│                                      └───────────────┘  │
│  ┌──────────────┐                                        │
│  │   Storage    │                                        │
│  │  owner_group │                                        │
│  │  access_grps │                                        │
│  │  is_public   │                                        │
│  └──────────────┘                                        │
└──────────────────────────────────────────────────────────┘
```

---

## 6. Recommended Next Steps (Prioritized)

### P0 — Before Any Feature Work

1. **Normalize `group_ids` to stable UUIDs**: Audit all inbound translators to prefer `group_id` over `group_npub` in local `group_ids` arrays. Add a Dexie migration or repair pass for existing data. This is the single highest-risk inconsistency.

2. **Access pruner: handle historical `group_npub` values**: Either normalize stored references (see above) or expand the accessible set to include all known historical npubs per group. The current pruner only checks the current `group_npub`.

### P1 — Short-Term Hardening

3. **Document the scope/task group drift behavior**: Make it explicit that changing a scope's groups does not retroactively update tasks. Consider a "re-sync access" bulk action if users need it.

4. **Prefer `write_group_id` in Flight Deck outbound**: Reduces dependence on `group_npub` stability for write authorization. Audit `buildWriteGroupFields()` callers.

5. **Add observability for empty `group_ids`**: Log when a record transitions from having groups to having none. This helps catch translator bugs or bad sync payloads.

### P2 — Future Consideration

6. **Document epoch-gated access for new members**: Users may expect new members to see historical records. A re-encryption workflow or explicit "grant history" action could address this.

7. **Align storage and record access models**: Document the intentional difference (storage uses membership, records use epoch-gated keys). Decide if they should converge.

8. **Review comment access assumptions**: Comments inherit access from their target. If comments ever gain independent sharing, the pruner cascade and Tower read auth need updates.

---

## 7. Open Questions

1. **Should scope group changes propagate to existing child tasks?** This is a product decision. Propagation adds safety but complexity. Not propagating is simpler but may confuse users.

2. **Is the fail-open behavior for empty `group_ids` intentional long-term?** Currently, ungrouped records are visible to all workspace members. Should there be a stricter default?

3. **Do we need a re-encryption workflow for granting historical access?** This is a UX and crypto question. Re-encrypting old records for a new epoch is expensive but may be expected.

4. **Should the access pruner run more frequently than hourly during active collaboration?** If group membership changes during a session, the hourly cooldown means stale records could persist for up to an hour.

5. **Is `board_group_id` still needed as a separate concept from the task's `group_ids` and `shares`?** It adds another dimension of group association that can drift from the primary access model.
