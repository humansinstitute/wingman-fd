import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  acquireRecordCheckoutMock,
  completeStorageObjectMock,
  downloadStorageObjectMock,
  prepareStorageObjectMock,
  releaseRecordCheckoutMock,
  uploadStorageObjectMock,
} = vi.hoisted(() => ({
  acquireRecordCheckoutMock: vi.fn(),
  completeStorageObjectMock: vi.fn(),
  downloadStorageObjectMock: vi.fn(),
  prepareStorageObjectMock: vi.fn(),
  releaseRecordCheckoutMock: vi.fn(),
  uploadStorageObjectMock: vi.fn(),
}));

vi.mock('../src/api.js', () => ({
  acquireRecordCheckout: acquireRecordCheckoutMock,
  completeStorageObject: completeStorageObjectMock,
  downloadStorageObject: downloadStorageObjectMock,
  fetchRecordHistory: vi.fn(),
  prepareStorageObject: prepareStorageObjectMock,
  releaseRecordCheckout: releaseRecordCheckoutMock,
  uploadStorageObject: uploadStorageObjectMock,
}));

import {
  docsManagerMixin,
  mergeDocumentSaveReferences,
} from '../src/docs-manager.js';
import { isCheckoutHeld } from '../src/lock-managed-records.js';
import {
  DOCUMENT_CONTENT_STORAGE_FORMAT,
  DOCUMENT_CONTENT_STORAGE_MIME,
} from '../src/translators/docs.js';
import {
  cacheGroupKey,
  clearCryptoContext,
  createGroupIdentity,
} from '../src/crypto/group-keys.js';
import { recordFamilyHash } from '../src/translators/chat.js';

function createStore(overrides = {}) {
  const store = {
    ...docsManagerMixin,
    lockManagedCheckoutSessions: {},
    documents: [],
    selectedDocType: null,
    selectedDocId: null,
    selectedDocCommentId: null,
    navSection: 'docs',
    mobileNavOpen: false,
    currentFolderId: null,
    docCommentBackfillAttemptsByDocId: {},
    session: { npub: 'npub1owner' },
    currentWorkspace: { creatorNpub: 'npub1owner' },
    docAutosaveState: 'saved',
    error: '',
    loadDocEditorFromSelection: vi.fn(),
    loadDocComments: vi.fn(),
    syncRoute: vi.fn(),
    ensureBackgroundSync: vi.fn(),
    buildLockManagedCheckoutIdentityContext: vi.fn(() => ({
      workspaceServiceNpub: 'npub1workspace',
      userNpub: 'npub1owner',
      workspaceUserKeyNpub: 'npub1workspacekey',
      signerNpub: 'npub1workspacekey',
    })),
    ...overrides,
  };

  Object.defineProperty(store, 'selectedDocument', {
    configurable: true,
    get() {
      return store.documents.find((item) => item.record_id === store.selectedDocId) || null;
    },
  });

  return store;
}

describe('docsManagerMixin record link save references', () => {
  it('preserves existing generic references when autosave adds parsed mentions', () => {
    const references = mergeDocumentSaveReferences({
      record_id: 'doc-1',
      source_links: [{ type: 'task', id: 'task-source' }],
      references: [
        { type: 'scope', id: 'scope-existing' },
        { type: 'task', id: 'task-source' },
      ],
      deliverable_links: [{ type: 'doc', id: 'doc-output' }],
    }, [
      { type: 'task', id: 'task-mentioned' },
      { type: 'scope', id: 'scope-existing' },
      { type: 'doc', id: 'doc-output' },
    ]);

    expect(references).toEqual([
      { type: 'scope', id: 'scope-existing' },
      { type: 'task', id: 'task-mentioned' },
    ]);
  });
});

