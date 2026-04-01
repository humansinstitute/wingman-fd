import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/translators/record-crypto.js', () => ({
  decryptRecordPayload: vi.fn(async (record) => JSON.parse(record.owner_payload.ciphertext)),
  encryptOwnerPayload: vi.fn(async (_ownerNpub, payload) => ({ ciphertext: JSON.stringify(payload) })),
  buildGroupPayloads: vi.fn(async (groupNpubs, payload) =>
    groupNpubs.map((group_npub) => ({ group_npub, ciphertext: JSON.stringify(payload), write: true }))),
}));

import { inboundDocument, inboundDirectory } from '../src/translators/docs.js';

describe('docs translator — group_id normalization', () => {
  it('inbound document extracts stable UUID group_ids from group_payloads', async () => {
    const record = {
      record_id: 'doc-1',
      owner_npub: 'npub_owner',
      version: 1,
      updated_at: '2026-04-01T00:00:00Z',
      owner_payload: {
        ciphertext: JSON.stringify({ data: { title: 'Test doc' } }),
      },
      group_payloads: [
        { group_id: 'uuid-1', group_npub: 'npub_old', group_epoch: 2 },
      ],
    };

    const row = await inboundDocument(record);
    expect(row.group_ids).toEqual(['uuid-1']);
  });

  it('inbound document normalizes stale npub share refs to UUID', async () => {
    const record = {
      record_id: 'doc-stale',
      owner_npub: 'npub_owner',
      version: 1,
      updated_at: '2026-04-01T00:00:00Z',
      owner_payload: {
        ciphertext: JSON.stringify({
          data: {
            title: 'Stale share doc',
            shares: [
              { type: 'group', group_npub: 'npub_old_epoch1', access: 'write' },
            ],
          },
        }),
      },
      group_payloads: [
        { group_id: 'uuid-1', group_npub: 'npub_old_epoch1', group_epoch: 1 },
      ],
    };

    const row = await inboundDocument(record);
    expect(row.shares[0].group_id).toBe('uuid-1');
    expect(row.shares[0].key).toBe('uuid-1');
  });

  it('inbound directory normalizes stale npub share refs to UUID', async () => {
    const record = {
      record_id: 'dir-stale',
      owner_npub: 'npub_owner',
      version: 1,
      updated_at: '2026-04-01T00:00:00Z',
      owner_payload: {
        ciphertext: JSON.stringify({
          data: {
            title: 'Stale dir',
            shares: [
              { type: 'group', group_npub: 'npub_stale_dir', access: 'read' },
              { type: 'person', person_npub: 'npub_person', via_group_npub: 'npub_stale_dir', access: 'write' },
            ],
          },
        }),
      },
      group_payloads: [
        { group_id: 'uuid-dir', group_npub: 'npub_stale_dir', group_epoch: 2 },
      ],
    };

    const row = await inboundDirectory(record);
    expect(row.shares[0].group_id).toBe('uuid-dir');
    expect(row.shares[1].via_group_id).toBe('uuid-dir');
    expect(row.group_ids).toEqual(['uuid-dir']);
  });

  it('inbound document synthesizes shares from group_payloads when data.shares is empty', async () => {
    const record = {
      record_id: 'doc-synth',
      owner_npub: 'npub_owner',
      version: 1,
      updated_at: '2026-04-01T00:00:00Z',
      owner_payload: {
        ciphertext: JSON.stringify({ data: { title: 'Synth doc' } }),
      },
      group_payloads: [
        { group_id: 'uuid-synth', group_npub: 'npub_synth', group_epoch: 1, write: true },
      ],
    };

    const row = await inboundDocument(record);
    expect(row.shares).toHaveLength(1);
    expect(row.shares[0].group_id).toBe('uuid-synth');
    expect(row.shares[0].type).toBe('group');
  });
});
