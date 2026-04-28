import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSyncFamilyHash } from '../src/sync-families.js';

const state = {
  pending: [],
  removed: [],
  syncCalls: [],
  syncArgs: [],
  syncStates: {},
  summaryResponse: null,
  documentsById: new Map(),
  directoriesById: new Map(),
  tasksById: new Map(),
};

vi.mock('../src/db.js', () => ({
  openWorkspaceDb: vi.fn(),
  getPendingWrites: vi.fn(async () => state.pending),
  removePendingWrite: vi.fn(async (rowId) => {
    state.removed.push(rowId);
    state.pending = state.pending.filter((row) => row.row_id !== rowId);
  }),
  upsertWorkspaceSettings: vi.fn(),
  upsertChannel: vi.fn(),
  upsertMessage: vi.fn(),
  upsertDocument: vi.fn(async (record) => {
    state.documentsById.set(record.record_id, record);
  }),
  upsertDirectory: vi.fn(async (record) => {
    state.directoriesById.set(record.record_id, record);
  }),
  getDocumentById: vi.fn(async (recordId) => state.documentsById.get(recordId) || null),
  getDirectoryById: vi.fn(async (recordId) => state.directoriesById.get(recordId) || null),
  upsertTask: vi.fn(async (record) => {
    state.tasksById.set(record.record_id, record);
  }),
  getTaskById: vi.fn(async (recordId) => state.tasksById.get(recordId) || null),
  upsertSchedule: vi.fn(),
  upsertComment: vi.fn(),
  upsertAudioNote: vi.fn(),
  upsertScope: vi.fn(),
  getSyncState: vi.fn(async (key) => state.syncStates[key] ?? null),
  setSyncState: vi.fn(),
  upsertSyncQuarantineEntry: vi.fn(),
  deleteSyncQuarantineEntry: vi.fn(),
}));

vi.mock('../src/api.js', () => ({
  getBaseUrl: vi.fn(() => 'https://sb4.otherstuff.studio'),
  syncRecords: vi.fn(async ({ records }) => {
    state.syncCalls.push(records.map((record) => record.record_id));
    state.syncArgs.push({ records });
  }),
  fetchRecords: vi.fn(async () => ({ records: [] })),
  fetchRecordsSummary: vi.fn(async () => state.summaryResponse ?? { available: false, families: [] }),
  fetchHeartbeat: vi.fn(async () => ({ available: false, families: [] })),
}));

