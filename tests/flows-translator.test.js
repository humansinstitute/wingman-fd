import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/translators/record-crypto.js', () => ({
  decryptRecordPayload: vi.fn(async (record) => JSON.parse(record.owner_payload.ciphertext)),
  encryptOwnerPayload: vi.fn(async (_ownerNpub, payload) => ({ ciphertext: JSON.stringify(payload) })),
  buildGroupPayloads: vi.fn(async (groupNpubs, payload) =>
    groupNpubs.map((group_npub) => ({ group_npub, ciphertext: JSON.stringify(payload), write: true }))),
}));

import { inboundFlow, outboundFlow, recordFamilyHash } from '../src/translators/flows.js';
import { APP_NPUB } from '../src/app-identity.js';

describe('flow translator — recordFamilyHash', () => {
  it('returns APP_NPUB:flow', () => {
    expect(recordFamilyHash('flow')).toBe(`${APP_NPUB}:flow`);
  });
});

describe('flow translator — inbound', () => {
  it('materializes a flow record into a local row', async () => {
    const steps = [
      {
        step_number: 1,
        title: 'Target Selection',
        instruction: 'Find 21 SME websites.',
        approval_mode: 'manual',
        whitelist_approvers: ['npub1pete'],
        artifacts_expected: ['document'],
      },
      {
        step_number: 2,
        title: 'Generate Proposals',
        instruction: 'For each approved target, run proposal flow.',
        approval_mode: 'agent',
        whitelist_approvers: ['npub1chiefofstaff'],
        artifacts_expected: ['document'],
      },
    ];

    const record = {
      record_id: 'flow-1',
      owner_npub: 'npub_owner',
      version: 2,
      created_at: '2026-04-01T00:00:00Z',
      updated_at: '2026-04-01T01:00:00Z',
      owner_payload: {
        ciphertext: JSON.stringify({
          app_namespace: APP_NPUB,
          collection_space: 'flow',
          schema_version: 1,
          record_id: 'flow-1',
          data: {
            title: 'Batch Outreach',
            description: 'End-to-end website redevelopment sales pipeline.',
            steps,
            next_flow_id: 'flow-2',
            scope_id: 'scope-l2-sales',
            scope_l1_id: 'scope-l1',
            scope_l2_id: 'scope-l2-sales',
            scope_l3_id: null,
            scope_l4_id: null,
            scope_l5_id: null,
            shares: [],
            record_state: 'active',
          },
        }),
      },
      group_payloads: [
        { group_npub: 'gpub_abc', ciphertext: '{}', write: true },
      ],
    };

    const row = await inboundFlow(record);

    expect(row.record_id).toBe('flow-1');
    expect(row.owner_npub).toBe('npub_owner');
    expect(row.title).toBe('Batch Outreach');
    expect(row.description).toBe('End-to-end website redevelopment sales pipeline.');
    expect(row.steps).toEqual(steps);
    expect(row.next_flow_id).toBe('flow-2');
    expect(row.scope_id).toBe('scope-l2-sales');
    expect(row.scope_l1_id).toBe('scope-l1');
    expect(row.scope_l2_id).toBe('scope-l2-sales');
    expect(row.scope_l3_id).toBeNull();
    expect(row.group_ids).toEqual(['gpub_abc']);
    expect(row.sync_status).toBe('synced');
    expect(row.record_state).toBe('active');
    expect(row.version).toBe(2);
  });

  it('defaults missing fields', async () => {
    const record = {
      record_id: 'flow-empty',
      owner_npub: 'npub_owner',
      owner_payload: { ciphertext: JSON.stringify({ data: {} }) },
      group_payloads: [],
    };

    const row = await inboundFlow(record);

    expect(row.title).toBe('');
    expect(row.description).toBe('');
    expect(row.steps).toEqual([]);
    expect(row.next_flow_id).toBeNull();
    expect(row.scope_id).toBeNull();
    expect(row.shares).toEqual([]);
    expect(row.record_state).toBe('active');
  });

  it('normalizes group refs from epoch metadata', async () => {
    const record = {
      record_id: 'flow-group-norm',
      owner_npub: 'npub_owner',
      version: 1,
      updated_at: '2026-04-02T00:00:00Z',
      owner_payload: {
        ciphertext: JSON.stringify({
          data: {
            title: 'Group flow',
            shares: [
              { type: 'group', group_npub: 'npub_old_epoch', access: 'write' },
            ],
          },
        }),
      },
      group_payloads: [
        {
          group_id: 'group-uuid-1',
          group_epoch: 1,
          group_npub: 'npub_old_epoch',
          ciphertext: '{}',
          write: true,
        },
      ],
    };

    const row = await inboundFlow(record);

    expect(row.group_ids).toEqual(['group-uuid-1']);
    expect(row.shares).toEqual([
      expect.objectContaining({ group_id: 'group-uuid-1', group_npub: 'npub_old_epoch' }),
    ]);
  });
});

