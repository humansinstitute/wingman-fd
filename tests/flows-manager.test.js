import { describe, it, expect, vi } from 'vitest';
import {
  pendingApprovals,
  approvalsByFlowRun,
  formatApprovalStatus,
  approvalStatusColor,
  confidenceLabel,
  flowsManagerMixin,
} from '../src/flows-manager.js';

vi.mock('../src/db.js', () => ({
  upsertFlow: vi.fn(async () => {}),
  getFlowById: vi.fn(async () => null),
  getFlowsByScope: vi.fn(async () => []),
  getFlowsByOwner: vi.fn(async () => []),
  upsertApproval: vi.fn(async () => {}),
  getApprovalById: vi.fn(async () => null),
  getApprovalsByScope: vi.fn(async () => []),
  getApprovalsByStatus: vi.fn(async () => []),
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
// Pure function tests
// ---------------------------------------------------------------------------

describe('pendingApprovals', () => {
  it('filters to pending non-deleted approvals', () => {
    const list = [
      { record_id: 'a1', status: 'pending', record_state: 'active' },
      { record_id: 'a2', status: 'approved', record_state: 'active' },
      { record_id: 'a3', status: 'pending', record_state: 'deleted' },
      { record_id: 'a4', status: 'pending', record_state: 'active' },
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
    ];
    expect(approvalsByFlowRun(list, 'run-1')).toHaveLength(1);
    expect(approvalsByFlowRun(list, null)).toEqual([]);
  });
});

describe('formatApprovalStatus', () => {
  it('formats known statuses', () => {
    expect(formatApprovalStatus('pending')).toBe('Pending');
    expect(formatApprovalStatus('approved')).toBe('Approved');
    expect(formatApprovalStatus('rejected')).toBe('Rejected');
    expect(formatApprovalStatus('needs_revision')).toBe('Needs Revision');
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
    flushAndBackgroundSync: vi.fn(async () => {}),
    applyTaskPatch: vi.fn(async () => null),
    ...overrides,
  };

  const descriptors = Object.getOwnPropertyDescriptors(flowsManagerMixin);
  for (const [key, desc] of Object.entries(descriptors)) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) continue;
    Object.defineProperty(store, key, desc);
  }
  return store;
}

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
    expect(store.applyTaskPatch).toHaveBeenCalledWith('task-1', { state: 'done' }, { silent: true, sync: true });
    expect(store.applyTaskPatch).toHaveBeenCalledWith('task-2', { state: 'done' }, { silent: true, sync: true });
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

  it('pendingApprovalsByScope filters pending approvals by scope', () => {
    const store = createStore({
      selectedBoardId: 'scope-1',
      approvals: [
        { record_id: 'a1', status: 'pending', scope_id: 'scope-1', record_state: 'active' },
        { record_id: 'a2', status: 'pending', scope_id: 'scope-2', record_state: 'active' },
        { record_id: 'a3', status: 'approved', scope_id: 'scope-1', record_state: 'active' },
      ],
    });

    expect(store.pendingApprovalsByScope).toHaveLength(1);
    expect(store.pendingApprovalsByScope[0].record_id).toBe('a1');
  });
});
