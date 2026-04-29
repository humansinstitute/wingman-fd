import { describe, expect, it, vi } from 'vitest';
import './setup.js';

// Mock Alpine.js — it requires a browser `window` at import time
vi.mock('alpinejs', () => ({
  default: { nextTick: (fn) => fn?.() },
}));

vi.mock('../src/translators/chat.js', () => ({
  outboundChatMessage: vi.fn(async (payload) => ({ ...payload, record_family_hash: 'mock:chat_message' })),
  outboundChannel: vi.fn(async (payload) => ({ ...payload, record_family_hash: 'mock:channel' })),
  recordFamilyHash: (family) => `mock:${family}`,
}));

import { chatMessageManagerMixin } from '../src/chat-message-manager.js';
import { createChatThreadFlowDispatchState } from '../src/chat-thread-flow-dispatch.js';
import { clearRuntimeData, deleteWorkspaceDb, openWorkspaceDb } from '../src/db.js';

// ---------------------------------------------------------------------------
// Helper: create a fake store with all mixin methods applied
// ---------------------------------------------------------------------------
function createStore(overrides = {}) {
  const store = {
    messages: [],
    channels: [],
    flows: [],
    scopes: [],
    selectedChannelId: null,
    activeThreadId: null,
    threadInput: '',
    messageInput: '',
    messageAudioDrafts: [],
    threadAudioDrafts: [],
    expandedChatMessageIds: [],
    truncatedChatMessageIds: [],
    focusMessageId: null,
    threadVisibleReplyCount: 6,
    mainFeedVisibleCount: 80,
    threadSize: 'default',
    pendingChatScrollToLatest: false,
    pendingThreadScrollToLatest: false,
    messageImageUploadCount: 0,
    threadImageUploadCount: 0,
    chatFeedScrollFrame: null,
    threadRepliesScrollFrame: null,
    chatPreviewMeasureFrame: null,
    showChannelSettingsModal: false,
    showFlowStartConfirm: false,
    flowStartTarget: null,
    flowStartContext: '',
    messageActionsMenuId: null,
    error: null,
    session: null,
    botNpub: '',
    backendUrl: '',
    THREAD_REPLY_PAGE_SIZE: 6,
    MAIN_FEED_PAGE_SIZE: 80,
    COMPOSER_MAX_LINES: 12,
    MESSAGE_PREVIEW_MAX_LINES: 15,
    // Stubs for methods from other mixins / the store
    syncRoute: vi.fn(),
    rememberPeople: vi.fn().mockResolvedValue(undefined),
    captureScrollAnchor: vi.fn().mockReturnValue(null),
    restoreScrollAnchor: vi.fn(),
    scheduleStorageImageHydration: vi.fn(),
    performSync: vi.fn().mockResolvedValue(undefined),
    ensureBackgroundSync: vi.fn(),
    selectChannel: vi.fn().mockResolvedValue(undefined),
    refreshChannels: vi.fn().mockResolvedValue(undefined),
    createEncryptedGroup: vi.fn().mockResolvedValue({ group_id: 'g1' }),
    getPreferredChannelWriteGroup: vi.fn().mockReturnValue('g1'),
    getChannelLabel: vi.fn().mockReturnValue('test-channel'),
    getTaskBoardOptionLabel: vi.fn((scopeId) => scopeId ? `Scope ${scopeId}` : ''),
    buildTaskBoardAssignment: vi.fn((scopeId) => {
      if (scopeId === '__unscoped__') {
        return {
          scope_id: null,
          scope_l1_id: null,
          scope_l2_id: null,
          scope_l3_id: null,
          scope_l4_id: null,
          scope_l5_id: null,
          scope_policy_group_ids: null,
          board_group_id: 'workspace-default',
          group_ids: ['workspace-default'],
          shares: [{ type: 'group', group_npub: 'workspace-default', access: 'write' }],
        };
      }
      return {
        scope_id: scopeId,
        scope_l1_id: scopeId,
        scope_l2_id: null,
        scope_l3_id: null,
        scope_l4_id: null,
        scope_l5_id: null,
        scope_policy_group_ids: [`policy:${scopeId}`],
        board_group_id: `group:${scopeId}`,
        group_ids: [`group:${scopeId}`],
        shares: [{ type: 'group', group_npub: `group:${scopeId}`, access: 'write' }],
      };
    }),
    materializeAudioDrafts: vi.fn().mockResolvedValue({ attachments: [] }),
    containsInlineImageUploadToken: vi.fn().mockReturnValue(false),
    _fireMentionTriggers: vi.fn(),
    getSenderName: vi.fn((npub) => npub ? `Name ${npub}` : ''),
    openRecordStatusModal: vi.fn(),
    workspaceOwnerNpub: 'npub1owner',
    ...overrides,
  };

  // Apply all mixin methods and getters
  const descriptors = Object.getOwnPropertyDescriptors(chatMessageManagerMixin);
  for (const [key, desc] of Object.entries(descriptors)) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) continue;
    Object.defineProperty(store, key, desc);
  }

  return store;
}

function bindMethod(methodName, overrides = {}) {
  const store = createStore(overrides);
  const method = store[methodName];
  if (typeof method === 'function') {
    return { fn: method.bind(store), store };
  }
  return { store };
}

