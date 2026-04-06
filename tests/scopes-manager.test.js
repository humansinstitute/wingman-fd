import { describe, expect, it, vi } from 'vitest';
import {
  getAvailableParents,
  readScopeAssignment,
  sameScopeAssignment,
  scopesManagerMixin,
} from '../src/scopes-manager.js';

function createScopeStore(overrides = {}) {
  const store = {
    scopePickerQuery: '',
    showScopePicker: false,
    showChannelScopePicker: false,
    showNewScopeForm: false,
    canAdminWorkspace: true,
    ...overrides,
  };

  const descriptors = Object.getOwnPropertyDescriptors(scopesManagerMixin);
  for (const [key, desc] of Object.entries(descriptors)) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) continue;
    Object.defineProperty(store, key, desc);
  }

  return store;
}

describe('scopes-manager pure utilities', () => {
  // --- getAvailableParents ---
  describe('getAvailableParents', () => {
    const scopes = [
      { record_id: 's1', level: 'product', title: 'Product A', record_state: 'active' },
      { record_id: 's2', level: 'product', title: 'Product B', record_state: 'deleted' },
      { record_id: 's3', level: 'project', title: 'Project X', record_state: 'active' },
      { record_id: 's4', level: 'project', title: 'Project Y', record_state: 'deleted' },
      { record_id: 's5', level: 'deliverable', title: 'Deliverable 1', record_state: 'active' },
    ];

    it('returns empty array for product level', () => {
      expect(getAvailableParents(scopes, 'product')).toEqual([]);
    });

    it('returns active products for project level', () => {
      const result = getAvailableParents(scopes, 'project');
      expect(result).toHaveLength(1);
      expect(result[0].record_id).toBe('s1');
    });

    it('excludes deleted products from project parents', () => {
      const result = getAvailableParents(scopes, 'project');
      expect(result.every(s => s.record_state !== 'deleted')).toBe(true);
    });

    it('returns active projects for deliverable level', () => {
      const result = getAvailableParents(scopes, 'deliverable');
      expect(result).toHaveLength(1);
      expect(result[0].record_id).toBe('s3');
    });

    it('excludes deleted projects from deliverable parents', () => {
      const result = getAvailableParents(scopes, 'deliverable');
      expect(result.every(s => s.record_state !== 'deleted')).toBe(true);
    });

    it('returns empty array for unknown level', () => {
      expect(getAvailableParents(scopes, 'unknown')).toEqual([]);
    });
  });

  // --- readScopeAssignment / sameScopeAssignment ---
  describe('scope assignment helpers', () => {
    it('normalizes missing scope fields to null', () => {
      expect(readScopeAssignment({})).toEqual({
        scope_id: null,
        scope_l1_id: null,
        scope_l2_id: null,
        scope_l3_id: null,
        scope_l4_id: null,
        scope_l5_id: null,
      });
    });

    it('reads scope assignment fields from a scoped record', () => {
      expect(readScopeAssignment({
        scope_id: 'scope-project',
        scope_l1_id: 'scope-product',
        scope_l2_id: 'scope-project',
        scope_l3_id: null,
        scope_l4_id: null,
        scope_l5_id: null,
      })).toEqual({
        scope_id: 'scope-project',
        scope_l1_id: 'scope-product',
        scope_l2_id: 'scope-project',
        scope_l3_id: null,
        scope_l4_id: null,
        scope_l5_id: null,
      });
    });

    it('detects equal scope assignments even across different record shapes', () => {
      expect(sameScopeAssignment(
        {
          scope_id: 'scope-project',
          scope_l1_id: 'scope-product',
          scope_l2_id: 'scope-project',
          scope_l3_id: null,
          scope_l4_id: null,
          scope_l5_id: null,
        },
        {
          record_id: 'doc-1',
          scope_id: 'scope-project',
          scope_l1_id: 'scope-product',
          scope_l2_id: 'scope-project',
          scope_l3_id: null,
          scope_l4_id: null,
          scope_l5_id: null,
        },
      )).toBe(true);
    });

    it('detects when scope assignments differ', () => {
      expect(sameScopeAssignment(
        { scope_id: 'scope-project', scope_l1_id: 'scope-product', scope_l2_id: 'scope-project' },
        { scope_id: 'scope-deliverable', scope_l1_id: 'scope-product', scope_l2_id: 'scope-project', scope_l3_id: 'scope-deliverable' },
      )).toBe(false);
    });
  });

  describe('scope picker state', () => {
    it('openScopePicker closes the channel scope picker', () => {
      const store = createScopeStore({
        scopePickerQuery: 'draft',
        showChannelScopePicker: true,
        showNewScopeForm: true,
      });

      store.openScopePicker();

      expect(store.scopePickerQuery).toBe('');
      expect(store.showScopePicker).toBe(true);
      expect(store.showChannelScopePicker).toBe(false);
      expect(store.showNewScopeForm).toBe(false);
    });

    it('openChannelScopePicker closes the task scope picker', () => {
      const store = createScopeStore({
        scopePickerQuery: 'draft',
        showScopePicker: true,
        showNewScopeForm: true,
      });

      store.openChannelScopePicker();

      expect(store.scopePickerQuery).toBe('');
      expect(store.showChannelScopePicker).toBe(true);
      expect(store.showScopePicker).toBe(false);
      expect(store.showNewScopeForm).toBe(false);
    });

    it('closeChannelScopePicker clears the shared query', () => {
      const store = createScopeStore({
        scopePickerQuery: 'ops',
        showChannelScopePicker: true,
        showNewScopeForm: true,
      });

      store.closeChannelScopePicker();

      expect(store.scopePickerQuery).toBe('');
      expect(store.showChannelScopePicker).toBe(false);
      expect(store.showNewScopeForm).toBe(false);
    });
  });

  describe('scope edit state', () => {
    it('detects when editing scope groups differ from the stored scope groups', () => {
      const store = createScopeStore({
        editingScope: {
          record_id: 'scope-1',
          group_ids: ['group-a'],
        },
        editingScopeAssignedGroupIds: ['group-a', 'group-b'],
        getScopeShareGroupIds(scope) {
          return scope.group_ids || [];
        },
        resolveGroupId(groupId) {
          return groupId || null;
        },
      });

      expect(store.editingScopeHasGroupChanges).toBe(true);
    });

    it('reapplies current scope group crypto without opening the edit modal', async () => {
      const reencryptScopedRecordsForScope = vi.fn(async () => ({
        total: 2,
        message: 'Re-encrypted 2 scoped records (1 tasks, 1 docs, 0 folders, 0 flows, 0 approvals, 0 channels, 0 reports).',
      }));
      const flushAndBackgroundSync = vi.fn(async () => {});
      const scope = { record_id: 'scope-1', title: 'Websites', group_ids: ['group-a', 'group-b'] };
      const store = createScopeStore({
        scopePolicyRepairBusy: false,
        scopePolicyRepairSummary: 'Old summary',
        scopes: [scope],
        scopesMap: new Map([[scope.record_id, scope]]),
        reencryptScopedRecordsForScope,
        flushAndBackgroundSync,
      });

      await store.reapplyScopeGroupCrypto(scope.record_id);

      expect(reencryptScopedRecordsForScope).toHaveBeenCalledWith(scope, scope);
      expect(flushAndBackgroundSync).toHaveBeenCalledTimes(1);
      expect(store.scopePolicyRepairBusy).toBe(false);
      expect(store.scopePolicyRepairSummary).toBe('Websites: Re-encrypted 2 scoped records (1 tasks, 1 docs, 0 folders, 0 flows, 0 approvals, 0 channels, 0 reports).');
    });

    it('same-scope reapply uses legacy fallback instead of treating current groups as the previous scope policy', async () => {
      const scope = { record_id: 'scope-1', title: 'Websites', group_ids: ['group-new'] };
      const repairScopedDocumentRecord = vi.fn(async () => true);
      const store = createScopeStore({
        scopes: [scope],
        scopesMap: new Map([[scope.record_id, scope]]),
        documents: [{ record_id: 'doc-1', scope_id: 'scope-1', record_state: 'active' }],
        directories: [],
        tasks: [],
        flows: [],
        approvals: [],
        channels: [],
        reports: [],
        repairScopedDocumentRecord,
        repairScopedDirectoryRecord: vi.fn(async () => false),
        repairScopedTaskRecord: vi.fn(async () => false),
        repairScopedFlowRecord: vi.fn(async () => false),
        repairScopedApprovalRecord: vi.fn(async () => false),
        repairScopedChannelRecord: vi.fn(async () => false),
        repairScopedReportRecord: vi.fn(async () => false),
        getScopeShareGroupIds(currentScope) {
          return currentScope.group_ids || [];
        },
      });

      const summary = await store.reencryptScopedRecordsForScope(scope, scope);

      expect(repairScopedDocumentRecord).toHaveBeenCalledWith(
        expect.objectContaining({ record_id: 'doc-1' }),
        [],
        scope,
      );
      expect(summary.documents).toBe(1);
      expect(store.showScopeRepairModal).toBe(true);
      expect(store.scopeRepairSession.phase).toBe('done');
      expect(store.scopeRepairSession.rewrittenRecords).toBe(1);
      expect(store.scopeRepairProgress.find((family) => family.id === 'documents')).toMatchObject({
        status: 'done',
        total: 1,
        rewritten: 1,
      });
    });
  });
});
