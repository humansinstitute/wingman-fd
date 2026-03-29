import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/translators/record-crypto.js', () => ({
  decryptRecordPayload: vi.fn(async (record) => JSON.parse(record.owner_payload.ciphertext)),
  encryptOwnerPayload: vi.fn(async (_ownerNpub, payload) => ({ ciphertext: JSON.stringify(payload) })),
  buildGroupPayloads: vi.fn(async (groupRefs, payload) =>
    groupRefs.map((group_id) => ({ group_id, ciphertext: JSON.stringify(payload), write: true }))),
}));

import { inboundReport, outboundReport, recordFamilyHash } from '../src/translators/reports.js';
import { APP_NPUB } from '../src/app-identity.js';

describe('report translator — inbound', () => {
  it('materializes a declarative report into a local row', async () => {
    const record = {
      record_id: 'report-1',
      owner_npub: 'npub_owner',
      version: 2,
      created_at: '2026-03-25T00:00:00Z',
      updated_at: '2026-03-25T01:00:00Z',
      owner_payload: {
        ciphertext: JSON.stringify({
          app_namespace: APP_NPUB,
          collection_space: 'report',
          schema_version: 1,
          record_id: 'report-1',
          metadata: {
            title: 'Daily Users',
            generated_at: '2026-03-25T00:55:00Z',
            record_state: 'active',
            surface: 'flightdeck',
            scope: {
              id: 'scope-project',
              level: 'project',
              l1_id: 'scope-product',
              l2_id: 'scope-project',
              l3_id: null,
              l4_id: null,
              l5_id: null,
            },
          },
          data: {
            declaration_type: 'metric',
            payload: {
              label: 'Daily Users',
              value: 50,
              unit: 'per day',
            },
          },
        }),
      },
      group_payloads: [
        { group_id: 'group-1', group_npub: 'group-1', ciphertext: '{}', write: true },
      ],
    };

    const row = await inboundReport(record);

    expect(row.record_id).toBe('report-1');
    expect(row.title).toBe('Daily Users');
    expect(row.declaration_type).toBe('metric');
    expect(row.generated_at).toBe('2026-03-25T00:55:00Z');
    expect(row.surface).toBe('flightdeck');
    expect(row.scope_id).toBe('scope-project');
    expect(row.scope_l1_id).toBe('scope-product');
    expect(row.scope_l2_id).toBe('scope-project');
    expect(row.payload.value).toBe(50);
    expect(row.group_ids).toEqual(['group-1']);
  });
});

describe('report translator — outbound', () => {
  it('builds a valid V4 envelope for declarative reports', async () => {
    const envelope = await outboundReport({
      record_id: 'report-1',
      owner_npub: 'npub_owner',
      group_ids: ['group-1'],
      metadata: {
        title: 'Daily Users',
        generated_at: '2026-03-25T00:55:00Z',
        record_state: 'active',
        surface: 'flightdeck',
        scope: {
          id: 'scope-project',
          level: 'project',
          l1_id: 'scope-product',
          l2_id: 'scope-project',
          l3_id: null,
          l4_id: null,
          l5_id: null,
        },
      },
      data: {
        declaration_type: 'metric',
        payload: {
          label: 'Daily Users',
          value: 50,
          unit: 'per day',
        },
      },
    });

    expect(envelope.record_id).toBe('report-1');
    expect(envelope.record_family_hash).toBe(recordFamilyHash('report'));
    expect(envelope.group_payloads).toHaveLength(1);

    const payload = JSON.parse(envelope.owner_payload.ciphertext);
    expect(payload.app_namespace).toBe(APP_NPUB);
    expect(payload.collection_space).toBe('report');
    expect(payload.metadata.title).toBe('Daily Users');
    expect(payload.data.declaration_type).toBe('metric');
    expect(payload.data.payload.value).toBe(50);
  });
});
