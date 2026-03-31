# Task Update Race Conditions: Root Cause Analysis and Design

**Status:** Draft - awaiting feedback
**Date:** 2026-03-31
**Scope:** wingman-fd task sync, with implications for wingman-tower and wingman-yoke
**Task:** f08949d2-11c6-44c4-9922-869c7d013279

---

## Problem Statement

Users report that task state, assignee, description, and comments can overwrite each other or disappear when multiple task updates happen close together. This affects both single-user rapid edits and multi-client scenarios (FD + Yoke updating the same task).

---

## Root Cause Analysis

### Race 1: No mutex on `performSync` -- concurrent sync cycles

**Location:** `src/sync-manager.js:713`

`performSync()` has no concurrency guard. Every task mutation (`saveEditingTask`, `applyTaskPatch`, `updateTaskField`, `quickSetTaskState`) calls `performSync()` at the end. The background sync timer (`backgroundSyncTick`) also calls it every 1-10 seconds.

If two task edits happen within ~100ms:

```
Edit A: upsertTask(v2) -> addPendingWrite(v2) -> performSync() [starts]
Edit B: upsertTask(v3) -> addPendingWrite(v3) -> performSync() [starts]
```

Both `performSync` calls run concurrently. Both call `flushPendingWrites()` which reads `getPendingWrites()` at roughly the same time, potentially seeing the same set of pending writes. This can lead to:
- **Double-push:** The same envelope is sent twice to Tower
- **Interleaved push/pull:** Sync A pushes v2 then pulls, Sync B pushes v3 then pulls; the pull in Sync A may overwrite v3 in Dexie with the server's v2 response

**Severity:** High. This is the primary cause of data loss.

### Race 2: Optimistic version increment without server confirmation

**Location:** `src/app.js:2711`, `src/app.js:2893`

Both `applyTaskPatch` and `saveEditingTask` compute the next version as:
```js
const nextVersion = (task.version ?? 1) + 1;
```

This reads the current local version and increments it. If two rapid edits both read version N before either sync completes, both produce version N+1 with `previous_version=N`. Tower's version-chain enforcement (`records.ts:128`) will reject the second write:

```
Tower has: v5
Edit A sends: version=6, previous_version=5 -> accepted
Edit B sends: version=6, previous_version=5 -> REJECTED (conflict)
```

**But the client doesn't handle rejections.** The `syncRecords` API call returns `{ rejected: [...] }` but `flushPendingWrites` in `sync-worker.js:136-157` does not inspect the response for rejected records. It removes all pending writes from the batch regardless:

```js
// sync-worker.js:159-161
for (const pw of batch) {
  await removePendingWrite(pw.row_id);
}
```

This means rejected writes are silently dropped -- the local Dexie row shows v6 but Tower only has v5. The next pull overwrites local with Tower's v5, undoing the user's edit.

**Severity:** Critical. This is the root cause of "disappearing" edits.

### Race 3: Full-record write model causes field-level stomping

**Location:** `src/app.js:2894-2913`, `src/translators/tasks.js:91+`

Every task save sends the complete record to Tower. There is no field-level patching or merge. If two clients edit different fields concurrently:

```
Client A: changes state from "new" to "in_progress" (sends full record)
Client B: changes description (sends full record with state="new")
```

Whichever write has a higher version wins entirely. The loser's field change is lost even though the fields don't overlap. This is by design in the current whole-record sync model, but it amplifies the impact of races 1 and 2.

**Severity:** Medium. Architectural constraint, not a bug per se.

### Race 4: `refreshTasks()` after sync can revert in-flight edits

**Location:** `src/app.js:2939`, `src/app.js:2847`