describe('sync worker pending write batching', () => {
  beforeEach(() => {
    state.pending = [];
    state.removed = [];
    state.syncCalls = [];
    state.syncArgs = [];
    state.syncStates = {};
    state.summaryResponse = null;
    state.documentsById = new Map();
    state.directoriesById = new Map();
    state.tasksById = new Map();
    vi.resetModules();
  });

  it('flushes pending writes in bounded batches', async () => {
    state.pending = Array.from({ length: 52 }, (_, index) => ({
      row_id: index + 1,
      envelope: { record_id: `task-${index + 1}` },
    }));

    const { flushPendingWrites } = await import('../src/worker/sync-worker.js');
    const result = await flushPendingWrites('npub-owner');

    expect(result).toEqual({ pushed: 52 });
    expect(state.syncCalls).toHaveLength(3);
    expect(state.syncCalls.map((batch) => batch.length)).toEqual([25, 25, 2]);
    expect(state.removed).toEqual(Array.from({ length: 52 }, (_, index) => index + 1));
  });

  it('passes checkout policy config through pending-write flushes', async () => {
    state.pending = [
      {
        row_id: 1,
        record_id: 'task-1',
        record_family_hash: getSyncFamilyHash('task'),
        envelope: {
          record_id: 'task-1',
          record_family_hash: getSyncFamilyHash('task'),
          checkout: { checkout_id: 'checkout-task-1', consume_on_success: true },
        },
      },
    ];

    const { syncRecords } = await import('../src/api.js');
    syncRecords.mockImplementationOnce(async (args) => {
      state.syncCalls.push(args.records.map((record) => record.record_id));
      state.syncArgs.push(args);
      return { synced: 1, rejected: [] };
    });

    const { flushPendingWrites } = await import('../src/worker/sync-worker.js');
    await flushPendingWrites('npub-owner', null, {
      checkoutPolicyConfig: { familySuffixes: { task: 'checkout_required' } },
    });

    expect(state.syncArgs[0].checkout_policy_config).toEqual({
      familySuffixes: { task: 'checkout_required' },
    });
    expect(state.removed).toEqual([1]);
  });

  it('uses pending-write policy config without flipping unrelated task writes', async () => {
    const taskFamilyHash = getSyncFamilyHash('task');
    const checkoutPolicyConfig = { familySuffixes: { task: 'checkout_required' } };
    state.pending = [
      {
        row_id: 1,
        record_id: 'task-create',
        record_family_hash: taskFamilyHash,
        envelope: {
          record_id: 'task-create',
          record_family_hash: taskFamilyHash,
        },
      },
      {
        row_id: 2,
        record_id: 'task-edit',
        record_family_hash: taskFamilyHash,
        checkout_policy_config: checkoutPolicyConfig,
        envelope: {
          record_id: 'task-edit',
          record_family_hash: taskFamilyHash,
          checkout: { checkout_id: 'checkout-task-edit', consume_on_success: true },
        },
      },
    ];

    const { syncRecords } = await import('../src/api.js');
    syncRecords.mockImplementation(async (args) => {
      state.syncCalls.push(args.records.map((record) => record.record_id));
      state.syncArgs.push(args);
      return { synced: args.records.length, rejected: [] };
    });

    const { flushPendingWrites } = await import('../src/worker/sync-worker.js');
    await flushPendingWrites('npub-owner');

    expect(state.syncCalls).toEqual([
      ['task-create'],
      ['task-edit'],
    ]);
    expect(state.syncArgs[0].checkout_policy_config).toBeNull();
    expect(state.syncArgs[1].checkout_policy_config).toEqual(checkoutPolicyConfig);
    expect(state.removed).toEqual([1, 2]);
  });

  it('flushes terminal task pending writes optimistically when stale checkout config is attached', async () => {
    const taskFamilyHash = getSyncFamilyHash('task');
    const checkoutPolicyConfig = { familySuffixes: { task: 'checkout_required' } };
    state.tasksById.set('task-archived', {
      record_id: 'task-archived',
      state: 'archive',
    });
    state.tasksById.set('task-done', {
      record_id: 'task-done',
      state: 'done',
    });
    state.pending = [
      {
        row_id: 1,
        record_id: 'task-archived',
        record_family_hash: taskFamilyHash,
        checkout_policy_config: checkoutPolicyConfig,
        envelope: {
          record_id: 'task-archived',
          record_family_hash: taskFamilyHash,
        },
      },
      {
        row_id: 2,
        record_id: 'task-done',
        record_family_hash: taskFamilyHash,
        checkout_policy_config: checkoutPolicyConfig,
        envelope: {
          record_id: 'task-done',
          record_family_hash: taskFamilyHash,
        },
      },
    ];

    const { syncRecords } = await import('../src/api.js');
    syncRecords.mockImplementation(async (args) => {
      state.syncCalls.push(args.records.map((record) => record.record_id));
      state.syncArgs.push(args);
      return { synced: args.records.length, rejected: [] };
    });

    const { flushPendingWrites } = await import('../src/worker/sync-worker.js');
    await flushPendingWrites('npub-owner');

    expect(state.syncCalls).toEqual([['task-archived', 'task-done']]);
    expect(state.syncArgs[0].checkout_policy_config).toBeNull();
    expect(state.removed).toEqual([1, 2]);
  });

  it('keeps the failing batch pending and reports batch context', async () => {
    state.pending = Array.from({ length: 30 }, (_, index) => ({
      row_id: index + 1,
      envelope: { record_id: `task-${index + 1}` },
    }));

    const { syncRecords } = await import('../src/api.js');
    syncRecords.mockImplementationOnce(async ({ records }) => {
      state.syncCalls.push(records.map((record) => record.record_id));
    });
    syncRecords.mockImplementationOnce(async ({ records }) => {
      state.syncCalls.push(records.map((record) => record.record_id));
      throw new Error('NetworkError when attempting to fetch resource.');
    });

    const { flushPendingWrites } = await import('../src/worker/sync-worker.js');

    await expect(flushPendingWrites('npub-owner')).rejects.toThrow(
      /Pending write sync failed for batch 2 \(5 records, 25\/30 flushed\): NetworkError when attempting to fetch resource\. Batch records: task-26/
    );

    expect(state.removed).toEqual(Array.from({ length: 25 }, (_, index) => index + 1));
    expect(state.syncCalls).toHaveLength(2);
    expect(state.syncCalls.map((batch) => batch.length)).toEqual([25, 5]);
  });

  it('reports pending records with missing checkout metadata in failed batches', async () => {
    state.pending = [
      {
        row_id: 7,
        record_id: 'doc-1',
        record_family_hash: getSyncFamilyHash('document'),
        envelope: {
          record_id: 'doc-1',
          record_family_hash: getSyncFamilyHash('document'),
          version: 2,
          previous_version: 1,
        },
      },
      {
        row_id: 8,
        record_id: 'task-1',
        record_family_hash: getSyncFamilyHash('task'),
        envelope: {
          record_id: 'task-1',
          record_family_hash: getSyncFamilyHash('task'),
          version: 4,
          previous_version: 3,
        },
      },
    ];

    const { syncRecords } = await import('../src/api.js');
    syncRecords.mockImplementationOnce(async ({ records }) => {
      state.syncCalls.push(records.map((record) => record.record_id));
      throw new Error('checkout_required record doc-1 requires checkout_id.');
    });

    const { flushPendingWrites } = await import('../src/worker/sync-worker.js');

    await expect(flushPendingWrites('npub-owner', null, {
      checkoutPolicyConfig: { familySuffixes: { task: 'checkout_required' } },
    })).rejects.toThrow(
      /Batch records: doc-1 .* checkout_id=missing row=7; task-1 .* checkout_id=missing row=8/
    );

    expect(state.removed).toEqual([]);
  });

  it('emits progress callbacks during flush', async () => {
    state.pending = Array.from({ length: 30 }, (_, index) => ({
      row_id: index + 1,
      envelope: { record_id: `rec-${index + 1}` },
    }));

    const { flushPendingWrites } = await import('../src/worker/sync-worker.js');
    const updates = [];
    await flushPendingWrites('npub-owner', (update) => updates.push({ ...update }));

    expect(updates.length).toBeGreaterThanOrEqual(3);
    expect(updates[0]).toMatchObject({ phase: 'pushing', pushed: 0, pushTotal: 30 });
    expect(updates[updates.length - 1]).toMatchObject({ phase: 'pushing', pushed: 30, pushTotal: 30 });
  });

  it('keeps rejected pending writes queued and removes only accepted rows', async () => {
    state.pending = [
      { row_id: 1, record_id: 'doc-1', envelope: { record_id: 'doc-1' } },
      { row_id: 2, record_id: 'doc-2', envelope: { record_id: 'doc-2' } },
    ];

    const { syncRecords } = await import('../src/api.js');
    syncRecords.mockImplementationOnce(async ({ records }) => {
      state.syncCalls.push(records.map((record) => record.record_id));
      return {
        synced: 1,
        created: 0,
        updated: 1,
        rejected: [{ record_id: 'doc-1', code: 'write_forbidden' }],
      };
    });

    const { flushPendingWrites } = await import('../src/worker/sync-worker.js');
    const result = await flushPendingWrites('npub-owner');

    expect(result).toEqual({ pushed: 1 });
    expect(state.removed).toEqual([2]);
  });

  it('skips inbound apply when a lock-managed pending write is newer than Tower', async () => {
    state.pending = [
      {
        row_id: 1,
        record_id: 'doc-1',
        record_family_hash: getSyncFamilyHash('document'),
        envelope: { record_id: 'doc-1', version: 3 },
      },
    ];

    const inboundDocument = vi.fn(async (record) => ({
      record_id: record.record_id,
      owner_npub: 'npub-owner',
      title: 'remote',
      content: 'remote',
      sync_status: 'synced',
      version: record.version,
      updated_at: record.updated_at,
    }));
    vi.doMock('../src/translators/docs.js', () => ({
      inboundDocument,
      inboundDirectory: vi.fn(async () => ({})),
    }));

    const { fetchRecords } = await import('../src/api.js');
    fetchRecords.mockImplementation(async ({ record_family_hash }) => {
      if (record_family_hash !== getSyncFamilyHash('document')) return { records: [] };
      return {
        records: [{
          record_id: 'doc-1',
          record_family_hash: getSyncFamilyHash('document'),
          owner_npub: 'npub-owner',
          version: 2,
          updated_at: '2026-04-23T00:00:00.000Z',
        }],
      };
    });

    const { pullRecordsForFamilies } = await import('../src/worker/sync-worker.js');
    await pullRecordsForFamilies('npub-owner', 'npub-owner', [getSyncFamilyHash('document')]);

    expect(inboundDocument).not.toHaveBeenCalled();
  });

  it('applies equal-version inbound records for lock-managed families so accepted writes materialize', async () => {
    state.pending = [
      {
        row_id: 1,
        record_id: 'doc-1',
        record_family_hash: getSyncFamilyHash('document'),
        envelope: { record_id: 'doc-1', version: 2 },
      },
    ];

    const inboundDocument = vi.fn(async (record) => ({
      record_id: record.record_id,
      owner_npub: 'npub-owner',
      title: 'accepted',
      content: 'accepted',
      sync_status: 'synced',
      version: record.version,
      updated_at: record.updated_at,
    }));
    vi.doMock('../src/translators/docs.js', () => ({
      inboundDocument,
      inboundDirectory: vi.fn(async () => ({})),
    }));

    const { fetchRecords } = await import('../src/api.js');
    fetchRecords.mockImplementation(async ({ record_family_hash }) => {
      if (record_family_hash !== getSyncFamilyHash('document')) return { records: [] };
      return {
        records: [{
          record_id: 'doc-1',
          record_family_hash: getSyncFamilyHash('document'),
          owner_npub: 'npub-owner',
          version: 2,
          updated_at: '2026-04-23T00:00:00.000Z',
        }],
      };
    });

    const { pullRecordsForFamilies } = await import('../src/worker/sync-worker.js');
    await pullRecordsForFamilies('npub-owner', 'npub-owner', [getSyncFamilyHash('document')]);

    expect(inboundDocument).toHaveBeenCalledTimes(1);
    expect(state.removed).toEqual([1]);
  });

  it('forced sync pulls and reconciles accepted checkout writes after push retry failure', async () => {
    state.pending = [
      {
        row_id: 1,
        record_id: 'doc-1',
        record_family_hash: getSyncFamilyHash('document'),
        envelope: {
          record_id: 'doc-1',
          record_family_hash: getSyncFamilyHash('document'),
          version: 8,
          previous_version: 7,
          checkout: { checkout_id: 'checkout-consumed', consume_on_success: true },
        },
      },
    ];

    const inboundDocument = vi.fn(async (record) => ({
      record_id: record.record_id,
      owner_npub: 'npub-owner',
      title: 'accepted',
      content: 'accepted',
      sync_status: 'synced',
      version: record.version,
      updated_at: record.updated_at,
    }));
    vi.doMock('../src/translators/docs.js', () => ({
      inboundDocument,
      inboundDirectory: vi.fn(async () => ({})),
    }));

    const { syncRecords, fetchRecords } = await import('../src/api.js');
    syncRecords.mockImplementationOnce(async ({ records }) => {
      state.syncCalls.push(records.map((record) => record.record_id));
      throw new Error('checkout checkout-consumed is no longer active');
    });
    fetchRecords.mockImplementation(async ({ record_family_hash }) => {
      if (record_family_hash !== getSyncFamilyHash('document')) return { records: [] };
      return {
        records: [{
          record_id: 'doc-1',
          record_family_hash: getSyncFamilyHash('document'),
          owner_npub: 'npub-owner',
          version: 8,
          updated_at: '2026-04-25T06:54:00.000Z',
        }],
      };
    });

    const { runSync } = await import('../src/worker/sync-worker.js');
    const result = await runSync('npub-owner', 'npub-owner', undefined, { forceFull: true });

    expect(result.pulled).toBeGreaterThan(0);
    expect(inboundDocument).toHaveBeenCalledTimes(1);
    expect(state.removed).toEqual([1]);
    expect(state.pending).toEqual([]);
  });

  it('emits progress callbacks during pull', async () => {
    const { pullRecords } = await import('../src/worker/sync-worker.js');
    const updates = [];
    await pullRecords('npub-owner', 'npub-owner', (update) => updates.push({ ...update }));

    expect(updates.length).toBeGreaterThanOrEqual(1);
    expect(updates[0]).toMatchObject({ phase: 'pulling', completedFamilies: 0 });
    const last = updates[updates.length - 1];
    expect(last.completedFamilies).toBe(last.totalFamilies);
  });

  it('emits full lifecycle progress through runSync', async () => {
    state.pending = [];

    const { runSync } = await import('../src/worker/sync-worker.js');
    const updates = [];
    await runSync('npub-owner', 'npub-owner', (update) => updates.push({ ...update }));

    const phases = updates.map((u) => u.phase);
    expect(phases[0]).toBe('checking');
    expect(phases).toContain('pulling');
    expect(phases[phases.length - 1]).toBe('applying');
  });
});