describe('docsManagerMixin.getMissingDocGroupRefs', () => {
  beforeEach(() => {
    acquireRecordCheckoutMock.mockReset();
    releaseRecordCheckoutMock.mockReset();
  });

  afterEach(() => {
    clearCryptoContext();
    vi.restoreAllMocks();
  });

  it('returns missing group refs even when at least one group key is loaded', () => {
    const loadedIdentity = createGroupIdentity();
    cacheGroupKey({
      group_id: 'group-loaded',
      group_npub: 'npub1loadedgroup',
      nsec: loadedIdentity.nsec,
    });

    const store = createStore();

    const missing = docsManagerMixin.getMissingDocGroupRefs.call(store, {
      group_ids: ['group-loaded', 'group-missing'],
    });

    expect(missing).toEqual(['group-missing']);
  });

  it('allows write flow to proceed when at least one delivery group key is loaded', async () => {
    const loadedIdentity = createGroupIdentity();
    cacheGroupKey({
      group_id: 'group-loaded',
      group_npub: 'npub1loadedgroup',
      nsec: loadedIdentity.nsec,
    });

    const store = createStore();
    const missing = await docsManagerMixin.ensureDocGroupKeysLoaded.call(store, {
      group_ids: ['group-loaded', 'group-missing'],
    });

    expect(missing).toEqual([]);
  });

  it('fails write flow when no delivery group keys are loaded', async () => {
    const store = createStore();
    const missing = await docsManagerMixin.ensureDocGroupKeysLoaded.call(store, {
      group_ids: ['group-a', 'group-b'],
    });

    expect(missing).toEqual(['group-a', 'group-b']);
  });

  it('fails doc comment payload targets when any document group key is missing', () => {
    const loadedIdentity = createGroupIdentity();
    cacheGroupKey({
      group_id: 'group-loaded',
      group_npub: 'npub1loadedgroup',
      nsec: loadedIdentity.nsec,
    });

    const store = createStore();
    const groupIds = docsManagerMixin.getEncryptableDocCommentGroupIds.call(store, {
      group_ids: ['group-loaded', 'group-missing'],
    });

    expect(groupIds).toBeNull();
    expect(store.error).toContain('group-missing');
  });

  it('fails doc comment payload targets when no group keys are loaded', () => {
    const store = createStore();
    const groupIds = docsManagerMixin.getEncryptableDocCommentGroupIds.call(store, {
      group_ids: ['group-a', 'group-b'],
    });

    expect(groupIds).toBeNull();
    expect(store.error).toContain('Document comment write is missing group keys');
  });

  it('refreshes group keys before choosing doc comment payload targets', async () => {
    const loadedIdentity = createGroupIdentity();
    cacheGroupKey({
      group_id: 'group-loaded',
      group_npub: 'npub1loadedgroup',
      nsec: loadedIdentity.nsec,
    });

    const refreshedIdentity = createGroupIdentity();
    const refreshGroups = vi.fn(async () => {
      cacheGroupKey({
        group_id: 'group-refreshed',
        group_npub: 'npub1refreshedgroup',
        nsec: refreshedIdentity.nsec,
      });
    });
    const store = createStore({ refreshGroups });

    const groupIds = await docsManagerMixin.getEncryptableDocCommentGroupIdsForWrite.call(store, {
      group_ids: ['group-loaded', 'group-refreshed'],
    });

    expect(refreshGroups).toHaveBeenCalledWith({ force: true });
    expect(groupIds).toEqual(['group-loaded', 'group-refreshed']);
  });
});

describe('docsManagerMixin comment loading', () => {
  beforeEach(() => {
    acquireRecordCheckoutMock.mockReset();
    releaseRecordCheckoutMock.mockReset();
  });

  afterEach(() => {
    clearCryptoContext();
    vi.restoreAllMocks();
  });

  it('applies comments returned by an explicit backfill from the live-query path', async () => {
    const backfilledComment = {
      record_id: 'comment-1',
      target_record_id: 'doc-1',
      target_record_family_hash: recordFamilyHash('document'),
      parent_comment_id: null,
      body: 'Visible after backfill',
      sender_npub: 'npub1other',
      record_state: 'active',
      version: 1,
      updated_at: '2026-04-26T00:00:00.000Z',
    };
    const store = createStore({
      selectedDocType: 'document',
      selectedDocId: 'doc-1',
      docComments: [],
      rememberPeople: vi.fn(async () => {}),
      scheduleDocCommentConnectorUpdate: vi.fn(),
      scheduleStorageImageHydration: vi.fn(),
      backfillDocCommentsFromBackend: vi.fn(async () => [backfilledComment]),
    });

    await store.applyDocComments([], { allowBackfill: true });

    expect(store.backfillDocCommentsFromBackend).toHaveBeenCalledWith('doc-1', recordFamilyHash('document'));
    expect(store.docComments).toEqual([backfilledComment]);
  });
});

