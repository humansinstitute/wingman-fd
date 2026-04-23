import { describe, expect, it, vi } from 'vitest';
import './setup.js';

import { channelsManagerMixin } from '../src/channels-manager.js';
import fs from 'node:fs';
import path from 'node:path';

function createStore(overrides = {}) {
  const store = {
    channels: [],
    selectedChannelId: null,
    mainFeedVisibleCount: 80,
    MAIN_FEED_PAGE_SIZE: 80,
    expandedChatMessageIds: [],
    truncatedChatMessageIds: [],
    pendingChatScrollToLatest: false,
    selectedChannelUnreadCutoff: null,
    selectedChannelUnreadChannelId: null,
    syncRoute: vi.fn(),
    startSelectedChannelLiveQuery: vi.fn(),
    ensureBackgroundSync: vi.fn(),
    closeThread: vi.fn(),
    markChannelRead: vi.fn().mockResolvedValue(undefined),
    captureSelectedChannelUnreadSnapshot: vi.fn().mockReturnValue('2026-04-10T05:00:00.000Z'),
    updatePageTitle: vi.fn(),
    rememberPeople: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };

  const descriptors = Object.getOwnPropertyDescriptors(channelsManagerMixin);
  for (const [key, desc] of Object.entries(descriptors)) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) continue;
    Object.defineProperty(store, key, desc);
  }

  return store;
}

const appSource = fs.readFileSync(
  path.resolve(import.meta.dirname, '..', 'src', 'app.js'),
  'utf-8',
);

describe('channelsManagerMixin', () => {
  it('selectChannel resets the main-feed window and keeps bottom-anchor intent by default', async () => {
    const store = createStore({
      mainFeedVisibleCount: 99,
      pendingChatScrollToLatest: false,
    });

    await store.selectChannel('channel-1');

    expect(store.selectedChannelId).toBe('channel-1');
    expect(store.mainFeedVisibleCount).toBe(80);
    expect(store.pendingChatScrollToLatest).toBe(true);
    expect(store.startSelectedChannelLiveQuery).toHaveBeenCalledTimes(1);
    expect(store.syncRoute).toHaveBeenCalledTimes(1);
  });

  it('captures the selected channel unread snapshot before markChannelRead clears the live unread cursor', async () => {
    const callOrder = [];
    const store = createStore({
      captureSelectedChannelUnreadSnapshot: vi.fn(() => {
        callOrder.push('capture');
        return '2026-04-10T05:00:00.000Z';
      }),
      markChannelRead: vi.fn(async () => {
        callOrder.push('mark');
      }),
    });

    await store.selectChannel('channel-1');

    expect(store.captureSelectedChannelUnreadSnapshot).toHaveBeenCalledWith('channel-1');
    expect(callOrder).toEqual(['capture', 'mark']);
    expect(store.selectedChannelUnreadChannelId).toBe('channel-1');
    expect(store.selectedChannelUnreadCutoff).toBe('2026-04-10T05:00:00.000Z');
  });

  it('route-driven chat focus no longer suppresses scrollToLatest on channel open', () => {
    expect(appSource).not.toContain("await this.selectChannel(item.channelId, { scrollToLatest: false });");
  });

  it('refreshGroups supports a max-age guard for group key refreshes', () => {
    const source = channelsManagerMixin.refreshGroups.toString();
    expect(source).toContain('options.maxAgeMs');
    expect(source).toContain('expiredByMaxAge');
    expect(source).toContain('!expiredByMaxAge');
  });
});
