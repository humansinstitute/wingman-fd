import { describe, expect, it } from 'vitest';

import * as unreadStoreModule from '../src/unread-store.js';
import {
  computeUnreadTaskMap,
  isMessageUnreadAtCutoff,
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

describe('message-level unread hooks', () => {
  it('exposes a helper for message unread cutoff comparisons', () => {
    expect(typeof unreadStoreModule.isMessageUnreadAtCutoff).toBe('function');
  });

  it('exposes mixin hooks for selected-channel unread snapshots', () => {
    expect(typeof unreadStoreModule.unreadStoreMixin.captureSelectedChannelUnreadSnapshot).toBe('function');
    expect(typeof unreadStoreModule.unreadStoreMixin.isMessageUnread).toBe('function');
  });

  it('highlights only messages newer than the captured cutoff', () => {
    expect(isMessageUnreadAtCutoff({
      channel_id: 'channel-1',
      sender_npub: 'npub1other',
      updated_at: '2026-04-10T05:00:01.000Z',
      record_state: 'active',
    }, '2026-04-10T05:00:00.000Z', {
      channelId: 'channel-1',
      viewerNpub: 'npub1viewer',
    })).toBe(true);

    expect(isMessageUnreadAtCutoff({
      channel_id: 'channel-1',
      sender_npub: 'npub1other',
      updated_at: '2026-04-10T05:00:00.000Z',
      record_state: 'active',
    }, '2026-04-10T05:00:00.000Z', {
      channelId: 'channel-1',
      viewerNpub: 'npub1viewer',
    })).toBe(false);
  });

  it('keeps the pre-open unread highlight snapshot and suppresses self-authored messages', () => {
    const store = {
      selectedChannelUnreadCutoff: '2026-04-10T05:00:00.000Z',
      selectedChannelUnreadChannelId: 'channel-1',
      session: { npub: 'npub1viewer' },
    };

    expect(unreadStoreModule.unreadStoreMixin.isMessageUnread.call(store, {
      channel_id: 'channel-1',
      sender_npub: 'npub1other',
      updated_at: '2026-04-10T05:00:01.000Z',
      record_state: 'active',
    })).toBe(true);

    expect(unreadStoreModule.unreadStoreMixin.isMessageUnread.call(store, {
      channel_id: 'channel-1',
      sender_npub: 'npub1viewer',
      updated_at: '2026-04-10T05:00:02.000Z',
      record_state: 'active',
    })).toBe(false);
  });
});
