import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/translators/record-crypto.js', () => ({
  decryptRecordPayload: vi.fn(async (record) => JSON.parse(record.owner_payload.ciphertext)),
  encryptOwnerPayload: vi.fn(async (_ownerNpub, payload) => ({ ciphertext: JSON.stringify(payload) })),
  buildGroupPayloads: vi.fn(async (groupNpubs, payload) =>
    groupNpubs.map((group_npub) => ({ group_npub, ciphertext: JSON.stringify(payload), write: true }))),
}));

import {
  parseFlowReferenceFromText,
  resolveFlowDispatchAssignee,
  resolveFlowLinkage,
  parseReferencesFromDescription,
} from '../src/translators/tasks.js';

// ─── parseFlowReferenceFromText ──────────────────────────────

describe('parseFlowReferenceFromText', () => {
  it('extracts flow title from "Run Flow: X" in title', () => {
    const result = parseFlowReferenceFromText('Run Flow: Generate Proposal');
    expect(result).toEqual({ flowTitle: 'Generate Proposal' });
  });

  it('extracts flow title case-insensitively', () => {
    const result = parseFlowReferenceFromText('run flow: Outreach Pipeline');
    expect(result).toEqual({ flowTitle: 'Outreach Pipeline' });
  });

  it('returns null for plain text without flow pattern', () => {
    expect(parseFlowReferenceFromText('Fix the login bug')).toBeNull();
    expect(parseFlowReferenceFromText('')).toBeNull();
    expect(parseFlowReferenceFromText(null)).toBeNull();
    expect(parseFlowReferenceFromText(undefined)).toBeNull();
  });

  it('trims whitespace from extracted flow title', () => {
    const result = parseFlowReferenceFromText('Run Flow:   Generate Proposal  ');
    expect(result).toEqual({ flowTitle: 'Generate Proposal' });
  });

  it('handles flow title at start of multi-line description', () => {
    const result = parseFlowReferenceFromText('Run Flow: Sales Pipeline\nAdditional context here');
    expect(result).toEqual({ flowTitle: 'Sales Pipeline' });
  });

  it('returns null if colon is missing', () => {
    expect(parseFlowReferenceFromText('Run Flow Generate Proposal')).toBeNull();
  });
});

// ─── resolveFlowLinkage ──────────────────────────────────────

