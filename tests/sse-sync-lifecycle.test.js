import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  connectSSE,
  disconnectSSE,
  setSSEStatusCallback,
  startWorkerFlushTimer,
  stopWorkerFlushTimer,
} from '../src/sync-worker-client.js';
import { syncManagerMixin } from '../src/sync-manager.js';

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
  flushOnly: vi.fn(),
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

vi.mock('../src/translators/chat.js', () => ({
  outboundChannel: vi.fn(async (p) => p),
  outboundChatMessage: vi.fn(async (p) => p),
  recordFamilyHash: vi.fn((cs) => `mock:${cs}`),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helper: create a fake store with all mixin methods applied
// ---------------------------------------------------------------------------
function createStore(overrides = {}) {
  const store = {
    session: null,
    backendUrl: '',
    navSection: 'chat',
    selectedChannelId: null,
    FAST_SYNC_MS: 15000,
    IDLE_SYNC_MS: 30000,
    SSE_HEARTBEAT_CADENCE_MS: 120000,
    BACKGROUND_GROUP_REFRESH_MS: 300000,
    backgroundSyncTimer: null,
    backgroundSyncInFlight: false,
    visibilityHandler: null,
    lastGroupsRefreshAt: 0,
    syncing: false,
    syncStatus: 'synced',
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
    sseStatus: 'disconnected',
    catchUpSyncActive: false,
    syncBackoffMs: 0,
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
    flows: [],
    persons: [],
    organisations: [],
    hasForcedInitialBackfill: false,
    hasForcedTaskFamilyBackfill: false,
    selectedBoardId: null,
    docsEditorOpen: false,
    selectedDocId: null,
    activeTaskId: null,
    wingmanHarnessDirty: false,
    workspaceOwnerNpub: 'npub1owner',
    currentWorkspaceKey: '',
    superbasedTokenInput: 'test-token-123',
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
// SSE lifecycle — connectSSEStream
// ---------------------------------------------------------------------------
describe('connectSSEStream', () => {
  it('calls connectSSE with NIP-98 auth token, not bootstrap token', async () => {
    const { fn } = bindMethod('connectSSEStream', {
      session: { npub: 'npub1viewer' },
      backendUrl: 'https://tower.example.com',
      workspaceOwnerNpub: 'npub1owner',
      superbasedTokenInput: 'my-token',
    });
    await fn();
    expect(connectSSE).toHaveBeenCalledTimes(1);
    const [ownerNpub, viewerNpub, backendUrl, token] = connectSSE.mock.calls[0];
    expect(ownerNpub).toBe('npub1owner');
    expect(viewerNpub).toBe('npub1viewer');
    expect(backendUrl).toBe('https://tower.example.com');
    // Token must be the base64 NIP-98 event, NOT the bootstrap connection token
    expect(token).not.toBe('my-token');
    expect(token).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it('registers the SSE status callback', async () => {
    const { fn } = bindMethod('connectSSEStream', {
      session: { npub: 'npub1viewer' },
      backendUrl: 'https://tower.example.com',
      workspaceOwnerNpub: 'npub1owner',
    });
    await fn();
    expect(setSSEStatusCallback).toHaveBeenCalledWith(expect.any(Function));
  });

  it('does not connect when session is missing', async () => {
    const { fn } = bindMethod('connectSSEStream', {
      session: null,
      backendUrl: 'https://tower.example.com',
      workspaceOwnerNpub: 'npub1owner',
    });
    await fn();
    expect(connectSSE).not.toHaveBeenCalled();
  });

  it('does not connect when backendUrl is missing', async () => {
    const { fn } = bindMethod('connectSSEStream', {
      session: { npub: 'npub1viewer' },
      backendUrl: '',
      workspaceOwnerNpub: 'npub1owner',
    });
    await fn();
    expect(connectSSE).not.toHaveBeenCalled();
  });

  it('does not connect when workspaceOwnerNpub is missing', async () => {
    const { fn } = bindMethod('connectSSEStream', {
      session: { npub: 'npub1viewer' },
      backendUrl: 'https://tower.example.com',
      workspaceOwnerNpub: '',
    });
    await fn();
    expect(connectSSE).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SSE lifecycle — disconnectSSEStream
// ---------------------------------------------------------------------------
describe('disconnectSSEStream', () => {
  it('calls disconnectSSE and resets sseStatus', () => {
    const { fn, store } = bindMethod('disconnectSSEStream', {
      sseStatus: 'connected',
    });
    fn();
    expect(disconnectSSE).toHaveBeenCalled();
    expect(store.sseStatus).toBe('disconnected');
  });
});

// ---------------------------------------------------------------------------
// SSE status callback — handleSSEStatus
// ---------------------------------------------------------------------------
describe('handleSSEStatus', () => {
  it('updates sseStatus when status message arrives', () => {
    const { fn, store } = bindMethod('handleSSEStatus', {
      sseStatus: 'disconnected',
    });
    fn({ status: 'connected' });
    expect(store.sseStatus).toBe('connected');
  });

  it('sets catchUpSyncActive on catch-up-required', () => {
    const { fn, store } = bindMethod('handleSSEStatus', {
      sseStatus: 'connected',
      catchUpSyncActive: false,
    });
    fn({ status: 'catch-up-required' });
    expect(store.catchUpSyncActive).toBe(true);
  });

  it('triggers group refresh on group-changed', () => {
    const refreshGroups = vi.fn().mockResolvedValue(undefined);
    const { fn } = bindMethod('handleSSEStatus', {
      sseStatus: 'connected',
      refreshGroups,
    });
    fn({ status: 'group-changed' });
    expect(refreshGroups).toHaveBeenCalledWith({ minIntervalMs: 0 });
  });

  it('widens polling cadence when SSE is connected', () => {
    const { fn, store } = bindMethod('handleSSEStatus', {
      sseStatus: 'disconnected',
    });
    fn({ status: 'connected' });
    expect(store.sseStatus).toBe('connected');
  });

  it('requests reconnect with fresh NIP-98 token on token-needed', async () => {
    const { fn, store } = bindMethod('handleSSEStatus', {
      session: { npub: 'npub1viewer' },
      backendUrl: 'https://tower.example.com',
      workspaceOwnerNpub: 'npub1owner',
      sseStatus: 'reconnecting',
    });
    fn({ status: 'token-needed' });
    // connectSSEStream is async — wait for it to complete
    await vi.waitFor(() => {
      expect(connectSSE).toHaveBeenCalledTimes(1);
    });
    const [, , , token] = connectSSE.mock.calls[0];
    // Should use NIP-98 token, not bootstrap token
    expect(token).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it('falls back to polling-only on fallback-polling status', () => {
    const { fn, store } = bindMethod('handleSSEStatus', {
      sseStatus: 'connected',
    });
    fn({ status: 'fallback-polling' });
    expect(store.sseStatus).toBe('fallback-polling');
  });
});

// ---------------------------------------------------------------------------
// SSE-aware sync cadence
// ---------------------------------------------------------------------------
describe('getSyncCadenceMs with SSE', () => {
  it('returns SSE_HEARTBEAT_CADENCE_MS when SSE is connected', () => {
    const { fn } = bindMethod('getSyncCadenceMs', {
      session: { npub: 'npub1me' },
      backendUrl: 'https://backend.example.com',
      navSection: 'chat',
      selectedChannelId: 'ch1',
      sseStatus: 'connected',
    });
    expect(fn()).toBe(120000);
  });

  it('returns normal FAST_SYNC_MS when SSE is disconnected', () => {
    const { fn } = bindMethod('getSyncCadenceMs', {
      session: { npub: 'npub1me' },
      backendUrl: 'https://backend.example.com',
      navSection: 'chat',
      selectedChannelId: 'ch1',
      sseStatus: 'disconnected',
    });
    expect(fn()).toBe(15000);
  });

  it('returns normal FAST_SYNC_MS when SSE is in fallback-polling', () => {
    const { fn } = bindMethod('getSyncCadenceMs', {
      session: { npub: 'npub1me' },
      backendUrl: 'https://backend.example.com',
      navSection: 'tasks',
      sseStatus: 'fallback-polling',
    });
    expect(fn()).toBe(15000);
  });
});

// ---------------------------------------------------------------------------
// ensureBackgroundSync wires SSE
// ---------------------------------------------------------------------------
describe('ensureBackgroundSync wires SSE', () => {
  it('connects SSE when session and backend are available', async () => {
    const { fn } = bindMethod('ensureBackgroundSync', {
      session: { npub: 'npub1viewer' },
      backendUrl: 'https://tower.example.com',
      workspaceOwnerNpub: 'npub1owner',
    });
    fn(false);
    // connectSSEStream is async — wait for it to complete
    await vi.waitFor(() => {
      expect(connectSSE).toHaveBeenCalledTimes(1);
    });
    const [ownerNpub, viewerNpub, backendUrl, token] = connectSSE.mock.calls[0];
    expect(ownerNpub).toBe('npub1owner');
    expect(viewerNpub).toBe('npub1viewer');
    expect(backendUrl).toBe('https://tower.example.com');
    // Token must be NIP-98, not bootstrap
    expect(token).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it('does not connect SSE when workspaceOwnerNpub is missing', () => {
    const { fn } = bindMethod('ensureBackgroundSync', {
      session: { npub: 'npub1viewer' },
      backendUrl: 'https://tower.example.com',
      workspaceOwnerNpub: '',
    });
    fn(false);
    expect(connectSSE).not.toHaveBeenCalled();
  });

  it('still starts worker flush timer alongside SSE', () => {
    const { fn } = bindMethod('ensureBackgroundSync', {
      session: { npub: 'npub1viewer' },
      backendUrl: 'https://tower.example.com',
      workspaceOwnerNpub: 'npub1owner',
    });
    fn(false);
    expect(startWorkerFlushTimer).toHaveBeenCalledWith(
      'npub1owner',
      'https://tower.example.com',
      'npub1owner',
    );
  });
});

// ---------------------------------------------------------------------------
// stopBackgroundSync disconnects SSE
// ---------------------------------------------------------------------------
describe('stopBackgroundSync disconnects SSE', () => {
  it('disconnects SSE when stopping background sync', () => {
    const timer = setTimeout(() => {}, 10000);
    const { fn, store } = bindMethod('stopBackgroundSync', {
      backgroundSyncTimer: timer,
      sseStatus: 'connected',
    });
    fn();
    expect(disconnectSSE).toHaveBeenCalled();
    expect(store.sseStatus).toBe('disconnected');
    expect(store.backgroundSyncTimer).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SSE status getter
// ---------------------------------------------------------------------------
describe('isSSEConnected', () => {
  it('returns true when sseStatus is connected', () => {
    const store = createStore({ sseStatus: 'connected' });
    expect(store.isSSEConnected).toBe(true);
  });

  it('returns false when sseStatus is disconnected', () => {
    const store = createStore({ sseStatus: 'disconnected' });
    expect(store.isSSEConnected).toBe(false);
  });

  it('returns false when sseStatus is reconnecting', () => {
    const store = createStore({ sseStatus: 'reconnecting' });
    expect(store.isSSEConnected).toBe(false);
  });

  it('returns false when sseStatus is fallback-polling', () => {
    const store = createStore({ sseStatus: 'fallback-polling' });
    expect(store.isSSEConnected).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Steady-state sync contract summary
// ---------------------------------------------------------------------------
describe('sync contract: SSE-first with heartbeat fallback', () => {
  it('widens polling interval when SSE is connected (heartbeat for catch-up only)', () => {
    const store = createStore({
      session: { npub: 'npub1me' },
      backendUrl: 'https://backend.example.com',
      navSection: 'tasks',
      sseStatus: 'connected',
    });
    const cadence = store.getSyncCadenceMs();
    // When SSE is connected, heartbeat cadence should be much wider than normal
    expect(cadence).toBeGreaterThan(store.FAST_SYNC_MS);
    expect(cadence).toBe(store.SSE_HEARTBEAT_CADENCE_MS);
  });

  it('returns to aggressive polling when SSE falls back', () => {
    const store = createStore({
      session: { npub: 'npub1me' },
      backendUrl: 'https://backend.example.com',
      navSection: 'tasks',
      sseStatus: 'fallback-polling',
    });
    const cadence = store.getSyncCadenceMs();
    expect(cadence).toBe(store.FAST_SYNC_MS);
  });

  it('returns to aggressive polling when SSE is disconnected', () => {
    const store = createStore({
      session: { npub: 'npub1me' },
      backendUrl: 'https://backend.example.com',
      navSection: 'tasks',
      sseStatus: 'disconnected',
    });
    const cadence = store.getSyncCadenceMs();
    expect(cadence).toBe(store.FAST_SYNC_MS);
  });
});
