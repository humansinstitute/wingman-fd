import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchRecordHistory, syncRecords } from '../src/api.js';
import {
  pullRecordsForFamilies,
  pruneOnLogin,
  runSync,
  connectSSE,
} from '../src/sync-worker-client.js';
import { syncManagerMixin } from '../src/sync-manager.js';
import { getSyncFamilyHash } from '../src/sync-families.js';
import { createNip98AuthHeader, createNip98AuthHeaderForSecret } from '../src/auth/nostr.js';
import { getActiveWorkspaceKeySecretForAuth } from '../src/crypto/workspace-keys.js';

vi.mock('../src/api.js', () => ({
  fetchRecordHistory: vi.fn(),
  syncRecords: vi.fn(),
}));

vi.mock('../src/db.js', () => ({
  getPendingWrites: vi.fn(async () => []),
  getPendingWritesByFamilies: vi.fn(async () => []),
  removePendingWrite: vi.fn(async () => {}),
  clearSyncState: vi.fn(async () => {}),
  clearRuntimeFamilies: vi.fn(async () => {}),
  clearSyncStateForFamilies: vi.fn(async () => {}),
  getSyncQuarantineEntries: vi.fn(async () => []),
  deleteSyncQuarantineEntry: vi.fn(async () => {}),
  clearSyncQuarantineForFamilies: vi.fn(async () => {}),
  deleteRuntimeRecordByFamily: vi.fn(async () => {}),
  upsertTask: vi.fn(async () => {}),
  upsertDocument: vi.fn(async () => {}),
  upsertDirectory: vi.fn(async () => {}),
  upsertChannel: vi.fn(async () => {}),
  upsertMessage: vi.fn(async () => {}),
  getCommentsByTarget: vi.fn(async () => []),
  upsertComment: vi.fn(async () => {}),
}));

vi.mock('../src/sync-worker-client.js', () => ({
  runSync: vi.fn(),
  pullRecordsForFamilies: vi.fn(),
  pruneOnLogin: vi.fn(),
  startWorkerFlushTimer: vi.fn(),
  stopWorkerFlushTimer: vi.fn(),
  connectSSE: vi.fn(),
  disconnectSSE: vi.fn(),
  setSSEStatusCallback: vi.fn(),
  flushNow: vi.fn(),
}));

vi.mock('../src/auth/nostr.js', () => ({
  createNip98AuthHeader: vi.fn(async () => 'Nostr eyJraW5kIjoyNzIzNX0='),
  createNip98AuthHeaderForSecret: vi.fn(async () => 'Nostr eyJzZWNyZXQiOnRydWV9'),
}));

