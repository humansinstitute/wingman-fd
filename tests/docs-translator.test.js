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
vi.mock('../src/api.js', () => ({
  downloadStorageObject: vi.fn(),
}));
import {
  inboundDocument,
  outboundDocument,
  inboundDirectory,
  outboundDirectory,
  DOCUMENT_CONTENT_STORAGE_FORMAT,
  DOCUMENT_CONTENT_STORAGE_MIME,
} from '../src/translators/docs.js';
import { downloadStorageObject } from '../src/api.js';
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
            content_format: 'block_document_v1',
            content_blocks: [{ id: 'blk-1', type: 'markdown', text: 'hello world', attrs: {} }],
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
    expect(row.content_format).toBe('block_document_v1');
    expect(row.content_blocks[0].id).toBe('blk-1');
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
      content_blocks: [{ id: 'blk-plan', type: 'markdown', text: 'outline', attrs: {} }],
      parent_directory_id: null,
      group_ids: ['g-1', 'g-direct'],
      shares: [
        {
          type: 'group',
          key: 'group:g-1',
          group_id: 'g-1',
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
    expect(envelope.group_payloads.find((item) => item.group_npub === 'g-1')?.write).toBe(true);
    expect(envelope.group_payloads.find((item) => item.group_npub === 'g-direct')?.write).toBe(true);

    const inner = JSON.parse(envelope.owner_payload.ciphertext);
    expect(inner.app_namespace).toBe(APP_NPUB);
    expect(inner.data.title).toBe('Plan');
    expect(inner.data.content_format).toBe('block_document_v1');
    expect(inner.data.content_blocks[0].id).toBe('blk-plan');
    expect(inner.data.shares).toHaveLength(2);
    expect(inner.data.shares[0].inherited).toBe(true);
    expect(inner.data.shares[0].inherited_from_directory_id).toBe('dir-1');
  });

  it('round-trips document source, reference, and deliverable links', async () => {
    const sourceLinks = [{ type: 'task', id: 'source-task' }];
    const references = [{ type: 'scope', id: 'scope-1' }];
    const deliverableLinks = [{ type: 'doc', id: 'deliverable-doc', order: 1 }];

    const envelope = await outboundDocument({
      record_id: 'doc-links',
      owner_npub: 'npub_owner',
      title: 'Linked doc',
      content: 'See @[Scope](mention:scope:scope-1)',
      content_blocks: [{ id: 'blk-1', type: 'markdown', text: 'body', attrs: {} }],
      source_links: sourceLinks,
      references,
      deliverable_links: deliverableLinks,
    });
    const inner = JSON.parse(envelope.owner_payload.ciphertext);
    expect(inner.data.source_links).toEqual(sourceLinks);
    expect(inner.data.references).toEqual(references);
    expect(inner.data.deliverable_links).toEqual(deliverableLinks);

    const row = await inboundDocument({
      record_id: 'doc-links',
      owner_npub: 'npub_owner',
      owner_payload: envelope.owner_payload,
      group_payloads: [],
    });
    expect(row.source_links).toEqual(sourceLinks);
    expect(row.references).toEqual(references);
    expect(row.deliverable_links).toEqual(deliverableLinks);
  });

  it('materializes storage-backed document content', async () => {
    downloadStorageObject.mockResolvedValue(new TextEncoder().encode(JSON.stringify({
      format: DOCUMENT_CONTENT_STORAGE_FORMAT,
      content_model: {
        content: '# Transcript\n\nLong body',
        content_format: 'block_document_v1',
        content_blocks: [{ id: 'blk-transcript', type: 'markdown', text: '# Transcript\n\nLong body', attrs: {} }],
      },
    })));

    const row = await inboundDocument({
      record_id: 'doc-storage',
      owner_npub: 'npub_owner',
      version: 1,
      updated_at: '2026-03-12T00:00:00Z',
      owner_payload: {
        ciphertext: JSON.stringify({
          app_namespace: 'coworker',
          collection_space: 'document',
          schema_version: 1,
          record_id: 'doc-storage',
          data: {
            title: 'Transcript',
            content: '# Transcript',
            content_format: 'block_document_v1',
            content_blocks: [],
            content_storage_object_id: 'storage-doc-1',
            content_storage_format: DOCUMENT_CONTENT_STORAGE_FORMAT,
            content_storage_content_type: DOCUMENT_CONTENT_STORAGE_MIME,
            content_size_bytes: 123,
            content_sha256_hex: 'abc123',
            parent_directory_id: null,
            shares: [],
          },
        }),
      },
      group_payloads: [],
    });

    expect(downloadStorageObject).toHaveBeenCalledWith('storage-doc-1');
    expect(row.content).toBe('# Transcript\n\nLong body');
    expect(row.content_blocks[0].id).toBe('blk-transcript');
    expect(row.content_storage_status).toBe('loaded');
    expect(row.content_storage_object_id).toBe('storage-doc-1');
  });

  it('builds a storage-backed document envelope without embedding the full body', async () => {
    const envelope = await outboundDocument({
      record_id: 'doc-storage',
      owner_npub: 'npub_owner',
      title: 'Transcript',
      content: '# Transcript',
      content_blocks: [],
      content_storage_object_id: 'storage-doc-1',
      content_storage_format: DOCUMENT_CONTENT_STORAGE_FORMAT,
      content_storage_content_type: DOCUMENT_CONTENT_STORAGE_MIME,
      content_size_bytes: 123,
      content_sha256_hex: 'abc123',
      group_ids: [],
      shares: [],
    });

    const inner = JSON.parse(envelope.owner_payload.ciphertext);
    expect(inner.data.content).toBe('# Transcript');
    expect(inner.data.content_blocks).toEqual([]);
    expect(inner.data.content_storage_object_id).toBe('storage-doc-1');
    expect(inner.data.content_storage_content_type).toBe(DOCUMENT_CONTENT_STORAGE_MIME);
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
            scope_l1_id: 'product-1',
            scope_l2_id: null,
            scope_l3_id: null,
            scope_l4_id: null,
            scope_l5_id: null,
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
    expect(row.scope_l1_id).toBe('product-1');
    expect(row.shares).toEqual([]);
  });

  it('builds a directory delete envelope', async () => {
    const envelope = await outboundDirectory({
      record_id: 'dir-2',
      owner_npub: 'npub_owner',
      title: 'Archive',
      parent_directory_id: null,
      group_ids: ['deliverable-group'],
      scope_id: 'deliverable-1',
      scope_l1_id: 'product-1',
      scope_l2_id: 'project-1',
      scope_l3_id: 'deliverable-1',
      scope_l4_id: null,
      scope_l5_id: null,
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
