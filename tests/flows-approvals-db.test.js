import { beforeEach, describe, expect, it } from 'vitest';
import {
  openWorkspaceDb,
  upsertFlow,
  getFlowById,
  getFlowsByScope,
  upsertApproval,
  getApprovalById,
  getApprovalsByScope,
  getApprovalsByStatus,
  upsertTask,
  getTaskById,
  clearRuntimeFamilies,
  clearRuntimeData,
  clearSyncStateForFamilies,
  setSyncState,
  getSyncState,
  addPendingWrite,
  getPendingWritesByFamilies,
} from '../src/db.js';
import { getSyncFamily, getSyncStateKeyForFamily, SYNC_FAMILY_OPTIONS } from '../src/sync-families.js';

const TEST_OWNER = 'npub_test_flows_approvals';

beforeEach(async () => {
  const wsDb = openWorkspaceDb(TEST_OWNER);
  await wsDb.open();
  await Promise.all(wsDb.tables.map((table) => table.clear()));
});

describe('sync family registration', () => {
  it('includes flow and approval in SYNC_FAMILY_OPTIONS', () => {
    const ids = SYNC_FAMILY_OPTIONS.map((f) => f.id);
    expect(ids).toContain('flow');
    expect(ids).toContain('approval');
  });

  it('maps flow family to flows table', () => {
    expect(getSyncFamily('flow')?.table).toBe('flows');
    expect(getSyncFamily('flow')?.hash).toBeTruthy();
  });

  it('maps approval family to approvals table', () => {
    expect(getSyncFamily('approval')?.table).toBe('approvals');
    expect(getSyncFamily('approval')?.hash).toBeTruthy();
  });

  it('provides sync state keys for new families', () => {
    expect(getSyncStateKeyForFamily('flow')).toBe(`sync_since:${getSyncFamily('flow')?.hash}`);
    expect(getSyncStateKeyForFamily('approval')).toBe(`sync_since:${getSyncFamily('approval')?.hash}`);
  });
});

describe('flows table — CRUD', () => {
  const testFlow = {
    record_id: 'flow-1',
    owner_npub: 'npub_owner',
    title: 'Batch Outreach',
    description: 'Sales pipeline flow.',
    steps: [
      { step_number: 1, title: 'Research', instruction: 'Find targets.', approval_mode: 'manual', whitelist_approvers: null, artifacts_expected: [] },
    ],
    next_flow_id: null,
    scope_id: 'scope-sales',
    scope_l1_id: 'scope-l1',
    scope_l2_id: 'scope-sales',
    scope_l3_id: null,
    scope_l4_id: null,
    scope_l5_id: null,
    shares: [],
    group_ids: ['group-1'],
    sync_status: 'synced',
    record_state: 'active',
    version: 1,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T01:00:00Z',
  };

  it('upserts and retrieves a flow by ID', async () => {
    await upsertFlow(testFlow);
    const row = await getFlowById('flow-1');
    expect(row.record_id).toBe('flow-1');
    expect(row.title).toBe('Batch Outreach');
    expect(row.steps).toHaveLength(1);
  });

  it('retrieves flows by scope', async () => {
    await upsertFlow(testFlow);
    await upsertFlow({
      ...testFlow,
      record_id: 'flow-2',
      title: 'Other Flow',
      scope_id: 'scope-other',
    });

    const scopeFlows = await getFlowsByScope('scope-sales');
    expect(scopeFlows).toHaveLength(1);
    expect(scopeFlows[0].title).toBe('Batch Outreach');
  });

  it('filters out deleted flows from scope query', async () => {
    await upsertFlow({ ...testFlow, record_state: 'deleted' });
    const scopeFlows = await getFlowsByScope('scope-sales');
    expect(scopeFlows).toHaveLength(0);
  });

  it('updates a flow via upsert', async () => {
    await upsertFlow(testFlow);
    await upsertFlow({ ...testFlow, title: 'Updated Title', version: 2 });
    const row = await getFlowById('flow-1');
    expect(row.title).toBe('Updated Title');
    expect(row.version).toBe(2);
  });
});

describe('approvals table — CRUD', () => {
  const testApproval = {
    record_id: 'approval-1',
    owner_npub: 'npub_owner',
    title: 'Step 1 Review',
    flow_id: 'flow-1',
    flow_run_id: 'run-001',
    flow_step: 1,
    task_ids: ['task-1'],
    status: 'pending',
    approval_mode: 'manual',
    brief: 'Targets selected.',
    confidence_score: 0.87,
    approved_by: null,
    approved_at: null,
    decision_note: null,
    agent_review_by: null,
    agent_review_note: null,
    artifact_refs: [],
    revision_task_id: null,
    scope_id: 'scope-sales',
    scope_l1_id: 'scope-l1',
    scope_l2_id: 'scope-sales',
    scope_l3_id: null,
    scope_l4_id: null,
    scope_l5_id: null,
    shares: [],
    group_ids: ['group-1'],
    sync_status: 'synced',
    record_state: 'active',
    version: 1,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-01T01:00:00Z',
  };

  it('upserts and retrieves an approval by ID', async () => {
    await upsertApproval(testApproval);
    const row = await getApprovalById('approval-1');
    expect(row.record_id).toBe('approval-1');
    expect(row.title).toBe('Step 1 Review');
    expect(row.status).toBe('pending');
    expect(row.task_ids).toEqual(['task-1']);
  });

  it('retrieves approvals by scope', async () => {
    await upsertApproval(testApproval);
    await upsertApproval({
      ...testApproval,
      record_id: 'approval-2',
      scope_id: 'scope-other',
    });

    const scopeApprovals = await getApprovalsByScope('scope-sales');
    expect(scopeApprovals).toHaveLength(1);
    expect(scopeApprovals[0].record_id).toBe('approval-1');
  });

  it('retrieves approvals by status', async () => {
    await upsertApproval(testApproval);
    await upsertApproval({
      ...testApproval,
      record_id: 'approval-2',
      status: 'approved',
      approved_by: 'npub_reviewer',
      approved_at: '2026-04-02T00:00:00Z',
    });

    const pending = await getApprovalsByStatus('pending');
    expect(pending).toHaveLength(1);
    expect(pending[0].record_id).toBe('approval-1');

    const approved = await getApprovalsByStatus('approved');
    expect(approved).toHaveLength(1);
    expect(approved[0].record_id).toBe('approval-2');
  });

  it('filters out deleted approvals from scope and status queries', async () => {
    await upsertApproval({ ...testApproval, record_state: 'deleted' });
    expect(await getApprovalsByScope('scope-sales')).toHaveLength(0);
    expect(await getApprovalsByStatus('pending')).toHaveLength(0);
  });

  it('updates an approval via upsert', async () => {
    await upsertApproval(testApproval);
    await upsertApproval({
      ...testApproval,
      status: 'approved',
      approved_by: 'npub_reviewer',
      approved_at: '2026-04-02T00:00:00Z',
      version: 2,
    });
    const row = await getApprovalById('approval-1');
    expect(row.status).toBe('approved');
    expect(row.approved_by).toBe('npub_reviewer');
  });
});