After `performSync`, several flows call `refreshTasks()` which reads all tasks from Dexie and replaces `this.tasks`. If a sync pull materialized an older server version into Dexie (because the latest local version hasn't been pushed yet), `refreshTasks` replaces the in-memory task list with the stale Dexie data, reverting the UI.

Timeline:
1. User edits task -> local Dexie has v6 (pending), in-memory has v6
2. Background sync pulls -> materializes v5 from Tower into Dexie (overwrites v6!)
3. `refreshTasks()` reads Dexie -> gets v5 -> replaces in-memory v6

**Severity:** High. The pull overwrites un-synced local edits in Dexie.

### Race 5: `editingTask` stale reference during concurrent saves

**Location:** `src/app.js:2880-2940`

`saveEditingTask` reads `this.editingTask` to build the update. If two saves are triggered rapidly (e.g., user clicks state change then immediately edits description):

1. Save A reads `editingTask` with state="in_progress", builds update
2. Save A sets `this.editingTask = { ...updated }` (line 2917)
3. Save B fires before Save A's sync completes
4. Save B reads the updated `editingTask` from step 2 -- this is fine for sequential saves
5. But if Save A's sync pull results in `refreshTasks()` updating `this.tasks` before Save B reads it, Save B may operate on stale data

This is a lesser concern compared to Race 1-4 but contributes to field stomping.

**Severity:** Low-Medium.

### Race 6: Comments share the same race window

Comments use the same pattern: `upsertComment` -> `addPendingWrite` -> `performSync`. All the same races apply. Additionally, comments reference `target_record_id` so a task version rollback doesn't directly affect comment content, but comment ordering and duplicate pushes are possible.

**Severity:** Medium.

---

## Evidence from Code

| File | Line | Issue |
|------|------|-------|
| `sync-manager.js` | 713 | `performSync` has no mutex/lock |
| `sync-worker.js` | 159-161 | Pending writes removed without checking rejection status |
| `sync-worker.js` | 216-220 | `materializeRecordForFamily` unconditionally overwrites Dexie rows |
| `app.js` | 2711, 2893 | Version computed from local state without server round-trip |
| `app.js` | 2939, 2847 | `refreshTasks` after sync replaces in-memory state from Dexie |
| `records.ts` | 128-134 | Tower enforces version chain -- rejects stale `previous_version` |
| `api.js` | 407 | `syncRecords` response (including rejections) is not inspected by caller |

---

## Proposed Fixes

### Fix 1: Add a sync mutex (High priority)

Add a simple promise-based mutex so only one `performSync` runs at a time. Subsequent calls queue behind the current one.

```js
// sync-manager.js
_syncPromise: null,

async performSync(options) {
  if (this._syncPromise) {
    // Wait for current sync to finish, then run again
    await this._syncPromise.catch(() => {});
    // Don't stack -- if another caller already queued, bail
    if (this._syncPromise) return this._syncPromise;
  }
  this._syncPromise = this._doPerformSync(options);
  try {
    return await this._syncPromise;
  } finally {
    this._syncPromise = null;
  }
}
```

**Trade-off:** Slightly slower for burst edits, but prevents all double-push and interleave issues.

### Fix 2: Handle rejected records from Tower (Critical)

After `syncRecords` returns, inspect the `rejected` array. For each rejected record:

1. Do NOT remove its pending write
2. Re-read the server version via pull
3. Attempt to re-apply the local change on top of the new server version (auto-merge for non-conflicting fields, or flag as conflict)

Minimal version (no auto-merge):
```js
// sync-worker.js flushPendingWrites
const result = await syncRecords({ owner_npub: ownerNpub, records: envelopes });
const rejectedIds = new Set((result.rejected || []).map(r => r.record_id));

for (const pw of batch) {
  if (rejectedIds.has(pw.envelope.record_id)) {
    // Leave pending write in place -- next sync cycle will re-attempt
    // after pulling the latest version
    continue;
  }
  await removePendingWrite(pw.row_id);
}
```

**Trade-off:** Rejected writes will retry on next cycle. Need to cap retry count to avoid infinite loops.

### Fix 3: Protect local pending records during pull (High priority)

When materializing inbound records, check if the local record has `sync_status === 'pending'`. If so, do not overwrite it -- the local pending version should take precedence until it's been pushed.

```js
// sync-worker.js materializeRecordForFamily
if (family === TASK_FAMILY) {
  const row = await inboundTask(record);
  const existing = await getTaskById(row.record_id);
  if (existing?.sync_status === 'pending' && (existing.version ?? 0) >= (row.version ?? 0)) {
    // Local pending edit is newer -- skip server version
    return;
  }
  await upsertTask(row);
}
```

**Trade-off:** Adds a read-before-write per record during pull. Could be optimized by batch-checking pending record IDs before the pull loop.

### Fix 4: Rebase pending writes on version conflict (Medium priority)

When a pending write is rejected due to version conflict, automatically rebase:

1. Pull the latest server version
2. Merge: take the pending write's changed fields and apply them on top of the server version
3. Re-queue with the correct `version` and `previous_version`

This requires tracking which fields the user actually changed (a "dirty fields" set) rather than sending the full record. This is a larger architectural change.

**Alternative:** For now, implement a simpler "last-write-wins with retry" where the pending write re-reads the server version, bumps the version, and re-sends the full record. This loses the other client's changes but is simpler and matches current semantics.

### Fix 5: Debounce rapid saves (Low priority, UX improvement)

Add a short debounce (300-500ms) on `saveEditingTask` to coalesce rapid field changes into a single write. This reduces the frequency of conflicts without fixing the underlying race.

---

## Recommended Implementation Order

1. **Fix 1 (sync mutex)** -- Eliminates concurrent sync corruption. Low risk, high impact.
2. **Fix 2 (handle rejections)** -- Stops silent data loss from rejected writes. Medium complexity.
3. **Fix 3 (protect pending during pull)** -- Prevents pull from overwriting unsaved local edits. Medium complexity.
4. **Fix 5 (debounce)** -- Quick UX win that reduces conflict frequency.
5. **Fix 4 (rebase/merge)** -- Full solution but higher complexity. Can be deferred.

Fixes 1-3 together address the critical data loss scenarios. Fix 4 improves multi-client collaboration but is a larger effort.

---

## Data Model Impact

No schema changes required for fixes 1-3. Fix 4 would benefit from:
- A `dirty_fields` column or transient property on pending writes to track which fields changed
- A `conflict_state` field on task rows to surface unresolved conflicts to the UI

---

## API Contract Impact

No Tower API changes required. The existing `rejected` array in sync responses already provides the information needed for Fix 2. The client just needs to start reading it.

---

## Edge Cases

1. **Offline edits:** Multiple pending writes for the same record_id accumulate. On reconnect, they're sent in order but each expects the previous to have succeeded. If the first is rejected, all subsequent ones will also fail. Fix 2 handles this.

2. **Subtask cascade:** `cascadeTaskScopeToSubtasks` generates multiple `queueTaskWrite` calls in a loop. Without the mutex, these can interleave with background sync.

3. **Comment-on-deleted-task:** If a task is deleted while a comment is being added, the comment's pending write may reference a deleted record. Tower should handle this gracefully (and does -- comments are independent records).

4. **Yoke concurrent writes:** Yoke uses the same Tower sync API with version chaining. If FD and Yoke both edit the same task, the same version conflict applies. The fix needs to work for both clients.

---

## Open Questions

1. **Should we implement field-level merge (Fix 4) or is last-write-wins acceptable?** Field-level merge is more correct but significantly more complex. For a small team, last-write-wins with proper conflict detection may be sufficient.

2. **Should conflict resolution be automatic or user-facing?** A conflict UI ("Your edit conflicts with a remote change -- which version do you want?") is more correct but adds UX complexity.

3. **Should the sync mutex be per-workspace or global?** Currently there's one Alpine store, so global is fine. If multi-workspace tabs are added later, it should be per-workspace.

4. **Is there a maximum retry count for rejected writes?** Suggest 3 retries before quarantining the pending write and surfacing it in the sync quarantine UI.

---

## Testing Strategy

- Unit test: sync mutex prevents concurrent `performSync` execution
- Unit test: `flushPendingWrites` preserves rejected writes' pending status
- Unit test: `materializeRecordForFamily` skips pending local records
- Integration test: rapid-fire task edits all arrive at Tower in order
- Integration test: FD + Yoke concurrent edit produces correct final state
