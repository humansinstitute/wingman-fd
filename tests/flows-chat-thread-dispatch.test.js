import { describe, expect, it, vi } from 'vitest';

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
  getTaskById: vi.fn(async () => null),
  getDocumentById: vi.fn(async () => null),
  getCommentsByTarget: vi.fn(async () => []),
  upsertComment: vi.fn(async () => {}),
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

vi.mock('../src/translators/comments.js', () => ({
  outboundComment: vi.fn(async (payload) => ({
    ...payload,
    record_family_hash: 'mock:comment',
    owner_payload: { ciphertext: '{}' },
    group_payloads: [],
  })),
}));

vi.mock('../src/translators/chat.js', () => ({
  recordFamilyHash: (family) => `mock:${family}`,
}));

import { flowsManagerMixin } from '../src/flows-manager.js';

function createStore(overrides = {}) {
  const store = {
    session: { npub: 'npub_viewer' },
    workspaceOwnerNpub: 'npub_owner',
    signingNpub: 'npub_viewer',
    defaultAgentNpub: 'npub_agent',
    botNpub: 'npub_bot',
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

function createFlow(overrides = {}) {
  return {
    record_id: 'flow-1',
    owner_npub: 'npub_owner',
    title: 'Chat Dispatch Flow',
    steps: [{ step_number: 1, title: 'Research', type: 'job_dispatch', instruction: 'Review the thread' }],
    scope_id: 'scope-flow',
    scope_l1_id: 'scope-flow',
    scope_l2_id: null,
    scope_l3_id: null,
    scope_l4_id: null,
    scope_l5_id: null,
    scope_policy_group_ids: ['policy-flow'],
    group_ids: ['group-flow'],
    board_group_id: 'group-flow',
    shares: [{ type: 'group', group_npub: 'group-flow', access: 'write' }],
    ...overrides,
  };
}

function createResolvedScopeAssignment(scopeId, suffix = 'manual') {
  return {
    scope_id: scopeId,
    scope_l1_id: scopeId,
    scope_l2_id: null,
    scope_l3_id: null,
    scope_l4_id: null,
    scope_l5_id: null,
    scope_policy_group_ids: [`policy-${suffix}`],
    group_ids: [`group-${suffix}`],
    shares: [{ type: 'group', group_npub: `group-${suffix}`, access: 'write' }],
    write_group_ref: `group-${suffix}`,
  };
}

describe('flowsManagerMixin — chat thread dispatch kickoff task', () => {
  it('creates exactly one kickoff task with the selected flow title and preview description', async () => {
    const store = createStore({
      flows: [createFlow()],
    });

    const preview = [
      '## Dispatch Request',
      '- dispatch_type: flow',
      '',
      '## Thread Transcript',
      '~~~text',
      'literal thread body',
      '~~~',
    ].join('\n');

    const result = await store.startChatThreadFlowDispatch({
      flowId: 'flow-1',
      kickoffDescription: preview,
      resolvedScopeAssignment: createResolvedScopeAssignment('scope-manual'),
    });

    expect(result).toEqual({
      task_id: expect.any(String),
      flow_run_id: null,
    });
    expect(store.tasks).toHaveLength(1);
    expect(store.flushAndBackgroundSync).toHaveBeenCalledTimes(1);
    expect(store.tasks[0]).toMatchObject({
      title: 'Chat Dispatch Flow',
      description: preview,
      state: 'new',
      flow_id: 'flow-1',
      flow_run_id: null,
      flow_step: null,
      assigned_to_npub: 'npub_agent',
    });
    expect(store.tasks[0].tags).toContain('flow_kickoff');
    expect(store.tasks[0].references).toEqual([{ type: 'flow', id: 'flow-1' }]);
  });

  it('writes the manual-scope assignment verbatim when provided', async () => {
    const store = createStore({
      flows: [createFlow()],
    });

    await store.startChatThreadFlowDispatch({
      flowId: 'flow-1',
      kickoffDescription: 'manual scope preview',
      resolvedScopeAssignment: createResolvedScopeAssignment('scope-manual', 'manual'),
    });

    expect(store.tasks[0]).toMatchObject({
      scope_id: 'scope-manual',
      scope_policy_group_ids: ['policy-manual'],
      group_ids: ['group-manual'],
      shares: [{ type: 'group', group_npub: 'group-manual', access: 'write' }],
      board_group_id: 'group-manual',
    });
  });

  it('writes the channel-scope assignment verbatim when provided', async () => {
    const store = createStore({
      flows: [createFlow()],
    });

    await store.startChatThreadFlowDispatch({
      flowId: 'flow-1',
      kickoffDescription: 'channel scope preview',
      resolvedScopeAssignment: createResolvedScopeAssignment('scope-channel', 'channel'),
    });

    expect(store.tasks[0]).toMatchObject({
      scope_id: 'scope-channel',
      scope_policy_group_ids: ['policy-channel'],
      group_ids: ['group-channel'],
      shares: [{ type: 'group', group_npub: 'group-channel', access: 'write' }],
      board_group_id: 'group-channel',
    });
  });

  it('reuses the selected flow scope semantics on the flow-scope path', async () => {
    const store = createStore({
      flows: [
        createFlow({
          shares: [{ type: 'group', group_npub: 'group-flow', access: 'write' }],
        }),
      ],
    });

    await store.startChatThreadFlowDispatch({
      flowId: 'flow-1',
      kickoffDescription: 'flow scope preview',
      resolvedScopeAssignment: null,
    });

    expect(store.tasks[0]).toMatchObject({
      scope_id: 'scope-flow',
      scope_policy_group_ids: ['policy-flow'],
      group_ids: ['group-flow'],
      shares: [{ type: 'group', group_npub: 'group-flow', access: 'write' }],
      board_group_id: 'group-flow',
    });
  });

  it('does not mix stale flow groups into the unscoped path when resolved scope is none', async () => {
    const store = createStore({
      flows: [createFlow()],
    });

    await store.startChatThreadFlowDispatch({
      flowId: 'flow-1',
      kickoffDescription: 'unscoped preview',
      resolvedScopeId: null,
      scopeSource: 'none',
      resolvedScopeAssignment: null,
    });

    expect(store.tasks[0].scope_id).toBeNull();
    expect(store.tasks[0].scope_policy_group_ids).toBeNull();
    expect(store.tasks[0].group_ids).not.toContain('group-flow');
  });
});
