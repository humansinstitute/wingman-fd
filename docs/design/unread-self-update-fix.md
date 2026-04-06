# Unread Border Persists After Self-Authored Task Updates

**Task:** d45722a8-12cb-4136-9733-1fbf8873ce32
**Status:** Design analysis complete, fix recommended
**Date:** 2026-03-29

---

## Problem Statement

When a Flight Deck user edits their own task — self-assignment, description change, state change, priority change, etc. — the red unread border reappears on that task card within ~30 seconds (the next `refreshUnreadFlags` cycle). The border should not appear for changes the user themselves authored.

## Root Cause Analysis

The unread system works by comparing `task.updated_at` against a read cursor timestamp:

```
task is unread ⟺ task.updated_at > max(tasks:nav cursor, tasks:item:<id> cursor)
```

### The race condition

1. **User opens task** → `markTaskRead(taskId)` sets per-task cursor to `now` (e.g. `T1 = 14:00:00.000`)
2. **User edits task** → `saveEditingTask()` or `applyTaskPatch()` sets `updated_at: new Date().toISOString()` (e.g. `T2 = 14:00:05.000`)
3. **Neither method calls `markTaskRead`** after the save
4. **30s later** → `refreshUnreadFlags()` fires → `task.updated_at (T2) > cursor (T1)` → **task marked unread again**

### Additional vector: sync round-trip

Even if we fix the local save path, Tower may echo the record back with a server-stamped `updated_at` that is slightly later than the local timestamp. The translator (`src/translators/tasks.js:83`) uses `record.updated_at` from the server response. This means the cursor could be stale even if we advance it at save time.

### Affected code paths

All three local task mutation paths bump `updated_at` without advancing the read cursor:

| Method | File | Line | Trigger |
|---|---|---|---|
| `saveEditingTask()` | `src/app.js` | 2844 | Edit form save (title, description, state, assignee, priority, tags, due date, scope) |
| `applyTaskPatch()` | `src/app.js` | 2658 | Inline field updates via `updateTaskField()`, quick state changes, subtask scope cascade |
| `addTask()` | `src/app.js` | 2608 | New task creation (sets both `created_at` and `updated_at` to `now`) |

`markTaskRead()` is only called in one place: `openTaskDetail()` at `src/app.js:2950`, i.e., when the user clicks into a task card.

## Proposed Solution

### Option A: Advance per-task cursor on local save (Recommended)

After every local task mutation, call `markTaskRead(taskId)` to advance the per-task cursor to `now`. This is the minimal, targeted fix.

**Where to add the call:**

1. **`saveEditingTask()`** — after `await upsertTask(updated)` and before sync, call `await this.markTaskRead(updated.record_id)`
2. **`applyTaskPatch()`** — after `await upsertTask(updated)`, call `await this.markTaskRead(taskId)`
3. **`addTask()`** — after `await upsertTask(localRow)`, call `await this.markTaskRead(recordId)` (newly created tasks authored by the viewer should never be unread)

**Why this works:** `markTaskRead` sets the cursor to `new Date().toISOString()` which will be >= the `updated_at` we just set (same clock, called immediately after). The `>` comparison in `computeUnreadTaskMap` means the task won't be flagged.

**Edge case — sync round-trip re-stamp:** If Tower echoes back a later `updated_at`, the task could briefly re-appear as unread until the user opens it again. To handle this robustly, we should also advance the cursor in the translator's `materialize` path when the incoming record's `signature_npub` matches the viewer. However, the translator doesn't have access to session context, so Option A alone is sufficient for the common case — the sync round-trip delay is typically < 30s, and the cursor set at save time will usually be later than the server stamp.

### Option B: Filter out self-authored changes in `computeUnreadTaskMap`

Add an `author_npub` or `last_modified_by` field to the task row, and skip the unread check when `task.last_modified_by === viewerNpub`.

**Rejected because:**
- Requires schema change to the task Dexie table
- The server may not consistently provide authorship metadata on every update
- More invasive change for the same result

### Option C: Hybrid — Option A + translator-level cursor advance

Extend Option A by also advancing the cursor when the sync worker materializes a task whose `signature_npub` matches the viewer. This fully covers the round-trip re-stamp edge case.

