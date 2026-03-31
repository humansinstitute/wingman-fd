import { describe, expect, it } from 'vitest';

import {
  computeUnreadTaskMap,
  pickEffectiveReadUntil,
} from '../src/unread-store.js';

describe('pickEffectiveReadUntil', () => {
  it('prefers the more recent item cursor over the nav cursor', () => {
    expect(pickEffectiveReadUntil(
      '2026-03-31T07:00:00.000Z',
      '2026-03-31T08:00:00.000Z',
    )).toBe('2026-03-31T08:00:00.000Z');
  });

  it('falls back to the nav cursor when the item cursor is missing or older', () => {
    expect(pickEffectiveReadUntil(
      '2026-03-31T08:00:00.000Z',
      null,
    )).toBe('2026-03-31T08:00:00.000Z');

    expect(pickEffectiveReadUntil(
      '2026-03-31T08:00:00.000Z',
      '2026-03-31T07:00:00.000Z',
    )).toBe('2026-03-31T08:00:00.000Z');
  });
});

describe('computeUnreadTaskMap', () => {
  it('treats the per-task cursor as an override only when newer than tasks:nav', () => {
    const tasks = [
      {
        record_id: 'task-1',
        owner_npub: 'viewer',
        record_state: 'active',
        created_at: '2026-03-31T07:00:00.000Z',
        updated_at: '2026-03-31T08:30:00.000Z',
      },
      {
        record_id: 'task-2',
        owner_npub: 'viewer',
        record_state: 'active',
        created_at: '2026-03-31T07:00:00.000Z',
        updated_at: '2026-03-31T08:30:00.000Z',
      },
    ];

    const unread = computeUnreadTaskMap(tasks, {
      'tasks:nav': '2026-03-31T08:00:00.000Z',
      'tasks:item:task-1': '2026-03-31T09:00:00.000Z',
      'tasks:item:task-2': '2026-03-31T07:30:00.000Z',
    }, 'viewer');

    expect(unread).toEqual({
      'task-2': true,
    });
  });
});
