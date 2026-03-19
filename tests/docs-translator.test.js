import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/translators/record-crypto.js', () => ({
  decryptRecordPayload: vi.fn(async (record) => JSON.parse(record.owner_payload.ciphertext)),
  encryptOwnerPayload: vi.fn(async (_ownerNpub, payload) => ({ ciphertext: JSON.stringify(payload) })),
  buildGroupPayloads: vi.fn(async (groupNpubs, payload, canWriteByGroup) =>
    groupNpubs.map((group_npub) => ({
      group_npub,
      ciphertext: JSON.stringify(payload),
      write: canWriteByGroup instanceof Map ? canWriteByGroup.get(group_npub) === true : true,
    }))),
}));
import {
  inboundDocument,
  outboundDocument,
  inboundDirectory,
  outboundDirectory,
} from '../src/translators/docs.js';
import { recordFamilyHash } from '../src/translators/chat.js';
import { APP_NPUB } from '../src/app-identity.js';

describe('docs translator', () => {
  it('materializes a document record into a local row', async () => {
    const record = {
      record_id: 'doc-1',
      owner_npub: 'npub_owner',
      version: 2,
      updated_at: '2026-03-12T00:00:00Z',
      owner_payload: {
        ciphertext: JSON.stringify({
          app_namespace: 'coworker',
          collection_space: 'document',
          schema_version: 1,
          record_id: 'doc-1',
          data: {
            title: 'Spec',
            content: 'hello world',
            parent_directory_id: 'dir-1',
            shares: [
              {
                type: 'group',
                key: 'group:g-1',
                group_npub: 'g-1',
                label: 'Reviewers',
                access: 'write',
                inherited: true,
                inherited_from_directory_id: 'dir-1',
              },
            ],
          },
        }),
      },
      group_payloads: [{ group_npub: 'g-1', ciphertext: '{}', write: true }],
    };

    const row = await inboundDocument(record);
    expect(row.record_id).toBe('doc-1');
    expect(row.parent_directory_id).toBe('dir-1');
    expect(row.content).toBe('hello world');
    expect(row.shares[0].group_npub).toBe('g-1');
    expect(row.shares[0].inherited).toBe(true);
    expect(row.shares[0].inherited_from_directory_id).toBe('dir-1');
    expect(row.group_ids).toEqual(['g-1']);
  });

  it('builds a document envelope from shares', async () => {
    const envelope = await outboundDocument({
      record_id: 'doc-2',
      owner_npub: 'npub_owner',
      title: 'Plan',
      content: 'outline',
      parent_directory_id: null,
      shares: [
        {
          type: 'group',
          key: 'group:g-1',
          group_npub: 'g-1',
          access: 'read',
          label: 'Readers',
          inherited: true,
          inherited_from_directory_id: 'dir-1',
        },
        {
          type: 'person',
          key: 'person:npub_friend',
          person_npub: 'npub_friend',
          via_group_npub: 'g-direct',
          access: 'write',
          label: 'Friend',
        },
      ],
    });

    expect(envelope.record_family_hash).toBe(recordFamilyHash('document'));
    expect(envelope.group_payloads).toHaveLength(2);
    expect(envelope.group_payloads.find((item) => item.group_npub === 'g-1')?.write).toBe(false);
    expect(envelope.group_payloads.find((item) => item.group_npub === 'g-direct')?.write).toBe(true);

    const inner = JSON.parse(envelope.owner_payload.ciphertext);
    expect(inner.app_namespace).toBe(APP_NPUB);
    expect(inner.data.title).toBe('Plan');
    expect(inner.data.shares).toHaveLength(2);
    expect(inner.data.shares[0].inherited).toBe(true);
    expect(inner.data.shares[0].inherited_from_directory_id).toBe('dir-1');
  });

  it('materializes a directory record into a local row', async () => {
    const record = {
      record_id: 'dir-1',
      owner_npub: 'npub_owner',
      version: 1,
      updated_at: '2026-03-12T00:00:00Z',
      owner_payload: {
        ciphertext: JSON.stringify({
          app_namespace: 'coworker',
          collection_space: 'directory',
          schema_version: 1,
          record_id: 'dir-1',
          data: {
            title: 'Projects',
            parent_directory_id: null,
            scope_id: 'product-1',
            scope_product_id: 'product-1',
            scope_project_id: null,
            scope_deliverable_id: null,
          },
        }),
      },
      group_payloads: [],
    };

    const row = await inboundDirectory(record);
    expect(row.record_id).toBe('dir-1');
    expect(row.title).toBe('Projects');
    expect(row.parent_directory_id).toBeNull();
    expect(row.scope_id).toBe('product-1');
    expect(row.scope_product_id).toBe('product-1');
    expect(row.shares).toEqual([]);
  });

  it('builds a directory delete envelope', async () => {
    const envelope = await outboundDirectory({
      record_id: 'dir-2',
      owner_npub: 'npub_owner',
      title: 'Archive',
      parent_directory_id: null,
      scope_id: 'deliverable-1',
      scope_product_id: 'product-1',
      scope_project_id: 'project-1',
      scope_deliverable_id: 'deliverable-1',
      shares: [],
      version: 3,
      previous_version: 2,
      record_state: 'deleted',
    });

    expect(envelope.record_family_hash).toBe(recordFamilyHash('directory'));
    expect(envelope.version).toBe(3);
    const inner = JSON.parse(envelope.owner_payload.ciphertext);
    expect(inner.app_namespace).toBe(APP_NPUB);
    expect(inner.data.scope_id).toBe('deliverable-1');
    expect(inner.data.record_state).toBe('deleted');
  });
});