describe('flow translator — outbound', () => {
  it('builds a valid envelope', async () => {
    const steps = [
      {
        step_number: 1,
        title: 'Research',
        instruction: 'Deep scan of website.',
        approval_mode: 'auto',
        whitelist_approvers: null,
        artifacts_expected: [],
      },
    ];

    const envelope = await outboundFlow({
      record_id: 'flow-1',
      owner_npub: 'npub_owner',
      title: 'Generate Proposal',
      description: 'Per-target proposal flow.',
      steps,
      next_flow_id: null,
      scope_id: 'scope-l3',
      scope_l1_id: 'scope-l1',
      scope_l2_id: 'scope-l2',
      scope_l3_id: 'scope-l3',
      group_ids: ['gpub_abc'],
      signature_npub: 'npub_owner',
    });

    expect(envelope.record_id).toBe('flow-1');
    expect(envelope.owner_npub).toBe('npub_owner');
    expect(envelope.record_family_hash).toBe(`${APP_NPUB}:flow`);
    expect(envelope.version).toBe(1);
    expect(envelope.group_payloads).toHaveLength(1);
    expect(envelope.group_payloads[0].group_npub).toBe('gpub_abc');

    const payload = JSON.parse(envelope.owner_payload.ciphertext);
    expect(payload.app_namespace).toBe(APP_NPUB);
    expect(payload.collection_space).toBe('flow');
    expect(payload.schema_version).toBe(1);
    expect(payload.data.title).toBe('Generate Proposal');
    expect(payload.data.steps).toEqual(steps);
    expect(payload.data.next_flow_id).toBeNull();
  });

  it('includes soft-delete state', async () => {
    const envelope = await outboundFlow({
      record_id: 'flow-1',
      owner_npub: 'npub_owner',
      title: 'Deleted flow',
      record_state: 'deleted',
      version: 2,
      previous_version: 1,
    });

    const payload = JSON.parse(envelope.owner_payload.ciphertext);
    expect(payload.data.record_state).toBe('deleted');
    expect(envelope.version).toBe(2);
    expect(envelope.previous_version).toBe(1);
  });
});

describe('flow translator — round-trip', () => {
  it('outbound → inbound preserves all fields', async () => {
    const steps = [
      {
        step_number: 1,
        title: 'Step 1',
        instruction: 'Do the thing. Reference @doc:spec-1',
        approval_mode: 'manual',
        whitelist_approvers: ['npub1pete', 'group:management'],
        artifacts_expected: ['document', 'task'],
      },
      {
        step_number: 2,
        title: 'Step 2',
        instruction: 'Follow up.',
        approval_mode: 'auto',
        whitelist_approvers: null,
        artifacts_expected: [],
      },
    ];

    const envelope = await outboundFlow({
      record_id: 'flow-rt',
      owner_npub: 'npub_owner',
      title: 'Round-trip Flow',
      description: 'Testing round-trip.',
      steps,
      next_flow_id: 'flow-next',
      scope_id: 'scope-1',
      scope_l1_id: 'scope-1',
      scope_l2_id: null,
      scope_l3_id: null,
      scope_l4_id: null,
      scope_l5_id: null,
      shares: [],
      group_ids: ['gpub_abc'],
      signature_npub: 'npub_owner',
    });

    const syntheticRecord = {
      record_id: envelope.record_id,
      owner_npub: envelope.owner_npub,
      version: envelope.version,
      created_at: '2026-04-01T00:00:00Z',
      updated_at: '2026-04-01T01:00:00Z',
      owner_payload: envelope.owner_payload,
      group_payloads: envelope.group_payloads,
    };

    const row = await inboundFlow(syntheticRecord);

    expect(row.record_id).toBe('flow-rt');
    expect(row.title).toBe('Round-trip Flow');
    expect(row.description).toBe('Testing round-trip.');
    expect(row.steps).toEqual(steps);
    expect(row.next_flow_id).toBe('flow-next');
    expect(row.scope_id).toBe('scope-1');
    expect(row.record_state).toBe('active');
  });
});

// ---------------------------------------------------------------------------
// Typed step round-trips
// ---------------------------------------------------------------------------