describe('clearRuntimeFamilies includes new tables', () => {
  it('clears flows and approvals tables', async () => {
    await upsertFlow({
      record_id: 'flow-1',
      owner_npub: 'npub_owner',
      title: 'Test',
      record_state: 'active',
      updated_at: '2026-04-01T00:00:00Z',
    });
    await upsertApproval({
      record_id: 'approval-1',
      owner_npub: 'npub_owner',
      title: 'Test',
      status: 'pending',
      record_state: 'active',
      updated_at: '2026-04-01T00:00:00Z',
    });

    await clearRuntimeFamilies(['flow', 'approval']);

    expect(await getFlowById('flow-1')).toBeUndefined();
    expect(await getApprovalById('approval-1')).toBeUndefined();
  });

  it('clears sync state for new families', async () => {
    await setSyncState(getSyncStateKeyForFamily('flow'), '2026-04-01T00:00:00Z');
    await setSyncState(getSyncStateKeyForFamily('approval'), '2026-04-01T00:00:00Z');

    await clearSyncStateForFamilies(['flow', 'approval']);

    expect(await getSyncState(getSyncStateKeyForFamily('flow'))).toBeNull();
    expect(await getSyncState(getSyncStateKeyForFamily('approval'))).toBeNull();
  });
});

describe('clearRuntimeData includes new tables', () => {
  it('clears all tables including flows and approvals', async () => {
    await upsertFlow({
      record_id: 'flow-1',
      owner_npub: 'npub_owner',
      title: 'Test',
      record_state: 'active',
      updated_at: '2026-04-01T00:00:00Z',
    });
    await upsertApproval({
      record_id: 'approval-1',
      owner_npub: 'npub_owner',
      title: 'Test',
      status: 'pending',
      record_state: 'active',
      updated_at: '2026-04-01T00:00:00Z',
    });

    await clearRuntimeData();

    expect(await getFlowById('flow-1')).toBeUndefined();
    expect(await getApprovalById('approval-1')).toBeUndefined();
  });
});

describe('pending writes for new families', () => {
  it('detects pending writes for flow and approval families', async () => {
    await addPendingWrite({
      record_id: 'flow-1',
      record_family_hash: getSyncFamily('flow').hash,
      envelope: { record_id: 'flow-1' },
    });
    await addPendingWrite({
      record_id: 'approval-1',
      record_family_hash: getSyncFamily('approval').hash,
      envelope: { record_id: 'approval-1' },
    });
    await addPendingWrite({
      record_id: 'task-1',
      record_family_hash: getSyncFamily('task').hash,
      envelope: { record_id: 'task-1' },
    });

    const flowPending = await getPendingWritesByFamilies(['flow']);
    expect(flowPending).toHaveLength(1);
    expect(flowPending[0].record_id).toBe('flow-1');

    const approvalPending = await getPendingWritesByFamilies(['approval']);
    expect(approvalPending).toHaveLength(1);
    expect(approvalPending[0].record_id).toBe('approval-1');
  });
});

describe('task table — flow extension indexes', () => {
  it('stores and retrieves tasks with flow fields', async () => {
    await upsertTask({
      record_id: 'task-flow-1',
      owner_npub: 'npub_owner',
      title: 'Flow step task',
      state: 'new',
      predecessor_task_ids: ['task-prev-1'],
      flow_id: 'flow-1',
      flow_run_id: 'run-001',
      flow_step: 2,
      record_state: 'active',
      updated_at: '2026-04-01T00:00:00Z',
    });

    const row = await getTaskById('task-flow-1');
    expect(row.predecessor_task_ids).toEqual(['task-prev-1']);
    expect(row.flow_id).toBe('flow-1');
    expect(row.flow_run_id).toBe('run-001');
    expect(row.flow_step).toBe(2);
  });

  it('stores tasks without flow fields (backward-compatible)', async () => {
    await upsertTask({
      record_id: 'task-plain',
      owner_npub: 'npub_owner',
      title: 'Plain task',
      state: 'ready',
      record_state: 'active',
      updated_at: '2026-04-01T00:00:00Z',
    });

    const row = await getTaskById('task-plain');
    expect(row.record_id).toBe('task-plain');
    expect(row.flow_id).toBeUndefined();
  });
});
