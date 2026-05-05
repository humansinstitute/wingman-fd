import { describe, expect, it } from 'vitest';
import {
  moveChannelInOrder,
  normalizeChannelOrder,
  sortChannelsByOrder,
} from '../src/channel-order.js';

describe('channel order helpers', () => {
  const channels = [
    { record_id: 'chan-a', title: 'A' },
    { record_id: 'chan-b', title: 'B' },
    { record_id: 'chan-c', title: 'C' },
  ];

  it('keeps saved ids first and appends new channels', () => {
    expect(normalizeChannelOrder(['chan-c', 'chan-a'], channels)).toEqual([
      'chan-c',
      'chan-a',
      'chan-b',
    ]);
  });

  it('drops duplicate and stale ids', () => {
    expect(normalizeChannelOrder(['chan-c', 'missing', 'chan-c', 'chan-a'], channels)).toEqual([
      'chan-c',
      'chan-a',
      'chan-b',
    ]);
  });

  it('sorts channels by normalized order', () => {
    expect(sortChannelsByOrder(channels, ['chan-c', 'chan-a']).map((channel) => channel.record_id)).toEqual([
      'chan-c',
      'chan-a',
      'chan-b',
    ]);
  });

  it('moves a dragged channel before the drop target', () => {
    expect(moveChannelInOrder(['chan-a', 'chan-b', 'chan-c'], channels, 'chan-c', 'chan-a')).toEqual([
      'chan-c',
      'chan-a',
      'chan-b',
    ]);
  });
});