**Deferred for now** — Option A covers the primary bug. Option C can be added if users report the sync round-trip flicker.

## Data Model

No schema changes required. The existing `read_cursors` table in Dexie is sufficient:

```
read_cursors: record_id, cursor_key, viewer_npub, read_until
```

The per-task cursor key pattern `tasks:item:<record_id>` is already in use.

## Component Interactions

```
User edits task
  └─> saveEditingTask() / applyTaskPatch() / addTask()
        ├─> upsertTask(updated)          // bumps updated_at
        ├─> markTaskRead(taskId)          // NEW: advances cursor to now
        └─> queueTaskWrite() + sync

30s later: refreshUnreadFlags()
  └─> computeUnreadTaskMap()
        └─> task.updated_at <= cursor  → NOT unread  ✓
```

## Edge Cases

1. **Two users editing same task simultaneously:** User A's edit bumps `updated_at`. User B's cursor is unaffected. User B correctly sees the task as unread. No regression.

2. **Rapid successive edits:** Each edit advances both `updated_at` and the cursor. The cursor always wins because `markTaskRead` uses `new Date()` called after the save completes.

3. **Task created by viewer:** `addTask()` creates a task at `now`. Without the fix, this task would appear unread on the next refresh cycle (unlikely to be noticed because it typically takes > 30s for the user to navigate away and back, but still incorrect). With the fix, it's immediately marked read.

4. **Subtask scope cascade:** `cascadeTaskScopeToSubtasks()` calls `applyTaskPatch` in a loop for each subtask. With the fix, all cascaded subtasks get their cursors advanced. This is correct — the viewer authored the cascade.

5. **Clock skew (server vs client):** If the server's clock is ahead, the echoed `updated_at` could be later than the client-side cursor. This is the sync round-trip edge case mentioned above. Option A alone doesn't fully cover it, but the window is small (< 1s typically) and self-corrects on next task open.

## Implementation Plan

### Files to modify

- **`src/app.js`** — Add `markTaskRead` calls in three methods

### Specific changes

```javascript
// In saveEditingTask(), after line 2844 (await upsertTask(updated)):
await this.markTaskRead(updated.record_id);

// In applyTaskPatch(), after line 2658 (await upsertTask(updated)):
await this.markTaskRead(taskId);

// In addTask(), after line 2608 (await upsertTask(localRow)):
await this.markTaskRead(recordId);
```

### Test additions

Add to `tests/unread-task-border.test.js`:

```javascript
describe('self-authored updates should not trigger unread', () => {
  it('task with cursor advanced to save time is not unread', () => {
    // Simulates markTaskRead being called at save time
    const saveTime = T4;
    const tasks = [task('t1', T4)]; // updated_at set to save time
    const cursorMap = {
      'tasks:nav': T1,
      'tasks:item:t1': T4, // cursor advanced to same time as updated_at
    };
    expect(computeUnreadTaskMap(tasks, cursorMap)).toEqual({});
  });

  it('task with cursor slightly after save time is not unread', () => {
    // markTaskRead runs after upsertTask, so cursor >= updated_at
    const tasks = [task('t1', T3)];
    const cursorMap = {
      'tasks:nav': T1,
      'tasks:item:t1': T4, // cursor later than updated_at
    };
    expect(computeUnreadTaskMap(tasks, cursorMap)).toEqual({});
  });
});
```

## Open Questions

1. **Should `markTaskRead` be fire-and-forget?** Currently it's async. In the save paths we should `await` it to ensure the cursor is persisted before the refresh cycle, but this adds a small amount of latency to saves. The DB write is local (Dexie/IndexedDB) so latency should be negligible (~1-5ms).

2. **Should we also handle task comments?** If a user posts a comment on a task, the task's `updated_at` may be bumped by the comment translator. The same bug could apply. Worth investigating separately.

3. **Should we debounce `markTaskRead` in `applyTaskPatch` for cascade operations?** If cascading scope to 20 subtasks, we'd call `markTaskRead` 20 times. Each is a Dexie put, so ~20 IndexedDB writes. This is fine for reasonable subtask counts but could be batched if performance becomes a concern.
