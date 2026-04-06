/**
 * Tests for flow sync-manager integration — ensures flows are accessible
 * via getLocalRecordsForStatusFamily, buildRecordStatusEnvelope, and
 * markRecordStatusLocalRecordSynced.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncManagerMixin } from '../src/sync-manager.js';

vi.mock('../src/api.js', () => ({
  fetchRecordHistory: vi.fn(),
  syncRecords: vi.fn(),
}));

const mockUpsertFlow = vi.fn(async () => {});

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
  upsertFlow: (...args) => mockUpsertFlow(...args),
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
  flushOnly: vi.fn(),
  connectSSE: vi.fn(),
  disconnectSSE: vi.fn(),
  setSSEStatusCallback: vi.fn(),
  flushNow: vi.fn(),
}));

vi.mock('../src/translators/tasks.js', () => ({
  outboundTask: vi.fn(async (p) => ({ ...p, record_family_hash: 'mock:task' })),
  recordFamilyHash: (f) => `h:${f}`,
}));

vi.mock('../src/translators/docs.js', () => ({
  outboundDocument: vi.fn(async (p) => ({ ...p, record_family_hash: 'mock:doc' })),
  outboundDirectory: vi.fn(async (p) => ({ ...p, record_family_hash: 'mock:dir' })),
}));

vi.mock('../src/translators/chat.js', () => ({
  outboundChannel: vi.fn(async (p) => ({ ...p, record_family_hash: 'mock:channel' })),
  outboundChatMessage: vi.fn(async (p) => ({ ...p, record_family_hash: 'mock:msg' })),
  recordFamilyHash: (f) => `h:${f}`,
}));

vi.mock('../src/translators/flows.js', () => ({
  outboundFlow: vi.fn(async (p) => ({
    ...p,
    record_family_hash: 'mock:flow',
    owner_payload: { ciphertext: '{}' },
    group_payloads: [],
  })),
  recordFamilyHash: (f) => `h:${f}`,
}));

vi.mock('../src/translators/approvals.js', () => ({
  outboundApproval: vi.fn(async (p) => ({ ...p, record_family_hash: 'mock:approval' })),
  recordFamilyHash: (f) => `h:${f}`,
}));

vi.mock('../src/translators/comments.js', () => ({
  outboundComment: vi.fn(async (p) => ({ ...p, record_family_hash: 'mock:comment' })),
}));

vi.mock('../src/translators/reports.js', () => ({
  recordFamilyHash: (f) => `h:${f}`,
}));

vi.mock('../src/translators/schedules.js', () => ({
  recordFamilyHash: (f) => `h:${f}`,
}));

vi.mock('../src/translators/settings.js', () => ({
  recordFamilyHash: (f) => `h:${f}`,
}));

vi.mock('../src/crypto/group-keys.js', () => ({
  hasGroupKey: vi.fn(() => true),
}));

vi.mock('../src/auth/nostr.js', () => ({
  createNip98AuthHeaderForSecret: vi.fn(),
}));

vi.mock('../src/crypto/workspace-keys.js', () => ({
  getActiveWorkspaceKeySecretForAuth: vi.fn(() => null),
  isWorkspaceKeyRegistered: vi.fn(() => false),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockUpsertFlow.mockClear();
});

function createStore(overrides = {}) {
  const store = {
    session: { npub: 'npub_viewer' },
    workspaceOwnerNpub: 'npub_owner',
    signingNpub: 'npub_viewer',
    flows: [],
    tasks: [],
    documents: [],
    directories: [],
    channels: [],
    messages: [],
    scopes: [],
    schedules: [],
    reports: [],
    groups: [],
    scopesMap: new Map(),
    recordStatusTowerLatestVersion: 0,
    recordStatusTowerVersionCount: 0,
    resolveGroupId(ref) { return ref || null; },
    getScopeShareGroupIds(scope) { return (scope?.group_ids || []).filter(Boolean); },
    buildScopeDefaultShares(gids) { return gids.map((g) => ({ group_id: g, permission: 'write' })); },
    ...overrides,
  };

  const descriptors = Object.getOwnPropertyDescriptors(syncManagerMixin);
  for (const [key, desc] of Object.entries(descriptors)) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) continue;
    Object.defineProperty(store, key, desc);
  }
  return store;
}

describe('sync-manager — flow family support', () => {
  it('getLocalRecordsForStatusFamily returns flows for family "flow"', () => {
    const flow = { record_id: 'flow-1', title: 'My Flow', group_ids: ['g1'] };
    const store = createStore({ flows: [flow] });
    const records = store.getLocalRecordsForStatusFamily('flow');
    expect(records).toHaveLength(1);
    expect(records[0].record_id).toBe('flow-1');
  });

  it('getLocalStatusRecord finds a flow by id', () => {
    const flow = { record_id: 'flow-1', title: 'My Flow', group_ids: ['g1'] };
    const store = createStore({ flows: [flow] });
    const found = store.getLocalStatusRecord('flow', 'flow-1');
    expect(found).toBeTruthy();
    expect(found.record_id).toBe('flow-1');
  });

  it('getLocalStatusRecord returns null for missing flow', () => {
    const store = createStore({ flows: [] });
    expect(store.getLocalStatusRecord('flow', 'nonexistent')).toBeNull();
  });

  it('markRecordStatusLocalRecordSynced updates flow sync_status', async () => {
    const flow = { record_id: 'flow-1', title: 'Test', group_ids: ['g1'], sync_status: 'pending', version: 1 };
    const store = createStore({ flows: [flow] });

    await store.markRecordStatusLocalRecordSynced('flow', flow, { version: 2 });

    expect(mockUpsertFlow).toHaveBeenCalledTimes(1);
    const upserted = mockUpsertFlow.mock.calls[0][0];
    expect(upserted.sync_status).toBe('synced');
    expect(upserted.version).toBe(2);

    // In-memory flows array updated
    expect(store.flows[0].sync_status).toBe('synced');
    expect(store.flows[0].version).toBe(2);
  });

  it('buildRecordStatusEnvelope produces a flow envelope', async () => {
    const flow = {
      record_id: 'flow-1',
      owner_npub: 'npub_owner',
      title: 'Test Flow',
      group_ids: ['group-abc'],
      shares: [{ group_id: 'group-abc', permission: 'write' }],
      version: 1,
      record_state: 'active',
    };
    const store = createStore();
    store.recordStatusTowerVersionCount = 0;

    const envelope = await store.buildRecordStatusEnvelope(flow, 'flow', { bootstrap: true });
    expect(envelope).toBeTruthy();
    expect(envelope.record_family_hash).toBe('mock:flow');
    expect(envelope.group_ids).toEqual(['group-abc']);
  });
});
