import { beforeEach, describe, expect, it, vi } from 'vitest';
import './setup.js';

const mocks = vi.hoisted(() => ({
  addPendingWrite: vi.fn(),
  getChannelById: vi.fn(),
  getCommentById: vi.fn(),
  getDocumentById: vi.fn(),
  getMessageById: vi.fn(),
  getReactionByIdentity: vi.fn(),
  getReactionsByTargets: vi.fn(),
  getTaskById: vi.fn(),
  upsertReaction: vi.fn(),
  outboundReaction: vi.fn(),
  getRecordWriteFieldsForStore: vi.fn(),
}));

vi.mock('../src/db.js', () => ({
  addPendingWrite: mocks.addPendingWrite,
  getChannelById: mocks.getChannelById,
  getCommentById: mocks.getCommentById,
  getDocumentById: mocks.getDocumentById,
  getMessageById: mocks.getMessageById,
  getReactionByIdentity: mocks.getReactionByIdentity,
  getReactionsByTargets: mocks.getReactionsByTargets,
  getTaskById: mocks.getTaskById,
  upsertReaction: mocks.upsertReaction,
}));

vi.mock('../src/translators/chat.js', () => ({
  recordFamilyHash: (family) => `app:${family}`,
}));

vi.mock('../src/translators/reactions.js', () => ({
  outboundReaction: mocks.outboundReaction,
}));

vi.mock('../src/preferred-write-group.js', () => ({
  getRecordWriteFieldsForStore: mocks.getRecordWriteFieldsForStore,
}));

import { reactionsManagerMixin } from '../src/reactions-manager.js';

function createStore(overrides = {}) {
  const store = {
    reactionRows: [],
    reactionPickerTargetKey: '',
    messages: [],
    channels: [],
    tasks: [],
    taskComments: [],
    documents: [],
    docComments: [],
    opportunityComments: [],
    selectedDocument: null,
    session: { npub: 'npub1me' },
    signingNpub: 'npub1signer',
    workspaceOwnerNpub: 'npub1owner',
    error: null,
    resolveChatProfile: vi.fn(),
    getTaskWriteFieldsForWrite: vi.fn(),
    getEncryptableDocCommentGroupIdsForWrite: vi.fn(),
    getPreferredDocWriteGroupRef: vi.fn(),
    flushAndBackgroundSync: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  for (const [key, desc] of Object.entries(Object.getOwnPropertyDescriptors(reactionsManagerMixin))) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) continue;
    Object.defineProperty(store, key, desc);
  }
  return store;
}

