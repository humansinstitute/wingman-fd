import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/translators/record-crypto.js', () => ({
  decryptRecordPayload: vi.fn(async (record) => JSON.parse(record.owner_payload.ciphertext)),
  encryptOwnerPayload: vi.fn(async (_ownerNpub, payload) => ({ ciphertext: JSON.stringify(payload) })),
  buildGroupPayloads: vi.fn(async (groupIds, payload) =>
    groupIds.map((group_npub) => ({ group_npub, ciphertext: JSON.stringify(payload) }))),
}));

import {
  inboundOpportunity,
  outboundOpportunity,
  OPPORTUNITY_STAGE_OPTIONS,
  recordFamilyHash,
} from '../src/translators/opportunities.js';
import { APP_NPUB } from '../src/app-identity.js';

describe('opportunities translator', () => {
  it('builds the record family hash', () => {
    expect(recordFamilyHash('opportunity')).toBe(`${APP_NPUB}:opportunity`);
  });

  it('round-trips outbound and inbound opportunity payloads', async () => {
    const envelope = await outboundOpportunity({
      record_id: 'opp-1',
      owner_npub: 'npub-owner',
      title: 'Pilot onboarding automation',
      description: 'Initial outreach has landed.',
      stage: 'lead',
      opportunity_type: 'automation',
      responsible_npub: 'npub-responsible',
      person_links: [{ person_id: 'person-1', primary: true }],
      organisation_links: [{ organisation_id: 'org-1', primary: true }],
      task_links: [{ task_id: 'task-1', primary: true }],
      expected_value: 12000,
      currency: 'AUD',
      expected_close_at: '2026-06-30',
      source: 'wealth-management',
      origin_opportunity_id: 'opp-0',
      shares: [],
      group_ids: ['group-1'],
    });

    const row = await inboundOpportunity({
      record_id: 'opp-1',
      owner_npub: 'npub-owner',
      version: 2,
      updated_at: '2026-04-20T00:00:00.000Z',
      owner_payload: envelope.owner_payload,
      group_payloads: [{ group_npub: 'group-1', ciphertext: envelope.owner_payload.ciphertext }],
    });

    expect(row.stage).toBe('lead');
    expect(row.opportunity_type).toBe('automation');
    expect(row.person_links).toEqual([{ person_id: 'person-1', primary: true }]);
    expect(row.organisation_links).toEqual([{ organisation_id: 'org-1', primary: true }]);
    expect(row.task_links).toEqual([{ task_id: 'task-1', primary: true }]);
    expect(row.expected_value).toBe(12000);
    expect(row.origin_opportunity_id).toBe('opp-0');
  });

  it('falls back to speculation for unknown stages', async () => {
    const row = await inboundOpportunity({
      record_id: 'opp-2',
      owner_npub: 'npub-owner',
      updated_at: '2026-04-20T00:00:00.000Z',
      owner_payload: {
        ciphertext: JSON.stringify({
          data: {
            title: 'Unknown stage',
            description: '',
            stage: 'mystery',
            person_links: [],
            organisation_links: [],
            task_links: [],
            shares: [],
            record_state: 'active',
          },
        }),
      },
      group_payloads: [],
    });

    expect(OPPORTUNITY_STAGE_OPTIONS.includes(row.stage)).toBe(true);
    expect(row.stage).toBe('speculation');
  });
});
