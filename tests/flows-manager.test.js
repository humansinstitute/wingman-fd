import { beforeEach, describe, it, expect, vi } from 'vitest';
import {
  pendingApprovals,
  approvalsByFlowRun,
  isArchivedApproval,
  formatApprovalStatus,
  approvalStatusColor,
  confidenceLabel,
  flowsManagerMixin,
  normalizeStoredFlowScopeId,
} from '../src/flows-manager.js';
import {
  ALL_TASK_BOARD_ID,
  RECENT_TASK_BOARD_ID,
  UNSCOPED_TASK_BOARD_ID,
} from '../src/task-board-state.js';

vi.mock('../src/crypto/group-keys.js', () => ({
  hasGroupKey: vi.fn(() => true),
}));

vi.mock('../src/db.js', () => ({
  upsertFlow: vi.fn(async () => {}),
  getFlowById: vi.fn(async () => null),
  getFlowsByScope: vi.fn(async () => []),
  getFlowsByOwner: vi.fn(async () => []),
  upsertApproval: vi.fn(async () => {}),
  getApprovalById: vi.fn(async () => null),
  getApprovalsByScope: vi.fn(async () => []),
  getApprovalsByStatus: vi.fn(async () => []),
  getAllApprovals: vi.fn(async () => []),
  upsertTask: vi.fn(async () => {}),
  addPendingWrite: vi.fn(async () => {}),
}));

vi.mock('../src/translators/flows.js', () => ({
  outboundFlow: vi.fn(async (payload) => ({
    ...payload,
    record_family_hash: 'mock:flow',
    owner_payload: { ciphertext: '{}' },
    group_payloads: [],
  })),
  recordFamilyHash: (collectionSpace) => `mock:${collectionSpace}`,
}));

vi.mock('../src/translators/approvals.js', () => ({
  outboundApproval: vi.fn(async (payload) => ({
    ...payload,
    record_family_hash: 'mock:approval',
    owner_payload: { ciphertext: '{}' },
    group_payloads: [],
  })),
  recordFamilyHash: (collectionSpace) => `mock:${collectionSpace}`,
}));

vi.mock('../src/translators/tasks.js', () => ({
  outboundTask: vi.fn(async (payload) => ({
    ...payload,
    record_family_hash: 'mock:task',
    owner_payload: { ciphertext: '{}' },
    group_payloads: [],
  })),
}));

import { addPendingWrite } from '../src/db.js';

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Pure function tests
// ---------------------------------------------------------------------------

describe('pendingApprovals', () => {
  it('filters to pending non-deleted approvals', () => {
    const list = [
      { record_id: 'a1', status: 'pending', record_state: 'active' },
      { record_id: 'a2', status: 'approved', record_state: 'active' },
      { record_id: 'a3', status: 'pending', record_state: 'deleted' },
      { record_id: 'a4', status: 'pending', record_state: 'active' },
      { record_id: 'a5', status: 'archived', record_state: 'archived' },
      { record_id: 'a6', status: 'pending', record_state: 'archived' },
    ];
    const result = pendingApprovals(list);
    expect(result).toHaveLength(2);
    expect(result.map((a) => a.record_id)).toEqual(['a1', 'a4']);
  });
});

describe('approvalsByFlowRun', () => {
  it('filters by flow_run_id', () => {
    const list = [
      { record_id: 'a1', flow_run_id: 'run-1', record_state: 'active' },
      { record_id: 'a2', flow_run_id: 'run-2', record_state: 'active' },
      { record_id: 'a3', flow_run_id: 'run-1', record_state: 'deleted' },
      { record_id: 'a4', flow_run_id: 'run-1', status: 'archived', record_state: 'archived' },
    ];
    expect(approvalsByFlowRun(list, 'run-1')).toHaveLength(1);
    expect(approvalsByFlowRun(list, null)).toEqual([]);
  });
});

describe('isArchivedApproval', () => {
  it('treats deleted, archived record_state, and archived status as hidden', () => {
    expect(isArchivedApproval({ record_state: 'deleted', status: 'pending' })).toBe(true);
    expect(isArchivedApproval({ record_state: 'archived', status: 'pending' })).toBe(true);
    expect(isArchivedApproval({ record_state: 'active', status: 'archived' })).toBe(true);
    expect(isArchivedApproval({ record_state: 'active', status: 'pending' })).toBe(false);
  });
});

