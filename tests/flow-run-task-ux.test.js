import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/translators/record-crypto.js', () => ({
  decryptRecordPayload: vi.fn(async (record) => JSON.parse(record.owner_payload.ciphertext)),
  encryptOwnerPayload: vi.fn(async (_ownerNpub, payload) => ({ ciphertext: JSON.stringify(payload) })),
  buildGroupPayloads: vi.fn(async (groupNpubs, payload) =>
    groupNpubs.map((group_npub) => ({ group_npub, ciphertext: JSON.stringify(payload), write: true }))),
}));

import {
  getTaskFlowInfo,
  buildAttachFlowPatch,
  buildDetachFlowPatch,
  buildFirstStepDescription,
} from '../src/task-flow-helpers.js';

// ─── getTaskFlowInfo ─────────────────────────────────────────

describe('getTaskFlowInfo', () => {
  const flows = [
    { record_id: 'flow-abc', title: 'Proposal Pipeline', record_state: 'active' },
    { record_id: 'flow-xyz', title: 'Onboarding Flow', record_state: 'active' },
  ];

  it('returns null for a task with no flow_id', () => {
    const task = { record_id: 't1', flow_id: null, flow_run_id: null, flow_step: null };
    expect(getTaskFlowInfo(task, flows)).toBeNull();
  });

  it('returns reference-only info when flow_id is set but flow_run_id is null', () => {
    const task = { record_id: 't2', flow_id: 'flow-abc', flow_run_id: null, flow_step: null };
    const info = getTaskFlowInfo(task, flows);
    expect(info).not.toBeNull();
    expect(info.flowId).toBe('flow-abc');
    expect(info.flowTitle).toBe('Proposal Pipeline');
    expect(info.isActiveRun).toBe(false);
    expect(info.flowStep).toBeNull();
  });

  it('returns active-run info when both flow_id and flow_run_id are set', () => {
    const task = {
      record_id: 't3',
      flow_id: 'flow-abc',
      flow_run_id: 'run-001',
      flow_step: 2,
    };
    const info = getTaskFlowInfo(task, flows);
    expect(info).not.toBeNull();
    expect(info.flowId).toBe('flow-abc');
    expect(info.flowTitle).toBe('Proposal Pipeline');
    expect(info.isActiveRun).toBe(true);
    expect(info.flowRunId).toBe('run-001');
    expect(info.flowStep).toBe(2);
  });

  it('handles missing flow gracefully (deleted/not found)', () => {
    const task = { record_id: 't4', flow_id: 'flow-gone', flow_run_id: null, flow_step: null };
    const info = getTaskFlowInfo(task, flows);
    expect(info).not.toBeNull();
    expect(info.flowId).toBe('flow-gone');
    expect(info.flowTitle).toBeNull();
    expect(info.isActiveRun).toBe(false);
  });

  it('returns null for undefined task', () => {
    expect(getTaskFlowInfo(null, flows)).toBeNull();
    expect(getTaskFlowInfo(undefined, flows)).toBeNull();
  });
});

// ─── buildAttachFlowPatch ────────────────────────────────────

describe('buildAttachFlowPatch', () => {
  it('builds a patch with flow_id and reference, no run context', () => {
    const patch = buildAttachFlowPatch('flow-abc', []);
    expect(patch.flow_id).toBe('flow-abc');
    expect(patch.flow_run_id).toBeNull();
    expect(patch.flow_step).toBeNull();
    expect(patch.references).toEqual([{ type: 'flow', id: 'flow-abc' }]);
  });

  it('preserves existing non-flow references', () => {
    const existing = [
      { type: 'task', id: 'task-1' },
      { type: 'doc', id: 'doc-2' },
    ];
    const patch = buildAttachFlowPatch('flow-abc', existing);
    expect(patch.references).toEqual([
      { type: 'task', id: 'task-1' },
      { type: 'doc', id: 'doc-2' },
      { type: 'flow', id: 'flow-abc' },
    ]);
  });

  it('does not duplicate flow reference if already present', () => {
    const existing = [{ type: 'flow', id: 'flow-abc' }];
    const patch = buildAttachFlowPatch('flow-abc', existing);
    const flowRefs = patch.references.filter(r => r.type === 'flow');
    expect(flowRefs).toHaveLength(1);
  });

  it('replaces existing flow reference when attaching a different flow', () => {
    const existing = [
      { type: 'flow', id: 'flow-old' },
      { type: 'task', id: 'task-1' },
    ];
    const patch = buildAttachFlowPatch('flow-new', existing);
    expect(patch.flow_id).toBe('flow-new');
    const flowRefs = patch.references.filter(r => r.type === 'flow');
    expect(flowRefs).toHaveLength(1);
    expect(flowRefs[0].id).toBe('flow-new');
    // Non-flow references preserved
    expect(patch.references.find(r => r.type === 'task')).toBeTruthy();
  });
});

// ─── buildDetachFlowPatch ────────────────────────────────────

describe('buildDetachFlowPatch', () => {
  it('clears flow fields and removes flow references', () => {
    const existing = [
      { type: 'flow', id: 'flow-abc' },
      { type: 'task', id: 'task-1' },
    ];
    const patch = buildDetachFlowPatch(existing);
    expect(patch.flow_id).toBeNull();
    expect(patch.flow_run_id).toBeNull();
    expect(patch.flow_step).toBeNull();
    expect(patch.references).toEqual([{ type: 'task', id: 'task-1' }]);
  });

  it('handles empty references', () => {
    const patch = buildDetachFlowPatch([]);
    expect(patch.flow_id).toBeNull();
    expect(patch.references).toEqual([]);
  });

  it('handles null references', () => {
    const patch = buildDetachFlowPatch(null);
    expect(patch.flow_id).toBeNull();
    expect(patch.references).toEqual([]);
  });
});

// ─── startFlowRun with context ───────────────────────────────

describe('startFlowRun with launch context', () => {
  it('returns step description when no context provided', () => {
    const result = buildFirstStepDescription('Do the thing', '');
    expect(result).toBe('Do the thing');
  });

  it('returns step description when context is null', () => {
    const result = buildFirstStepDescription('Do the thing', null);
    expect(result).toBe('Do the thing');
  });

  it('appends context to step description', () => {
    const result = buildFirstStepDescription('Do the thing', 'Use client X data');
    expect(result).toContain('Do the thing');
    expect(result).toContain('Use client X data');
  });

  it('uses context alone when step has no description', () => {
    const result = buildFirstStepDescription('', 'Use client X data');
    expect(result).toBe('Use client X data');
  });

  it('uses context alone when step description is null', () => {
    const result = buildFirstStepDescription(null, 'Use client X data');
    expect(result).toBe('Use client X data');
  });

  it('trims whitespace from context', () => {
    const result = buildFirstStepDescription('Step desc', '  context  ');
    expect(result).toContain('context');
    expect(result).not.toMatch(/^\s/);
  });
});
