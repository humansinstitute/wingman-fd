import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/translators/record-crypto.js', () => ({
  decryptRecordPayload: vi.fn(async (record) => JSON.parse(record.owner_payload.ciphertext)),
  encryptOwnerPayload: vi.fn(async (_ownerNpub, payload) => ({ ciphertext: JSON.stringify(payload) })),
  buildGroupPayloads: vi.fn(async (groupNpubs, payload) =>
    groupNpubs.map((group_npub) => ({ group_npub, ciphertext: JSON.stringify(payload), write: true }))),
}));

import { inboundApproval, outboundApproval, recordFamilyHash } from '../src/translators/approvals.js';
import { APP_NPUB } from '../src/app-identity.js';

describe('approval translator — recordFamilyHash', () => {
  it('returns APP_NPUB:approval', () => {
    expect(recordFamilyHash('approval')).toBe(`${APP_NPUB}:approval`);
  });
});

describe('approval translator — inbound', () => {
  it('materializes an approval record into a local row', async () => {
    const artifactRefs = [
      { record_id: 'doc-1', record_family_hash: `${APP_NPUB}:document` },
      { record_id: 'task-1', record_family_hash: `${APP_NPUB}:task` },
    ];

    const record = {
      record_id: 'approval-1',
      owner_npub: 'npub_owner',
      version: 1,
      created_at: '2026-04-01T00:00:00Z',
      updated_at: '2026-04-01T01:00:00Z',
      owner_payload: {
        ciphertext: JSON.stringify({
          app_namespace: APP_NPUB,
          collection_space: 'approval',
          schema_version: 1,
          record_id: 'approval-1',
          data: {
            title: 'Step 1 Review: 21 SME targets selected',
            flow_id: 'flow-1',
            flow_run_id: 'run-001',
            flow_step: 1,
            task_ids: ['task-1', 'task-2'],
            status: 'pending',
            approval_mode: 'manual',
            brief: '21 SME targets selected across 3 industries.',
            confidence_score: 0.87,
            approved_by: null,
            approved_at: null,
            decision_note: null,
            agent_review_by: null,
            agent_review_note: null,
            artifact_refs: artifactRefs,
            revision_task_id: null,
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

    const row = await inboundApproval(record);

    expect(row.record_id).toBe('approval-1');
    expect(row.owner_npub).toBe('npub_owner');
    expect(row.title).toBe('Step 1 Review: 21 SME targets selected');
    expect(row.flow_id).toBe('flow-1');
    expect(row.flow_run_id).toBe('run-001');
    expect(row.flow_step).toBe(1);
    expect(row.task_ids).toEqual(['task-1', 'task-2']);
    expect(row.status).toBe('pending');
    expect(row.approval_mode).toBe('manual');
    expect(row.brief).toBe('21 SME targets selected across 3 industries.');
    expect(row.confidence_score).toBe(0.87);
    expect(row.approved_by).toBeNull();
    expect(row.approved_at).toBeNull();
    expect(row.decision_note).toBeNull();
    expect(row.agent_review_by).toBeNull();
    expect(row.agent_review_note).toBeNull();
    expect(row.artifact_refs).toEqual(artifactRefs);
    expect(row.revision_task_id).toBeNull();
    expect(row.scope_id).toBe('scope-l2-sales');
    expect(row.group_ids).toEqual(['gpub_abc']);
    expect(row.sync_status).toBe('synced');
    expect(row.record_state).toBe('active');
    expect(row.version).toBe(1);
  });

  it('defaults missing fields', async () => {
    const record = {
      record_id: 'approval-empty',
      owner_npub: 'npub_owner',
      owner_payload: { ciphertext: JSON.stringify({ data: {} }) },
      group_payloads: [],
    };

    const row = await inboundApproval(record);

    expect(row.title).toBe('');
    expect(row.flow_id).toBeNull();
    expect(row.flow_run_id).toBeNull();
    expect(row.flow_step).toBeNull();
    expect(row.task_ids).toEqual([]);
    expect(row.status).toBe('pending');
    expect(row.approval_mode).toBe('manual');
    expect(row.brief).toBe('');
    expect(row.confidence_score).toBeNull();
    expect(row.artifact_refs).toEqual([]);
    expect(row.revision_task_id).toBeNull();
    expect(row.record_state).toBe('active');
  });

  it('handles approved approval with decision fields', async () => {
    const record = {
      record_id: 'approval-decided',
      owner_npub: 'npub_owner',
      version: 2,
      updated_at: '2026-04-02T00:00:00Z',
      owner_payload: {
        ciphertext: JSON.stringify({
          data: {
            title: 'Approved step',
            status: 'approved',
            approved_by: 'npub_reviewer',
            approved_at: '2026-04-02T00:00:00Z',
            decision_note: 'Looks good. Proceeding.',
            agent_review_by: 'npub_chiefofstaff',
            agent_review_note: '17/19 passed quality check.',
          },
        }),
      },
      group_payloads: [],
    };

    const row = await inboundApproval(record);

    expect(row.status).toBe('approved');
    expect(row.approved_by).toBe('npub_reviewer');
    expect(row.approved_at).toBe('2026-04-02T00:00:00Z');
    expect(row.decision_note).toBe('Looks good. Proceeding.');
    expect(row.agent_review_by).toBe('npub_chiefofstaff');
    expect(row.agent_review_note).toBe('17/19 passed quality check.');
  });

  it('handles needs_revision status with revision_task_id', async () => {
    const record = {
      record_id: 'approval-revision',
      owner_npub: 'npub_owner',
      version: 3,
      updated_at: '2026-04-03T00:00:00Z',
      owner_payload: {
        ciphertext: JSON.stringify({
          data: {
            title: 'Needs work',
            status: 'needs_revision',
            revision_task_id: 'task-rework-1',
          },
        }),
      },
      group_payloads: [],
    };

    const row = await inboundApproval(record);

    expect(row.status).toBe('needs_revision');
    expect(row.revision_task_id).toBe('task-rework-1');
  });
});

describe('approval translator — outbound', () => {
  it('builds a valid envelope', async () => {
    const envelope = await outboundApproval({
      record_id: 'approval-1',
      owner_npub: 'npub_owner',
      title: 'Step 1 Review',
      flow_id: 'flow-1',
      flow_run_id: 'run-001',
      flow_step: 1,
      task_ids: ['task-1'],
      status: 'pending',
      approval_mode: 'manual',
      brief: 'Agent summary here.',
      confidence_score: 0.87,
      artifact_refs: [{ record_id: 'doc-1', record_family_hash: `${APP_NPUB}:document` }],
      scope_id: 'scope-1',
      scope_l1_id: 'scope-1',
      group_ids: ['gpub_abc'],
      signature_npub: 'npub_owner',
    });

    expect(envelope.record_id).toBe('approval-1');
    expect(envelope.record_family_hash).toBe(`${APP_NPUB}:approval`);
    expect(envelope.group_payloads).toHaveLength(1);

    const payload = JSON.parse(envelope.owner_payload.ciphertext);
    expect(payload.app_namespace).toBe(APP_NPUB);
    expect(payload.collection_space).toBe('approval');
    expect(payload.schema_version).toBe(1);
    expect(payload.data.title).toBe('Step 1 Review');
    expect(payload.data.flow_id).toBe('flow-1');
    expect(payload.data.task_ids).toEqual(['task-1']);
    expect(payload.data.status).toBe('pending');
    expect(payload.data.brief).toBe('Agent summary here.');
    expect(payload.data.confidence_score).toBe(0.87);
    expect(payload.data.artifact_refs).toHaveLength(1);
  });

  it('includes soft-delete state', async () => {
    const envelope = await outboundApproval({
      record_id: 'approval-1',
      owner_npub: 'npub_owner',
      title: 'Deleted approval',
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

describe('approval translator — round-trip', () => {
  it('outbound → inbound preserves all fields', async () => {
    const artifactRefs = [
      { record_id: 'doc-1', record_family_hash: `${APP_NPUB}:document` },
    ];

    const envelope = await outboundApproval({
      record_id: 'approval-rt',
      owner_npub: 'npub_owner',
      title: 'Round-trip Approval',
      flow_id: 'flow-1',
      flow_run_id: 'run-001',
      flow_step: 2,
      task_ids: ['task-1', 'task-2'],
      status: 'pending',
      approval_mode: 'agent',
      brief: 'Full brief text.',
      confidence_score: 0.92,
      agent_review_by: 'npub_chiefofstaff',
      agent_review_note: 'Reviewed and recommended.',
      artifact_refs: artifactRefs,
      scope_id: 'scope-1',
      scope_l1_id: 'scope-1',
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

    const row = await inboundApproval(syntheticRecord);

    expect(row.record_id).toBe('approval-rt');
    expect(row.title).toBe('Round-trip Approval');
    expect(row.flow_id).toBe('flow-1');
    expect(row.flow_run_id).toBe('run-001');
    expect(row.flow_step).toBe(2);
    expect(row.task_ids).toEqual(['task-1', 'task-2']);
    expect(row.status).toBe('pending');
    expect(row.approval_mode).toBe('agent');
    expect(row.brief).toBe('Full brief text.');
    expect(row.confidence_score).toBe(0.92);
    expect(row.agent_review_by).toBe('npub_chiefofstaff');
    expect(row.agent_review_note).toBe('Reviewed and recommended.');
    expect(row.artifact_refs).toEqual(artifactRefs);
    expect(row.record_state).toBe('active');
  });
});
