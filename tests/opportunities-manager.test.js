import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/crypto/group-keys.js', () => ({
  hasGroupKey: vi.fn(() => true),
}));

vi.mock('../src/db.js', () => ({
  addPendingWrite: vi.fn(async () => {}),
  getCommentsByTarget: vi.fn(async () => []),
  getTaskById: vi.fn(async () => null),
  getOpportunityById: vi.fn(async () => null),
  getOpportunitiesByOwner: vi.fn(async () => []),
  getPendingWrites: vi.fn(async () => []),
  removePendingWrite: vi.fn(async () => {}),
  upsertComment: vi.fn(async () => {}),
  upsertOpportunity: vi.fn(async () => {}),
  upsertTask: vi.fn(async () => {}),
}));

vi.mock('../src/translators/opportunities.js', () => ({
  OPPORTUNITY_STAGE_OPTIONS: Object.freeze([
    'speculation',
    'outreach',
    'lead',
    'qualified',
    'proposal',
    'won',
    'lost',
    'abandoned',
  ]),
  outboundOpportunity: vi.fn(async (opportunity) => ({
    record_id: opportunity.record_id,
    record_family_hash: 'family:opportunity',
    version: opportunity.version,
    previous_version: opportunity.previous_version,
    group_payloads: (opportunity.group_ids || []).map((group_id) => ({ group_id })),
  })),
  recordFamilyHash: (collectionSpace) => `family:${collectionSpace}`,
}));

vi.mock('../src/translators/tasks.js', () => ({
  outboundTask: vi.fn(async (task) => ({
    record_id: task.record_id,
    record_family_hash: 'family:task',
  })),
  resolveFlowDispatchAssignee: vi.fn(({ flowId, flowRunId, defaultAgentNpub, botNpub }) => (
    flowId && !flowRunId ? (defaultAgentNpub || botNpub || null) : null
  )),
  resolveFlowLinkage: vi.fn(({ references = [] }) => ({
    flow_id: null,
    flow_run_id: null,
    flow_step: null,
    references,
  })),
}));

vi.mock('../src/translators/comments.js', () => ({
  outboundComment: vi.fn(async () => ({ record_family_hash: 'family:comment' })),
}));

import {
  addPendingWrite,
  getOpportunityById,
  getPendingWrites,
  removePendingWrite,
  upsertTask,
} from '../src/db.js';
import { opportunitiesManagerMixin } from '../src/opportunities-manager.js';

function createStore(overrides = {}) {
  const store = {
    session: { npub: 'npub-session' },
    workspaceOwnerNpub: 'npub-owner',
    signingNpub: 'npub-signing',
    editingOpportunity: null,
    opportunityPersonQuery: '',
    opportunityOrganisationQuery: '',
    opportunityTaskQuery: '',
    opportunityResponsibleQuery: '',
    persons: [],
    organisations: [],
    tasks: [],
    opportunities: [],
    flows: [],
    groups: [],
    scopesMap: new Map(),
    error: '',
    opportunitySaving: false,
    opportunityCheckoutPending: false,
    opportunityDetailMode: 'view',
    opportunityEditOriginal: null,
    findPeopleSuggestions: vi.fn(() => []),
    resolveChatProfile: vi.fn(),
    flushAndBackgroundSync: vi.fn(async () => {}),
    ensureLockManagedCheckout: vi.fn(async () => ({ checkout_id: 'checkout-1' })),
    releaseLockManagedCheckout: vi.fn(async () => true),
    clearLockManagedCheckoutSession: vi.fn(),
    attachCheckoutRequiredCheckoutToEnvelope: vi.fn(async (_record, envelope) => ({
      ...envelope,
      checkout: { checkout_id: 'checkout-1', consume_on_success: true },
    })),
    getCheckoutEditPolicyConfig: vi.fn((familySuffix) => ({
      familySuffixes: { [familySuffix]: 'checkout_required' },
    })),
    buildScopeAssignment: vi.fn((scopeId) => ({
      scope_id: scopeId ?? null,
      scope_l1_id: scopeId ?? null,
      scope_l2_id: null,
      scope_l3_id: null,
      scope_l4_id: null,
      scope_l5_id: null,
    })),
    getScopeBreadcrumb: vi.fn((scopeId) => (scopeId ? `Scope ${scopeId}` : '')),
    getScopeShareGroupIds: vi.fn((scope) => scope?.group_ids || []),
    buildScopeDefaultShares: vi.fn((groupIds = []) => groupIds.map((groupId) => ({
      type: 'group',
      key: `group:${groupId}`,
      access: 'write',
      group_npub: groupId,
      label: groupId,
    }))),
    buildTaskBoardAssignment: vi.fn((scopeId) => ({
      scope_id: scopeId ?? null,
      scope_l1_id: scopeId ?? null,
      scope_l2_id: null,
      scope_l3_id: null,
      scope_l4_id: null,
      scope_l5_id: null,
      scope_policy_group_ids: ['group-1'],
      board_group_id: 'group-1',
      group_ids: ['group-1'],
      shares: [{
        type: 'group',
        key: 'group:group-1',
        access: 'write',
        group_npub: 'group-1',
        label: 'group-1',
      }],
    })),
    ...overrides,
  };

  const descriptors = Object.getOwnPropertyDescriptors(opportunitiesManagerMixin);
  for (const [key, desc] of Object.entries(descriptors)) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) continue;
    Object.defineProperty(store, key, desc);
  }

  return store;
}