describe('formatApprovalStatus', () => {
  it('formats known statuses', () => {
    expect(formatApprovalStatus('pending')).toBe('Pending');
    expect(formatApprovalStatus('approved')).toBe('Approved');
    expect(formatApprovalStatus('rejected')).toBe('Rejected');
    expect(formatApprovalStatus('needs_revision')).toBe('Needs Revision');
    expect(formatApprovalStatus('archived')).toBe('Archived');
  });

  it('returns empty string for null/undefined', () => {
    expect(formatApprovalStatus(null)).toBe('');
    expect(formatApprovalStatus(undefined)).toBe('');
  });
});

describe('approvalStatusColor', () => {
  it('returns correct colors', () => {
    expect(approvalStatusColor('pending')).toBe('#fbbf24');
    expect(approvalStatusColor('approved')).toBe('#34d399');
    expect(approvalStatusColor('rejected')).toBe('#f87171');
    expect(approvalStatusColor('needs_revision')).toBe('#a78bfa');
    expect(approvalStatusColor('archived')).toBe('#94a3b8');
  });

  it('returns fallback for unknown', () => {
    expect(approvalStatusColor('unknown')).toBe('#9ca3af');
  });
});

describe('confidenceLabel', () => {
  it('formats score as percentage', () => {
    expect(confidenceLabel(0.87)).toBe('87%');
    expect(confidenceLabel(1)).toBe('100%');
    expect(confidenceLabel(0)).toBe('0%');
  });

  it('returns empty string for null', () => {
    expect(confidenceLabel(null)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Mixin tests
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
    flowDetailMode: 'view',
    flowEditOriginal: null,
    flowCheckoutPending: false,
    recordCheckoutPolicyConfig: { familySuffixes: {} },
    flushAndBackgroundSync: vi.fn(async () => ({ pushed: 1 })),
    applyTaskPatch: vi.fn(async () => null),
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
    ...overrides,
  };

  const descriptors = Object.getOwnPropertyDescriptors(flowsManagerMixin);
  for (const [key, desc] of Object.entries(descriptors)) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) continue;
    Object.defineProperty(store, key, desc);
  }
  return store;
}

describe('flowsManagerMixin — checkout edit flow', () => {
  it('checks out existing flows before saving edits', async () => {
    const flow = {
      record_id: 'flow-1',
      title: 'Original flow',
      description: '',
      steps: [],
      group_ids: ['g1'],
      version: 2,
      record_state: 'active',
    };
    const store = createStore({
      editingFlowId: 'flow-1',
      flows: [flow],
    });

    await expect(store.enterFlowEditMode()).resolves.toBe(true);
    const updated = await store.updateFlow('flow-1', { title: 'Updated flow' });

    expect(store.ensureLockManagedCheckout).toHaveBeenCalledWith(
      flow,
      'mock:flow',
      expect.objectContaining({
        intent: 'edit',
        checkoutPolicyConfig: { familySuffixes: { flow: 'checkout_required' } },
      }),
    );
    expect(updated).toMatchObject({
      record_id: 'flow-1',
      title: 'Updated flow',
      version: 3,
    });
    expect(addPendingWrite).toHaveBeenCalledWith(expect.objectContaining({
      record_id: 'flow-1',
      record_family_hash: 'mock:flow',
      checkout_policy_config: { familySuffixes: { flow: 'checkout_required' } },
      envelope: expect.objectContaining({
        checkout: { checkout_id: 'checkout-1', consume_on_success: true },
        previous_version: 2,
      }),
    }));
    expect(store.clearLockManagedCheckoutSession).toHaveBeenCalledWith('flow-1', 'mock:flow');
    expect(store.flowDetailMode).toBe('view');
  });
});

describe('flowsManagerMixin — approval actions', () => {
  it('approveApproval sets status to approved and moves linked tasks to done', async () => {
    const store = createStore({
      approvals: [
        {
          record_id: 'approval-1',
          status: 'pending',
          task_ids: ['task-1', 'task-2'],
          group_ids: ['g1'],
          version: 1,
          record_state: 'active',
        },
      ],
    });

    const result = await store.approveApproval('approval-1', 'Looks good');

    expect(result.status).toBe('approved');
    expect(result.approved_by).toBe('npub_viewer');
    expect(result.approved_at).toBeTruthy();
    expect(result.decision_note).toBe('Looks good');
    expect(store.applyTaskPatch).toHaveBeenCalledTimes(2);
    expect(store.applyTaskPatch).toHaveBeenCalledWith('task-1', { state: 'done' }, {
      silent: true,
      sync: true,
      intent: 'approval_approve',
    });
    expect(store.applyTaskPatch).toHaveBeenCalledWith('task-2', { state: 'done' }, {
      silent: true,
      sync: true,
      intent: 'approval_approve',
    });
  });

  it('approval decisions acquire checkout and attach checkout metadata', async () => {
    const approval = {
      record_id: 'approval-1',
      status: 'pending',
      task_ids: [],
      group_ids: ['g1'],
      version: 4,
      record_state: 'active',
    };
    const store = createStore({
      approvals: [approval],
    });

    const result = await store.rejectApproval('approval-1', 'Not ready');

    expect(store.ensureLockManagedCheckout).toHaveBeenCalledWith(
      approval,
      'mock:approval',
      expect.objectContaining({
        intent: 'edit',
        checkoutPolicyConfig: { familySuffixes: { approval: 'checkout_required' } },
      }),
    );
    expect(result).toMatchObject({
      record_id: 'approval-1',
      status: 'rejected',
      version: 5,
    });
    expect(addPendingWrite).toHaveBeenCalledWith(expect.objectContaining({
      record_id: 'approval-1',
      record_family_hash: 'mock:approval',
      checkout_policy_config: { familySuffixes: { approval: 'checkout_required' } },
      envelope: expect.objectContaining({
        checkout: { checkout_id: 'checkout-1', consume_on_success: true },
        previous_version: 4,
      }),
    }));
    expect(store.clearLockManagedCheckoutSession).toHaveBeenCalledWith('approval-1', 'mock:approval');
  });

  it('rejectApproval sets status to rejected', async () => {
    const store = createStore({
      approvals: [
        {
          record_id: 'approval-1',
          status: 'pending',
          task_ids: [],
          group_ids: [],
          version: 1,
          record_state: 'active',
        },
      ],
    });

    const result = await store.rejectApproval('approval-1', 'Not acceptable');

    expect(result.status).toBe('rejected');
    expect(result.decision_note).toBe('Not acceptable');
  });

  it('improveApproval sets needs_revision and creates a revision task', async () => {
    const store = createStore({
      approvals: [
        {
          record_id: 'approval-1',
          title: 'Step 1 Review',
          status: 'pending',
          flow_id: 'flow-1',
          flow_run_id: 'run-1',
          flow_step: 1,
          task_ids: [],
          scope_id: 'scope-1',
          scope_l1_id: 'scope-1',
          scope_l2_id: null,
          scope_l3_id: null,
          scope_l4_id: null,
          scope_l5_id: null,
          group_ids: ['g1'],
          version: 1,
          record_state: 'active',
        },
      ],
      tasks: [],
    });

    const result = await store.improveApproval('approval-1', 'Please fix the analysis');

    expect(result.status).toBe('needs_revision');
    expect(result.revision_task_id).toBeTruthy();
    expect(result.decision_note).toBe('Please fix the analysis');
    // Revision task should be added to tasks
    expect(store.tasks).toHaveLength(1);
    expect(store.tasks[0].title).toBe('Revision: Step 1 Review');
    expect(store.tasks[0].state).toBe('ready');
    expect(store.tasks[0].flow_id).toBe('flow-1');
  });

  it('approveApproval returns null for non-existent approval', async () => {
    const store = createStore();
    const result = await store.approveApproval('nonexistent');
    expect(result).toBeNull();
  });

  it('archiveApproval hides the approval and archives linked in-flight tasks', async () => {
    const store = createStore({
      approvals: [
        {
          record_id: 'approval-1',
          status: 'pending',
          task_ids: ['task-1', 'task-2'],
          group_ids: ['g1'],
          version: 1,
          record_state: 'active',
        },
      ],
    });

    const result = await store.archiveApproval('approval-1', 'Stop this flow');

    expect(result.status).toBe('archived');
    expect(result.record_state).toBe('archived');
    expect(result.approved_by).toBe('npub_viewer');
    expect(result.approved_at).toBeTruthy();
    expect(result.decision_note).toBe('Stop this flow');
    expect(store.pendingApprovalsByScope).toHaveLength(0);
    expect(store.applyTaskPatch).toHaveBeenCalledTimes(2);
    expect(store.applyTaskPatch).toHaveBeenCalledWith('task-1', { state: 'archive' }, {
      silent: true,
      sync: true,
      intent: 'approval_archive',
    });
    expect(store.applyTaskPatch).toHaveBeenCalledWith('task-2', { state: 'archive' }, {
      silent: true,
      sync: true,
      intent: 'approval_archive',
    });
  });

  it('deleteApproval tombstones locally and queues an owner-only delete envelope', async () => {
    const store = createStore({
      activeApprovalId: 'approval-1',
      showApprovalDetail: true,
      approvalPreviewRecord: { record_id: 'task-1' },
      approvalPreviewBlocks: [{ id: 'block-1' }],
      approvalPreviewComments: [{ record_id: 'comment-1' }],
      approvalPreviewExpanded: true,
      approvals: [
        {
          record_id: 'approval-1',
          status: 'pending',
          task_ids: ['task-1'],
          group_ids: ['missing-group'],
          version: 7,
          record_state: 'active',
        },
      ],
    });

    const result = await store.deleteApproval('approval-1');

    expect(result).toMatchObject({
      record_id: 'approval-1',
      record_state: 'deleted',
      sync_status: 'pending',
      version: 8,
    });
    expect(store.approvals).toEqual([]);
    expect(store.activeApprovalId).toBeNull();
    expect(store.showApprovalDetail).toBe(false);
    expect(store.approvalPreviewRecord).toBeNull();
    expect(addPendingWrite).toHaveBeenCalledWith(expect.objectContaining({
      record_id: 'approval-1',
      record_family_hash: 'mock:approval',
      envelope: expect.objectContaining({
        record_id: 'approval-1',
        record_state: 'deleted',
        group_ids: [],
        previous_version: 7,
        write_group_ref: null,
      }),
    }));
    expect(store.flushAndBackgroundSync).toHaveBeenCalledTimes(1);
    expect(store.applyTaskPatch).not.toHaveBeenCalled();
  });

  it('deletePendingApprovalsByScope deletes visible pending approvals with one flush', async () => {
    const store = createStore({
      approvals: [
        { record_id: 'a1', status: 'pending', group_ids: ['g1'], version: 1, record_state: 'active' },
        { record_id: 'a2', status: 'pending', group_ids: ['g1'], version: 1, record_state: 'active' },
        { record_id: 'a3', status: 'approved', group_ids: ['g1'], version: 1, record_state: 'active' },
      ],
    });

    const count = await store.deletePendingApprovalsByScope();

    expect(count).toBe(2);
    expect(store.approvals.map((approval) => approval.record_id)).toEqual(['a3']);
    expect(addPendingWrite).toHaveBeenCalledTimes(2);
    expect(store.flushAndBackgroundSync).toHaveBeenCalledTimes(1);
  });
});

describe('flowsManagerMixin — computed getters', () => {
  it('flowsByScope filters by selected board', () => {
    const store = createStore({
      selectedBoardId: 'scope-1',
      flows: [
        { record_id: 'f1', scope_id: 'scope-1' },
        { record_id: 'f2', scope_id: 'scope-2' },
      ],
    });

    expect(store.flowsByScope).toHaveLength(1);
    expect(store.flowsByScope[0].record_id).toBe('f1');
  });

  it('flowsByScope returns all flows when no board selected', () => {
    const store = createStore({
      selectedBoardId: null,
      flows: [
        { record_id: 'f1', scope_id: 'scope-1' },
        { record_id: 'f2', scope_id: 'scope-2' },
      ],
    });

    expect(store.flowsByScope).toHaveLength(2);
  });

  it('flowsByScope returns all flows for the all-work board', () => {
    const store = createStore({
      selectedBoardId: ALL_TASK_BOARD_ID,
      flows: [
        { record_id: 'f1', scope_id: 'scope-1' },
        { record_id: 'f2', scope_id: 'scope-2' },
      ],
    });

    expect(store.flowsByScope).toHaveLength(2);
  });

  it('flowsByScope returns all flows for the recent-work board', () => {
    const store = createStore({
      selectedBoardId: RECENT_TASK_BOARD_ID,
      flows: [
        { record_id: 'f1', scope_id: 'scope-1' },
        { record_id: 'f2', scope_id: 'scope-2' },
      ],
    });

    expect(store.flowsByScope).toHaveLength(2);
  });

  it('flowsByScope returns only unscoped flows for the unscoped board', () => {
    const store = createStore({
      selectedBoardId: UNSCOPED_TASK_BOARD_ID,
      scopesMap: new Map(),
      flows: [
        { record_id: 'f1', scope_id: null, scope_l1_id: null, record_state: 'active' },
        { record_id: 'f2', scope_id: 'scope-2', scope_l1_id: 'scope-2', record_state: 'active' },
      ],
    });

    expect(store.flowsByScope).toHaveLength(1);
    expect(store.flowsByScope[0].record_id).toBe('f1');
  });

  it('pendingApprovalsByScope filters pending approvals by scope', () => {
    const store = createStore({
      selectedBoardId: 'scope-1',
      approvals: [
        { record_id: 'a1', status: 'pending', scope_id: 'scope-1', record_state: 'active' },
        { record_id: 'a2', status: 'pending', scope_id: 'scope-2', record_state: 'active' },
        { record_id: 'a3', status: 'approved', scope_id: 'scope-1', record_state: 'active' },
        { record_id: 'a4', status: 'archived', scope_id: 'scope-1', record_state: 'archived' },
      ],
    });

    expect(store.pendingApprovalsByScope).toHaveLength(1);
    expect(store.pendingApprovalsByScope[0].record_id).toBe('a1');
  });

  it('pendingApprovalsByScope returns all pending approvals for the all-work board', () => {
    const store = createStore({
      selectedBoardId: ALL_TASK_BOARD_ID,
      approvals: [
        { record_id: 'a1', status: 'pending', scope_id: 'scope-1', record_state: 'active' },
        { record_id: 'a2', status: 'pending', scope_id: 'scope-2', record_state: 'active' },
      ],
    });

    expect(store.pendingApprovalsByScope).toHaveLength(2);
  });
});

describe('flowsManagerMixin — flow approver helpers', () => {
  it('addFlowStepApprover adds a person token and remembers the profile', async () => {
    const store = createStore({
      rememberPeople: vi.fn(async () => {}),
      resolveChatProfile: vi.fn(),
    });
    const step = { whitelist_approvers: null };

    const added = await store.addFlowStepApprover(step, {
      token: 'npub1alice',
      type: 'person',
    });

    expect(added).toBe(true);
    expect(step.whitelist_approvers).toEqual(['npub1alice']);
    expect(store.resolveChatProfile).toHaveBeenCalledWith('npub1alice');
    expect(store.rememberPeople).toHaveBeenCalledWith(['npub1alice'], 'flow-approver');
  });

  it('addFlowStepApprover adds a group token without remembering people', async () => {
    const store = createStore({
      rememberPeople: vi.fn(async () => {}),
      resolveChatProfile: vi.fn(),
    });
    const step = { whitelist_approvers: [] };

    const added = await store.addFlowStepApprover(step, 'group:management');

    expect(added).toBe(true);
    expect(step.whitelist_approvers).toEqual(['group:management']);
    expect(store.resolveChatProfile).not.toHaveBeenCalled();
    expect(store.rememberPeople).not.toHaveBeenCalled();
  });

  it('consumeFlowStepApproverQuery accepts comma-separated raw tokens', async () => {
    const store = createStore({
      rememberPeople: vi.fn(async () => {}),
      resolveChatProfile: vi.fn(),
    });
    const step = { whitelist_approvers: null };

    const added = await store.consumeFlowStepApproverQuery(
      step,
      ' npub1alice, group:management, invalid-token ',
    );

    expect(added).toBe(true);
    expect(step.whitelist_approvers).toEqual(['npub1alice', 'group:management']);
  });

  it('consumeFlowStepApproverQuery falls back to a suggestion when raw query is not a token', async () => {
    const store = createStore({
      rememberPeople: vi.fn(async () => {}),
      resolveChatProfile: vi.fn(),
    });
    const step = { whitelist_approvers: null };

    const added = await store.consumeFlowStepApproverQuery(step, 'alice', {
      token: 'npub1alice',
      type: 'person',
    });

    expect(added).toBe(true);
    expect(step.whitelist_approvers).toEqual(['npub1alice']);
  });

  it('removeFlowStepApprover removes tokens and clears the list when empty', () => {
    const store = createStore();
    const step = { whitelist_approvers: ['npub1alice', 'group:management'] };

    store.removeFlowStepApprover(step, 'npub1alice');
    expect(step.whitelist_approvers).toEqual(['group:management']);

    store.removeFlowStepApprover(step, 'group:management');
    expect(step.whitelist_approvers).toBeNull();
  });
});

describe('normalizeStoredFlowScopeId', () => {
  it('returns null for system board ids', () => {
    expect(normalizeStoredFlowScopeId(ALL_TASK_BOARD_ID)).toBeNull();
    expect(normalizeStoredFlowScopeId(RECENT_TASK_BOARD_ID)).toBeNull();
    expect(normalizeStoredFlowScopeId(UNSCOPED_TASK_BOARD_ID)).toBeNull();
  });

  it('returns a real scope id unchanged', () => {
    expect(normalizeStoredFlowScopeId('scope-1')).toBe('scope-1');
  });
});
