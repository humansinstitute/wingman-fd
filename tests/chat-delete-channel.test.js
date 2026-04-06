import { describe, expect, it, vi } from 'vitest';

vi.mock('alpinejs', () => ({
  default: { nextTick: (fn) => fn?.() },
}));

vi.mock('../src/db.js', () => ({
  getMessagesByChannel: vi.fn(async () => []),
  getMessageById: vi.fn(async () => null),
  upsertMessage: vi.fn(async () => {}),
  upsertChannel: vi.fn(async () => {}),
  addPendingWrite: vi.fn(async () => {}),
  deleteChannelRuntimeState: vi.fn(async () => ({ deletedChannels: 1, deletedMessages: 0, deletedPendingWrites: 0 })),
}));

vi.mock('../src/api.js', () => ({
  fetchRecordHistory: vi.fn(async () => ({ versions: [] })),
}));

vi.mock('../src/translators/chat.js', () => ({
  outboundChatMessage: vi.fn(async (payload) => ({ ...payload, record_family_hash: 'mock:chat_message' })),
  outboundChannel: vi.fn(async (payload) => ({ ...payload, record_family_hash: 'mock:channel' })),
  recordFamilyHash: (family) => `mock:${family}`,
}));

import { fetchRecordHistory } from '../src/api.js';
import { addPendingWrite, deleteChannelRuntimeState, upsertChannel } from '../src/db.js';
import { chatMessageManagerMixin } from '../src/chat-message-manager.js';
import { outboundChannel } from '../src/translators/chat.js';

function createStore(overrides = {}) {
  const store = {
    channels: [],
    messages: [],
    selectedChannelId: null,
    activeThreadId: null,
    threadInput: '',
    expandedChatMessageIds: [],
    truncatedChatMessageIds: [],
    focusMessageId: null,
    threadSize: 'default',
    threadVisibleReplyCount: 6,
    mainFeedVisibleCount: 80,
    pendingChatScrollToLatest: false,
    pendingThreadScrollToLatest: false,
    messageImageUploadCount: 0,
    threadImageUploadCount: 0,
    chatFeedScrollFrame: null,
    threadRepliesScrollFrame: null,
    chatPreviewMeasureFrame: null,
    showChannelSettingsModal: true,
    channelDeleteConfirmArmed: false,
    error: null,
    session: { npub: 'npub1viewer' },
    signingNpub: 'npub1viewer',
    backendUrl: 'https://tower.example.test',
    workspaceOwnerNpub: 'npub1owner',
    THREAD_REPLY_PAGE_SIZE: 6,
    MAIN_FEED_PAGE_SIZE: 80,
    captureScrollAnchor: vi.fn().mockReturnValue(null),
    restoreScrollAnchor: vi.fn(),
    scheduleChatFeedScrollToBottom: vi.fn(),
    scheduleThreadRepliesScrollToBottom: vi.fn(),
    scheduleChatPreviewMeasurement: vi.fn(),
    scheduleStorageImageHydration: vi.fn(),
    syncRoute: vi.fn(),
    refreshMessages: vi.fn().mockResolvedValue(undefined),
    refreshChannels: vi.fn().mockImplementation(async function refreshChannels() {
      return this.channels;
    }),
    flushAndBackgroundSync: vi.fn().mockResolvedValue({ pushed: 1 }),
    getPreferredChannelWriteGroup: vi.fn().mockReturnValue('group-1'),
    getChannelLabel: vi.fn((channel) => channel?.title || 'Untitled channel'),
    ...overrides,
  };

  const descriptors = Object.getOwnPropertyDescriptors(chatMessageManagerMixin);
  for (const [key, desc] of Object.entries(descriptors)) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) continue;
    Object.defineProperty(store, key, desc);
  }

  return store;
}

function bindDeleteSelectedChannel(overrides = {}) {
  const store = createStore(overrides);
  return {
    store,
    fn: store.deleteSelectedChannel.bind(store),
  };
}

