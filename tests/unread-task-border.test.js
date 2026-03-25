import { describe, expect, it } from 'vitest';
import { computeUnreadTaskMap } from '../src/unread-store.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const T1 = '2026-03-25T10:00:00.000Z';
const T2 = '2026-03-25T11:00:00.000Z';
const T3 = '2026-03-25T12:00:00.000Z';
const T4 = '2026-03-25T13:00:00.000Z';

function task(id, updatedAt, state = 'active') {
  return { record_id: id, updated_at: updatedAt, record_state: state };
}

// ---------------------------------------------------------------------------
// computeUnreadTaskMap
// ---------------------------------------------------------------------------

describe('computeUnreadTaskMap', () => {
  it('returns empty map when no tasks:nav cursor exists', () => {
    const tasks = [task('t1', T3)];
    const cursorMap = {};
    expect(computeUnreadTaskMap(tasks, cursorMap)).toEqual({});
  });

  it('returns empty map when tasks list is empty', () => {
    const cursorMap = { 'tasks:nav': T2 };
    expect(computeUnreadTaskMap([], cursorMap)).toEqual({});
  });

  it('marks task as unread when updated_at > tasks:nav cursor', () => {
    const tasks = [task('t1', T3)];
    const cursorMap = { 'tasks:nav': T2 };
    expect(computeUnreadTaskMap(tasks, cursorMap)).toEqual({ t1: true });
  });

  it('does not mark task as unread when updated_at <= tasks:nav cursor', () => {
    const tasks = [task('t1', T1)];
    const cursorMap = { 'tasks:nav': T2 };
    expect(computeUnreadTaskMap(tasks, cursorMap)).toEqual({});
  });

  it('does not mark task as unread when updated_at equals tasks:nav cursor', () => {
    const tasks = [task('t1', T2)];
    const cursorMap = { 'tasks:nav': T2 };
    expect(computeUnreadTaskMap(tasks, cursorMap)).toEqual({});
  });

  it('ignores deleted tasks', () => {
    const tasks = [task('t1', T3, 'deleted')];
    const cursorMap = { 'tasks:nav': T2 };
    expect(computeUnreadTaskMap(tasks, cursorMap)).toEqual({});
  });

  it('respects per-task cursor when it is more recent than nav cursor', () => {
    // Task updated at T3, nav cursor at T2, per-task cursor at T4 (user opened it after update)
    const tasks = [task('t1', T3)];
    const cursorMap = {
      'tasks:nav': T2,
      'tasks:item:t1': T4,
    };
    expect(computeUnreadTaskMap(tasks, cursorMap)).toEqual({});
  });

  it('uses nav cursor when it is more recent than per-task cursor', () => {
    // Task updated at T1, nav cursor at T3, per-task cursor at T2
    // updated_at (T1) <= effective (T3) → not unread
    const tasks = [task('t1', T1)];
    const cursorMap = {
      'tasks:nav': T3,
      'tasks:item:t1': T2,
    };
    expect(computeUnreadTaskMap(tasks, cursorMap)).toEqual({});
  });

  it('marks task unread when updated after both cursors', () => {
    // Task updated at T4, nav cursor at T2, per-task cursor at T3
    const tasks = [task('t1', T4)];
    const cursorMap = {
      'tasks:nav': T2,
      'tasks:item:t1': T3,
    };
    expect(computeUnreadTaskMap(tasks, cursorMap)).toEqual({ t1: true });
  });

  it('handles mixed read/unread tasks correctly', () => {
    const tasks = [
      task('t1', T1), // before nav cursor → read
      task('t2', T3), // after nav cursor → unread
      task('t3', T3, 'deleted'), // deleted → ignored
      task('t4', T4), // after nav cursor, but has per-task cursor at T4 → read
      task('t5', T4), // after nav cursor, per-task cursor at T3 → still unread
    ];
    const cursorMap = {
      'tasks:nav': T2,
      'tasks:item:t4': T4,
      'tasks:item:t5': T3,
    };
    expect(computeUnreadTaskMap(tasks, cursorMap)).toEqual({
      t2: true,
      t5: true,
    });
  });

  it('per-task cursor exactly at updated_at clears unread', () => {
    const tasks = [task('t1', T3)];
    const cursorMap = {
      'tasks:nav': T2,
      'tasks:item:t1': T3,
    };
    // updated_at (T3) is NOT > effective (T3), so not unread
    expect(computeUnreadTaskMap(tasks, cursorMap)).toEqual({});
  });

  it('treats tasks with various record_state values correctly', () => {
    const tasks = [
      task('t1', T3, 'active'),
      task('t2', T3, 'archived'),
      task('t3', T3, 'deleted'),
    ];
    const cursorMap = { 'tasks:nav': T2 };
    // Only deleted is excluded; active and archived are included
    expect(computeUnreadTaskMap(tasks, cursorMap)).toEqual({
      t1: true,
      t2: true,
    });
  });
});