describe('flow translator — typed steps round-trip', () => {
  it('round-trips job_dispatch steps', async () => {
    const steps = [
      {
        step_number: 1,
        title: 'Research Targets',
        type: 'job_dispatch',
        job_type: 'research',
        goals: 'Find 21 SME websites in target vertical',
        manager_guidance: 'Prioritize sites with clear contact info',
        worker_guidance: 'Use SerpAPI for search, save results as CSV',
        directory_override: '/tmp/research',
        artifacts_expected: ['document', 'csv'],
      },
    ];

    const envelope = await outboundFlow({
      record_id: 'flow-typed-1',
      owner_npub: 'npub_owner',
      title: 'Typed Flow',
      steps,
      group_ids: ['gpub_abc'],
    });

    const row = await inboundFlow({
      record_id: envelope.record_id,
      owner_npub: envelope.owner_npub,
      version: envelope.version,
      created_at: '2026-04-04T00:00:00Z',
      updated_at: '2026-04-04T00:00:00Z',
      owner_payload: envelope.owner_payload,
      group_payloads: envelope.group_payloads,
    });

    expect(row.steps).toHaveLength(1);
    const s = row.steps[0];
    expect(s.type).toBe('job_dispatch');
    expect(s.job_type).toBe('research');
    expect(s.goals).toBe('Find 21 SME websites in target vertical');
    expect(s.manager_guidance).toBe('Prioritize sites with clear contact info');
    expect(s.worker_guidance).toBe('Use SerpAPI for search, save results as CSV');
    expect(s.directory_override).toBe('/tmp/research');
    expect(s.artifacts_expected).toEqual(['document', 'csv']);
  });

  it('round-trips approval steps', async () => {
    const steps = [
      {
        step_number: 1,
        title: 'Manager Sign-off',
        type: 'approval',
        description: 'Review the research output for completeness',
        brief_template: 'Research found {{count}} targets. See attached CSV.',
        approver_mode: 'manual',
        whitelist_approvers: ['npub1pete', 'group:management'],
        artifacts_expected: ['document'],
      },
    ];

    const envelope = await outboundFlow({
      record_id: 'flow-typed-2',
      owner_npub: 'npub_owner',
      title: 'Approval Flow',
      steps,
      group_ids: ['gpub_abc'],
    });

    const row = await inboundFlow({
      record_id: envelope.record_id,
      owner_npub: envelope.owner_npub,
      version: envelope.version,
      created_at: '2026-04-04T00:00:00Z',
      updated_at: '2026-04-04T00:00:00Z',
      owner_payload: envelope.owner_payload,
      group_payloads: envelope.group_payloads,
    });

    expect(row.steps).toHaveLength(1);
    const s = row.steps[0];
    expect(s.type).toBe('approval');
    expect(s.description).toBe('Review the research output for completeness');
    expect(s.brief_template).toBe('Research found {{count}} targets. See attached CSV.');
    expect(s.approver_mode).toBe('manual');
    expect(s.whitelist_approvers).toEqual(['npub1pete', 'group:management']);
    expect(s.artifacts_expected).toEqual(['document']);
  });

  it('round-trips mixed step types', async () => {
    const steps = [
      {
        step_number: 1,
        title: 'Research',
        type: 'job_dispatch',
        job_type: 'research',
        goals: 'Find targets',
        manager_guidance: '',
        worker_guidance: '',
        directory_override: '',
        artifacts_expected: ['csv'],
      },
      {
        step_number: 2,
        title: 'Review',
        type: 'approval',
        description: 'Approve target list',
        brief_template: '',
        approver_mode: 'manual',
        whitelist_approvers: null,
        artifacts_expected: [],
      },
      {
        step_number: 3,
        title: 'Execute',
        type: 'job_dispatch',
        job_type: 'outreach',
        goals: 'Send outreach emails',
        manager_guidance: 'Keep it professional',
        worker_guidance: 'Use template A',
        directory_override: '',
        artifacts_expected: ['email'],
      },
    ];

    const envelope = await outboundFlow({
      record_id: 'flow-mixed',
      owner_npub: 'npub_owner',
      title: 'Mixed Flow',
      steps,
      group_ids: [],
    });

    const row = await inboundFlow({
      record_id: envelope.record_id,
      owner_npub: envelope.owner_npub,
      version: envelope.version,
      created_at: '2026-04-04T00:00:00Z',
      updated_at: '2026-04-04T00:00:00Z',
      owner_payload: envelope.owner_payload,
      group_payloads: envelope.group_payloads,
    });

    expect(row.steps).toHaveLength(3);
    expect(row.steps[0].type).toBe('job_dispatch');
    expect(row.steps[1].type).toBe('approval');
    expect(row.steps[2].type).toBe('job_dispatch');
    expect(row.steps[2].job_type).toBe('outreach');
  });
});
