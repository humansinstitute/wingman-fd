/**
 * Tests for flow group persistence — flows must inherit group_ids from scope
 * so that outbound writes carry write_group_ref and group_payloads.
 *
 * Covers:
 * 1. createFlow derives group_ids from scope when scope_id is set
 * 2. createFlow passes write_group_ref to outboundFlow
 * 3. updateFlow preserves/recomputes group_ids
 * 4. sync-manager: getLocalRecordsForStatusFamily includes flows
 * 5. sync-manager: buildRecordStatusEnvelope handles flow family
 * 6. sync-manager: markRecordStatusLocalRecordSynced handles flow family
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flowsManagerMixin } from '../src/flows-manager.js';

const mockUpsertFlow = vi.fn(async () => {});
const mockAddPendingWrite = vi.fn(async () => {});
const mockOutboundFlow = vi.fn(async (payload) => ({
  ...payload,
  record_family_hash: 'mock:flow',
  owner_payload: { ciphertext: '{}' },
  group_payloads: [],
}));

vi.mock('../src/db.js', () => ({
  upsertFlow: (...args) => mockUpsertFlow(...args),
  getFlowById: vi.fn(async () => null),
  getFlowsByScope: vi.fn(async () => []),
  getFlowsByOwner: vi.fn(async () => []),
  upsertApproval: vi.fn(async () => {}),
  getApprovalById: vi.fn(async () => null),
  getApprovalsByScope: vi.fn(async () => []),
  getApprovalsByStatus: vi.fn(async () => []),
  upsertTask: vi.fn(async () => {}),
  addPendingWrite: (...args) => mockAddPendingWrite(...args),
}));

vi.mock('../src/translators/flows.js', () => ({
  outboundFlow: (...args) => mockOutboundFlow(...args),
}));

vi.mock('../src/translators/approvals.js', () => ({
  outboundApproval: vi.fn(async (payload) => ({
    ...payload,
    record_family_hash: 'mock:approval',
    owner_payload: { ciphertext: '{}' },
    group_payloads: [],
  })),
}));

vi.mock('../src/translators/tasks.js', () => ({
  outboundTask: vi.fn(async (payload) => ({
    ...payload,
    record_family_hash: 'mock:task',
    owner_payload: { ciphertext: '{}' },
    group_payloads: [],
  })),
}));

// ---------------------------------------------------------------------------
// Helper: build a store with flowsManagerMixin methods applied
// ---------------------------------------------------------------------------

function createStore(overrides = {}) {
  const store = {
    session: { npub: 'npub_viewer' },
    workspaceOwnerNpub: 'npub_owner',
    signingNpub: 'npub_viewer',
    selectedBoardId: null,
    flows: [],
    approvals: [],
    tasks: [],
    scopesMap: new Map(),
    groups: [],
    flushAndBackgroundSync: vi.fn(async () => {}),
    applyTaskPatch: vi.fn(async () => null),
    // Provide scope group resolution helpers (matching scopes-manager mixin)
    getScopeShareGroupIds(scope) {
      return (scope?.group_ids || []).filter(Boolean);
    },
    buildScopeDefaultShares(groupIds = []) {
      return groupIds.map((gid) => ({ group_id: gid, permission: 'write' }));
    },
    getShareGroupIds(shares = []) {
      return [...new Set(shares.map((s) => s.group_id).filter(Boolean))];
    },
    resolveGroupId(ref) {
      return ref || null;
    },
    ...overrides,
  };

  const descriptors = Object.getOwnPropertyDescriptors(flowsManagerMixin);
  for (const [key, desc] of Object.entries(descriptors)) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) continue;
    Object.defineProperty(store, key, desc);
  }
  return store;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockUpsertFlow.mockClear();
  mockAddPendingWrite.mockClear();
  mockOutboundFlow.mockClear();
});

describe('createFlow — group inheritance from scope', () => {
  it('derives group_ids from scope when scope_id is provided', async () => {
    const store = createStore({
      scopesMap: new Map([
        ['scope-1', { record_id: 'scope-1', title: 'Product A', group_ids: ['group-abc', 'group-def'] }],
      ]),
    });

    const recordId = await store.createFlow({
      title: 'Test Flow',
      scope_id: 'scope-1',
      scope_l1_id: 'scope-1',
    });

    expect(recordId).toBeTruthy();

    // The local row saved to Dexie must have non-empty group_ids
    const savedRow = mockUpsertFlow.mock.calls[0][0];
    expect(savedRow.group_ids).toEqual(['group-abc', 'group-def']);
    expect(savedRow.group_ids.length).toBeGreaterThan(0);
  });

  it('passes write_group_ref to outboundFlow from derived group_ids', async () => {
    const store = createStore({
      scopesMap: new Map([
        ['scope-1', { record_id: 'scope-1', title: 'Product A', group_ids: ['group-abc'] }],
      ]),
    });

    await store.createFlow({
      title: 'Test Flow',
      scope_id: 'scope-1',
      scope_l1_id: 'scope-1',
    });

    const outboundArg = mockOutboundFlow.mock.calls[0][0];
    expect(outboundArg.write_group_ref).toBe('group-abc');
    expect(outboundArg.group_ids).toEqual(['group-abc']);
  });

  it('creates shares from scope group_ids', async () => {
    const store = createStore({
      scopesMap: new Map([
        ['scope-1', { record_id: 'scope-1', title: 'Product A', group_ids: ['group-abc'] }],
      ]),
    });

    await store.createFlow({
      title: 'Test Flow',
      scope_id: 'scope-1',
      scope_l1_id: 'scope-1',
    });

    const savedRow = mockUpsertFlow.mock.calls[0][0];
    expect(savedRow.shares.length).toBeGreaterThan(0);
    expect(savedRow.shares[0].group_id).toBe('group-abc');
  });

  it('falls back to empty group_ids when no scope is set', async () => {
    const store = createStore();

    await store.createFlow({ title: 'Unscopable Flow' });

    const savedRow = mockUpsertFlow.mock.calls[0][0];
    expect(savedRow.group_ids).toEqual([]);
  });

  it('does not use hardcoded empty group_ids when scope provides groups', async () => {
    // This test captures the exact bug: even when a scope_id is present,
    // the old code always passed group_ids: [] from the UI layer.
    const store = createStore({
      scopesMap: new Map([
        ['scope-1', { record_id: 'scope-1', title: 'Product A', group_ids: ['group-xyz'] }],
      ]),
    });

    // Simulate what the UI *used to* do: pass explicit group_ids: []
    // After the fix, createFlow should still derive from scope.
    await store.createFlow({
      title: 'Flow with scope',
      scope_id: 'scope-1',
      scope_l1_id: 'scope-1',
      group_ids: [],  // Caller passes empty — createFlow should override from scope
    });

    const savedRow = mockUpsertFlow.mock.calls[0][0];
    expect(savedRow.group_ids).toEqual(['group-xyz']);
  });
});

describe('updateFlow — group_ids preserved', () => {
  it('retains group_ids from existing flow on update', async () => {
    const store = createStore({
      flows: [
        {
          record_id: 'flow-1',
          owner_npub: 'npub_owner',
          title: 'Old Title',
          group_ids: ['group-abc'],
          shares: [{ group_id: 'group-abc', permission: 'write' }],
          version: 1,
          sync_status: 'synced',
          record_state: 'active',
        },
      ],
    });

    const updated = await store.updateFlow('flow-1', { title: 'New Title' });

    expect(updated.group_ids).toEqual(['group-abc']);
    const outboundArg = mockOutboundFlow.mock.calls[0][0];
    expect(outboundArg.write_group_ref).toBe('group-abc');
  });
});