describe('resolveFlowLinkage', () => {
  it('resolves flow_id and adds reference when flow found by title', () => {
    const flows = [
      { record_id: 'flow-abc', title: 'Generate Proposal' },
      { record_id: 'flow-xyz', title: 'Sales Pipeline' },
    ];
    const result = resolveFlowLinkage({
      title: 'Run Flow: Generate Proposal',
      description: '',
      references: [],
      flows,
    });

    expect(result.flow_id).toBe('flow-abc');
    expect(result.references).toEqual(
      expect.arrayContaining([{ type: 'flow', id: 'flow-abc' }])
    );
  });

  it('resolves flow_id from existing mention-based reference', () => {
    const flows = [
      { record_id: 'flow-abc', title: 'Generate Proposal' },
    ];
    const result = resolveFlowLinkage({
      title: 'Some task',
      description: 'See @[Generate Proposal](mention:flow:flow-abc)',
      references: [{ type: 'flow', id: 'flow-abc' }],
      flows,
    });

    expect(result.flow_id).toBe('flow-abc');
  });

  it('returns null flow_id when no flow match found', () => {
    const flows = [
      { record_id: 'flow-abc', title: 'Generate Proposal' },
    ];
    const result = resolveFlowLinkage({
      title: 'Run Flow: Nonexistent Pipeline',
      description: '',
      references: [],
      flows,
    });

    expect(result.flow_id).toBeNull();
    expect(result.references).toEqual([]);
  });

  it('returns null flow_id for plain tasks with no flow indicators', () => {
    const flows = [{ record_id: 'flow-abc', title: 'Generate Proposal' }];
    const result = resolveFlowLinkage({
      title: 'Fix the login bug',
      description: 'Some description',
      references: [],
      flows,
    });

    expect(result.flow_id).toBeNull();
    expect(result.references).toEqual([]);
  });

  it('does not duplicate flow reference if already present', () => {
    const flows = [
      { record_id: 'flow-abc', title: 'Generate Proposal' },
    ];
    const result = resolveFlowLinkage({
      title: 'Run Flow: Generate Proposal',
      description: '',
      references: [{ type: 'flow', id: 'flow-abc' }],
      flows,
    });

    expect(result.flow_id).toBe('flow-abc');
    const flowRefs = result.references.filter(r => r.type === 'flow');
    expect(flowRefs).toHaveLength(1);
  });

  it('preserves non-flow references in output', () => {
    const flows = [
      { record_id: 'flow-abc', title: 'Generate Proposal' },
    ];
    const existing = [
      { type: 'task', id: 'task-123' },
      { type: 'doc', id: 'doc-456' },
    ];
    const result = resolveFlowLinkage({
      title: 'Run Flow: Generate Proposal',
      description: '',
      references: existing,
      flows,
    });

    expect(result.flow_id).toBe('flow-abc');
    expect(result.references).toEqual(expect.arrayContaining([
      { type: 'task', id: 'task-123' },
      { type: 'doc', id: 'doc-456' },
      { type: 'flow', id: 'flow-abc' },
    ]));
  });

  it('keeps title-resolved flow linkage as kickoff/reference-only until runtime dispatch', () => {
    const flows = [
      { record_id: 'flow-abc', title: 'Generate Proposal' },
    ];
    const result = resolveFlowLinkage({
      title: 'Run Flow: Generate Proposal',
      description: '',
      references: [],
      flows,
    });

    expect(result.flow_id).toBe('flow-abc');
    expect(result.flow_run_id).toBeNull();
    expect(result.flow_step).toBeNull();
  });

  it('does not generate flow_run_id for mention-only references', () => {
    const flows = [
      { record_id: 'flow-abc', title: 'Generate Proposal' },
    ];
    const result = resolveFlowLinkage({
      title: 'Review the proposal output',
      description: 'Related to @[Generate Proposal](mention:flow:flow-abc)',
      references: [{ type: 'flow', id: 'flow-abc' }],
      flows,
    });

    expect(result.flow_id).toBe('flow-abc');
    // mention-only = reference linkage, not a run initiation
    expect(result.flow_run_id).toBeNull();
    expect(result.flow_step).toBeNull();
  });

  it('handles empty flows array gracefully', () => {
    const result = resolveFlowLinkage({
      title: 'Run Flow: Generate Proposal',
      description: '',
      references: [],
      flows: [],
    });

    expect(result.flow_id).toBeNull();
    expect(result.references).toEqual([]);
  });
});

describe('resolveFlowDispatchAssignee', () => {
  it('returns the default agent for kickoff tasks', () => {
    expect(resolveFlowDispatchAssignee({
      flowId: 'flow-abc',
      flowRunId: null,
      defaultAgentNpub: 'npub_agent',
      botNpub: 'npub_bot',
    })).toBe('npub_agent');
  });

  it('falls back to the bot npub when no default agent is configured', () => {
    expect(resolveFlowDispatchAssignee({
      flowId: 'flow-abc',
      flowRunId: null,
      defaultAgentNpub: '',
      botNpub: 'npub_bot',
    })).toBe('npub_bot');
  });

  it('does not auto-assign tasks that already belong to a flow run', () => {
    expect(resolveFlowDispatchAssignee({
      flowId: 'flow-abc',
      flowRunId: 'run-123',
      defaultAgentNpub: 'npub_agent',
      botNpub: 'npub_bot',
    })).toBeNull();
  });

  it('does not auto-assign tasks without a resolved flow', () => {
    expect(resolveFlowDispatchAssignee({
      flowId: null,
      flowRunId: null,
      defaultAgentNpub: 'npub_agent',
      botNpub: 'npub_bot',
    })).toBeNull();
  });
});
