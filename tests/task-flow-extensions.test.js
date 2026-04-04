import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/translators/record-crypto.js', () => ({
  decryptRecordPayload: vi.fn(async (record) => JSON.parse(record.owner_payload.ciphertext)),
  encryptOwnerPayload: vi.fn(async (_ownerNpub, payload) => ({ ciphertext: JSON.stringify(payload) })),
  buildGroupPayloads: vi.fn(async (groupNpubs, payload) =>
    groupNpubs.map((group_npub) => ({ group_npub, ciphertext: JSON.stringify(payload), write: true }))),
}));

import { inboundTask, outboundTask } from '../src/translators/tasks.js';
import { APP_NPUB } from '../src/app-identity.js';

describe('task flow extensions — inbound', () => {
  it('reads predecessor_task_ids, flow_id, flow_run_id, flow_step from payload', async () => {
    const record = {
      record_id: 'task-flow-1',
      owner_npub: 'npub_owner',
      version: 1,
      updated_at: '2026-04-01T00:00:00Z',
      owner_payload: {
        ciphertext: JSON.stringify({
          data: {
            title: 'Step 2 task',
            state: 'new',
            predecessor_task_ids: ['task-step1', 'task-step1b'],
            flow_id: 'flow-outreach',
            flow_run_id: 'run-001',
            flow_step: 2,
          },
        }),
      },
      group_payloads: [],
    };

    const row = await inboundTask(record);

    expect(row.predecessor_task_ids).toEqual(['task-step1', 'task-step1b']);
    expect(row.flow_id).toBe('flow-outreach');
    expect(row.flow_run_id).toBe('run-001');
    expect(row.flow_step).toBe(2);
  });

  it('defaults flow fields to null when not present', async () => {
    const record = {
      record_id: 'task-no-flow',
      owner_npub: 'npub_owner',
      version: 1,
      owner_payload: {
        ciphertext: JSON.stringify({
          data: { title: 'Plain task', state: 'ready' },
        }),
      },
      group_payloads: [],
    };

    const row = await inboundTask(record);

    expect(row.predecessor_task_ids).toBeNull();
    expect(row.flow_id).toBeNull();
    expect(row.flow_run_id).toBeNull();
    expect(row.flow_step).toBeNull();
  });

  it('handles empty predecessor_task_ids array', async () => {
    const record = {
      record_id: 'task-empty-preds',
      owner_npub: 'npub_owner',
      version: 1,
      owner_payload: {
        ciphertext: JSON.stringify({
          data: {
            title: 'Task with empty predecessors',
            predecessor_task_ids: [],
          },
        }),
      },
      group_payloads: [],
    };

    const row = await inboundTask(record);

    expect(row.predecessor_task_ids).toEqual([]);
  });
});

describe('task flow extensions — outbound', () => {
  it('includes flow fields in outbound envelope', async () => {
    const envelope = await outboundTask({
      record_id: 'task-flow-out',
      owner_npub: 'npub_owner',
      title: 'Flow task',
      predecessor_task_ids: ['task-a', 'task-b'],
      flow_id: 'flow-1',
      flow_run_id: 'run-001',
      flow_step: 3,
    });

    const payload = JSON.parse(envelope.owner_payload.ciphertext);
    expect(payload.data.predecessor_task_ids).toEqual(['task-a', 'task-b']);
    expect(payload.data.flow_id).toBe('flow-1');
    expect(payload.data.flow_run_id).toBe('run-001');
    expect(payload.data.flow_step).toBe(3);
  });

  it('omits flow fields when null (backward-compatible)', async () => {
    const envelope = await outboundTask({
      record_id: 'task-plain',
      owner_npub: 'npub_owner',
      title: 'Plain task',
    });

    const payload = JSON.parse(envelope.owner_payload.ciphertext);
    expect(payload.data.predecessor_task_ids).toBeNull();
    expect(payload.data.flow_id).toBeNull();
    expect(payload.data.flow_run_id).toBeNull();
    expect(payload.data.flow_step).toBeNull();
  });
});

describe('task flow extensions — round-trip', () => {
  it('preserves flow fields through outbound → inbound cycle', async () => {
    const envelope = await outboundTask({
      record_id: 'task-rt',
      owner_npub: 'npub_owner',
      title: 'Round-trip flow task',
      predecessor_task_ids: ['pred-1'],
      flow_id: 'flow-rt',
      flow_run_id: 'run-rt',
      flow_step: 1,
      group_ids: ['gpub_abc'],
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

    const row = await inboundTask(syntheticRecord);

    expect(row.predecessor_task_ids).toEqual(['pred-1']);
    expect(row.flow_id).toBe('flow-rt');
    expect(row.flow_run_id).toBe('run-rt');
    expect(row.flow_step).toBe(1);
  });
});