describe('deleteSelectedChannel', () => {
  it('arms delete confirmation on the first click', async () => {
    vi.clearAllMocks();
    const { fn, store } = bindDeleteSelectedChannel({
      channels: [
        { record_id: 'ch-1', owner_npub: 'npub1owner', title: 'Other Stuff', version: 1, group_ids: ['group-1'] },
      ],
      selectedChannelId: 'ch-1',
    });

    await fn();

    expect(store.channelDeleteConfirmArmed).toBe(true);
    expect(fetchRecordHistory).not.toHaveBeenCalled();
    expect(deleteChannelRuntimeState).not.toHaveBeenCalled();
    expect(upsertChannel).not.toHaveBeenCalled();
  });

  it('hard-deletes local-only channels without queueing a Tower tombstone', async () => {
    vi.clearAllMocks();
    fetchRecordHistory.mockResolvedValueOnce({ versions: [] });
    const { fn, store } = bindDeleteSelectedChannel({
      channels: [
        { record_id: 'ch-1', owner_npub: 'npub1owner', title: 'Other Stuff', version: 1, group_ids: ['group-1'] },
        { record_id: 'ch-2', owner_npub: 'npub1owner', title: 'General', version: 1, group_ids: ['group-1'] },
      ],
      channelDeleteConfirmArmed: true,
      selectedChannelId: 'ch-1',
      refreshChannels: vi.fn().mockImplementation(async function refreshChannels() {
        this.channels = this.channels.filter((channel) => channel.record_id !== 'ch-1');
        return this.channels;
      }),
    });

    await fn();

    expect(fetchRecordHistory).toHaveBeenCalledWith({
      record_id: 'ch-1',
      owner_npub: 'npub1owner',
      viewer_npub: 'npub1viewer',
    });
    expect(deleteChannelRuntimeState).toHaveBeenCalledWith('ch-1');
    expect(upsertChannel).not.toHaveBeenCalled();
    expect(outboundChannel).not.toHaveBeenCalled();
    expect(addPendingWrite).not.toHaveBeenCalled();
    expect(store.flushAndBackgroundSync).not.toHaveBeenCalled();
    expect(store.channels.map((channel) => channel.record_id)).toEqual(['ch-2']);
    expect(store.selectedChannelId).toBe('ch-2');
    expect(store.showChannelSettingsModal).toBe(false);
    expect(store.channelDeleteConfirmArmed).toBe(false);
    expect(store.error).toBeNull();
  });

  it('queues a delete tombstone when the channel already exists on Tower', async () => {
    vi.clearAllMocks();
    fetchRecordHistory.mockResolvedValueOnce({
      versions: [
        { version: 1, updated_at: '2026-04-01T10:00:00.000Z' },
        { version: 2, updated_at: '2026-04-02T10:00:00.000Z' },
      ],
    });
    const { fn, store } = bindDeleteSelectedChannel({
      channels: [
        { record_id: 'ch-1', owner_npub: 'npub1owner', title: 'Other Stuff', version: 1, group_ids: ['group-1'], participant_npubs: ['npub1viewer'] },
      ],
      channelDeleteConfirmArmed: true,
      selectedChannelId: 'ch-1',
      refreshChannels: vi.fn().mockImplementation(async function refreshChannels() {
        this.channels = [];
        return this.channels;
      }),
    });

    await fn();

    expect(deleteChannelRuntimeState).not.toHaveBeenCalled();
    expect(upsertChannel).toHaveBeenCalledWith(expect.objectContaining({
      record_id: 'ch-1',
      record_state: 'deleted',
      version: 3,
    }));
    expect(outboundChannel).toHaveBeenCalledWith(expect.objectContaining({
      record_id: 'ch-1',
      owner_npub: 'npub1owner',
      version: 3,
      previous_version: 2,
      record_state: 'deleted',
    }));
    expect(addPendingWrite).toHaveBeenCalledWith(expect.objectContaining({
      record_id: 'ch-1',
      record_family_hash: 'mock:channel',
      envelope: expect.objectContaining({
        record_id: 'ch-1',
        version: 3,
        previous_version: 2,
      }),
    }));
    expect(store.flushAndBackgroundSync).toHaveBeenCalledTimes(1);
    expect(store.channels).toEqual([]);
    expect(store.selectedChannelId).toBeNull();
    expect(store.showChannelSettingsModal).toBe(false);
    expect(store.channelDeleteConfirmArmed).toBe(false);
    expect(store.error).toBeNull();
  });
});
