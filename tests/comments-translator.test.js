import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/translators/record-crypto.js', () => ({
  decryptRecordPayload: vi.fn(async (record) => JSON.parse(record.owner_payload.ciphertext)),
  encryptOwnerPayload: vi.fn(async (_ownerNpub, payload) => ({ ciphertext: JSON.stringify(payload) })),
  buildGroupPayloads: vi.fn(async (groupNpubs, payload) =>
    groupNpubs.map((group_npub) => ({ group_npub, ciphertext: JSON.stringify(payload), write: true }))),
}));
import {
  inboundComment,
  outboundComment,
  recordFamilyHash,
} from '../src/translators/comments.js';
import { APP_NPUB } from '../src/app-identity.js';

describe('comment translator — inbound', () => {
  it('materializes a comment record into a local row', async () => {
    const record = {
      record_id: 'comment-1',
      owner_npub: 'npub_owner',
      signature_npub: 'npub_commenter',
      version: 1,
      created_at: '2026-03-10T00:00:00Z',
      updated_at: '2026-03-10T01:00:00Z',
      owner_payload: {
        ciphertext: JSON.stringify({
          app_namespace: APP_NPUB,
          collection_space: 'comment',
          schema_version: 1,
          record_id: 'comment-1',
          data: {
            target_record_id: 'task-1',
            target_record_family_hash: `${APP_NPUB}:task`,
            parent_comment_id: null,
            body: 'Looks good, shipping it.',
            attachments: [{ kind: 'audio', audio_note_record_id: 'audio-1', title: 'Voice note' }],
            record_state: 'active',
          },
        }),
      },
      group_payloads: [
        { group_npub: 'gpub_abc', ciphertext: '{}', write: true },
      ],
    };

    const row = await inboundComment(record);

    expect(row.record_id).toBe('comment-1');
    expect(row.owner_npub).toBe('npub_owner');
    expect(row.target_record_id).toBe('task-1');
    expect(row.target_record_family_hash).toBe(`${APP_NPUB}:task`);
    expect(row.parent_comment_id).toBeNull();
    expect(row.body).toBe('Looks good, shipping it.');
    expect(row.attachments).toHaveLength(1);
    expect(row.sender_npub).toBe('npub_commenter');
    expect(row.record_state).toBe('active');
  });

  it('defaults missing fields gracefully', async () => {
    const record = {
      record_id: 'comment-2',
      owner_npub: 'npub_owner',
      owner_payload: { ciphertext: JSON.stringify({ data: {} }) },
      group_payloads: [],
    };

    const row = await inboundComment(record);

    expect(row.target_record_id).toBeNull();
    expect(row.body).toBe('');
    expect(row.parent_comment_id).toBeNull();
    expect(row.sender_npub).toBe('npub_owner');
  });
});

describe('comment translator — outbound', () => {
  it('builds a valid V4 envelope', async () => {
    const envelope = await outboundComment({
      record_id: 'comment-1',
      owner_npub: 'npub_owner',
      target_record_id: 'task-1',
      target_record_family_hash: `${APP_NPUB}:task`,
      body: 'Great progress!',
      attachments: [{ kind: 'audio', audio_note_record_id: 'audio-1', title: 'Voice note' }],
      target_group_ids: ['gpub_abc'],
      signature_npub: 'npub_owner',
    });

    expect(envelope.record_id).toBe('comment-1');
    expect(envelope.record_family_hash).toBe(`${APP_NPUB}:comment`);
    expect(envelope.group_payloads).toHaveLength(1);
    expect(envelope.group_payloads[0].group_npub).toBe('gpub_abc');

    const payload = JSON.parse(envelope.owner_payload.ciphertext);
    expect(payload.app_namespace).toBe(APP_NPUB);
    expect(payload.collection_space).toBe('comment');
    expect(payload.data.target_record_id).toBe('task-1');
    expect(payload.data.body).toBe('Great progress!');
    expect(payload.data.attachments).toHaveLength(1);
    expect(payload.data.parent_comment_id).toBeNull();
  });

  it('inherits group_ids from target for fanout', async () => {
    const envelope = await outboundComment({
      record_id: 'comment-2',
      owner_npub: 'npub_owner',
      target_record_id: 'task-1',
      target_record_family_hash: `${APP_NPUB}:task`,
      body: 'Inheriting access',
      target_group_ids: ['gpub_a', 'gpub_b'],
    });

    expect(envelope.group_payloads).toHaveLength(2);
    expect(envelope.group_payloads.map(g => g.group_npub)).toEqual(['gpub_a', 'gpub_b']);
  });
});

describe('comment translator — recordFamilyHash', () => {
  it('returns APP_NPUB:comment', () => {
    expect(recordFamilyHash('comment')).toBe(`${APP_NPUB}:comment`);
  });
});
