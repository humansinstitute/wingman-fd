import { describe, it, expect, vi } from 'vitest';

import {
  buildFlowEditorForm,
  normalizeStepType,
  defaultStepForType,
  isJobDispatchStep,
  isApprovalStep,
  parseTagList,
  formatTagList,
} from '../src/flows-manager.js';

// ---------------------------------------------------------------------------
// Step type helpers
// ---------------------------------------------------------------------------

describe('normalizeStepType', () => {
  it('passes through explicit job_dispatch type', () => {
    const step = { step_number: 1, title: 'Deploy', type: 'job_dispatch', job_type: 'code' };
    expect(normalizeStepType(step).type).toBe('job_dispatch');
  });

  it('passes through explicit approval type', () => {
    const step = { step_number: 1, title: 'Review', type: 'approval', approver_mode: 'manual' };
    expect(normalizeStepType(step).type).toBe('approval');
  });

  it('maps legacy step with approval_mode to approval type', () => {
    const legacy = {
      step_number: 1,
      title: 'Old Step',
      instruction: 'Do stuff',
      approval_mode: 'manual',
      whitelist_approvers: ['npub1pete'],
      artifacts_expected: ['document'],
    };
    const normalized = normalizeStepType(legacy);
    expect(normalized.type).toBe('approval');
    expect(normalized.approver_mode).toBe('manual');
    expect(normalized.whitelist_approvers).toEqual(['npub1pete']);
    expect(normalized.artifacts_expected).toEqual(['document']);
  });

  it('maps legacy step with approval_mode=auto to job_dispatch', () => {
    const legacy = {
      step_number: 1,
      title: 'Auto Step',
      instruction: 'Run automatically',
      approval_mode: 'auto',
      artifacts_expected: ['document'],
    };
    const normalized = normalizeStepType(legacy);
    expect(normalized.type).toBe('job_dispatch');
    expect(normalized.goals).toBe('Run automatically');
  });

  it('defaults untyped step without approval_mode to job_dispatch', () => {
    const bare = { step_number: 1, title: 'Bare Step' };
    expect(normalizeStepType(bare).type).toBe('job_dispatch');
  });
});

describe('defaultStepForType', () => {
  it('creates a blank job_dispatch step', () => {
    const step = defaultStepForType('job_dispatch', 3);
    expect(step.step_number).toBe(3);
    expect(step.type).toBe('job_dispatch');
    expect(step.title).toBe('');
    expect(step.job_type).toBe('');
    expect(step.goals).toBe('');
    expect(step.manager_guidance).toBe('');
    expect(step.worker_guidance).toBe('');
    expect(step.directory_override).toBe('');
    expect(step.artifacts_expected).toEqual([]);
  });

  it('creates a blank approval step', () => {
    const step = defaultStepForType('approval', 2);
    expect(step.step_number).toBe(2);
    expect(step.type).toBe('approval');
    expect(step.title).toBe('');
    expect(step.description).toBe('');
    expect(step.brief_template).toBe('');
    expect(step.approver_mode).toBe('manual');
    expect(step.whitelist_approvers).toBeNull();
    expect(step.artifacts_expected).toEqual([]);
  });
});