describe('reactionsManagerMixin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.outboundReaction.mockImplementation(async (payload) => ({
      record_family_hash: 'app:reaction',
      payload,
    }));
    mocks.addPendingWrite.mockResolvedValue(undefined);
    mocks.upsertReaction.mockResolvedValue(undefined);
    mocks.getReactionByIdentity.mockResolvedValue(null);
    mocks.getRecordWriteFieldsForStore.mockResolvedValue({
      group_ids: ['group-chat'],
      write_group_ref: 'group-chat',
    });
  });

  it('summarizes reactions for chat messages, thread replies, task comments, and doc comments', () => {
    const store = createStore({
      messages: [
        { record_id: 'msg-main' },
        { record_id: 'msg-parent' },
        { record_id: 'msg-reply', parent_message_id: 'msg-parent' },
      ],
      taskComments: [
        { record_id: 'task-comment-root' },
      ],
      docComments: [
        { record_id: 'doc-comment-root' },
        { record_id: 'doc-comment-reply', parent_comment_id: 'doc-comment-root' },
      ],
    });
    store.applyReactions([
      { record_id: 'r1', target_record_id: 'msg-main', target_record_family_hash: 'app:chat_message', emoji: 'thumbs_up', reactor_npub: 'npub1me', record_state: 'active' },
      { record_id: 'r2', target_record_id: 'msg-parent', target_record_family_hash: 'app:chat_message', emoji: 'heart', reactor_npub: 'npub1other', record_state: 'active' },
      { record_id: 'r3', target_record_id: 'msg-reply', target_record_family_hash: 'app:chat_message', emoji: 'eyes', reactor_npub: 'npub1other', record_state: 'active' },
      { record_id: 'r4', target_record_id: 'task-comment-root', target_record_family_hash: 'app:comment', emoji: 'party', reactor_npub: 'npub1me', record_state: 'active' },
      { record_id: 'r5', target_record_id: 'doc-comment-root', target_record_family_hash: 'app:comment', emoji: 'smile', reactor_npub: 'npub1other', record_state: 'active' },
      { record_id: 'r6', target_record_id: 'doc-comment-reply', target_record_family_hash: 'app:comment', emoji: 'thumbs_up', reactor_npub: 'npub1me', record_state: 'active' },
      { record_id: 'r7', target_record_id: 'doc-comment-reply', target_record_family_hash: 'app:comment', emoji: 'thumbs_up', reactor_npub: 'npub1deleted', record_state: 'deleted' },
    ]);

    expect(store.getReactionSummary('msg-main', 'app:chat_message')).toMatchObject([
      { emoji: 'thumbs_up', count: 1, reacted_by_me: true },
    ]);
    expect(store.getReactionSummary('msg-parent', 'app:chat_message')).toMatchObject([
      { emoji: 'heart', count: 1, reacted_by_me: false },
    ]);
    expect(store.getReactionSummary('msg-reply', 'app:chat_message')).toMatchObject([
      { emoji: 'eyes', count: 1, reacted_by_me: false },
    ]);
    expect(store.getReactionSummary('task-comment-root', 'app:comment')).toMatchObject([
      { emoji: 'party', count: 1, reacted_by_me: true },
    ]);
    expect(store.getReactionSummary('doc-comment-root', 'app:comment')).toMatchObject([
      { emoji: 'smile', count: 1, reacted_by_me: false },
    ]);
    expect(store.getReactionSummary('doc-comment-reply', 'app:comment')).toMatchObject([
      { emoji: 'thumbs_up', count: 1, reacted_by_me: true },
    ]);
  });

  it('creates a default thumbs_up pending write with channel reaction groups', async () => {
    const store = createStore({
      messages: [{ record_id: 'msg-1', channel_id: 'channel-1' }],
      channels: [{ record_id: 'channel-1', owner_npub: 'npub1owner', group_ids: ['group-chat'] }],
    });

    await store.toggleReaction('msg-1', 'app:chat_message');

    expect(mocks.getRecordWriteFieldsForStore).toHaveBeenCalledWith(
      store,
      expect.objectContaining({ record_id: 'channel-1' }),
      expect.objectContaining({ label: 'Chat reaction write' }),
    );
    expect(mocks.upsertReaction).toHaveBeenCalledWith(expect.objectContaining({
      target_record_id: 'msg-1',
      target_record_family_hash: 'app:chat_message',
      emoji: 'thumbs_up',
      reactor_npub: 'npub1me',
      record_state: 'active',
      version: 1,
    }));
    expect(mocks.outboundReaction).toHaveBeenCalledWith(expect.objectContaining({
      target_record_id: 'msg-1',
      emoji: 'thumbs_up',
      target_group_ids: ['group-chat'],
      write_group_ref: 'group-chat',
      previous_version: 0,
      signature_npub: 'npub1signer',
    }));
    expect(mocks.addPendingWrite).toHaveBeenCalledWith(expect.objectContaining({
      record_family_hash: 'app:reaction',
    }));
  });

  it('blocks chat message reaction writes when no encryptable channel group is resolved', async () => {
    mocks.getRecordWriteFieldsForStore.mockResolvedValue({
      group_ids: [],
      write_group_ref: null,
    });
    const store = createStore({
      messages: [{ record_id: 'msg-1', channel_id: 'channel-1' }],
      channels: [{ record_id: 'channel-1', owner_npub: 'npub1owner' }],
    });

    await store.toggleReaction('msg-1', 'app:chat_message');

    expect(mocks.upsertReaction).not.toHaveBeenCalled();
    expect(mocks.outboundReaction).not.toHaveBeenCalled();
    expect(mocks.addPendingWrite).not.toHaveBeenCalled();
    expect(store.error).toBe('Reaction write is missing target group keys.');
  });

  it('soft-deletes an active own reaction and inherits task comment groups', async () => {
    mocks.getReactionByIdentity.mockResolvedValue({
      record_id: 'reaction-existing',
      record_state: 'active',
      version: 2,
      created_at: '2026-04-30T00:00:00.000Z',
    });
    const store = createStore({
      tasks: [{ record_id: 'task-1', owner_npub: 'npub1owner' }],
      taskComments: [{
        record_id: 'comment-1',
        owner_npub: 'npub1owner',
        target_record_id: 'task-1',
        target_record_family_hash: 'app:task',
      }],
      getTaskWriteFieldsForWrite: vi.fn().mockResolvedValue({
        group_ids: ['group-task'],
        write_group_ref: 'group-task',
      }),
    });

    await store.toggleReaction('comment-1', 'app:comment', 'heart');

    expect(store.getTaskWriteFieldsForWrite).toHaveBeenCalledWith(expect.objectContaining({ record_id: 'task-1' }));
    expect(mocks.upsertReaction).toHaveBeenCalledWith(expect.objectContaining({
      record_id: 'reaction-existing',
      target_record_id: 'comment-1',
      emoji: 'heart',
      record_state: 'deleted',
      version: 3,
    }));
    expect(mocks.outboundReaction).toHaveBeenCalledWith(expect.objectContaining({
      record_id: 'reaction-existing',
      record_state: 'deleted',
      target_group_ids: ['group-task'],
      write_group_ref: 'group-task',
      previous_version: 2,
    }));
  });

  it('blocks task comment reaction writes when no encryptable task group is resolved', async () => {
    const store = createStore({
      tasks: [{ record_id: 'task-1', owner_npub: 'npub1owner' }],
      taskComments: [{
        record_id: 'comment-1',
        owner_npub: 'npub1owner',
        target_record_id: 'task-1',
        target_record_family_hash: 'app:task',
      }],
      getTaskWriteFieldsForWrite: vi.fn().mockResolvedValue({
        group_ids: [],
        write_group_ref: null,
      }),
    });

    await store.toggleReaction('comment-1', 'app:comment', 'heart');

    expect(mocks.upsertReaction).not.toHaveBeenCalled();
    expect(mocks.outboundReaction).not.toHaveBeenCalled();
    expect(mocks.addPendingWrite).not.toHaveBeenCalled();
    expect(store.error).toBe('Reaction write is missing target group keys.');
  });

  it('inherits document comment groups and blocks writes when document keys are unavailable', async () => {
    const store = createStore({
      selectedDocument: { record_id: 'doc-1', owner_npub: 'npub1owner' },
      documents: [{ record_id: 'doc-1', owner_npub: 'npub1owner' }],
      docComments: [{
        record_id: 'doc-comment-1',
        owner_npub: 'npub1owner',
        target_record_id: 'doc-1',
        target_record_family_hash: 'app:document',
      }],
      getEncryptableDocCommentGroupIdsForWrite: vi.fn().mockResolvedValue(['group-doc']),
      getPreferredDocWriteGroupRef: vi.fn().mockReturnValue('group-doc'),
    });

    await store.toggleReaction('doc-comment-1', 'app:comment', 'eyes');

    expect(store.getEncryptableDocCommentGroupIdsForWrite).toHaveBeenCalledWith(expect.objectContaining({ record_id: 'doc-1' }));
    expect(mocks.outboundReaction).toHaveBeenCalledWith(expect.objectContaining({
      target_group_ids: ['group-doc'],
      write_group_ref: 'group-doc',
    }));

    vi.clearAllMocks();
    const blockedStore = createStore({
      error: 'Document comment write is missing group keys: group-missing',
      selectedDocument: { record_id: 'doc-1', owner_npub: 'npub1owner' },
      docComments: [{
        record_id: 'doc-comment-1',
        owner_npub: 'npub1owner',
        target_record_id: 'doc-1',
        target_record_family_hash: 'app:document',
      }],
    });
    blockedStore.getEncryptableDocCommentGroupIdsForWrite = vi.fn(async () => {
      blockedStore.error = 'Document comment write is missing group keys: group-missing';
      return null;
    });

    await blockedStore.toggleReaction('doc-comment-1', 'app:comment', 'eyes');

    expect(mocks.upsertReaction).not.toHaveBeenCalled();
    expect(mocks.addPendingWrite).not.toHaveBeenCalled();
    expect(blockedStore.error).toBe('Document comment write is missing group keys: group-missing');
  });

  it('blocks document comment reaction writes when document group resolution is empty', async () => {
    const store = createStore({
      selectedDocument: { record_id: 'doc-1', owner_npub: 'npub1owner' },
      documents: [{ record_id: 'doc-1', owner_npub: 'npub1owner' }],
      docComments: [{
        record_id: 'doc-comment-1',
        owner_npub: 'npub1owner',
        target_record_id: 'doc-1',
        target_record_family_hash: 'app:document',
      }],
      getEncryptableDocCommentGroupIdsForWrite: vi.fn().mockResolvedValue([]),
      getPreferredDocWriteGroupRef: vi.fn().mockReturnValue(null),
    });

    await store.toggleReaction('doc-comment-1', 'app:comment', 'eyes');

    expect(mocks.upsertReaction).not.toHaveBeenCalled();
    expect(mocks.outboundReaction).not.toHaveBeenCalled();
    expect(mocks.addPendingWrite).not.toHaveBeenCalled();
    expect(store.error).toBe('Reaction write is missing target group keys.');
  });
});