describe('staleness check', () => {
  beforeEach(() => {
    state.syncStates = {};
    state.summaryResponse = null;
    vi.resetModules();
  });

  it('returns not stale when summary endpoint is unavailable', async () => {
    state.summaryResponse = { available: false, families: [] };
    const { checkStaleness } = await import('../src/worker/sync-worker.js');
    const result = await checkStaleness('npub-owner');
    expect(result).toEqual({ stale: false, available: false });
  });

  it('returns stale when remote cursor is ahead of local', async () => {
    state.summaryResponse = {
      available: true,
      families: [{ record_family_hash: 'abc123', latest_updated_at: '2026-01-02T00:00:00Z' }],
    };
    state.syncStates['sync_since:abc123'] = '2026-01-01T00:00:00Z';

    const { checkStaleness } = await import('../src/worker/sync-worker.js');
    const result = await checkStaleness('npub-owner');
    expect(result).toEqual({ stale: true, available: true });
  });

  it('returns not stale when local cursor matches remote', async () => {
    state.summaryResponse = {
      available: true,
      families: [{ record_family_hash: 'abc123', latest_updated_at: '2026-01-01T00:00:00Z' }],
    };
    state.syncStates['sync_since:abc123'] = '2026-01-01T00:00:00Z';

    const { checkStaleness } = await import('../src/worker/sync-worker.js');
    const result = await checkStaleness('npub-owner');
    expect(result).toEqual({ stale: false, available: true });
  });
});