describe('isJobDispatchStep / isApprovalStep', () => {
  it('identifies job_dispatch steps', () => {
    expect(isJobDispatchStep({ type: 'job_dispatch' })).toBe(true);
    expect(isJobDispatchStep({ type: 'approval' })).toBe(false);
  });

  it('identifies approval steps', () => {
    expect(isApprovalStep({ type: 'approval' })).toBe(true);
    expect(isApprovalStep({ type: 'job_dispatch' })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tag list helpers (for whitelist_approvers and artifacts_expected inputs)
// ---------------------------------------------------------------------------

describe('parseTagList', () => {
  it('splits comma-separated values and trims whitespace', () => {
    expect(parseTagList('npub1pete, group:mgmt , npub1bob'))
      .toEqual(['npub1pete', 'group:mgmt', 'npub1bob']);
  });

  it('filters out empty segments', () => {
    expect(parseTagList('a,, b, ,c')).toEqual(['a', 'b', 'c']);
  });

  it('returns empty array for empty/null input', () => {
    expect(parseTagList('')).toEqual([]);
    expect(parseTagList(null)).toEqual([]);
    expect(parseTagList(undefined)).toEqual([]);
  });

  it('handles single value with no commas', () => {
    expect(parseTagList('npub1pete')).toEqual(['npub1pete']);
  });
});

describe('formatTagList', () => {
  it('joins array into comma-separated string', () => {
    expect(formatTagList(['npub1pete', 'group:mgmt'])).toBe('npub1pete, group:mgmt');
  });

  it('returns empty string for null/empty', () => {
    expect(formatTagList(null)).toBe('');
    expect(formatTagList([])).toBe('');
  });
});

// ---------------------------------------------------------------------------
// buildFlowEditorForm with typed steps
// ---------------------------------------------------------------------------

describe('buildFlowEditorForm — typed steps', () => {
  it('deep-copies typed steps into form state', () => {
    const flow = {
      title: 'My Flow',
      description: 'Desc',
      steps: [
        { step_number: 1, title: 'Job', type: 'job_dispatch', job_type: 'research', goals: 'Find stuff' },
        { step_number: 2, title: 'Gate', type: 'approval', approver_mode: 'manual' },
      ],
      next_flow_id: null,
      scope_id: 'scope-1',
    };

    const form = buildFlowEditorForm(flow, null);
    expect(form.formSteps).toHaveLength(2);
    expect(form.formSteps[0].type).toBe('job_dispatch');
    expect(form.formSteps[1].type).toBe('approval');

    // Verify deep copy — mutating form should not mutate original
    form.formSteps[0].goals = 'Changed';
    expect(flow.steps[0].goals).toBe('Find stuff');
  });
});

// ---------------------------------------------------------------------------
// startFlowRun — mixin method
// ---------------------------------------------------------------------------

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

vi.mock('../src/translators/tasks.js', () => ({
  outboundTask: vi.fn(async (payload) => ({
    ...payload,
    record_family_hash: 'mock:task',
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

import { flowsManagerMixin } from '../src/flows-manager.js';

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

describe('flowsManagerMixin — startFlowRun', () => {
  it('creates a task linked to the first step of the flow', async () => {
    const store = createStore({
      flows: [
        {
          record_id: 'flow-1',
          owner_npub: 'npub_owner',
          title: 'Outreach Pipeline',
          steps: [
            { step_number: 1, title: 'Research', type: 'job_dispatch', job_type: 'research', goals: 'Find targets' },
            { step_number: 2, title: 'Review', type: 'approval', approver_mode: 'manual' },
          ],
          scope_id: 'scope-1',
          scope_l1_id: 'scope-1',
          scope_l2_id: null,
          scope_l3_id: null,
          scope_l4_id: null,
          scope_l5_id: null,
          group_ids: ['g1'],
        },
      ],
    });

    const result = await store.startFlowRun('flow-1');

    expect(result).toBeTruthy();
    expect(result.task_id).toBeTruthy();
    expect(result.flow_run_id).toBeTruthy();

    // Task should be in the store
    expect(store.tasks).toHaveLength(1);
    const task = store.tasks[0];
    expect(task.flow_id).toBe('flow-1');
    expect(task.flow_run_id).toBe(result.flow_run_id);
    expect(task.flow_step).toBe(1);
    expect(task.title).toBe('Research');
    expect(task.state).toBe('ready');
    // Inherits scope from the flow
    expect(task.scope_id).toBe('scope-1');
  });

  it('returns null when flow has no steps', async () => {
    const store = createStore({
      flows: [
        {
          record_id: 'flow-empty',
          owner_npub: 'npub_owner',
          title: 'Empty Flow',
          steps: [],
          scope_id: null,
          group_ids: [],
        },
      ],
    });

    const result = await store.startFlowRun('flow-empty');
    expect(result).toBeNull();
  });

  it('returns null for nonexistent flow', async () => {
    const store = createStore();
    const result = await store.startFlowRun('nonexistent');
    expect(result).toBeNull();
  });

  it('returns null when no session', async () => {
    const store = createStore({ session: null });
    store.flows = [{ record_id: 'flow-1', steps: [{ step_number: 1, title: 'X', type: 'job_dispatch' }] }];
    const result = await store.startFlowRun('flow-1');
    expect(result).toBeNull();
  });

  it('calls flushAndBackgroundSync after creating the task', async () => {
    const store = createStore({
      flows: [
        {
          record_id: 'flow-1',
          owner_npub: 'npub_owner',
          title: 'Test Flow',
          steps: [{ step_number: 1, title: 'Step 1', type: 'job_dispatch', job_type: 'code', goals: 'Do it' }],
          scope_id: null,
          group_ids: [],
        },
      ],
    });

    await store.startFlowRun('flow-1');
    expect(store.flushAndBackgroundSync).toHaveBeenCalled();
  });
});
