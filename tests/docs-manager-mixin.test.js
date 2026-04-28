import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { acquireRecordCheckoutMock, releaseRecordCheckoutMock } = vi.hoisted(() => ({
  acquireRecordCheckoutMock: vi.fn(),
  releaseRecordCheckoutMock: vi.fn(),
}));

vi.mock('../src/api.js', () => ({
  acquireRecordCheckout: acquireRecordCheckoutMock,
  fetchRecordHistory: vi.fn(),
  releaseRecordCheckout: releaseRecordCheckoutMock,
}));

import { docsManagerMixin } from '../src/docs-manager.js';
import { isCheckoutHeld } from '../src/lock-managed-records.js';
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

  it('returns loaded subset for doc comment group payload targets', () => {
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

    expect(groupIds).toEqual(['group-loaded']);
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
