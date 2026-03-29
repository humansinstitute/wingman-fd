import { describe, expect, it } from 'vitest';
import { computeUnreadTaskMap, hasUnreadTasks } from '../src/unread-store.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const T1 = '2026-03-25T10:00:00.000Z';
const T2 = '2026-03-25T11:00:00.000Z';
const T3 = '2026-03-25T12:00:00.000Z';
const T4 = '2026-03-25T13:00:00.000Z';
const T5 = '2026-03-25T14:00:00.000Z';

const VIEWER = 'npub_viewer';
const OTHER = 'npub_other';

function task(id, updatedAt, state = 'active', opts = {}) {
  return {
    record_id: id,
    updated_at: updatedAt,
    record_state: state,
    owner_npub: opts.owner_npub ?? OTHER,
    created_at: opts.created_at ?? updatedAt,
  };
}

// ---------------------------------------------------------------------------
// markAllTasksRead — behavioral tests via computeUnreadTaskMap
//
// markAllTasksRead advances tasks:nav to "now", which should clear all
// per-task unread indicators since updated_at <= now for every task.
// ---------------------------------------------------------------------------

describe('markAllTasksRead effect on computeUnreadTaskMap', () => {
  it('advancing tasks:nav to now clears all unread indicators', () => {
    const tasks = [
      task('t1', T3),
      task('t2', T4),
      task('t3', T2),
    ];
    // Before: tasks:nav at baseline T1, all tasks newer → unread
    const beforeCursors = { 'tasks:nav': T1 };
    expect(computeUnreadTaskMap(tasks, beforeCursors)).toEqual({
      t1: true,
      t2: true,
      t3: true,
    });

    // After: tasks:nav advanced to T5 (now) — all tasks older → read
    const afterCursors = { 'tasks:nav': T5 };
    expect(computeUnreadTaskMap(tasks, afterCursors)).toEqual({});
  });

  it('advancing tasks:nav clears unread even when per-task cursors exist', () => {
    const tasks = [
      task('t1', T3),
      task('t2', T4),
    ];
    // t1 has per-task cursor at T2 (still unread), t2 has none
    const beforeCursors = { 'tasks:nav': T1, 'tasks:item:t1': T2 };
    expect(computeUnreadTaskMap(tasks, beforeCursors)).toEqual({
      t1: true,
      t2: true,
    });

    // After mark all read: tasks:nav at T5 supersedes per-task cursors
    const afterCursors = { 'tasks:nav': T5, 'tasks:item:t1': T2 };
    expect(computeUnreadTaskMap(tasks, afterCursors)).toEqual({});
  });

  it('hasUnreadTasks returns false after mark-all clears the map', () => {
    // After markAllTasksRead, the unread map is empty → no nav dot
    expect(hasUnreadTasks({})).toBe(false);
  });

  it('new tasks arriving after mark-all-read show as unread', () => {
    // After marking all read at T5, a new task arrives with updated_at > T5
    const T6 = '2026-03-25T15:00:00.000Z';
    const tasks = [
      task('t1', T3), // before T5 → read
      task('t_new', T6), // after T5 → unread
    ];
    const cursors = { 'tasks:nav': T5 };
    expect(computeUnreadTaskMap(tasks, cursors)).toEqual({ t_new: true });
  });
});

// ---------------------------------------------------------------------------
// Read cursor sync verification
//
// read_cursors is a local-only Dexie table NOT registered in sync families.
// This means cursors do NOT sync across devices — they are device-local.
// These tests document and verify that expectation.
// ---------------------------------------------------------------------------

describe('read cursor sync status', () => {
  it('read_cursors is not a sync family', async () => {
    const { SYNC_FAMILY_OPTIONS } = await import('../src/sync-families.js');
    const familyTables = SYNC_FAMILY_OPTIONS.map((f) => f.table);
    expect(familyTables).not.toContain('read_cursors');
  });

  it('read_cursors table does not appear in any sync family id', async () => {
    const { SYNC_FAMILY_OPTIONS } = await import('../src/sync-families.js');
    const familyIds = SYNC_FAMILY_OPTIONS.map((f) => f.id);
    expect(familyIds).not.toContain('read_cursor');
    expect(familyIds).not.toContain('read_cursors');
  });
});

// ---------------------------------------------------------------------------
// markAllTasksRead method contract
// ---------------------------------------------------------------------------

describe('markAllTasksRead method contract', () => {
  it('should be exported from unread-store', async () => {
    const mod = await import('../src/unread-store.js');
    expect(mod.unreadStoreMixin.markAllTasksRead).toBeTypeOf('function');
  });

  it('should clear _unreadTaskItems and _unreadTasks when called', async () => {
    // This tests the mixin method in isolation with a mock context
    const mod = await import('../src/unread-store.js');
    const mockCtx = {
      session: { npub: VIEWER },
      _unreadTaskItems: { t1: true, t2: true },
      _unreadTasks: true,
      async markSectionRead(section) {
        this._markSectionReadCalled = section;
      },
      async refreshUnreadFlags() {
        // no-op in test
      },
    };

    await mod.unreadStoreMixin.markAllTasksRead.call(mockCtx);

    expect(mockCtx._markSectionReadCalled).toBe('tasks');
    expect(mockCtx._unreadTaskItems).toEqual({});
    expect(mockCtx._unreadTasks).toBe(false);
  });

  it('should be a no-op when no session npub', async () => {
    const mod = await import('../src/unread-store.js');
    const mockCtx = {
      session: null,
      _unreadTaskItems: { t1: true },
      _unreadTasks: true,
    };

    await mod.unreadStoreMixin.markAllTasksRead.call(mockCtx);

    // Should not have changed anything
    expect(mockCtx._unreadTaskItems).toEqual({ t1: true });
    expect(mockCtx._unreadTasks).toBe(true);
  });
});