describe('docsManagerMixin comment drawer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts the doc comments drawer collapsed when opening a document normally', () => {
    const store = createStore({
      documents: [{ record_id: 'doc-1', parent_directory_id: 'dir-1' }],
      docCommentsVisible: true,
    });

    store.openDoc('doc-1');

    expect(store.docCommentsVisible).toBe(false);
    expect(store.selectedDocCommentId).toBeNull();
  });

  it('opens the doc comments drawer when routing directly to a comment', () => {
    const store = createStore({
      documents: [{ record_id: 'doc-1', parent_directory_id: 'dir-1' }],
      docCommentsVisible: false,
    });

    store.openDoc('doc-1', { commentId: 'comment-1' });

    expect(store.docCommentsVisible).toBe(true);
    expect(store.selectedDocCommentId).toBe('comment-1');
  });

  it('opens an inline anchored composer instead of the legacy modal', () => {
    const store = createStore({
      selectedDocId: 'doc-1',
      docCommentsVisible: false,
      selectedDocCommentId: 'comment-1',
      showDocCommentModal: false,
      scheduleDocCommentConnectorUpdate: vi.fn(),
    });

    store.openDocCommentModal({ id: 'block-1-3', start_line: 3 });

    expect(store.docCommentsVisible).toBe(true);
    expect(store.docCommentAnchorLine).toBe(3);
    expect(store.docCommentAnchorBlockId).toBe('block-1-3');
    expect(store.selectedDocCommentId).toBeNull();
    expect(store.showDocCommentModal).toBe(false);
  });

  it('uses the selected read-mode block when the drawer plus starts a comment', () => {
    const blocks = [
      { id: 'block-1-1', start_line: 1, raw: 'First' },
      { id: 'block-1-4', start_line: 4, raw: 'Second' },
    ];
    const store = createStore({
      selectedDocId: 'doc-1',
      docEditorMode: 'preview',
      docEditorBlocks: blocks,
      docSelectedBlockId: null,
      scheduleDocCommentConnectorUpdate: vi.fn(),
      syncRoute: vi.fn(),
      clearDocCommentConnector: vi.fn(),
    });

    store.selectDocBlockForComment(blocks[1], 1);
    store.startDocCommentPlacement();

    expect(store.docCommentsVisible).toBe(true);
    expect(store.docSelectedBlockId).toBe('block-1-4');
    expect(store.docCommentAnchorLine).toBe(4);
    expect(store.docCommentAnchorBlockId).toBe('block-1-4');
    expect(store.selectedDocCommentId).toBeNull();
  });

  it('uses the active edit-mode block when the drawer plus starts a comment', () => {
    const blocks = [
      { id: 'block-1-1', start_line: 1, raw: 'First' },
      { id: 'block-1-6', start_line: 6, raw: 'Editing' },
    ];
    const store = createStore({
      selectedDocId: 'doc-1',
      docEditorMode: 'block',
      docEditorBlocks: blocks,
      docEditingBlockIndex: 1,
      docSelectedBlockId: null,
      scheduleDocCommentConnectorUpdate: vi.fn(),
      syncRoute: vi.fn(),
      clearDocCommentConnector: vi.fn(),
    });

    store.startDocCommentPlacement();

    expect(store.docSelectedBlockId).toBe('block-1-6');
    expect(store.docCommentAnchorLine).toBe(6);
    expect(store.docCommentAnchorBlockId).toBe('block-1-6');
  });

  it('lists root comments and replies separately for the drawer', () => {
    const store = createStore({
      docComments: [
        { record_id: 'reply-1', parent_comment_id: 'root-1', record_state: 'active', updated_at: '2026-01-01T00:02:00Z' },
        { record_id: 'root-2', parent_comment_id: null, record_state: 'deleted', updated_at: '2026-01-01T00:03:00Z' },
        { record_id: 'root-1', parent_comment_id: null, record_state: 'active', updated_at: '2026-01-01T00:01:00Z' },
      ],
    });

    expect(store.getRootDocComments().map((comment) => comment.record_id)).toEqual(['root-1']);
    expect(store.getDocCommentReplies('root-1').map((comment) => comment.record_id)).toEqual(['reply-1']);
  });

  it('orders root comment threads by document block position before timestamp', () => {
    const store = createStore({
      docEditorBlocks: [
        { id: 'block-1', start_line: 1 },
        { id: 'block-2', start_line: 8 },
        { id: 'block-3', start_line: 14 },
      ],
      docComments: [
        {
          record_id: 'late-block-1',
          parent_comment_id: null,
          anchor_block_id: 'block-1',
          anchor_line_number: 1,
          record_state: 'active',
          created_at: '2026-01-01T00:04:00Z',
          updated_at: '2026-01-01T00:04:00Z',
        },
        {
          record_id: 'early-block-3',
          parent_comment_id: null,
          anchor_block_id: 'block-3',
          anchor_line_number: 14,
          record_state: 'active',
          created_at: '2026-01-01T00:01:00Z',
          updated_at: '2026-01-01T00:01:00Z',
        },
        {
          record_id: 'line-fallback-block-2',
          parent_comment_id: null,
          anchor_block_id: null,
          anchor_line_number: 8,
          record_state: 'active',
          created_at: '2026-01-01T00:03:00Z',
          updated_at: '2026-01-01T00:03:00Z',
        },
      ],
    });

    expect(store.getRootDocComments().map((comment) => comment.record_id)).toEqual([
      'late-block-1',
      'line-fallback-block-2',
      'early-block-3',
    ]);
  });
});

