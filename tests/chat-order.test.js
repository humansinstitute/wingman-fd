import { describe, expect, it } from 'vitest';

import {
  rankMainFeedMessages,
  rankThreadReplies,
  resolveVisibleThreadReplyCount,
  sortMessagesByUpdatedAt,
  visibleThreadReplies,
} from '../src/chat-order.js';

describe('chat order helpers', () => {
  it('sorts channel rows by latest activity in each thread', () => {
    const messages = [
      {
        record_id: 'root-a',
        parent_message_id: null,
        updated_at: '2026-03-18T09:00:00.000Z',
      },
      {
        record_id: 'root-b',
        parent_message_id: null,
        updated_at: '2026-03-18T09:30:00.000Z',
      },
      {
        record_id: 'reply-a',
        parent_message_id: 'root-a',
        updated_at: '2026-03-18T10:00:00.000Z',
      },
    ];

    expect(rankMainFeedMessages(messages).map((message) => message.record_id)).toEqual([
      'root-b',
      'root-a',
    ]);
  });

  it('sorts thread replies oldest to newest', () => {
    const messages = [
      {
        record_id: 'reply-2',
        parent_message_id: 'root-a',
        updated_at: '2026-03-18T10:00:00.000Z',
      },
      {
        record_id: 'reply-1',
        parent_message_id: 'root-a',
        updated_at: '2026-03-18T09:00:00.000Z',
      },
      {
        record_id: 'reply-other',
        parent_message_id: 'root-b',
        updated_at: '2026-03-18T08:00:00.000Z',
      },
    ];

    expect(rankThreadReplies(messages, 'root-a').map((message) => message.record_id)).toEqual([
      'reply-1',
      'reply-2',
    ]);
  });

  it('shows the newest reply window while keeping oldest to newest order', () => {
    const messages = [
      {
        record_id: 'reply-1',
        parent_message_id: 'root-a',
        updated_at: '2026-03-18T09:00:00.000Z',
      },
      {
        record_id: 'reply-2',
        parent_message_id: 'root-a',
        updated_at: '2026-03-18T10:00:00.000Z',
      },
      {
        record_id: 'reply-3',
        parent_message_id: 'root-a',
        updated_at: '2026-03-18T11:00:00.000Z',
      },
    ];

    expect(visibleThreadReplies(messages, 'root-a', 2).map((message) => message.record_id)).toEqual([
      'reply-2',
      'reply-3',
    ]);
  });

  it('expands the visible thread window to include a focused older reply', () => {
    const replies = [
      { record_id: 'reply-1' },
      { record_id: 'reply-2' },
      { record_id: 'reply-3' },
      { record_id: 'reply-4' },
    ];

    expect(resolveVisibleThreadReplyCount(replies, 2, 'reply-2')).toBe(3);
  });

  it('normalizes unsorted message rows before rendering', () => {
    const messages = [
      {
        record_id: 'msg-2',
        parent_message_id: null,
        updated_at: '2026-03-18T10:00:00.000Z',
      },
      {
        record_id: 'msg-1',
        parent_message_id: null,
        updated_at: '2026-03-18T09:00:00.000Z',
      },
    ];

    expect(sortMessagesByUpdatedAt(messages).map((message) => message.record_id)).toEqual([
      'msg-1',
      'msg-2',
    ]);
  });
});
