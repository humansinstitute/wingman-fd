import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/translators/record-crypto.js', () => ({
  decryptRecordPayload: vi.fn(async (record) => JSON.parse(record.owner_payload.ciphertext)),
  encryptOwnerPayload: vi.fn(async (_ownerNpub, payload) => ({ ciphertext: JSON.stringify(payload) })),
  buildGroupPayloads: vi.fn(async (groupRefs, payload) =>
    groupRefs.map((group_id) => ({ group_id, ciphertext: JSON.stringify(payload), write: true }))),
}));

import { inboundSchedule, outboundSchedule, recordFamilyHash } from '../src/translators/schedules.js';
import { APP_NPUB } from '../src/app-identity.js';

describe('schedule translator — inbound', () => {
  it('materializes a schedule record into a local row', async () => {
    const record = {
      record_id: 'schedule-1',
      owner_npub: 'npub_owner',
      version: 2,
      created_at: '2026-03-10T00:00:00Z',
      updated_at: '2026-03-10T01:00:00Z',
      owner_payload: {
        ciphertext: JSON.stringify({
          app_namespace: APP_NPUB,
          collection_space: 'schedule',
          schema_version: 1,
          record_id: 'schedule-1',
          data: {
            title: 'Daily wrap-up',
            description: 'Post review',
            time_start: '21:30',
            time_end: '23:45',
            days: ['mon', 'tue'],
            timezone: 'Australia/Perth',
            assigned_group_id: 'group-1',
            active: true,
            last_run: '2026-03-10T13:45:00Z',
            repeat: 'daily',
            record_state: 'active',
          },
        }),
      },
      group_payloads: [
        { group_id: 'group-1', group_npub: 'group-1', ciphertext: '{}', write: true },
      ],
    };

    const row = await inboundSchedule(record);

    expect(row.record_id).toBe('schedule-1');
    expect(row.title).toBe('Daily wrap-up');
    expect(row.time_start).toBe('21:30');
    expect(row.time_end).toBe('23:45');
    expect(row.days).toEqual(['mon', 'tue']);
    expect(row.timezone).toBe('Australia/Perth');
    expect(row.assigned_group_id).toBe('group-1');
    expect(row.active).toBe(true);
    expect(row.last_run).toBe('2026-03-10T13:45:00Z');
    expect(row.repeat).toBe('daily');
    expect(row.group_ids).toEqual(['group-1']);
  });
});

describe('schedule translator — outbound', () => {
  it('builds a valid V4 envelope', async () => {
    const envelope = await outboundSchedule({
      record_id: 'schedule-1',
      owner_npub: 'npub_owner',
      title: 'Morning briefing',
      description: 'Run wake and summary',
      time_start: '05:00',
      time_end: '07:00',
      days: ['mon', 'wed'],
      timezone: 'Australia/Perth',
      assigned_group_id: 'group-1',
      active: true,
      repeat: 'daily',
      group_ids: ['group-1'],
      signature_npub: 'npub_owner',
    });

    expect(envelope.record_id).toBe('schedule-1');
    expect(envelope.record_family_hash).toBe(recordFamilyHash('schedule'));
    const payload = JSON.parse(envelope.owner_payload.ciphertext);
    expect(payload.collection_space).toBe('schedule');
    expect(payload.data.title).toBe('Morning briefing');
    expect(payload.data.days).toEqual(['mon', 'wed']);
    expect(payload.data.assigned_group_id).toBe('group-1');
    expect(payload.data.active).toBe(true);
  });

  it('uses write_group_npub when the writable group ref is not a UUID', async () => {
    const envelope = await outboundSchedule({
      record_id: 'schedule-legacy-group',
      owner_npub: 'npub_owner',
      title: 'Legacy group schedule',
      group_ids: ['npub1grouprefexample'],
      write_group_ref: 'npub1grouprefexample',
      signature_npub: 'npub_owner',
    });

    expect(envelope.write_group_id).toBeUndefined();
    expect(envelope.write_group_npub).toBe('npub1grouprefexample');
  });
});