// ---------------------------------------------------------------------------
// Computed getters
// ---------------------------------------------------------------------------
describe('chat message computed getters', () => {
  it('selectedChannel returns matching channel', () => {
    const ch = { record_id: 'ch1', title: 'General' };
    const store = createStore({ channels: [ch], selectedChannelId: 'ch1' });
    expect(store.selectedChannel).toEqual(ch);
  });

  it('selectedChannel returns null when no match', () => {
    const store = createStore({ channels: [], selectedChannelId: 'ch1' });
    expect(store.selectedChannel).toBeNull();
  });

  it('mainFeedMessages returns ranked messages', () => {
    const store = createStore({
      messages: [
        { record_id: 'm1', parent_message_id: null, updated_at: '2024-01-01T00:00:00Z' },
        { record_id: 'm2', parent_message_id: 'm1', updated_at: '2024-01-01T01:00:00Z' },
        { record_id: 'm3', parent_message_id: null, updated_at: '2024-01-01T02:00:00Z' },
      ],
    });
    const feed = store.mainFeedMessages;
    // mainFeedMessages should only contain top-level messages (parent_message_id == null)
    expect(feed.every((m) => m.parent_message_id === null)).toBe(true);
  });

  it('visibleMainFeedMessages returns the newest feed window', () => {
    const store = createStore({
      mainFeedVisibleCount: 2,
      messages: [
        { record_id: 'm1', parent_message_id: null, updated_at: '2024-01-01T00:00:00Z' },
        { record_id: 'm2', parent_message_id: null, updated_at: '2024-01-01T01:00:00Z' },
        { record_id: 'm3', parent_message_id: null, updated_at: '2024-01-01T02:00:00Z' },
      ],
    });
    expect(store.visibleMainFeedMessages.map((message) => message.record_id)).toEqual(['m2', 'm3']);
    expect(store.hiddenMainFeedCount).toBe(1);
    expect(store.hasMoreMainFeedMessages).toBe(true);
  });

  it('visibleMainFeedMessages defaults to the newest 80 messages when the page size is 80', () => {
    const messages = Array.from({ length: 85 }, (_, index) => ({
      record_id: `m${index + 1}`,
      parent_message_id: null,
      updated_at: new Date(Date.UTC(2024, 0, 1, 0, 0, index)).toISOString(),
    }));
    const store = createStore({
      MAIN_FEED_PAGE_SIZE: 80,
      mainFeedVisibleCount: 80,
      messages,
    });
    expect(store.visibleMainFeedMessages).toHaveLength(80);
    expect(store.hiddenMainFeedCount).toBe(5);
    expect(store.visibleMainFeedMessages[0]?.record_id).toBe('m6');
    expect(store.visibleMainFeedMessages.at(-1)?.record_id).toBe('m85');
  });

  it('threadMessages returns empty when no active thread', () => {
    const store = createStore({ activeThreadId: null, messages: [{ record_id: 'm1' }] });
    expect(store.threadMessages).toEqual([]);
  });

  it('threadMessages returns replies for active thread', () => {
    const store = createStore({
      activeThreadId: 'm1',
      messages: [
        { record_id: 'm1', parent_message_id: null, updated_at: '2024-01-01T00:00:00Z' },
        { record_id: 'm2', parent_message_id: 'm1', updated_at: '2024-01-01T01:00:00Z' },
        { record_id: 'm3', parent_message_id: 'm1', updated_at: '2024-01-01T02:00:00Z' },
        { record_id: 'm4', parent_message_id: null, updated_at: '2024-01-01T03:00:00Z' },
      ],
    });
    const thread = store.threadMessages;
    expect(thread.length).toBe(2);
    expect(thread.every((m) => m.parent_message_id === 'm1')).toBe(true);
  });

  it('hasMoreThreadMessages returns false when no hidden messages', () => {
    const store = createStore({
      activeThreadId: 'm1',
      threadVisibleReplyCount: 10,
      messages: [
        { record_id: 'm2', parent_message_id: 'm1', updated_at: '2024-01-01T01:00:00Z' },
      ],
    });
    expect(store.hasMoreThreadMessages).toBe(false);
  });

  it('hiddenThreadReplyCount is zero when all visible', () => {
    const store = createStore({
      activeThreadId: 'm1',
      threadVisibleReplyCount: 100,
      messages: [
        { record_id: 'm2', parent_message_id: 'm1', updated_at: '2024-01-01T01:00:00Z' },
      ],
    });
    expect(store.hiddenThreadReplyCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Thread lifecycle
// ---------------------------------------------------------------------------
describe('thread lifecycle', () => {
  it('openThread sets active thread and resets state', () => {
    const { fn, store } = bindMethod('openThread', {
      activeThreadId: null,
      threadInput: 'leftover',
    });
    fn('m1');
    expect(store.activeThreadId).toBe('m1');
    expect(store.threadInput).toBe('');
    expect(store.threadVisibleReplyCount).toBe(6);
    expect(store.pendingThreadScrollToLatest).toBe(true);
    expect(store.syncRoute).toHaveBeenCalled();
  });

  it('openThread respects syncRoute: false', () => {
    const { fn, store } = bindMethod('openThread');
    fn('m1', { syncRoute: false });
    expect(store.syncRoute).not.toHaveBeenCalled();
  });

  it('closeThread resets thread state', () => {
    const { fn, store } = bindMethod('closeThread', {
      activeThreadId: 'm1',
      threadInput: 'something',
      threadSize: 'wide',
      pendingThreadScrollToLatest: true,
    });
    fn();
    expect(store.activeThreadId).toBeNull();
    expect(store.threadInput).toBe('');
    expect(store.threadSize).toBe('default');
    expect(store.pendingThreadScrollToLatest).toBe(false);
    expect(store.syncRoute).toHaveBeenCalled();
  });

  it('closeThread respects syncRoute: false', () => {
    const { fn, store } = bindMethod('closeThread');
    fn({ syncRoute: false });
    expect(store.syncRoute).not.toHaveBeenCalled();
  });

  it('cycleThreadSize cycles through sizes', () => {
    const { fn, store } = bindMethod('cycleThreadSize', { threadSize: 'default' });
    fn();
    expect(store.threadSize).toBe('wide');
    fn();
    expect(store.threadSize).toBe('full');
    fn();
    expect(store.threadSize).toBe('default');
  });

  it('showMoreThreadMessages increases visible count', () => {
    const { fn, store } = bindMethod('showMoreThreadMessages', {
      threadVisibleReplyCount: 6,
    });
    fn();
    expect(store.threadVisibleReplyCount).toBe(12);
    fn();
    expect(store.threadVisibleReplyCount).toBe(18);
  });

  it('showMoreMainFeedMessages increases visible count', () => {
    const { fn, store } = bindMethod('showMoreMainFeedMessages', {
      mainFeedVisibleCount: 80,
      MAIN_FEED_PAGE_SIZE: 80,
    });
    fn();
    expect(store.mainFeedVisibleCount).toBe(160);
    fn();
    expect(store.mainFeedVisibleCount).toBe(240);
  });

  it('showMoreMainFeedMessages expands by 80 and restores the captured anchor', () => {
    const anchor = { id: 'm80' };
    const { fn, store } = bindMethod('showMoreMainFeedMessages', {
      mainFeedVisibleCount: 80,
      MAIN_FEED_PAGE_SIZE: 80,
      captureScrollAnchor: vi.fn().mockReturnValue(anchor),
      restoreScrollAnchor: vi.fn(),
    });
    fn();
    expect(store.mainFeedVisibleCount).toBe(160);
    expect(store.captureScrollAnchor).toHaveBeenCalled();
    expect(store.restoreScrollAnchor).toHaveBeenCalledWith(anchor);
  });

  it('getThreadParentMessage returns parent', () => {
    const parent = { record_id: 'm1', parent_message_id: null };
    const { fn } = bindMethod('getThreadParentMessage', {
      activeThreadId: 'm1',
      messages: [parent, { record_id: 'm2', parent_message_id: 'm1' }],
    });
    expect(fn()).toEqual(parent);
  });

  it('getThreadParentMessage returns null when no thread', () => {
    const { fn } = bindMethod('getThreadParentMessage', { activeThreadId: null });
    expect(fn()).toBeNull();
  });

  it('getThreadReplyCount counts replies', () => {
    const { fn } = bindMethod('getThreadReplyCount', {
      messages: [
        { record_id: 'm1', parent_message_id: null },
        { record_id: 'm2', parent_message_id: 'm1' },
        { record_id: 'm3', parent_message_id: 'm1' },
        { record_id: 'm4', parent_message_id: 'm5' },
      ],
    });
    expect(fn('m1')).toBe(2);
    expect(fn('m5')).toBe(1);
    expect(fn('m99')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Chat preview truncation
// ---------------------------------------------------------------------------
describe('chat preview truncation', () => {
  it('isChatMessageExpanded checks list', () => {
    const { fn } = bindMethod('isChatMessageExpanded', {
      expandedChatMessageIds: ['m1', 'm3'],
    });
    expect(fn('m1')).toBe(true);
    expect(fn('m2')).toBe(false);
  });

  it('isChatMessageTruncated checks list', () => {
    const { fn } = bindMethod('isChatMessageTruncated', {
      truncatedChatMessageIds: ['m2'],
    });
    expect(fn('m2')).toBe(true);
    expect(fn('m1')).toBe(false);
  });

  it('toggleChatMessageExpanded adds and removes', () => {
    const { fn, store } = bindMethod('toggleChatMessageExpanded', {
      expandedChatMessageIds: [],
    });
    fn('m1');
    expect(store.expandedChatMessageIds).toContain('m1');
    fn('m1');
    expect(store.expandedChatMessageIds).not.toContain('m1');
  });

  it('toggleChatMessageExpanded ignores empty recordId', () => {
    const { fn, store } = bindMethod('toggleChatMessageExpanded', {
      expandedChatMessageIds: [],
    });
    fn('');
    expect(store.expandedChatMessageIds).toEqual([]);
    fn(null);
    expect(store.expandedChatMessageIds).toEqual([]);
  });

  it('syncChatPreviewState prunes invalid IDs', () => {
    const { fn, store } = bindMethod('syncChatPreviewState', {
      mainFeedVisibleCount: 1,
      messages: [
        { record_id: 'm1', parent_message_id: null, updated_at: '2024-01-01T00:00:00Z' },
        { record_id: 'm2', parent_message_id: null, updated_at: '2024-01-01T01:00:00Z' },
      ],
      expandedChatMessageIds: ['m1', 'm999'],
      truncatedChatMessageIds: ['m999', 'm1'],
    });
    fn();
    expect(store.expandedChatMessageIds).toEqual([]);
    expect(store.truncatedChatMessageIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Scroll anchoring (no-op in test env — just verify no throw)
// ---------------------------------------------------------------------------
describe('scroll and composer methods', () => {
  it('scheduleChatFeedScrollToBottom does not throw in test env', () => {
    const { fn } = bindMethod('scheduleChatFeedScrollToBottom');
    expect(() => fn()).not.toThrow();
  });

  it('scheduleThreadRepliesScrollToBottom does not throw in test env', () => {
    const { fn } = bindMethod('scheduleThreadRepliesScrollToBottom');
    expect(() => fn()).not.toThrow();
  });

  it('autosizeComposer does not throw with null', () => {
    const { fn } = bindMethod('autosizeComposer');
    expect(() => fn(null)).not.toThrow();
  });

  it('autosizeComposer keeps empty composers at the three-line minimum', () => {
    const { fn } = bindMethod('autosizeComposer');
    const textarea = {
      scrollHeight: 42,
      style: {},
    };

    vi.stubGlobal('window', {
      getComputedStyle: () => ({
        lineHeight: '20px',
        paddingTop: '8px',
        paddingBottom: '8px',
        borderTopWidth: '1px',
        borderBottomWidth: '1px',
        minHeight: '78px',
      }),
    });

    try {
      fn(textarea);
      expect(textarea.style.height).toBe('78px');
      expect(textarea.style.overflowY).toBe('hidden');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('scheduleComposerAutosize does not throw in test env', () => {
    const { fn } = bindMethod('scheduleComposerAutosize');
    expect(() => fn('message')).not.toThrow();
  });

  it('scheduleChatPreviewMeasurement does not throw in test env', () => {
    const { fn } = bindMethod('scheduleChatPreviewMeasurement');
    expect(() => fn()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Message application
// ---------------------------------------------------------------------------
describe('applyMessages', () => {
  it('sets messages on store', async () => {
    const { fn, store } = bindMethod('applyMessages');
    const msgs = [
      { record_id: 'm1', sender_npub: 'npub1a', parent_message_id: null, updated_at: '2024-01-01T00:00:00Z' },
    ];
    await fn(msgs);
    expect(store.messages).toHaveLength(1);
    expect(store.messages[0].record_id).toBe('m1');
    expect(store.pendingChatScrollToLatest).toBe(false);
  });

  it('closes thread if thread messages disappear', async () => {
    const { fn, store } = bindMethod('applyMessages', {
      activeThreadId: 'm99',
    });
    await fn([{ record_id: 'm1', sender_npub: 'npub1a', parent_message_id: null, updated_at: '2024-01-01' }]);
    expect(store.activeThreadId).toBeNull();
  });

  it('keeps thread if thread messages exist', async () => {
    const { fn, store } = bindMethod('applyMessages', {
      activeThreadId: 'm1',
    });
    await fn([
      { record_id: 'm1', sender_npub: 'npub1a', parent_message_id: null, updated_at: '2024-01-01' },
      { record_id: 'm2', sender_npub: 'npub1b', parent_message_id: 'm1', updated_at: '2024-01-02' },
    ]);
    expect(store.activeThreadId).toBe('m1');
  });

  it('schedules a bottom scroll when pendingChatScrollToLatest is set', async () => {
    const scheduleChatFeedScrollToBottom = vi.fn();
    const { fn } = bindMethod('applyMessages', {
      pendingChatScrollToLatest: true,
      scheduleChatFeedScrollToBottom,
    });
    await fn([
      { record_id: 'm1', sender_npub: 'npub1a', parent_message_id: null, updated_at: '2024-01-01T00:00:00Z' },
    ]);
    expect(scheduleChatFeedScrollToBottom).toHaveBeenCalledTimes(1);
  });

  it('exposes a load-more visibility hook whenever older messages are hidden', () => {
    const messages = Array.from({ length: 30 }, (_, index) => ({
      record_id: `m${index + 1}`,
      parent_message_id: null,
      updated_at: `2024-01-01T00:${String(index).padStart(2, '0')}:00Z`,
    }));
    const store = createStore({
      MAIN_FEED_PAGE_SIZE: 21,
      mainFeedVisibleCount: 21,
      messages,
      chatFeedNearTop: false,
    });
    expect(store.showMainFeedLoadMoreControl).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// patchMessageLocal
// ---------------------------------------------------------------------------
describe('patchMessageLocal', () => {
  it('updates existing message in place', () => {
    const { fn, store } = bindMethod('patchMessageLocal', {
      messages: [
        { record_id: 'm1', body: 'old', updated_at: '2024-01-01' },
      ],
    });
    fn({ record_id: 'm1', body: 'new' });
    expect(store.messages[0].body).toBe('new');
    expect(store.messages[0].updated_at).toBe('2024-01-01');
  });

  it('adds new message when not found', () => {
    const { fn, store } = bindMethod('patchMessageLocal', {
      messages: [
        { record_id: 'm1', body: 'old', updated_at: '2024-01-01' },
      ],
    });
    fn({ record_id: 'm2', body: 'new', updated_at: '2024-01-02' });
    expect(store.messages).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// refreshMessages
// ---------------------------------------------------------------------------
describe('refreshMessages', () => {
  it('clears messages when no channel selected', async () => {
    const { fn, store } = bindMethod('refreshMessages', {
      selectedChannelId: null,
      messages: [{ record_id: 'm1' }],
    });
    await fn();
    expect(store.messages).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// createBotDm validation
// ---------------------------------------------------------------------------
describe('createBotDm', () => {
  it('sets error when not signed in', async () => {
    const { fn, store } = bindMethod('createBotDm', {
      session: null,
      botNpub: 'npub1bot',
    });
    await fn();
    expect(store.error).toBe('Sign in and set bot npub first');
  });

  it('sets error when no backend', async () => {
    const { fn, store } = bindMethod('createBotDm', {
      session: { npub: 'npub1me' },
      botNpub: 'npub1bot',
      backendUrl: '',
    });
    await fn();
    expect(store.error).toBe('Set backend URL first');
  });
});

// ---------------------------------------------------------------------------
// sendMessage validation
// ---------------------------------------------------------------------------
describe('sendMessage', () => {
  it('does nothing with empty input and no drafts', async () => {
    const { fn, store } = bindMethod('sendMessage', {
      messageInput: '',
      messageAudioDrafts: [],
      selectedChannelId: 'ch1',
      channels: [{ record_id: 'ch1' }],
    });
    await fn();
    expect(store.error).toBeNull();
    expect(store.performSync).not.toHaveBeenCalled();
  });

  it('sets error when no channel selected', async () => {
    const { fn, store } = bindMethod('sendMessage', {
      messageInput: 'hello',
      messageAudioDrafts: [],
      selectedChannelId: null,
    });
    await fn();
    expect(store.error).toBe('Select a channel first');
  });

  it('sets error when image upload in progress', async () => {
    const { fn, store } = bindMethod('sendMessage', {
      messageInput: 'hello',
      messageImageUploadCount: 1,
    });
    await fn();
    expect(store.error).toBe('Wait for image upload to finish.');
  });

  it('schedules a chat-feed scroll after inserting the local pending row', async () => {
    const workspaceDbKey = 'chat-message-manager-send-message';
    openWorkspaceDb(workspaceDbKey);
    await clearRuntimeData();

    try {
      const scheduleChatFeedScrollToBottom = vi.fn();
      const patchMessageLocal = vi.fn();
      const { fn, store } = bindMethod('sendMessage', {
        session: { npub: 'npub1viewer' },
        workspaceOwnerNpub: 'npub1owner',
        selectedChannelId: 'ch1',
        channels: [{ record_id: 'ch1', owner_npub: 'npub1owner', group_ids: [] }],
        messageInput: 'hello world',
        scheduleChatFeedScrollToBottom,
        patchMessageLocal,
        flushAndBackgroundSync: vi.fn().mockResolvedValue(undefined),
        getPreferredChannelWriteGroup: vi.fn().mockReturnValue(null),
      });

      await fn();

      expect(scheduleChatFeedScrollToBottom).toHaveBeenCalledTimes(1);
      expect(patchMessageLocal).toHaveBeenCalledTimes(1);
      expect(patchMessageLocal.mock.calls[0][0]).toEqual(expect.objectContaining({
        channel_id: 'ch1',
        body: 'hello world',
        sender_npub: 'npub1viewer',
        sync_status: 'pending',
      }));
      expect(store.messageInput).toBe('');
    } finally {
      await deleteWorkspaceDb(workspaceDbKey);
    }
  });
});

// ---------------------------------------------------------------------------
// sendThreadReply validation
// ---------------------------------------------------------------------------
describe('sendThreadReply', () => {
  it('does nothing with empty input and no drafts', async () => {
    const { fn, store } = bindMethod('sendThreadReply', {
      threadInput: '',
      threadAudioDrafts: [],
      activeThreadId: 'm1',
      selectedChannelId: 'ch1',
    });
    await fn();
    expect(store.performSync).not.toHaveBeenCalled();
  });

  it('sets error when no thread open', async () => {
    const { fn, store } = bindMethod('sendThreadReply', {
      threadInput: 'reply',
      threadAudioDrafts: [],
      activeThreadId: null,
      selectedChannelId: 'ch1',
    });
    await fn();
    expect(store.error).toBe('Open a thread first');
  });

  it('sets error when image upload in progress', async () => {
    const { fn, store } = bindMethod('sendThreadReply', {
      threadInput: 'reply',
      threadImageUploadCount: 1,
      activeThreadId: 'm1',
      selectedChannelId: 'ch1',
    });
    await fn();
    expect(store.error).toBe('Wait for image upload to finish.');
  });
});

// ---------------------------------------------------------------------------
// deleteActiveThread validation
// ---------------------------------------------------------------------------
describe('deleteActiveThread', () => {
  it('sets error when no thread open', async () => {
    const { fn, store } = bindMethod('deleteActiveThread', {
      activeThreadId: null,
      selectedChannelId: 'ch1',
      messages: [],
    });
    await fn();
    expect(store.error).toBe('Open a thread first');
  });
});

// ---------------------------------------------------------------------------
// deleteSelectedChannel validation
// ---------------------------------------------------------------------------
describe('deleteSelectedChannel', () => {
  it('sets error when no channel selected', async () => {
    const { fn, store } = bindMethod('deleteSelectedChannel', {
      selectedChannelId: null,
      channels: [],
    });
    await fn();
    expect(store.error).toBe('Select a channel first');
  });
});

// ---------------------------------------------------------------------------
// Chat message actions menu
// ---------------------------------------------------------------------------
describe('chat message actions menu', () => {
  it('openMessageActionsMenu sets the active menu record id', () => {
    const { fn, store } = bindMethod('openMessageActionsMenu');
    fn('msg-1');
    expect(store.messageActionsMenuId).toBe('msg-1');
  });

  it('openMessageActionsMenu replaces previous menu id', () => {
    const { fn, store } = bindMethod('openMessageActionsMenu', {
      messageActionsMenuId: 'msg-old',
    });
    fn('msg-2');
    expect(store.messageActionsMenuId).toBe('msg-2');
  });

  it('closeMessageActionsMenu clears the active menu', () => {
    const { fn, store } = bindMethod('closeMessageActionsMenu', {
      messageActionsMenuId: 'msg-1',
    });
    fn();
    expect(store.messageActionsMenuId).toBeNull();
  });

  it('isMessageActionsMenuOpen returns true for matching id', () => {
    const { fn } = bindMethod('isMessageActionsMenuOpen', {
      messageActionsMenuId: 'msg-1',
    });
    expect(fn('msg-1')).toBe(true);
    expect(fn('msg-2')).toBe(false);
  });

  it('isMessageActionsMenuOpen returns false when no menu open', () => {
    const { fn } = bindMethod('isMessageActionsMenuOpen', {
      messageActionsMenuId: null,
    });
    expect(fn('msg-1')).toBe(false);
  });

  it('toggleMessageActionsMenu opens when closed', () => {
    const { fn, store } = bindMethod('toggleMessageActionsMenu', {
      messageActionsMenuId: null,
    });
    fn('msg-1');
    expect(store.messageActionsMenuId).toBe('msg-1');
  });

  it('toggleMessageActionsMenu closes when same id is open', () => {
    const { fn, store } = bindMethod('toggleMessageActionsMenu', {
      messageActionsMenuId: 'msg-1',
    });
    fn('msg-1');
    expect(store.messageActionsMenuId).toBeNull();
  });

  it('toggleMessageActionsMenu switches to new id when different id is open', () => {
    const { fn, store } = bindMethod('toggleMessageActionsMenu', {
      messageActionsMenuId: 'msg-1',
    });
    fn('msg-2');
    expect(store.messageActionsMenuId).toBe('msg-2');
  });

  it('inspectMessageSyncStatus calls openRecordStatusModal with chat_message family', () => {
    const openRecordStatusModal = vi.fn();
    const { fn, store } = bindMethod('inspectMessageSyncStatus', {
      openRecordStatusModal,
      messages: [
        { record_id: 'msg-1', body: 'Hello world', parent_message_id: null, updated_at: '2024-01-01T00:00:00Z' },
      ],
      messageActionsMenuId: 'msg-1',
    });
    fn('msg-1');
    expect(openRecordStatusModal).toHaveBeenCalledWith({
      familyId: 'chat_message',
      recordId: 'msg-1',
      label: 'Hello world',
    });
    expect(store.messageActionsMenuId).toBeNull();
  });

  it('inspectMessageSyncStatus truncates long message body for label', () => {
    const openRecordStatusModal = vi.fn();
    const longBody = 'A'.repeat(60);
    const { fn } = bindMethod('inspectMessageSyncStatus', {
      openRecordStatusModal,
      messages: [
        { record_id: 'msg-1', body: longBody, parent_message_id: null, updated_at: '2024-01-01T00:00:00Z' },
      ],
      messageActionsMenuId: 'msg-1',
    });
    fn('msg-1');
    const label = openRecordStatusModal.mock.calls[0][0].label;
    expect(label.length).toBeLessThanOrEqual(53);
    expect(label.endsWith('...')).toBe(true);
  });

  it('inspectMessageSyncStatus uses fallback label when message not found', () => {
    const openRecordStatusModal = vi.fn();
    const { fn } = bindMethod('inspectMessageSyncStatus', {
      openRecordStatusModal,
      messages: [],
      messageActionsMenuId: null,
    });
    fn('msg-unknown');
    expect(openRecordStatusModal).toHaveBeenCalledWith({
      familyId: 'chat_message',
      recordId: 'msg-unknown',
      label: 'Chat message',
    });
  });
});

function createDispatchReadyStore(overrides = {}) {
  return createStore({
    ...createChatThreadFlowDispatchState(),
    channels: [
      { record_id: 'channel-1', scope_id: 'scope-channel', title: 'General' },
    ],
    flows: [
      {
        record_id: 'flow-1',
        title: 'Flow One',
        scope_id: 'scope-flow',
        scope_l1_id: 'scope-flow',
        scope_policy_group_ids: ['policy:scope-flow'],
        group_ids: ['group:scope-flow'],
        record_state: 'active',
      },
      {
        record_id: 'flow-2',
        title: 'Flow Two',
        record_state: 'active',
      },
    ],
    chatThreadFlowDispatchSource: {
      channelId: 'channel-1',
      clickedMessageId: 'reply-1',
      threadRootMessageId: 'root-1',
      sourceSurface: 'thread_reply',
      dispatchedAt: '2026-04-21T13:28:21.377Z',
    },
    chatThreadFlowDispatchMessages: [
      {
        record_id: 'root-1',
        channel_id: 'channel-1',
        parent_message_id: null,
        body: 'Root message',
        sender_npub: 'npub1root',
        updated_at: '2026-04-21T13:28:21.377Z',
      },
      {
        record_id: 'reply-1',
        channel_id: 'channel-1',
        parent_message_id: 'root-1',
        body: 'Reply message',
        sender_npub: 'npub1reply',
        updated_at: '2026-04-21T13:30:21.377Z',
      },
    ],
    ...overrides,
  });
}

describe('chat thread flow dispatch modal state', () => {
  it('opens from the canonical message set and leaves the plain flow-start path untouched', async () => {
    const threadRoot = {
      record_id: 'root-1',
      channel_id: 'channel-1',
      parent_message_id: null,
      body: 'Root message',
      updated_at: '2026-04-21T10:00:00.000Z',
      record_state: 'active',
    };
    const earlierReply = {
      record_id: 'reply-1',
      channel_id: 'channel-1',
      parent_message_id: 'root-1',
      body: 'First reply',
      updated_at: '2026-04-21T10:01:00.000Z',
      record_state: 'active',
    };
    const clickedReply = {
      record_id: 'reply-2',
      channel_id: 'channel-1',
      parent_message_id: 'root-1',
      body: 'Clicked reply',
      updated_at: '2026-04-21T10:02:00.000Z',
      record_state: 'active',
    };

    const { fn, store } = bindMethod('openChatThreadFlowDispatch', {
      channels: [{ record_id: 'channel-1', scope_id: 'scope-channel', title: 'General' }],
      flows: [{ record_id: 'flow-1', title: 'Flow One', record_state: 'active' }],
      selectedChannelId: 'channel-1',
      mainFeedVisibleCount: 1,
      messageActionsMenuId: 'reply-2',
      showFlowStartConfirm: true,
      flowStartTarget: { record_id: 'existing-flow' },
      flowStartContext: 'keep-existing-start-context',
      messages: [
        threadRoot,
        earlierReply,
        clickedReply,
        {
          record_id: 'other-root',
          channel_id: 'channel-1',
          parent_message_id: null,
          body: 'Newest top-level message',
          updated_at: '2026-04-21T10:05:00.000Z',
          record_state: 'active',
        },
      ],
    });

    await fn('reply-2', 'thread_reply');

    expect(store.messageActionsMenuId).toBeNull();
    expect(store.showChatThreadFlowDispatchModal).toBe(true);
    expect(store.chatThreadFlowDispatchLoading).toBe(false);
    expect(store.chatThreadFlowDispatchSource).toEqual(expect.objectContaining({
      channelId: 'channel-1',
      clickedMessageId: 'reply-2',
      threadRootMessageId: 'root-1',
      sourceSurface: 'thread_reply',
    }));
    expect(store.chatThreadFlowDispatchMessages.map((message) => message.record_id)).toEqual([
      'root-1',
      'reply-1',
      'reply-2',
    ]);
    expect(store.chatThreadFlowDispatchSelectedFlowId).toBeNull();
    expect(store.chatThreadFlowDispatchManualScopeId).toBeNull();
    expect(store.chatThreadFlowDispatchResolvedScopeId).toBe('scope-channel');
    expect(store.chatThreadFlowDispatchScopeSource).toBe('channel');
    expect(store.chatThreadFlowDispatchResolvedScopeAssignment).toMatchObject({
      scope_id: 'scope-channel',
      write_group_ref: 'group:scope-channel',
    });
    expect(store.showFlowStartConfirm).toBe(true);
    expect(store.flowStartTarget).toEqual({ record_id: 'existing-flow' });
    expect(store.flowStartContext).toBe('keep-existing-start-context');
  });

  it('closeChatThreadFlowDispatch resets the full dispatch state block', () => {
    const store = createStore({
      showChatThreadFlowDispatchModal: true,
      chatThreadFlowDispatchOpenedAt: Date.now(),
      chatThreadFlowDispatchSource: { channelId: 'channel-1' },
      chatThreadFlowDispatchMessages: [{ record_id: 'root-1' }],
      chatThreadFlowDispatchSelectedFlowId: 'flow-1',
      chatThreadFlowDispatchManualScopeId: 'scope-override',
      chatThreadFlowDispatchResolvedScopeId: 'scope-override',
      chatThreadFlowDispatchResolvedScopeAssignment: { scope_id: 'scope-override' },
      chatThreadFlowDispatchScopeSource: 'override',
      chatThreadFlowDispatchLaunchNotes: 'Launch note',
      chatThreadFlowDispatchPreview: 'Preview text',
      chatThreadFlowDispatchDirty: true,
      chatThreadFlowDispatchPreviewStale: true,
      chatThreadFlowDispatchLoading: true,
      chatThreadFlowDispatchSubmitting: true,
      chatThreadFlowDispatchError: 'Failed',
    });

    store.closeChatThreadFlowDispatch();

    const expected = createChatThreadFlowDispatchState();
    for (const [key, value] of Object.entries(expected)) {
      expect(store[key]).toEqual(value);
    }
  });

  it('ignores backdrop close clicks for the opening gesture window', () => {
    const store = createStore({
      showChatThreadFlowDispatchModal: true,
      chatThreadFlowDispatchOpenedAt: Date.now(),
      chatThreadFlowDispatchSource: { channelId: 'channel-1' },
    });

    store.handleChatThreadFlowDispatchOverlayClick();

    expect(store.showChatThreadFlowDispatchModal).toBe(true);
    expect(store.chatThreadFlowDispatchSource).toEqual({ channelId: 'channel-1' });
  });

  it('allows backdrop close clicks after the opening gesture window passes', () => {
    const store = createStore({
      showChatThreadFlowDispatchModal: true,
      chatThreadFlowDispatchOpenedAt: Date.now() - 500,
      chatThreadFlowDispatchSource: { channelId: 'channel-1' },
    });

    store.handleChatThreadFlowDispatchOverlayClick();

    expect(store.showChatThreadFlowDispatchModal).toBe(false);
    expect(store.chatThreadFlowDispatchSource).toBeNull();
  });

  it('keeps thread resolution consistent across main-feed, thread-parent, and thread-reply entry points', async () => {
    const baseOverrides = {
      channels: [{ record_id: 'channel-1', scope_id: 'scope-channel', title: 'General' }],
      flows: [{ record_id: 'flow-1', title: 'Flow One', record_state: 'active' }],
      messages: [
        {
          record_id: 'root-1',
          channel_id: 'channel-1',
          parent_message_id: null,
          body: 'Root message',
          updated_at: '2026-04-21T10:00:00.000Z',
          record_state: 'active',
        },
        {
          record_id: 'reply-1',
          channel_id: 'channel-1',
          parent_message_id: 'root-1',
          body: 'Reply message',
          updated_at: '2026-04-21T10:02:00.000Z',
          record_state: 'active',
        },
      ],
    };

    const mainFeedStore = createStore(baseOverrides);
    const threadParentStore = createStore(baseOverrides);
    const threadReplyStore = createStore(baseOverrides);

    await mainFeedStore.openChatThreadFlowDispatch('root-1', 'main_feed');
    await threadParentStore.openChatThreadFlowDispatch('root-1', 'thread_parent');
    await threadReplyStore.openChatThreadFlowDispatch('reply-1', 'thread_reply');

    const expectedTranscript = ['root-1', 'reply-1'];

    expect(mainFeedStore.chatThreadFlowDispatchSource?.threadRootMessageId).toBe('root-1');
    expect(threadParentStore.chatThreadFlowDispatchSource?.threadRootMessageId).toBe('root-1');
    expect(threadReplyStore.chatThreadFlowDispatchSource?.threadRootMessageId).toBe('root-1');
    expect(mainFeedStore.chatThreadFlowDispatchMessages.map((message) => message.record_id)).toEqual(expectedTranscript);
    expect(threadParentStore.chatThreadFlowDispatchMessages.map((message) => message.record_id)).toEqual(expectedTranscript);
    expect(threadReplyStore.chatThreadFlowDispatchMessages.map((message) => message.record_id)).toEqual(expectedTranscript);
  });
});

describe('chat thread flow dispatch preview lifecycle', () => {
  it('regenerates the preview when flow selection changes while the preview is not dirty', () => {
    const store = createDispatchReadyStore();

    store.chatThreadFlowDispatchSelectedFlowId = 'flow-1';
    store.handleChatThreadFlowDispatchInputsChanged();

    expect(store.chatThreadFlowDispatchPreview).toContain('selected_flow_id: flow-1');
    expect(store.chatThreadFlowDispatchPreview).toContain('selected_flow_title: Flow One');
    expect(store.chatThreadFlowDispatchDirty).toBe(false);
    expect(store.chatThreadFlowDispatchPreviewStale).toBe(false);
  });

  it('regenerates the preview when the manual scope override changes while the preview is not dirty', () => {
    const store = createDispatchReadyStore({
      chatThreadFlowDispatchSelectedFlowId: 'flow-1',
    });

    store.regenerateChatThreadFlowDispatchPreview();
    store.chatThreadFlowDispatchManualScopeId = 'scope-override';
    store.handleChatThreadFlowDispatchInputsChanged();

    expect(store.chatThreadFlowDispatchResolvedScopeId).toBe('scope-override');
    expect(store.chatThreadFlowDispatchScopeSource).toBe('override');
    expect(store.chatThreadFlowDispatchPreview).toContain('resolved_scope_id: scope-override');
  });

  it('regenerates the preview when launch notes change while the preview is not dirty', () => {
    const store = createDispatchReadyStore({
      chatThreadFlowDispatchSelectedFlowId: 'flow-1',
    });

    store.chatThreadFlowDispatchLaunchNotes = 'Use the current repo and preserve acceptance criteria.';
    store.handleChatThreadFlowDispatchInputsChanged();

    expect(store.chatThreadFlowDispatchPreview).toContain('Use the current repo and preserve acceptance criteria.');
  });

  it('marks the preview as dirty after a manual edit', () => {
    const store = createDispatchReadyStore({
      chatThreadFlowDispatchPreview: 'Manually edited preview',
    });

    store.markChatThreadFlowDispatchPreviewEdited();

    expect(store.chatThreadFlowDispatchDirty).toBe(true);
  });

  it('marks the preview stale instead of overwriting manual edits when dependencies change later', () => {
    const store = createDispatchReadyStore({
      chatThreadFlowDispatchSelectedFlowId: 'flow-1',
    });

    store.regenerateChatThreadFlowDispatchPreview();
    store.chatThreadFlowDispatchPreview = 'Manual operator preview';
    store.markChatThreadFlowDispatchPreviewEdited();
    store.chatThreadFlowDispatchLaunchNotes = 'Updated launch note';
    store.handleChatThreadFlowDispatchInputsChanged();

    expect(store.chatThreadFlowDispatchPreview).toBe('Manual operator preview');
    expect(store.chatThreadFlowDispatchPreviewStale).toBe(true);
  });

  it('explicit regenerate clears the stale marker and rebuilds the preview', () => {
    const store = createDispatchReadyStore({
      chatThreadFlowDispatchSelectedFlowId: 'flow-1',
    });

    store.regenerateChatThreadFlowDispatchPreview();
    store.chatThreadFlowDispatchPreview = 'Manual operator preview';
    store.markChatThreadFlowDispatchPreviewEdited();
    store.chatThreadFlowDispatchLaunchNotes = 'Updated launch note';
    store.handleChatThreadFlowDispatchInputsChanged();

    const regenerated = store.regenerateChatThreadFlowDispatchPreview();

    expect(regenerated).toContain('Updated launch note');
    expect(store.chatThreadFlowDispatchPreview).toContain('Updated launch note');
    expect(store.chatThreadFlowDispatchDirty).toBe(false);
    expect(store.chatThreadFlowDispatchPreviewStale).toBe(false);
  });
});