describe('opportunitiesManagerMixin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOpportunityById.mockResolvedValue(null);
    getPendingWrites.mockResolvedValue([]);
  });

  it('does not return person, organisation, or task suggestions for empty link queries', () => {
    const store = createStore({
      editingOpportunity: {
        person_links: [],
        organisation_links: [],
        task_links: [],
      },
      persons: [{ record_id: 'person-1', title: 'Alice Example', tags: 'sales' }],
      organisations: [{ record_id: 'org-1', title: 'Acme Pty', tags: 'prospect' }],
      tasks: [{ record_id: 'task-1', title: 'Call Acme', record_state: 'active' }],
    });

    expect(store.opportunityPersonSuggestions).toEqual([]);
    expect(store.opportunityOrganisationSuggestions).toEqual([]);
    expect(store.opportunityTaskSuggestions).toEqual([]);
  });

  it('requires a scoped opportunity before enabling task creation', () => {
    const store = createStore({
      editingOpportunity: {
        scope_id: null,
        task_links: [],
      },
      opportunityTaskQuery: 'Follow up with Acme',
    });

    expect(store.opportunityTaskDraftTitle).toBe('Follow up with Acme');
    expect(store.canCreateOpportunityTask).toBe(false);
  });

  it('appends linked tasks instead of replacing the existing opportunity task list', () => {
    const store = createStore({
      editingOpportunity: {
        task_links: [{ task_id: 'task-1', primary: true }],
      },
      opportunityTaskQuery: 'Add another task',
    });

    store.linkTaskToEditingOpportunity('task-2', { primary: false });

    expect(store.editingOpportunity.task_links).toEqual([
      { task_id: 'task-1', primary: true },
      { task_id: 'task-2', primary: false },
    ]);
    expect(store.opportunityTaskQuery).toBe('');
  });

  it('creates a scoped task from the opportunity editor and links it immediately', async () => {
    const uuidSpy = vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('task-1');
    const store = createStore({
      scopesMap: new Map([['scope-1', { record_id: 'scope-1', level: 'l2', group_ids: ['group-1'] }]]),
      editingOpportunity: {
        record_id: 'opp-1',
        scope_id: 'scope-1',
        scope_l1_id: 'scope-1',
        scope_l2_id: null,
        scope_l3_id: null,
        scope_l4_id: null,
        scope_l5_id: null,
        task_links: [],
      },
      opportunityTaskQuery: 'Call Acme treasury team',
    });

    const created = await store.createTaskForEditingOpportunity();

    expect(created).toMatchObject({
      record_id: 'task-1',
      title: 'Call Acme treasury team',
      scope_id: 'scope-1',
      board_group_id: 'group-1',
      group_ids: ['group-1'],
      references: [{ type: 'opportunity', id: 'opp-1' }],
    });
    expect(upsertTask).toHaveBeenCalledWith(expect.objectContaining({
      record_id: 'task-1',
      title: 'Call Acme treasury team',
      scope_id: 'scope-1',
      references: [{ type: 'opportunity', id: 'opp-1' }],
    }));
    expect(addPendingWrite).toHaveBeenCalledWith(expect.objectContaining({
      record_id: 'task-1',
      record_family_hash: 'family:task',
    }));
    expect(store.editingOpportunity.task_links).toEqual([{ task_id: 'task-1', primary: true }]);
    expect(store.opportunityTaskQuery).toBe('');
    expect(store.flushAndBackgroundSync).toHaveBeenCalledTimes(1);

    uuidSpy.mockRestore();
  });

  it('assigns flow kickoff tasks from the opportunity editor to the default agent', async () => {
    const uuidSpy = vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('task-flow-1');
    const { resolveFlowLinkage } = await import('../src/translators/tasks.js');
    resolveFlowLinkage.mockReturnValueOnce({
      flow_id: 'flow-1',
      flow_run_id: null,
      flow_step: null,
      references: [
        { type: 'opportunity', id: 'opp-1' },
        { type: 'flow', id: 'flow-1' },
      ],
    });
    const store = createStore({
      defaultAgentNpub: 'npub-agent',
      botNpub: 'npub-bot',
      flows: [{ record_id: 'flow-1', title: 'Outreach Pipeline', record_state: 'active' }],
      scopesMap: new Map([['scope-1', { record_id: 'scope-1', level: 'l2', group_ids: ['group-1'] }]]),
      editingOpportunity: {
        record_id: 'opp-1',
        scope_id: 'scope-1',
        scope_l1_id: 'scope-1',
        scope_l2_id: null,
        scope_l3_id: null,
        scope_l4_id: null,
        scope_l5_id: null,
        task_links: [],
      },
      opportunityTaskQuery: 'Run Flow: Outreach Pipeline',
    });

    const created = await store.createTaskForEditingOpportunity();

    expect(created.assigned_to_npub).toBe('npub-agent');
    expect(upsertTask).toHaveBeenCalledWith(expect.objectContaining({
      record_id: 'task-flow-1',
      assigned_to_npub: 'npub-agent',
      flow_id: 'flow-1',
      flow_run_id: null,
    }));

    uuidSpy.mockRestore();
  });

  it('collapses edits to an unsynced opportunity create into a replacement v1 create write', async () => {
    const existing = {
      record_id: 'opp-1',
      owner_npub: 'npub-owner',
      title: 'Draft opportunity',
      description: '',
      stage: 'speculation',
      version: 1,
      sync_status: 'pending',
      group_ids: ['group-1'],
      shares: [{ type: 'group', group_npub: 'group-1', access: 'write' }],
      created_at: '2026-04-28T01:00:00.000Z',
      updated_at: '2026-04-28T01:00:00.000Z',
    };
    getOpportunityById.mockResolvedValueOnce(existing);
    getPendingWrites
      .mockResolvedValueOnce([{
        row_id: 7,
        record_id: 'opp-1',
        record_family_hash: 'family:opportunity',
        envelope: {
          record_id: 'opp-1',
          record_family_hash: 'family:opportunity',
          version: 1,
          previous_version: 0,
        },
      }])
      .mockResolvedValueOnce([{
        row_id: 7,
        record_id: 'opp-1',
        record_family_hash: 'family:opportunity',
        envelope: {
          record_id: 'opp-1',
          record_family_hash: 'family:opportunity',
          version: 1,
          previous_version: 0,
        },
      }]);
    const store = createStore({
      editingOpportunity: {
        ...existing,
        title: 'Updated before first sync',
      },
    });

    const saved = await store.saveEditingOpportunity();

    expect(saved).toMatchObject({
      record_id: 'opp-1',
      title: 'Updated before first sync',
      version: 1,
      sync_status: 'pending',
    });
    expect(removePendingWrite).toHaveBeenCalledWith(7);
    expect(addPendingWrite).toHaveBeenCalledWith(expect.objectContaining({
      record_id: 'opp-1',
      record_family_hash: 'family:opportunity',
      envelope: expect.objectContaining({
        version: 1,
        previous_version: 0,
      }),
    }));
  });

  it('checks out existing opportunities before edit and checks in on save', async () => {
    const existing = {
      record_id: 'opp-1',
      owner_npub: 'npub-owner',
      title: 'Draft opportunity',
      description: '',
      stage: 'speculation',
      version: 2,
      sync_status: 'synced',
      group_ids: ['group-1'],
      shares: [{ type: 'group', group_npub: 'group-1', access: 'write' }],
      created_at: '2026-04-28T01:00:00.000Z',
      updated_at: '2026-04-28T01:00:00.000Z',
    };
    getOpportunityById.mockResolvedValue(existing);
    const store = createStore({
      opportunities: [existing],
      editingOpportunity: { ...existing },
      activeOpportunityId: 'opp-1',
      flushAndBackgroundSync: vi.fn(async () => ({ pushed: 1 })),
    });

    await expect(store.enterOpportunityEditMode()).resolves.toBe(true);
    store.editingOpportunity.title = 'Checked out update';
    const saved = await store.saveEditingOpportunity();

    expect(store.ensureLockManagedCheckout).toHaveBeenCalledWith(
      existing,
      'family:opportunity',
      expect.objectContaining({
        intent: 'edit',
        checkoutPolicyConfig: { familySuffixes: { opportunity: 'checkout_required' } },
      }),
    );
    expect(saved).toMatchObject({
      record_id: 'opp-1',
      title: 'Checked out update',
      version: 3,
    });
    expect(addPendingWrite).toHaveBeenCalledWith(expect.objectContaining({
      record_id: 'opp-1',
      checkout_policy_config: { familySuffixes: { opportunity: 'checkout_required' } },
      envelope: expect.objectContaining({
        previous_version: 2,
        checkout: { checkout_id: 'checkout-1', consume_on_success: true },
      }),
    }));
    expect(store.clearLockManagedCheckoutSession).toHaveBeenCalledWith('opp-1', 'family:opportunity');
    expect(store.opportunityDetailMode).toBe('view');
  });

  it('derives high-level opportunity metrics from filtered opportunities and linked tasks', () => {
    const store = createStore({
      opportunityFilter: '',
      opportunities: [
        {
          record_id: 'opp-1',
          title: 'Alpha',
          stage: 'qualified',
          expected_value: 125000,
          currency: 'AUD',
          expected_close_at: '2026-04-30',
          task_links: [{ task_id: 'task-1', primary: true }],
        },
        {
          record_id: 'opp-2',
          title: 'Beta',
          stage: 'proposal',
          expected_value: 40000,
          currency: 'USD',
          expected_close_at: '2026-06-15',
          task_links: [{ task_id: 'task-2', primary: true }],
        },
        {
          record_id: 'opp-3',
          title: 'Gamma',
          stage: 'lost',
          expected_value: 9000,
          currency: 'AUD',
          expected_close_at: '2026-04-28',
          task_links: [{ task_id: 'task-3', primary: true }],
        },
      ],
      tasks: [
        { record_id: 'task-1', record_state: 'active', updated_at: '2026-04-20T10:00:00Z' },
        { record_id: 'task-2', record_state: 'active', updated_at: '2026-03-25T10:00:00Z' },
        { record_id: 'task-3', record_state: 'active', updated_at: '2026-04-19T10:00:00Z' },
      ],
    });

    expect(store.opportunityMetrics.opportunityCount).toBe(3);
    expect(store.opportunityMetrics.openCount).toBe(2);
    expect(store.opportunityMetrics.totalForecast.value).toBe('AUD 125K +1');
    expect(store.opportunityMetrics.totalForecast.meta).toContain('AUD 125K');
    expect(store.opportunityMetrics.totalForecast.meta).toContain('USD 40K');
    expect(store.opportunityMetrics.next30Forecast.value).toBe('AUD 125K');
    expect(store.opportunityMetrics.recentActivityCount).toBe(2);
  });
});
