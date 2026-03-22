import { describe, expect, it, vi } from 'vitest';
import { syncManagerMixin } from '../src/sync-manager.js';

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
    backgroundSyncTimer: null,
    backgroundSyncInFlight: false,
    visibilityHandler: null,
    syncing: false,
    syncStatus: 'synced',
    syncSession: {
      state: 'idle',
      phase: 'idle',
      startedAt: null,
      finishedAt: null,
      lastSuccessAt: null,
      error: null,
      pushed: 0,
      pushTotal: 0,
      pulled: 0,
      completedFamilies: 0,
      totalFamilies: 0,
      currentFamily: null,
    },
    syncQuarantine: [],
    repairSelectedFamilyIds: [],
    repairError: null,
    repairNotice: '',
    repairBusy: false,
    syncQuarantineError: null,
    syncQuarantineNotice: '',
    syncQuarantineBusy: false,
    error: null,
    groups: [],
    channels: [],
    messages: [],
    documents: [],
    directories: [],
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
    expect(performSync).toHaveBeenCalledWith({ silent: false });
    expect(ensureBackgroundSync).toHaveBeenCalled();
  });

  it('does not throw when performSync fails', async () => {
    const performSync = vi.fn().mockRejectedValue(new Error('fail'));
    const ensureBackgroundSync = vi.fn();
    const { fn } = bindMethod('syncNow', {
      performSync,
      ensureBackgroundSync,
    });
    await expect(fn()).resolves.not.toThrow();
    expect(ensureBackgroundSync).toHaveBeenCalled();
  });
});
