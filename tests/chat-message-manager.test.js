import { describe, expect, it, vi } from 'vitest';

// Mock Alpine.js — it requires a browser `window` at import time
vi.mock('alpinejs', () => ({
  default: { nextTick: (fn) => fn?.() },
}));

import { chatMessageManagerMixin } from '../src/chat-message-manager.js';

// ---------------------------------------------------------------------------
// Helper: create a fake store with all mixin methods applied
// ---------------------------------------------------------------------------
function createStore(overrides = {}) {
  const store = {
    messages: [],
    channels: [],
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
    threadSize: 'default',
    pendingChatScrollToLatest: false,
    pendingThreadScrollToLatest: false,
    messageImageUploadCount: 0,
    threadImageUploadCount: 0,
    chatFeedScrollFrame: null,
    threadRepliesScrollFrame: null,
    chatPreviewMeasureFrame: null,
    showChannelSettingsModal: false,
    messageActionsMenuId: null,
    error: null,
    session: null,
    botNpub: '',
    backendUrl: '',
    THREAD_REPLY_PAGE_SIZE: 6,
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
    materializeAudioDrafts: vi.fn().mockResolvedValue({ attachments: [] }),
    containsInlineImageUploadToken: vi.fn().mockReturnValue(false),
    _fireMentionTriggers: vi.fn(),
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
      messages: [
        { record_id: 'm1', parent_message_id: null, updated_at: '2024-01-01T00:00:00Z' },
      ],
      expandedChatMessageIds: ['m1', 'm999'],
      truncatedChatMessageIds: ['m999', 'm1'],
    });
    fn();
    expect(store.expandedChatMessageIds).toEqual(['m1']);
    expect(store.truncatedChatMessageIds).toEqual(['m1']);
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