describe('sync worker client bridge', () => {
  let originalWorker;
  let originalNostr;

  beforeEach(() => {
    originalWorker = globalThis.Worker;
    originalNostr = globalThis.window?.nostr;
  });

  afterEach(() => {
    if (originalWorker === undefined) {
      delete globalThis.Worker;
    } else {
      globalThis.Worker = originalWorker;
    }
    if (globalThis.window) {
      if (originalNostr === undefined) {
        delete globalThis.window.nostr;
      } else {
        globalThis.window.nostr = originalNostr;
      }
    }
    vi.resetModules();
  });

  it('boots a browser worker and routes progress and results through the protocol', async () => {
    const workerInstances = [];

    class MockWorker {
      constructor(url, options) {
        this.url = String(url);
        this.options = options;
        this.onmessage = null;
        this.onerror = null;
        this.terminated = false;
        this.lastMessage = null;
        workerInstances.push(this);
      }

      addEventListener(type, handler) {
        if (type === 'message') this.onmessage = handler;
        if (type === 'error' || type === 'messageerror') this.onerror = handler;
      }

      removeEventListener() {}

      terminate() {
        this.terminated = true;
      }

      postMessage(message) {
        this.lastMessage = message;
        Promise.resolve().then(() => {
          if (message.method === 'runSync') {
            this.onmessage?.({
              data: {
                type: 'sync-worker:progress',
                id: message.id,
                update: { phase: 'checking' },
              },
            });
            this.onmessage?.({
              data: {
                type: 'sync-worker:progress',
                id: message.id,
                update: { phase: 'applying' },
              },
            });
            this.onmessage?.({
              data: {
                type: 'sync-worker:response',
                id: message.id,
                ok: true,
                value: { pushed: 7, pulled: 2, pruned: 0 },
              },
            });
          }
        });
      }
    }

    globalThis.Worker = MockWorker;
    vi.resetModules();

    const { primeSyncWorker, runSync } = await import('../src/sync-worker-client.js');
    expect(primeSyncWorker()).toBe(true);
    expect(workerInstances).toHaveLength(1);
    expect(workerInstances[0].url).toContain('sync-worker-runner.js');
    expect(workerInstances[0].options).toEqual({ type: 'module' });

    const updates = [];
    const result = await runSync('npub-owner', 'npub-viewer', (update) => updates.push(update), {
      authMethod: 'secret',
      backendUrl: 'https://backend.example.com',
      workspaceDbKey: 'workspace-db',
    });

    expect(result).toEqual({ pushed: 7, pulled: 2, pruned: 0 });
    expect(updates.map((update) => update.phase)).toEqual(['checking', 'applying']);
    expect(workerInstances[0].lastMessage).toMatchObject({
      type: 'sync-worker:request',
      method: 'runSync',
      payload: {
        ownerNpub: 'npub-owner',
        viewerNpub: 'npub-viewer',
        options: {
          authMethod: 'secret',
          backendUrl: 'https://backend.example.com',
          workspaceDbKey: 'workspace-db',
        },
      },
    });
  });

  it('bridges extension-auth signing requests through the main thread', async () => {
    const workerInstances = [];
    const signedEvent = {
      id: 'signed-event-id',
      sig: 'signed-event-sig',
      kind: 27235,
      pubkey: 'pubkey-hex',
      created_at: 1,
      tags: [],
      content: '',
    };

    class MockWorker {
      constructor() {
        workerInstances.push(this);
        this.onmessage = null;
        this.onerror = null;
        this.messages = [];
        this.runRequestId = null;
      }

      addEventListener(type, handler) {
        if (type === 'message') this.onmessage = handler;
        if (type === 'error' || type === 'messageerror') this.onerror = handler;
      }

      removeEventListener() {}

      terminate() {}

      postMessage(message) {
        this.messages.push(message);
        Promise.resolve().then(() => {
          if (message.type === 'sync-worker:request' && message.method === 'runSync') {
            this.runRequestId = message.id;
            this.onmessage?.({
              data: {
                type: 'sync-worker:auth-request',
                authId: 1,
                method: 'getPublicKey',
              },
            });
            return;
          }

          if (message.type === 'sync-worker:auth-response' && message.authId === 1) {
            this.onmessage?.({
              data: {
                type: 'sync-worker:auth-request',
                authId: 2,
                method: 'signEvent',
                params: {
                  event: {
                    kind: 27235,
                    pubkey: message.value,
                    created_at: 1,
                    tags: [],
                    content: '',
                  },
                },
              },
            });
            return;
          }

          if (message.type === 'sync-worker:auth-response' && message.authId === 2) {
            this.onmessage?.({
              data: {
                type: 'sync-worker:response',
                id: this.runRequestId,
                ok: true,
                value: { pushed: 1, pulled: 0, pruned: 0 },
              },
            });
          }
        });
      }
    }

    globalThis.Worker = MockWorker;
    globalThis.window = globalThis.window || {};
    globalThis.window.nostr = {
      getPublicKey: vi.fn(async () => 'pubkey-hex'),
      signEvent: vi.fn(async (event) => ({ ...event, ...signedEvent })),
    };
    vi.resetModules();

    const client = await import('../src/sync-worker-client.js');

    const result = await client.runSync('npub-owner', 'npub-viewer', undefined, {
      authMethod: 'extension',
      backendUrl: 'https://backend.example.com',
      workspaceDbKey: 'workspace-db',
    });

    expect(result).toEqual({ pushed: 1, pulled: 0, pruned: 0 });
    expect(workerInstances).toHaveLength(1);
    expect(globalThis.window.nostr.getPublicKey).toHaveBeenCalledTimes(1);
    expect(globalThis.window.nostr.signEvent).toHaveBeenCalledTimes(1);
    expect(globalThis.window.nostr.signEvent).toHaveBeenCalledWith(expect.objectContaining({
      kind: 27235,
      pubkey: 'pubkey-hex',
    }));
    expect(workerInstances[0].messages).toContainEqual(expect.objectContaining({
      type: 'sync-worker:request',
      method: 'runSync',
      payload: expect.objectContaining({
        ownerNpub: 'npub-owner',
        viewerNpub: 'npub-viewer',
        options: expect.objectContaining({
          authMethod: 'extension',
          backendUrl: 'https://backend.example.com',
          workspaceDbKey: 'workspace-db',
        }),
      }),
    }));
    expect(workerInstances[0].messages).toContainEqual({
      type: 'sync-worker:auth-response',
      authId: 1,
      ok: true,
      value: 'pubkey-hex',
    });
    expect(workerInstances[0].messages).toContainEqual({
      type: 'sync-worker:auth-response',
      authId: 2,
      ok: true,
      value: {
        kind: 27235,
        pubkey: 'pubkey-hex',
        created_at: 1,
        tags: [],
        content: '',
        id: 'signed-event-id',
        sig: 'signed-event-sig',
      },
    });
  });

  it('recovers by spawning a fresh worker after the first one crashes', async () => {
    const workerInstances = [];
    let crashFirst = true;

    class MockWorker {
      constructor() {
        workerInstances.push(this);
        this.onmessage = null;
        this.onerror = null;
        this.terminated = false;
      }

      addEventListener(type, handler) {
        if (type === 'message') this.onmessage = handler;
        if (type === 'error' || type === 'messageerror') this.onerror = handler;
      }

      removeEventListener() {}

      terminate() {
        this.terminated = true;
      }

      postMessage(message) {
        if (message.type !== 'sync-worker:request') return;
        Promise.resolve().then(() => {
          if (crashFirst) {
            crashFirst = false;
            // Simulate a crash: fire error event
            this.onerror?.({ error: new Error('Worker crashed') });
            return;
          }
          // Second worker succeeds
          this.onmessage?.({
            data: {
              type: 'sync-worker:response',
              id: message.id,
              ok: true,
              value: { pushed: 3, pulled: 1, pruned: 0 },
            },
          });
        });
      }
    }

    globalThis.Worker = MockWorker;
    vi.resetModules();

    const { runSync } = await import('../src/sync-worker-client.js');
    const result = await runSync('npub-owner', 'npub-viewer', undefined, {
      backendUrl: 'https://backend.example.com',
      workspaceDbKey: 'ws-db',
    });

    expect(result).toEqual({ pushed: 3, pulled: 1, pruned: 0 });
    // First worker crashed, second was created for recovery
    expect(workerInstances).toHaveLength(2);
    expect(workerInstances[0].terminated).toBe(true);
    expect(workerInstances[1].terminated).toBe(false);
  });

  it('throws explicit sync error when Worker is not supported', async () => {
    delete globalThis.Worker;
    vi.resetModules();

    const { runSync } = await import('../src/sync-worker-client.js');
    await expect(
      runSync('npub-owner', 'npub-viewer', undefined, { backendUrl: 'https://x.com' }),
    ).rejects.toThrow('Sync unavailable: Web Workers are not supported');
  });

  it('throws after exhausting recovery attempts and preserves queued writes', async () => {
    let instanceCount = 0;

    class AlwaysCrashWorker {
      constructor() {
        instanceCount++;
        this.onerror = null;
      }

      addEventListener(type, handler) {
        if (type === 'error' || type === 'messageerror') this.onerror = handler;
      }

      removeEventListener() {}
      terminate() {}

      postMessage(message) {
        if (message.type !== 'sync-worker:request') return;
        Promise.resolve().then(() => {
          this.onerror?.({ error: new Error('persistent crash') });
        });
      }
    }

    globalThis.Worker = AlwaysCrashWorker;
    vi.resetModules();

    const { runSync } = await import('../src/sync-worker-client.js');
    await expect(
      runSync('npub-owner', 'npub-viewer', undefined, { backendUrl: 'https://x.com' }),
    ).rejects.toThrow(/Sync worker recovery failed/);

    // 1 initial + 2 recovery = 3 worker instances created
    expect(instanceCount).toBe(3);
  });

  it('notifies the degraded callback when worker cannot recover', async () => {
    class AlwaysCrashWorker {
      constructor() { this.onerror = null; }
      addEventListener(type, handler) {
        if (type === 'error' || type === 'messageerror') this.onerror = handler;
      }
      removeEventListener() {}
      terminate() {}
      postMessage(message) {
        if (message.type !== 'sync-worker:request') return;
        Promise.resolve().then(() => {
          this.onerror?.({ error: new Error('boom') });
        });
      }
    }

    globalThis.Worker = AlwaysCrashWorker;
    vi.resetModules();

    const { runSync, setWorkerDegradedCallback } = await import('../src/sync-worker-client.js');
    const degradedEvents = [];
    setWorkerDegradedCallback((event) => degradedEvents.push(event));

    await expect(runSync('npub-owner')).rejects.toThrow();
    expect(degradedEvents.length).toBeGreaterThanOrEqual(1);
    expect(degradedEvents[degradedEvents.length - 1]).toMatchObject({
      degraded: true,
      reason: expect.any(String),
    });
  });

  it('does not fall back to local sync module when postMessage fails', async () => {
    const workerInstances = [];
    let firstPostMessage = true;

    class PostMessageFailWorker {
      constructor() {
        workerInstances.push(this);
        this.onmessage = null;
        this.onerror = null;
      }

      addEventListener(type, handler) {
        if (type === 'message') this.onmessage = handler;
        if (type === 'error' || type === 'messageerror') this.onerror = handler;
      }

      removeEventListener() {}
      terminate() {}

      postMessage(message) {
        if (message.type !== 'sync-worker:request') return;
        if (firstPostMessage) {
          firstPostMessage = false;
          throw new Error('DataCloneError');
        }
        // Recovery worker succeeds
        Promise.resolve().then(() => {
          this.onmessage?.({
            data: {
              type: 'sync-worker:response',
              id: message.id,
              ok: true,
              value: { pushed: 0, pulled: 0, pruned: 0 },
            },
          });
        });
      }
    }

    globalThis.Worker = PostMessageFailWorker;
    vi.resetModules();

    const { runSync } = await import('../src/sync-worker-client.js');
    const result = await runSync('npub-owner', 'npub-viewer', undefined, {
      backendUrl: 'https://backend.example.com',
    });

    expect(result).toEqual({ pushed: 0, pulled: 0, pruned: 0 });
    // First worker had postMessage fail, recovery created a second
    expect(workerInstances).toHaveLength(2);
  });

  it('flushOnly routes through the worker path', async () => {
    class MockWorker {
      constructor() { this.onmessage = null; }
      addEventListener(type, handler) {
        if (type === 'message') this.onmessage = handler;
      }
      removeEventListener() {}
      terminate() {}
      postMessage(message) {
        if (message.type !== 'sync-worker:request') return;
        expect(message.method).toBe('flushOnly');
        Promise.resolve().then(() => {
          this.onmessage?.({
            data: {
              type: 'sync-worker:response',
              id: message.id,
              ok: true,
              value: { pushed: 5 },
            },
          });
        });
      }
    }

    globalThis.Worker = MockWorker;
    vi.resetModules();

    const { flushOnly } = await import('../src/sync-worker-client.js');
    const result = await flushOnly('npub-owner', null, {
      backendUrl: 'https://backend.example.com',
    });
    expect(result).toEqual({ pushed: 5 });
  });
});