vi.mock('../src/crypto/workspace-keys.js', () => ({
  getActiveWorkspaceKeySecretForAuth: vi.fn(() => null),
  isWorkspaceKeyRegistered: vi.fn(() => false),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

vi.mock('../src/translators/chat.js', () => ({
  outboundChannel: vi.fn(async (payload) => ({ ...payload, record_family_hash: 'family:channel' })),
  outboundChatMessage: vi.fn(async (payload) => ({ ...payload, record_family_hash: 'family:chat_message' })),
  recordFamilyHash: vi.fn((cs) => `mock:${cs}`),
}));

// ---------------------------------------------------------------------------
// Helper: create a fake store with all mixin methods applied
// ---------------------------------------------------------------------------
function createStore(overrides = {}) {
  const store = {
    session: null,
    backendUrl: '',
    navSection: 'chat',
    selectedChannelId: null,
    FAST_SYNC_MS: 1000,
    IDLE_SYNC_MS: 5000,
    BACKGROUND_GROUP_REFRESH_MS: 300000,
    backgroundSyncTimer: null,
    backgroundSyncInFlight: false,
    visibilityHandler: null,
    lastGroupsRefreshAt: 0,
    syncing: false,
    syncStatus: 'synced',
    showAvatarMenu: false,
    showSyncProgressModal: false,
    syncFamilyProgress: [],
    syncSession: {
      state: 'idle',
      phase: 'idle',
      startedAt: null,
      finishedAt: null,
      lastSuccessAt: null,
      manual: false,
      error: null,
      heartbeat: false,
      pushed: 0,
      pushTotal: 0,
      pulled: 0,
      completedFamilies: 0,
      totalFamilies: 0,
      currentFamily: null,
      currentFamilyHash: null,
    },
    syncQuarantine: [],
    repairSelectedFamilyIds: [],
    repairError: null,
    repairNotice: '',
    repairBusy: false,
    repairTaskIdInput: '',
    repairTaskProbeBusy: false,
    recordStatusModalOpen: false,
    recordStatusFamilyId: '',
    recordStatusTargetId: '',
    recordStatusTargetLabel: '',
    recordStatusBusy: false,
    recordStatusSyncBusy: false,
    recordStatusError: null,
    recordStatusNotice: '',
    recordStatusTowerVersionCount: 0,
    recordStatusTowerLatestVersion: 0,
    recordStatusTowerUpdatedAt: '',
    recordStatusLocalPresent: false,
    recordStatusLocalVersion: 0,
    recordStatusLocalSyncStatus: '',
    recordStatusPendingWriteCount: 0,
    recordStatusWriteGroupRef: '',
    recordStatusWriteGroupLabel: '',
    recordStatusWriteGroupKeyLoaded: false,
    syncQuarantineError: null,
    syncQuarantineNotice: '',
    syncQuarantineBusy: false,
    error: null,
    groups: [],
    channels: [],
    messages: [],
    documents: [],
    directories: [],
    reports: [],
    tasks: [],
    taskComments: [],
    scopes: [],
    audioNotes: [],
    schedules: [],
    hasForcedInitialBackfill: false,
    hasForcedTaskFamilyBackfill: false,
    selectedBoardId: null,
    docsEditorOpen: false,
    selectedDocId: null,
    activeTaskId: null,
    wingmanHarnessDirty: false,
    workspaceOwnerNpub: 'npub1owner',
    // Stubs for methods from other mixins
    refreshGroups: vi.fn().mockResolvedValue(undefined),
    refreshChannels: vi.fn().mockResolvedValue(undefined),
    refreshMessages: vi.fn().mockResolvedValue(undefined),
    refreshAudioNotes: vi.fn().mockResolvedValue(undefined),
    refreshDirectories: vi.fn().mockResolvedValue(undefined),
    refreshDocuments: vi.fn().mockResolvedValue(undefined),
    refreshTasks: vi.fn().mockResolvedValue(undefined),
    refreshSchedules: vi.fn().mockResolvedValue(undefined),
    refreshScopes: vi.fn().mockResolvedValue(undefined),
    refreshWorkspaceSettings: vi.fn().mockResolvedValue(undefined),
    refreshStatusRecentChanges: vi.fn().mockResolvedValue(undefined),
    ensureTaskBoardScopeSetup: vi.fn().mockResolvedValue(undefined),
    getEffectiveDocShares: vi.fn((record) => record?.shares || []),
    patchDirectoryLocal: vi.fn(),
    patchDocumentLocal: vi.fn(),
    loadDocComments: vi.fn().mockResolvedValue(undefined),
    loadTaskComments: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };

  // Apply all mixin methods and getters
  const descriptors = Object.getOwnPropertyDescriptors(syncManagerMixin);
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
// Repair UI
// ---------------------------------------------------------------------------
describe('repair UI', () => {
  it('repairFamilyOptions returns SYNC_FAMILY_OPTIONS', () => {
    const store = createStore();
    expect(Array.isArray(store.repairFamilyOptions)).toBe(true);
    expect(store.repairFamilyOptions.length).toBeGreaterThan(0);
    expect(store.repairFamilyOptions[0]).toHaveProperty('id');
  });

  it('isRepairFamilySelected checks list', () => {
    const { fn } = bindMethod('isRepairFamilySelected', {
      repairSelectedFamilyIds: ['task', 'channel'],
    });
    expect(fn('task')).toBe(true);
    expect(fn('document')).toBe(false);
  });

  it('toggleRepairFamily adds and removes', () => {
    const { fn, store } = bindMethod('toggleRepairFamily', {
      repairSelectedFamilyIds: [],
    });
    fn('task');
    expect(store.repairSelectedFamilyIds).toContain('task');
    fn('task');
    expect(store.repairSelectedFamilyIds).not.toContain('task');
  });

  it('toggleRepairFamily clears error and notice', () => {
    const { fn, store } = bindMethod('toggleRepairFamily', {
      repairSelectedFamilyIds: [],
      repairError: 'old error',
      repairNotice: 'old notice',
    });
    fn('task');
    expect(store.repairError).toBeNull();
    expect(store.repairNotice).toBe('');
  });

  it('selectAllRepairFamilies selects all', () => {
    const { fn, store } = bindMethod('selectAllRepairFamilies', {
      repairSelectedFamilyIds: [],
    });
    fn();
    expect(store.repairSelectedFamilyIds.length).toBeGreaterThan(0);
  });

  it('clearRepairFamilies clears all', () => {
    const { fn, store } = bindMethod('clearRepairFamilies', {
      repairSelectedFamilyIds: ['task', 'channel'],
    });
    fn();
    expect(store.repairSelectedFamilyIds).toEqual([]);
  });
});

describe('record status actions', () => {
  it('enables force submit for pending local changes even when Tower already has versions', () => {
    const store = createStore({
      recordStatusTargetId: 'msg-1',
      recordStatusFamilyId: 'chat_message',
      recordStatusLocalPresent: true,
      recordStatusTowerVersionCount: 1,
      recordStatusTowerLatestVersion: 1,
      recordStatusLocalVersion: 2,
      recordStatusLocalSyncStatus: 'failed',
      recordStatusPendingWriteCount: 0,
    });
    expect(store.canForcePushRecordStatusTarget()).toBe(true);
  });

  it('builds chat message force-submit envelopes from the channel group', async () => {
    const store = createStore({
      session: { npub: 'npub1viewer' },
      signingNpub: 'npub1workspacekey',
      workspaceOwnerNpub: 'npub1owner',
      recordStatusTowerLatestVersion: 3,
      channels: [{
        record_id: 'ch-1',
        owner_npub: 'npub1owner',
        group_ids: ['group-1'],
        participant_npubs: ['npub1viewer'],
      }],
    });
    const envelope = await store.buildRecordStatusEnvelope({
      record_id: 'msg-1',
      channel_id: 'ch-1',
      body: 'hello',
      attachments: [],
      record_state: 'active',
      version: 2,
    }, 'chat_message', { bootstrap: false });

    expect(envelope.version).toBe(4);
    expect(envelope.previous_version).toBe(3);
    expect(envelope.channel_group_ids).toEqual(['group-1']);
  });
});

// ---------------------------------------------------------------------------
// Sync quarantine
// ---------------------------------------------------------------------------
describe('sync quarantine', () => {
  it('hasSyncQuarantine reflects quarantine array', () => {
    const s1 = createStore({ syncQuarantine: [] });
    expect(s1.hasSyncQuarantine).toBe(false);

    const s2 = createStore({ syncQuarantine: [{ record_id: 'r1' }] });
    expect(s2.hasSyncQuarantine).toBe(true);
  });

  it('syncQuarantineRecordLabel truncates long IDs', () => {
    const { fn } = bindMethod('syncQuarantineRecordLabel');
    expect(fn({ record_id: 'abcdefghijklmnopqrst' })).toBe('abcdefgh…qrst');
    expect(fn({ record_id: 'short' })).toBe('short');
    expect(fn({})).toBe('Unknown record');
  });

  it('formatSyncQuarantineTimestamp handles various inputs', () => {
    const { fn } = bindMethod('formatSyncQuarantineTimestamp');
    expect(fn(null)).toBe('');
    expect(fn('')).toBe('');
    expect(fn('invalid-date')).toBe('invalid-date');
    // Valid ISO date
    const result = fn('2024-01-15T12:00:00Z');
    expect(result).toBeTruthy();
    expect(typeof result).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// Sync cadence
// ---------------------------------------------------------------------------
describe('getSyncCadenceMs', () => {
  it('returns null when not signed in', () => {
    const { fn } = bindMethod('getSyncCadenceMs', { session: null });
    expect(fn()).toBeNull();
  });

  it('returns null when no backend', () => {
    const { fn } = bindMethod('getSyncCadenceMs', {
      session: { npub: 'npub1me' },
      backendUrl: '',
    });
    expect(fn()).toBeNull();
  });

  it('returns FAST_SYNC_MS for chat with channel selected', () => {
    const { fn } = bindMethod('getSyncCadenceMs', {
      session: { npub: 'npub1me' },
      backendUrl: 'https://backend.example.com',
      navSection: 'chat',
      selectedChannelId: 'ch1',
    });
    expect(fn()).toBe(1000);
  });

  it('returns FAST_SYNC_MS for docs section', () => {
    const { fn } = bindMethod('getSyncCadenceMs', {
      session: { npub: 'npub1me' },
      backendUrl: 'https://backend.example.com',
      navSection: 'docs',
    });
    expect(fn()).toBe(1000);
  });

  it('returns IDLE_SYNC_MS for other sections', () => {
    const { fn } = bindMethod('getSyncCadenceMs', {
      session: { npub: 'npub1me' },
      backendUrl: 'https://backend.example.com',
      navSection: 'status',
      selectedChannelId: null,
    });
    expect(fn()).toBe(5000);
  });
});

// ---------------------------------------------------------------------------
// Sync lifecycle
// ---------------------------------------------------------------------------
describe('stopBackgroundSync', () => {
  it('clears timer', () => {
    const timer = setTimeout(() => {}, 10000);
    const { fn, store } = bindMethod('stopBackgroundSync', {
      backgroundSyncTimer: timer,
    });
    fn();
    expect(store.backgroundSyncTimer).toBeNull();
  });
});

describe('scheduleBackgroundSync', () => {
  it('sets a timer', () => {
    const { fn, store } = bindMethod('scheduleBackgroundSync', {
      session: { npub: 'npub1me' },
      backendUrl: 'https://backend.example.com',
      navSection: 'chat',
      selectedChannelId: 'ch1',
    });
    fn(100);
    expect(store.backgroundSyncTimer).not.toBeNull();
    clearTimeout(store.backgroundSyncTimer);
  });

  it('clears timer when cadence is null', () => {
    const { fn, store } = bindMethod('scheduleBackgroundSync', {
      session: null,
      backgroundSyncTimer: 123,
    });
    fn();
    expect(store.backgroundSyncTimer).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Sync session UI
// ---------------------------------------------------------------------------
describe('updateSyncSession', () => {
  it('merges updates into syncSession', () => {
    const { fn, store } = bindMethod('updateSyncSession');
    fn({ phase: 'pushing', pushed: 5, pushTotal: 10 });
    expect(store.syncSession.phase).toBe('pushing');
    expect(store.syncSession.pushed).toBe(5);
  });
});

describe('sync family progress helpers', () => {
  it('initializeSyncFamilyProgress seeds pending families', () => {
    const { fn, store } = bindMethod('initializeSyncFamilyProgress');
    fn();
    expect(store.syncFamilyProgress.length).toBeGreaterThan(0);
    expect(store.syncFamilyProgress.every((family) => family.status === 'pending')).toBe(true);
  });

  it('handleSyncProgressUpdate marks manual sync families active and done', () => {
    const { fn, store } = bindMethod('handleSyncProgressUpdate', {
      syncSession: {
        state: 'syncing',
        phase: 'checking',
        startedAt: null,
        finishedAt: null,
        lastSuccessAt: null,
        manual: true,
        error: null,
        heartbeat: false,
        pushed: 0,
        pushTotal: 0,
        pulled: 0,
        completedFamilies: 0,
        totalFamilies: 0,
        currentFamily: null,
        currentFamilyHash: null,
      },
      syncFamilyProgress: [
        { id: 'channel', hash: 'family:channel', label: 'Channels', status: 'pending' },
        { id: 'task', hash: 'family:task', label: 'Tasks', status: 'pending' },
      ],
    });

    fn({ phase: 'pulling', currentFamily: 'Channels', currentFamilyHash: 'family:channel', completedFamilies: 0, totalFamilies: 2, pulled: 0 });
    expect(store.syncFamilyProgress[0].status).toBe('active');

    fn({ phase: 'pulling', currentFamily: 'Channels', currentFamilyHash: 'family:channel', completedFamilies: 1, totalFamilies: 2, pulled: 5 });
    expect(store.syncFamilyProgress[0].status).toBe('done');
  });
});

describe('syncProgressLabel', () => {
  it('returns empty for idle', () => {
    const { fn, store } = bindMethod('syncProgressLabel');
    store.syncSession.phase = 'idle';
    expect(fn()).toBe('');
  });

  it('returns checking label', () => {
    const { fn, store } = bindMethod('syncProgressLabel');
    store.syncSession.phase = 'checking';
    expect(fn()).toBe('Checking...');
  });

  it('returns manual checking label for full sync', () => {
    const { fn, store } = bindMethod('syncProgressLabel');
    store.syncSession.phase = 'checking';
    store.syncSession.manual = true;
    expect(fn()).toBe('Starting full sync...');
  });

  it('returns pushing label', () => {
    const { fn, store } = bindMethod('syncProgressLabel');
    store.syncSession.phase = 'pushing';
    store.syncSession.pushed = 3;
    store.syncSession.pushTotal = 10;
    expect(fn()).toBe('Pushing 3 / 10');
  });

  it('returns pulling label with family', () => {
    const { fn, store } = bindMethod('syncProgressLabel');
    store.syncSession.phase = 'pulling';
    store.syncSession.currentFamily = 'tasks';
    store.syncSession.completedFamilies = 2;
    store.syncSession.totalFamilies = 5;
    expect(fn()).toBe('Fetching tasks (2 / 5 collections)');
  });

  it('returns applying label', () => {
    const { fn, store } = bindMethod('syncProgressLabel');
    store.syncSession.phase = 'applying';
    expect(fn()).toBe('Applying...');
  });

  it('returns error label', () => {
    const { fn, store } = bindMethod('syncProgressLabel');
    store.syncSession.phase = 'error';
    expect(fn()).toBe('Sync error');
  });
});

describe('syncProgressPercent', () => {
  it('returns 0 for idle', () => {
    const { fn } = bindMethod('syncProgressPercent');
    expect(fn()).toBe(0);
  });

  it('returns 5 for checking', () => {
    const { fn, store } = bindMethod('syncProgressPercent');
    store.syncSession.phase = 'checking';
    expect(fn()).toBe(5);
  });

  it('returns 100 for done', () => {
    const { fn, store } = bindMethod('syncProgressPercent');
    store.syncSession.phase = 'done';
    expect(fn()).toBe(100);
  });

  it('returns proportional for pushing', () => {
    const { fn, store } = bindMethod('syncProgressPercent');
    store.syncSession.phase = 'pushing';
    store.syncSession.pushed = 5;
    store.syncSession.pushTotal = 10;
    expect(fn()).toBe(25);
  });
});

describe('lastSyncTimeLabel', () => {
  it('returns Never when no last success', () => {
    const { fn } = bindMethod('lastSyncTimeLabel');
    expect(fn()).toBe('Never');
  });

  it('returns Just now for recent sync', () => {
    const { fn, store } = bindMethod('lastSyncTimeLabel');
    store.syncSession.lastSuccessAt = Date.now() - 5000;
    expect(fn()).toBe('Just now');
  });

  it('returns minutes ago', () => {
    const { fn, store } = bindMethod('lastSyncTimeLabel');
    store.syncSession.lastSuccessAt = Date.now() - 180000; // 3 minutes
    expect(fn()).toBe('3m ago');
  });
});

// ---------------------------------------------------------------------------
// performSync
// ---------------------------------------------------------------------------
describe('performSync', () => {
  it('keeps silent no-op syncs on the cheap path', async () => {
    runSync.mockResolvedValueOnce({ pushed: 0, pulled: 0, pruned: 0 });
    const refreshSyncStatus = vi.fn().mockResolvedValue(undefined);
    const refreshStatusRecentChanges = vi.fn().mockResolvedValue(undefined);
    const refreshWorkspaceSettings = vi.fn().mockResolvedValue(undefined);
    const ensureTaskFamilyBackfill = vi.fn().mockResolvedValue(undefined);
    const ensureTaskBoardScopeSetup = vi.fn().mockResolvedValue(undefined);
    const loadDocComments = vi.fn().mockResolvedValue(undefined);
    const refreshGroups = vi.fn().mockResolvedValue(undefined);
    const { fn } = bindMethod('performSync', {
      session: { npub: 'npub1me', method: 'extension' },
      backendUrl: 'https://backend.example.com',
      refreshGroups,
      refreshSyncStatus,
      refreshStatusRecentChanges,
      refreshWorkspaceSettings,
      ensureTaskFamilyBackfill,
      ensureTaskBoardScopeSetup,
      loadDocComments,
      hasForcedInitialBackfill: true,
      groups: [{ group_id: 'g1' }],
    });

    const result = await fn({ silent: true });

    expect(result).toEqual({ pushed: 0, pulled: 0, pruned: 0 });
    expect(runSync).toHaveBeenCalledWith(
      'npub1owner',
      'npub1me',
      expect.any(Function),
      expect.objectContaining({
        authMethod: 'extension',
        backendUrl: 'https://backend.example.com',
        workspaceDbKey: 'npub1owner',
      }),
    );
    expect(refreshGroups).toHaveBeenCalledWith({ minIntervalMs: 300000 });
    expect(refreshWorkspaceSettings).not.toHaveBeenCalled();
    expect(ensureTaskFamilyBackfill).not.toHaveBeenCalled();
    expect(ensureTaskBoardScopeSetup).not.toHaveBeenCalled();
    expect(loadDocComments).not.toHaveBeenCalled();
    expect(refreshStatusRecentChanges).not.toHaveBeenCalled();
    expect(refreshSyncStatus).toHaveBeenCalledWith({ refreshUnread: false });
  });

  it('refreshes derived state when silent sync pulls remote changes', async () => {
    runSync.mockResolvedValueOnce({ pushed: 0, pulled: 3, pruned: 0 });
    const refreshSyncStatus = vi.fn().mockResolvedValue(undefined);
    const refreshWorkspaceSettings = vi.fn().mockResolvedValue(undefined);
    const ensureTaskFamilyBackfill = vi.fn().mockResolvedValue(undefined);
    const ensureTaskBoardScopeSetup = vi.fn().mockResolvedValue(undefined);
    const { fn } = bindMethod('performSync', {
      session: { npub: 'npub1me' },
      backendUrl: 'https://backend.example.com',
      refreshSyncStatus,
      refreshWorkspaceSettings,
      ensureTaskFamilyBackfill,
      ensureTaskBoardScopeSetup,
      hasForcedInitialBackfill: true,
      groups: [{ group_id: 'g1' }],
    });

    await fn({ silent: true });

    expect(refreshWorkspaceSettings).toHaveBeenCalledTimes(1);
    expect(ensureTaskFamilyBackfill).toHaveBeenCalledTimes(1);
    expect(ensureTaskBoardScopeSetup).toHaveBeenCalledTimes(1);
    expect(refreshSyncStatus).toHaveBeenCalledWith({ refreshUnread: true });
  });

  it('returns early when not signed in', async () => {
    const { fn, store } = bindMethod('performSync', { session: null });
    const result = await fn({ silent: true });
    expect(result).toEqual({ pushed: 0, pulled: 0 });
  });

  it('sets error when not configured and not silent', async () => {
    const { fn, store } = bindMethod('performSync', {
      session: null,
      backendUrl: '',
    });
    await fn({ silent: false });
    expect(store.error).toBe('Configure settings first');
  });

  it('opens sync progress modal and forces full sync for manual runs', async () => {
    runSync.mockResolvedValueOnce({ pushed: 2, pulled: 10, pruned: 0 });
    const refreshSyncStatus = vi.fn().mockResolvedValue(undefined);
    const refreshWorkspaceSettings = vi.fn().mockResolvedValue(undefined);
    const ensureTaskFamilyBackfill = vi.fn().mockResolvedValue(undefined);
    const ensureTaskBoardScopeSetup = vi.fn().mockResolvedValue(undefined);
    const refreshGroups = vi.fn().mockResolvedValue(undefined);
    const { fn, store } = bindMethod('performSync', {
      session: { npub: 'npub1me', method: 'extension' },
      backendUrl: 'https://backend.example.com',
      refreshGroups,
      refreshSyncStatus,
      refreshWorkspaceSettings,
      ensureTaskFamilyBackfill,
      ensureTaskBoardScopeSetup,
      hasForcedInitialBackfill: true,
      groups: [{ group_id: 'g1' }],
    });

    await fn({ silent: false, forceFull: true, manual: true });

    expect(store.showSyncProgressModal).toBe(true);
    expect(store.syncSession.manual).toBe(true);
    expect(store.syncFamilyProgress.length).toBeGreaterThan(0);
    expect(runSync).toHaveBeenCalledWith(
      'npub1owner',
      'npub1me',
      expect.any(Function),
      expect.objectContaining({
        forceFull: true,
      }),
    );
  });
});

describe('syncNow', () => {
  it('closes the avatar menu and requests a manual full sync', async () => {
    const performSync = vi.fn().mockResolvedValue(undefined);
    const ensureBackgroundSync = vi.fn();
    const { fn, store } = bindMethod('syncNow', {
      showAvatarMenu: true,
      performSync,
      ensureBackgroundSync,
    });

    await fn();

    expect(store.showAvatarMenu).toBe(false);
    expect(performSync).toHaveBeenCalledWith({ silent: false, forceFull: true, manual: true });
    expect(ensureBackgroundSync).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ensureTaskFamilyBackfill
// ---------------------------------------------------------------------------
describe('ensureTaskFamilyBackfill', () => {
  it('returns false when already backfilled', async () => {
    const { fn } = bindMethod('ensureTaskFamilyBackfill', {
      hasForcedTaskFamilyBackfill: true,
    });
    expect(await fn()).toBe(false);
  });

  it('returns false when no session', async () => {
    const { fn } = bindMethod('ensureTaskFamilyBackfill', {
      session: null,
    });
    expect(await fn()).toBe(false);
  });

  it('returns false when tasks exist', async () => {
    const { fn } = bindMethod('ensureTaskFamilyBackfill', {
      session: { npub: 'npub1me' },
      backendUrl: 'https://backend.example.com',
      tasks: [{ id: 't1' }],
    });
    expect(await fn()).toBe(false);
  });

  it('returns false when no groups', async () => {
    const { fn } = bindMethod('ensureTaskFamilyBackfill', {
      session: { npub: 'npub1me' },
      backendUrl: 'https://backend.example.com',
      groups: [],
      tasks: [],
    });
    expect(await fn()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// restoreSelectedFamiliesFromSuperBased
// ---------------------------------------------------------------------------
describe('restoreSelectedFamiliesFromSuperBased', () => {
  it('sets error when no families selected', async () => {
    const { fn, store } = bindMethod('restoreSelectedFamiliesFromSuperBased', {
      repairSelectedFamilyIds: [],
    });
    await fn();
    expect(store.repairError).toBe('Select at least one record family.');
  });
});

// ---------------------------------------------------------------------------
// probeTaskOnTowerAndRepair
// ---------------------------------------------------------------------------
describe('probeTaskOnTowerAndRepair', () => {
  it('sets error when task id is missing', async () => {
    const { fn, store } = bindMethod('probeTaskOnTowerAndRepair', {
      repairTaskIdInput: '',
    });
    await fn();
    expect(store.repairError).toBe('Enter a task ID.');
  });

  it('reports when a task is not found on Tower', async () => {
    fetchRecordHistory.mockResolvedValueOnce({ versions: [] });
    const { fn, store } = bindMethod('probeTaskOnTowerAndRepair', {
      repairTaskIdInput: 'task-1',
      session: { npub: 'npub1me' },
      workspaceOwnerNpub: 'npub1owner',
      tasks: [],
    });
    await fn();
    expect(store.repairError).toBe('Task not found on Tower for the current workspace/user view.');
  });

  it('reports success when the task exists on Tower and is already local', async () => {
    fetchRecordHistory.mockResolvedValueOnce({ versions: [{ version: 1 }] });
    const { fn, store } = bindMethod('probeTaskOnTowerAndRepair', {
      repairTaskIdInput: 'task-1',
      session: { npub: 'npub1me' },
      workspaceOwnerNpub: 'npub1owner',
      tasks: [{ record_id: 'task-1' }],
    });
    await fn();
    expect(store.repairNotice).toContain('already present locally');
  });

  it('rebuilds the task family when the task exists on Tower but is missing locally', async () => {
    fetchRecordHistory.mockResolvedValueOnce({ versions: [{ version: 1 }, { version: 2 }] });
    const restoreFamiliesFromSuperBased = vi.fn().mockImplementation(async () => {
      store.tasks = [{ record_id: 'task-1' }];
      return { cancelled: false, restored: 1 };
    });
    const { fn, store } = bindMethod('probeTaskOnTowerAndRepair', {
      repairTaskIdInput: 'task-1',
      session: { npub: 'npub1me' },
      workspaceOwnerNpub: 'npub1owner',
      tasks: [],
      restoreFamiliesFromSuperBased,
    });
    await fn();
    expect(restoreFamiliesFromSuperBased).toHaveBeenCalledWith(['task'], { confirm: false });
    expect(store.repairNotice).toContain('restored it locally');
  });
});

// ---------------------------------------------------------------------------
// record status modal
// ---------------------------------------------------------------------------
describe('record status modal', () => {
  it('opens and reports when a local task exists on Tower', async () => {
    fetchRecordHistory.mockResolvedValueOnce({
      versions: [
        { version: 1, updated_at: '2026-03-27T10:00:00.000Z' },
        { version: 2, updated_at: '2026-03-28T11:00:00.000Z' },
      ],
    });
    const { fn, store } = bindMethod('openRecordStatusModal', {
      session: { npub: 'npub1me' },
      tasks: [{ record_id: 'task-1' }],
      getRecordStatusPendingWrites: vi.fn().mockResolvedValue([]),
    });

    await fn({ familyId: 'task', recordId: 'task-1', label: 'Task One' });

    expect(store.recordStatusModalOpen).toBe(true);
    expect(store.recordStatusTowerVersionCount).toBe(2);
    expect(store.recordStatusTowerUpdatedAt).toBe('2026-03-28T11:00:00.000Z');
    expect(store.recordStatusLocalPresent).toBe(true);
    expect(store.recordStatusNotice).toContain('local copy is present');
  });

  it('reports when a record is missing on Tower', async () => {
    fetchRecordHistory.mockResolvedValueOnce({ versions: [] });
    const { fn, store } = bindMethod('openRecordStatusModal', {
      session: { npub: 'npub1me' },
      documents: [{ record_id: 'doc-1' }],
      getRecordStatusPendingWrites: vi.fn().mockResolvedValue([]),
    });

    await fn({ familyId: 'document', recordId: 'doc-1', label: 'Doc One' });

    expect(store.recordStatusNotice).toBe('Doc One is missing on Tower. You can force submit this local snapshot as version 1.');
    expect(store.recordStatusTowerVersionCount).toBe(0);
  });

  it('derives task write groups from the attached scope when the local task row is stale', async () => {
    fetchRecordHistory.mockResolvedValueOnce({ versions: [] });
    const { fn, store } = bindMethod('openRecordStatusModal', {
      session: { npub: 'npub1me' },
      groups: [{ group_id: 'group-1', name: 'Scope Writers' }],
      tasks: [{
        record_id: 'task-1',
        scope_id: 'scope-1',
        scope_l1_id: 'scope-1',
        board_group_id: null,
        group_ids: [],
        shares: [],
      }],
      buildTaskBoardAssignment: vi.fn().mockReturnValue({
        scope_id: 'scope-1',
        scope_l1_id: 'scope-1',
        scope_l2_id: null,
        scope_l3_id: null,
        scope_l4_id: null,
        scope_l5_id: null,
        board_group_id: 'group-1',
        group_ids: ['group-1'],
        shares: [{ type: 'group', group_npub: 'group-1', access: 'write' }],
      }),
      getRecordStatusPendingWrites: vi.fn().mockResolvedValue([]),
      resolveGroupId: vi.fn((groupRef) => groupRef),
      buildScopeDefaultShares: vi.fn((groupIds = []) => groupIds.map((groupId) => ({
        type: 'group',
        group_npub: groupId,
        access: 'write',
      }))),
    });

    await fn({ familyId: 'task', recordId: 'task-1', label: 'Task One' });

    expect(store.recordStatusWriteGroupRef).toBe('group-1');
    expect(store.recordStatusWriteGroupLabel).toBe('Scope Writers');
    expect(store.recordStatusNotice).toBe('Task One is missing on Tower. You can force submit this local snapshot as version 1.');
  });

  it('force-pushes the current local snapshot plus local comments as fresh v1 records and clears stale pending writes', async () => {
    syncRecords.mockResolvedValueOnce({ synced: 1, created: 1, updated: 0, rejected: [] });
    fetchRecordHistory.mockResolvedValueOnce({
      versions: [{ version: 1, updated_at: '2026-03-28T12:00:00.000Z' }],
    });
    const documentFamilyHash = getSyncFamilyHash('document');
    const commentFamilyHash = getSyncFamilyHash('comment');
    const getRecordStatusPendingWrites = vi.fn().mockResolvedValue([
      { row_id: 11, record_id: 'doc-1', record_family_hash: documentFamilyHash, created_at: '2026-03-28T10:00:00.000Z', envelope: { version: 4 } },
      { row_id: 12, record_id: 'comment-1', record_family_hash: commentFamilyHash, created_at: '2026-03-28T11:00:00.000Z', envelope: { version: 2 } },
    ]);
    const getRecordStatusRelatedComments = vi.fn().mockResolvedValue([
      {
        record_id: 'comment-1',
        owner_npub: 'npub1owner',
        target_record_id: 'doc-1',
        target_record_family_hash: documentFamilyHash,
        body: 'hello',
        attachments: [],
        parent_comment_id: null,
      },
    ]);
    const removeRecordStatusPendingWrite = vi.fn().mockResolvedValue(undefined);
    const buildRecordStatusEnvelope = vi.fn().mockResolvedValue({
      record_id: 'doc-1',
      record_family_hash: documentFamilyHash,
      version: 1,
      previous_version: 0,
    });
    const buildRecordStatusCommentEnvelope = vi.fn().mockResolvedValue({
      record_id: 'comment-1',
      record_family_hash: commentFamilyHash,
      version: 1,
      previous_version: 0,
    });
    const markRecordStatusLocalRecordSynced = vi.fn(async function (familyId, localRecord, options = {}) {
      this.documents = this.documents.map((entry) => entry.record_id === localRecord.record_id
        ? { ...entry, sync_status: 'synced', version: options.version ?? entry.version }
        : entry);
    });
    const markRecordStatusCommentsSynced = vi.fn().mockResolvedValue(undefined);
    const { fn, store } = bindMethod('forcePushRecordStatusTarget', {
      session: { npub: 'npub1me' },
      recordStatusFamilyId: 'document',
      recordStatusTargetId: 'doc-1',
      recordStatusTargetLabel: 'Doc One',
      recordStatusLocalPresent: true,
      documents: [{ record_id: 'doc-1', owner_npub: 'npub1owner', group_ids: ['group-1'], shares: ['group-1'], version: 2, sync_status: 'pending' }],
      recordStatusTowerVersionCount: 0,
      getRecordStatusPendingWrites,
      getRecordStatusRelatedComments,
      removeRecordStatusPendingWrite,
      buildRecordStatusEnvelope,
      buildRecordStatusCommentEnvelope,
      markRecordStatusLocalRecordSynced,
      markRecordStatusCommentsSynced,
      checkRecordStatusOnTower: syncManagerMixin.checkRecordStatusOnTower,
    });

    await fn();

    expect(syncRecords).toHaveBeenCalledWith({
      owner_npub: 'npub1owner',
      records: [
        expect.objectContaining({ record_id: 'doc-1', version: 1, previous_version: 0 }),
        expect.objectContaining({ record_id: 'comment-1', version: 1, previous_version: 0 }),
      ],
    });
    expect(removeRecordStatusPendingWrite).toHaveBeenCalledWith(11);
    expect(removeRecordStatusPendingWrite).toHaveBeenCalledWith(12);
    expect(store.recordStatusNotice).toContain('cleared 2 stale pending writes');
    expect(store.recordStatusNotice).toContain('Recreated 1 local comment');
    expect(store.recordStatusLocalPresent).toBe(true);
    expect(store.documents[0].version).toBe(1);
  });

  it('force-pushes scoped tasks using recovered scope groups and persists the repaired assignment locally', async () => {
    syncRecords.mockResolvedValueOnce({ synced: 1, created: 1, updated: 0, rejected: [] });
    fetchRecordHistory.mockResolvedValueOnce({
      versions: [{ version: 1, updated_at: '2026-03-28T12:00:00.000Z' }],
    });
    const taskFamilyHash = getSyncFamilyHash('task');
    const getRecordStatusPendingWrites = vi.fn().mockResolvedValue([]);
    const buildRecordStatusEnvelope = vi.fn().mockResolvedValue({
      record_id: 'task-1',
      record_family_hash: taskFamilyHash,
      version: 1,
      previous_version: 0,
    });
    const buildRecordStatusCommentEnvelope = vi.fn().mockResolvedValue({
      record_id: 'comment-1',
      record_family_hash: getSyncFamilyHash('comment'),
      version: 1,
      previous_version: 0,
    });
    const markRecordStatusLocalRecordSynced = vi.fn(async function (familyId, localRecord, options = {}) {
      this.tasks = this.tasks.map((entry) => entry.record_id === localRecord.record_id
        ? { ...localRecord, sync_status: 'synced', version: options.version ?? entry.version }
        : entry);
    });
    const { fn, store } = bindMethod('forcePushRecordStatusTarget', {
      session: { npub: 'npub1me' },
      recordStatusFamilyId: 'task',
      recordStatusTargetId: 'task-1',
      recordStatusTargetLabel: 'Task One',
      recordStatusLocalPresent: true,
      recordStatusTowerVersionCount: 0,
      groups: [{ group_id: 'group-1', name: 'Scope Writers' }],
      tasks: [{
        record_id: 'task-1',
        owner_npub: 'npub1owner',
        title: 'Task One',
        scope_id: 'scope-1',
        scope_l1_id: 'scope-1',
        board_group_id: null,
        group_ids: [],
        shares: [],
        version: 3,
        sync_status: 'pending',
      }],
      getRecordStatusPendingWrites,
      getRecordStatusRelatedComments: vi.fn().mockResolvedValue([{
        record_id: 'comment-1',
        owner_npub: 'npub1owner',
        target_record_id: 'task-1',
        target_record_family_hash: taskFamilyHash,
        body: 'hello',
        attachments: [],
        parent_comment_id: null,
      }]),
      removeRecordStatusPendingWrite: vi.fn().mockResolvedValue(undefined),
      buildRecordStatusEnvelope,
      buildRecordStatusCommentEnvelope,
      markRecordStatusLocalRecordSynced,
      markRecordStatusCommentsSynced: vi.fn().mockResolvedValue(undefined),
      checkRecordStatusOnTower: syncManagerMixin.checkRecordStatusOnTower,
      buildTaskBoardAssignment: vi.fn().mockReturnValue({
        scope_id: 'scope-1',
        scope_l1_id: 'scope-1',
        scope_l2_id: null,
        scope_l3_id: null,
        scope_l4_id: null,
        scope_l5_id: null,
        board_group_id: 'group-1',
        group_ids: ['group-1'],
        shares: [{ type: 'group', group_npub: 'group-1', access: 'write' }],
      }),
      resolveGroupId: vi.fn((groupRef) => groupRef),
      buildScopeDefaultShares: vi.fn((groupIds = []) => groupIds.map((groupId) => ({
        type: 'group',
        group_npub: groupId,
        access: 'write',
      }))),
    });

    await fn();

    expect(buildRecordStatusEnvelope).toHaveBeenCalledWith(expect.objectContaining({
      board_group_id: 'group-1',
      group_ids: ['group-1'],
    }), 'task', { bootstrap: true });
    expect(buildRecordStatusCommentEnvelope).toHaveBeenCalledWith(expect.objectContaining({
      record_id: 'comment-1',
    }), { targetGroupIds: ['group-1'] });
    expect(markRecordStatusLocalRecordSynced).toHaveBeenCalledWith('task', expect.objectContaining({
      board_group_id: 'group-1',
      group_ids: ['group-1'],
    }), { version: 1 });
    expect(store.tasks[0].board_group_id).toBe('group-1');
    expect(store.tasks[0].group_ids).toEqual(['group-1']);
  });

  it('bootstraps the current local snapshot when pending writes are missing', async () => {
    syncRecords.mockResolvedValueOnce({ synced: 1, created: 1, updated: 0, rejected: [] });
    fetchRecordHistory.mockResolvedValueOnce({
      versions: [{ version: 1, updated_at: '2026-03-28T12:00:00.000Z' }],
    });
    const getRecordStatusPendingWrites = vi.fn().mockResolvedValue([]);
    const removeRecordStatusPendingWrite = vi.fn().mockResolvedValue(undefined);
    const buildRecordStatusEnvelope = vi.fn().mockResolvedValue({
      record_id: 'doc-1',
      record_family_hash: getSyncFamilyHash('document'),
      version: 1,
      previous_version: 0,
    });
    const buildRecordStatusCommentEnvelope = vi.fn();
    const getRecordStatusRelatedComments = vi.fn().mockResolvedValue([]);
    const markRecordStatusLocalRecordSynced = vi.fn(async function (familyId, localRecord, options = {}) {
      this.documents = this.documents.map((entry) => entry.record_id === localRecord.record_id
        ? { ...entry, sync_status: 'synced', version: options.version ?? entry.version }
        : entry);
    });
    const markRecordStatusCommentsSynced = vi.fn().mockResolvedValue(undefined);
    const { fn, store } = bindMethod('forcePushRecordStatusTarget', {
      session: { npub: 'npub1me' },
      recordStatusFamilyId: 'document',
      recordStatusTargetId: 'doc-1',
      recordStatusTargetLabel: 'Doc One',
      recordStatusLocalPresent: true,
      documents: [{ record_id: 'doc-1', owner_npub: 'npub1owner', title: 'Doc One', content: 'hello', group_ids: ['group-1'], shares: ['group-1'], version: 3, sync_status: 'pending' }],
      recordStatusTowerVersionCount: 0,
      getRecordStatusPendingWrites,
      getRecordStatusRelatedComments,
      removeRecordStatusPendingWrite,
      buildRecordStatusEnvelope,
      buildRecordStatusCommentEnvelope,
      markRecordStatusLocalRecordSynced,
      markRecordStatusCommentsSynced,
      checkRecordStatusOnTower: syncManagerMixin.checkRecordStatusOnTower,
    });

    await fn();

    expect(syncRecords).toHaveBeenCalledWith({
      owner_npub: 'npub1owner',
      records: [expect.objectContaining({ record_id: 'doc-1', version: 1, previous_version: 0 })],
    });
    expect(removeRecordStatusPendingWrite).not.toHaveBeenCalled();
    expect(store.documents[0].version).toBe(1);
    expect(store.recordStatusNotice).toContain('Documents version 1');
  });
});

// ---------------------------------------------------------------------------
// dismissSyncQuarantineIssue / retrySyncQuarantineIssue / deleteLocalQuarantinedRecord
// ---------------------------------------------------------------------------
describe('quarantine actions', () => {
  it('retrySyncQuarantineIssue sets error for unknown family', async () => {
    const { fn, store } = bindMethod('retrySyncQuarantineIssue');
    await fn({ family_id: 'nonexistent_family_xyz' });
    expect(store.syncQuarantineError).toBe('Unknown sync family for this quarantine issue.');
  });

  it('deleteLocalQuarantinedRecord sets error for unknown family', async () => {
    const { fn, store } = bindMethod('deleteLocalQuarantinedRecord');
    await fn({ family_id: 'nonexistent_family_xyz' });
    expect(store.syncQuarantineError).toBe('Unknown sync family for this quarantine issue.');
  });
});

// ---------------------------------------------------------------------------
// syncNow
// ---------------------------------------------------------------------------
describe('syncNow', () => {
  it('calls performSync and ensureBackgroundSync', async () => {
    const performSync = vi.fn().mockResolvedValue(undefined);
    const ensureBackgroundSync = vi.fn();
    const { fn } = bindMethod('syncNow', {
      performSync,
      ensureBackgroundSync,
    });
    await fn();
    expect(performSync).toHaveBeenCalledWith({ silent: false, forceFull: true, manual: true });
    expect(ensureBackgroundSync).toHaveBeenCalled();
  });

  it('does not throw when performSync fails', async () => {
    const performSync = vi.fn().mockRejectedValue(new Error('fail'));
    const ensureBackgroundSync = vi.fn();
    const { fn } = bindMethod('syncNow', {
      performSync,
      ensureBackgroundSync,
    });
    await fn();
    expect(ensureBackgroundSync).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SSE token regression — must use NIP-98, never bootstrap connection token
// ---------------------------------------------------------------------------
describe('connectSSEStream — NIP-98 auth token', () => {
  it('passes a NIP-98 token to the worker, not the connection token', async () => {
    const { fn, store } = bindMethod('connectSSEStream', {
      session: { npub: 'npub1viewer' },
      backendUrl: 'https://tower.example',
      workspaceOwnerNpub: 'npub1owner',
      superbasedTokenInput: 'CONNECTION_BOOTSTRAP_TOKEN_SHOULD_NOT_APPEAR',
    });

    await fn();

    expect(connectSSE).toHaveBeenCalledTimes(1);
    const [ownerNpub, viewerNpub, backendUrl, token] = connectSSE.mock.calls[0];

    // The token must be the base64 NIP-98 event, NOT the bootstrap token
    expect(token).not.toBe('CONNECTION_BOOTSTRAP_TOKEN_SHOULD_NOT_APPEAR');
    expect(token).not.toContain('superbased_connection');
    // It should be a base64 string extracted from "Nostr <base64>"
    expect(token).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it('uses workspace key auth when available', async () => {
    getActiveWorkspaceKeySecretForAuth.mockReturnValue('deadbeef');

    const { fn } = bindMethod('connectSSEStream', {
      session: { npub: 'npub1viewer' },
      backendUrl: 'https://tower.example',
      workspaceOwnerNpub: 'npub1owner',
    });

    await fn();

    expect(createNip98AuthHeaderForSecret).toHaveBeenCalledWith(
      'https://tower.example/api/v4/workspaces/npub1owner/stream',
      'GET',
      null,
      'deadbeef',
    );
    expect(createNip98AuthHeader).not.toHaveBeenCalled();
  });

  it('falls back to session auth when no workspace key', async () => {
    getActiveWorkspaceKeySecretForAuth.mockReturnValue(null);

    const { fn } = bindMethod('connectSSEStream', {
      session: { npub: 'npub1viewer' },
      backendUrl: 'https://tower.example',
      workspaceOwnerNpub: 'npub1owner',
    });

    await fn();

    expect(createNip98AuthHeader).toHaveBeenCalledWith(
      'https://tower.example/api/v4/workspaces/npub1owner/stream',
      'GET',
      null,
    );
  });

  it('does not call connectSSE when NIP-98 signing fails', async () => {
    createNip98AuthHeader.mockRejectedValueOnce(new Error('no signer'));
    getActiveWorkspaceKeySecretForAuth.mockReturnValue(null);

    const { fn } = bindMethod('connectSSEStream', {
      session: { npub: 'npub1viewer' },
      backendUrl: 'https://tower.example',
      workspaceOwnerNpub: 'npub1owner',
    });

    await fn();

    expect(connectSSE).not.toHaveBeenCalled();
  });

  it('does not call connectSSE when missing session or backendUrl', async () => {
    const { fn: noSession } = bindMethod('connectSSEStream', {
      session: null,
      backendUrl: 'https://tower.example',
      workspaceOwnerNpub: 'npub1owner',
    });
    await noSession();
    expect(connectSSE).not.toHaveBeenCalled();

    const { fn: noBackend } = bindMethod('connectSSEStream', {
      session: { npub: 'npub1viewer' },
      backendUrl: '',
      workspaceOwnerNpub: 'npub1owner',
    });
    await noBackend();
    expect(connectSSE).not.toHaveBeenCalled();
  });
});