describe('docsManagerMixin checkout orchestration', () => {
  const documentFamilyHash = recordFamilyHash('document');

  beforeEach(() => {
    acquireRecordCheckoutMock.mockReset();
    releaseRecordCheckoutMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('releases the previous document checkout when switching records', () => {
    const previousRecord = { record_id: 'doc-a', parent_directory_id: 'dir-a', sync_status: 'synced' };
    const nextRecord = { record_id: 'doc-b', parent_directory_id: 'dir-b', sync_status: 'synced' };
    const store = createStore({
      documents: [previousRecord, nextRecord],
      selectedDocType: 'document',
      selectedDocId: 'doc-a',
      releaseLockManagedCheckout: vi.fn(async () => true),
    });

    store.openDoc('doc-b');

    expect(store.releaseLockManagedCheckout).toHaveBeenCalledWith(
      previousRecord,
      documentFamilyHash,
      { reportError: false },
    );
    expect(store.selectedDocId).toBe('doc-b');
    expect(store.currentFolderId).toBe('dir-b');
  });

  it('does not release a held checkout while a local write is still pending', async () => {
    const store = createStore();
    store.setLockManagedCheckoutSession('doc-a', documentFamilyHash, {
      acquireState: 'held',
      checkout: {
        state: 'checked_out',
        checkout_id: 'checkout-1',
        lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    });

    const released = await store.releaseLockManagedCheckout(
      { record_id: 'doc-a', sync_status: 'pending' },
      documentFamilyHash,
    );

    expect(released).toBe(false);
    expect(releaseRecordCheckoutMock).not.toHaveBeenCalled();
    expect(store.getLockManagedCheckoutSession('doc-a', documentFamilyHash)?.checkout?.checkout_id).toBe('checkout-1');
  });

  it('reuses the same idempotency key across acquire retries for the same edit intent', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('edit-session-1');
    const conflict = new Error('conflict');
    conflict.classification = 'checkout_conflict';
    acquireRecordCheckoutMock
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce({
        checkout: {
          state: 'checked_out',
          checkout_id: 'checkout-2',
          lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
        },
      });

    const store = createStore();
    const record = { record_id: 'doc-a', sync_status: 'synced', version: 1 };

    await expect(
      store.ensureLockManagedCheckout(record, documentFamilyHash, { intent: 'edit', reportError: false }),
    ).rejects.toMatchObject({ classification: 'checkout_conflict' });

    const checkout = await store.ensureLockManagedCheckout(record, documentFamilyHash, {
      intent: 'edit',
      reportError: false,
    });

    expect(checkout?.checkout_id).toBe('checkout-2');
    expect(acquireRecordCheckoutMock).toHaveBeenCalledTimes(2);
    expect(acquireRecordCheckoutMock.mock.calls[0][0].idempotencyKey).toBe('edit-session-1');
    expect(acquireRecordCheckoutMock.mock.calls[1][0].idempotencyKey).toBe('edit-session-1');
  });

  it('acquires checkout before entering document edit mode', async () => {
    acquireRecordCheckoutMock.mockResolvedValueOnce({
      checkout: {
        state: 'checked_out',
        checkout_id: 'checkout-doc-edit-1',
        lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    });

    const record = { record_id: 'doc-a', sync_status: 'synced', version: 1 };
    const store = createStore({
      documents: [record],
      selectedDocType: 'document',
      selectedDocId: 'doc-a',
      setDocEditorMode: vi.fn(),
    });

    const entered = await store.enterSelectedDocEditMode('block');

    expect(entered).toBe(true);
    expect(acquireRecordCheckoutMock).toHaveBeenCalledWith(expect.objectContaining({
      recordId: 'doc-a',
      recordFamilyHash: documentFamilyHash,
    }));
    expect(store.setDocEditorMode).toHaveBeenCalledWith('block');
  });

  it('allows delegated workspace-key checkout attempts when local creator differs', async () => {
    acquireRecordCheckoutMock.mockResolvedValueOnce({
      checkout: {
        state: 'checked_out',
        checkout_id: 'checkout-delegated-owner-1',
        lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    const store = createStore({
      session: { npub: 'npub1owneruser' },
      currentWorkspace: { creatorNpub: 'npub1workspaceservice' },
      buildLockManagedCheckoutIdentityContext: vi.fn(() => ({
        workspaceServiceNpub: 'npub1workspaceservice',
        userNpub: 'npub1owneruser',
        workspaceUserKeyNpub: 'npub1workspacekey',
        signerNpub: 'npub1workspacekey',
      })),
    });

    const checkout = await store.ensureLockManagedCheckout(
      { record_id: 'doc-a', sync_status: 'synced', version: 1 },
      documentFamilyHash,
      { reportError: false },
    );

    expect(checkout?.checkout_id).toBe('checkout-delegated-owner-1');
    expect(acquireRecordCheckoutMock).toHaveBeenCalledTimes(1);
    expect(acquireRecordCheckoutMock).toHaveBeenCalledWith(expect.objectContaining({
      identityContext: expect.objectContaining({
        userNpub: 'npub1owneruser',
        workspaceUserKeyNpub: 'npub1workspacekey',
      }),
    }));
  });

  it('maps Tower non-owner checkout_required rejections after acquire attempt', async () => {
    const forbidden = new Error('not owner');
    forbidden.classification = 'edit_policy_forbidden';
    acquireRecordCheckoutMock.mockRejectedValueOnce(forbidden);
    const store = createStore({
      session: { npub: 'npub1collaborator' },
      currentWorkspace: { creatorNpub: 'npub1workspaceservice' },
      buildLockManagedCheckoutIdentityContext: vi.fn(() => ({
        workspaceServiceNpub: 'npub1workspace',
        userNpub: 'npub1collaborator',
        workspaceUserKeyNpub: 'npub1workspacekey',
        signerNpub: 'npub1workspacekey',
      })),
    });

    await expect(store.ensureLockManagedCheckout(
      { record_id: 'doc-a', sync_status: 'synced', version: 1 },
      documentFamilyHash,
      { reportError: false },
    )).rejects.toMatchObject({ classification: 'edit_policy_forbidden' });

    expect(acquireRecordCheckoutMock).toHaveBeenCalledTimes(1);
    expect(store.getLockManagedCheckoutSession('doc-a', documentFamilyHash)).toMatchObject({
      acquireState: 'blocked',
      classification: 'edit_policy_forbidden',
    });
  });

  it('blocks missing checkout identity before acquire', async () => {
    const missingIdentity = new Error('missing workspace key');
    missingIdentity.classification = 'workspace_key_missing';
    const store = createStore({
      session: null,
      currentWorkspace: { creatorNpub: 'npub1owner' },
      buildLockManagedCheckoutIdentityContext: vi.fn(() => {
        throw missingIdentity;
      }),
    });

    await expect(store.ensureLockManagedCheckout(
      { record_id: 'doc-a', sync_status: 'synced', version: 1 },
      documentFamilyHash,
      { reportError: false },
    )).rejects.toMatchObject({ classification: 'workspace_key_missing' });

    expect(acquireRecordCheckoutMock).not.toHaveBeenCalled();
    expect(store.getLockManagedCheckoutSession('doc-a', documentFamilyHash)).toMatchObject({
      acquireState: 'blocked',
      classification: 'workspace_key_missing',
    });
  });

  it('maps blocked checkout errors to deterministic UI state', async () => {
    const conflict = new Error('record checked out');
    conflict.classification = 'record_checked_out';
    conflict.response = {
      checkout: {
        state: 'checked_out',
        checked_out_by_user_npub: 'npub1other',
        lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    };
    acquireRecordCheckoutMock.mockRejectedValueOnce(conflict);

    const store = createStore();

    await expect(store.ensureLockManagedCheckout(
      { record_id: 'doc-a', sync_status: 'synced', version: 1 },
      documentFamilyHash,
      { reportError: false },
    )).rejects.toMatchObject({ classification: 'record_checked_out' });

    expect(store.getLockManagedCheckoutSession('doc-a', documentFamilyHash)).toMatchObject({
      acquireState: 'blocked',
      classification: 'record_checked_out',
      message: expect.stringContaining('Checked out by npub1other'),
    });
  });

  it('routes directory mutations through checkout_required acquire', async () => {
    acquireRecordCheckoutMock.mockResolvedValueOnce({
      checkout: {
        state: 'checked_out',
        checkout_id: 'checkout-dir-1',
        lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    });

    const store = createStore();
    const checkout = await store.ensureLockManagedCheckout(
      { record_id: 'dir-a', sync_status: 'synced', version: 1 },
      recordFamilyHash('directory'),
      { reportError: false },
    );

    expect(checkout?.checkout_id).toBe('checkout-dir-1');
    expect(acquireRecordCheckoutMock).toHaveBeenCalledWith(expect.objectContaining({
      recordId: 'dir-a',
      recordFamilyHash: recordFamilyHash('directory'),
    }));
  });

  it('can opt task edits into checkout_required through policy config', async () => {
    acquireRecordCheckoutMock.mockResolvedValueOnce({
      checkout: {
        state: 'checked_out',
        checkout_id: 'checkout-task-1',
        lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    });

    const store = createStore({
      recordCheckoutPolicyConfig: { familySuffixes: { task: 'checkout_required' } },
    });
    const envelope = {
      record_id: 'task-a',
      record_family_hash: recordFamilyHash('task'),
      version: 2,
    };

    const managedEnvelope = await store.attachCheckoutRequiredCheckoutToEnvelope(
      { record_id: 'task-a', sync_status: 'synced', version: 1 },
      envelope,
      { reportError: false },
    );

    expect(managedEnvelope.checkout).toEqual({
      checkout_id: 'checkout-task-1',
      consume_on_success: true,
    });
    expect(acquireRecordCheckoutMock).toHaveBeenCalledWith(expect.objectContaining({
      recordId: 'task-a',
      recordFamilyHash: recordFamilyHash('task'),
    }));
  });

  it('can opt one task edit envelope into checkout_required without changing store defaults', async () => {
    acquireRecordCheckoutMock.mockResolvedValueOnce({
      checkout: {
        state: 'checked_out',
        checkout_id: 'checkout-task-local-1',
        lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
      },
    });

    const store = createStore();
    const envelope = {
      record_id: 'task-local',
      record_family_hash: recordFamilyHash('task'),
      version: 2,
    };

    expect(store.isCheckoutRequiredRecordFamily(recordFamilyHash('task'))).toBe(false);

    const managedEnvelope = await store.attachCheckoutRequiredCheckoutToEnvelope(
      { record_id: 'task-local', sync_status: 'synced', version: 1 },
      envelope,
      {
        reportError: false,
        checkoutPolicyConfig: { familySuffixes: { task: 'checkout_required' } },
      },
    );

    expect(managedEnvelope.checkout).toEqual({
      checkout_id: 'checkout-task-local-1',
      consume_on_success: true,
    });
    expect(store.isCheckoutRequiredRecordFamily(recordFamilyHash('task'))).toBe(false);
  });

  it('saveAndExitSelectedDocEditMode saves, returns to read mode, and force-releases checkout', async () => {
    const record = { record_id: 'doc-a', sync_status: 'pending', version: 2 };
    const store = createStore({
      documents: [record],
      selectedDocType: 'document',
      selectedDocId: 'doc-a',
      docEditorMode: 'block',
      docEditingBlockIndex: 1,
      commitDocBlockEdit: vi.fn(),
      saveSelectedDocItem: vi.fn(async () => record),
      setDocEditorMode: vi.fn(),
      releaseLockManagedCheckout: vi.fn(async () => true),
    });

    const saved = await store.saveAndExitSelectedDocEditMode();

    expect(saved).toBe(true);
    expect(store.commitDocBlockEdit).toHaveBeenCalledTimes(1);
    expect(store.saveSelectedDocItem).toHaveBeenCalledWith({ autosave: false });
    expect(store.setDocEditorMode).toHaveBeenCalledWith('preview');
    expect(store.releaseLockManagedCheckout).toHaveBeenCalledWith(
      record,
      documentFamilyHash,
      { reportError: false, force: true },
    );
  });
});

describe('docsManagerMixin canonical row normalization', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uploads oversized document content for envelope storage', async () => {
    prepareStorageObjectMock.mockResolvedValue({ object_id: 'storage-doc-1', upload_url: '' });
    uploadStorageObjectMock.mockResolvedValue({});
    completeStorageObjectMock.mockResolvedValue({});

    const store = createStore({
      workspaceOwnerNpub: 'npub1workspace',
      _resolveDocGroupRef: (value) => String(value || '').trim() || null,
    });
    const contentModel = {
      content: 'Transcript line\n'.repeat(6000),
      content_format: 'block_document_v1',
      content_blocks: [{ id: 'blk-1', type: 'markdown', text: 'Transcript line'.repeat(6000), attrs: {} }],
    };

    const payload = await store.prepareDocumentContentForEnvelope({
      record_id: 'doc-large',
      owner_npub: 'npub1workspace',
      title: 'Transcript',
      write_group_ref: 'group-1',
      shares: [],
    }, contentModel, ['group-1']);

    expect(prepareStorageObjectMock).toHaveBeenCalledWith(expect.objectContaining({
      owner_npub: 'npub1workspace',
      owner_group_id: 'group-1',
      access_group_ids: ['group-1'],
      content_type: DOCUMENT_CONTENT_STORAGE_MIME,
    }));
    expect(uploadStorageObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({ object_id: 'storage-doc-1' }),
      expect.any(Uint8Array),
      DOCUMENT_CONTENT_STORAGE_MIME,
    );
    expect(completeStorageObjectMock).toHaveBeenCalledWith('storage-doc-1', expect.objectContaining({
      size_bytes: expect.any(Number),
      sha256_hex: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    expect(payload.content_storage_object_id).toBe('storage-doc-1');
    expect(payload.content_storage_format).toBe(DOCUMENT_CONTENT_STORAGE_FORMAT);
    expect(payload.content).toHaveLength(8192);
    expect(payload.content_blocks).toEqual([]);
  });

  it('preserves non-writable delivery groups in canonical document rows', () => {
    const store = createStore();

    const normalized = store.normalizeDocumentRowGroupRefs({
      group_ids: ['g-allowed', 'g-hidden'],
      scope_policy_group_ids: ['g-allowed', 'g-hidden'],
      write_group_id: 'g-hidden',
      shares: [
        { type: 'group', group_id: 'g-allowed', access: 'write' },
        { type: 'group', group_id: 'g-hidden', access: 'write' },
        { type: 'person', person_npub: 'npub1friend', via_group_id: 'g-hidden', access: 'read' },
      ],
    });

    expect(normalized.group_ids).toEqual(['g-allowed', 'g-hidden']);
    expect(normalized.scope_policy_group_ids).toEqual(['g-allowed', 'g-hidden']);
    expect(normalized.shares).toHaveLength(3);
  });

  it('preserves non-writable delivery groups in canonical directory rows', () => {
    const store = createStore();

    const normalized = store.normalizeDirectoryRowGroupRefs({
      group_ids: ['g-allowed', 'g-hidden'],
      scope_policy_group_ids: ['g-hidden'],
      shares: [
        { type: 'group', group_id: 'g-allowed', access: 'write' },
        { type: 'group', group_id: 'g-hidden', access: 'read' },
      ],
    });

    expect(normalized.group_ids).toEqual(['g-hidden', 'g-allowed']);
    expect(normalized.scope_policy_group_ids).toEqual(['g-hidden']);
    expect(normalized.shares).toHaveLength(2);
  });
});

describe('lock-managed checkout state helpers', () => {
  it('treats an expired lease as not held', () => {
    expect(isCheckoutHeld({
      state: 'checked_out',
      checkout_id: 'checkout-1',
      lease_expires_at: '2026-04-24T00:00:00.000Z',
    }, Date.parse('2026-04-24T00:00:01.000Z'))).toBe(false);
  });
});
