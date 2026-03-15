import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/translators/record-crypto.js', () => ({
  decryptRecordPayload: vi.fn(async (record) => JSON.parse(record.owner_payload.ciphertext)),
  encryptOwnerPayload: vi.fn(async (_ownerNpub, payload) => ({ ciphertext: JSON.stringify(payload) })),
  buildGroupPayloads: vi.fn(async (groupNpubs, payload) =>
    groupNpubs.map((group_npub) => ({ group_npub, ciphertext: JSON.stringify(payload), write: true }))),
}));

import { inboundAudioNote, outboundAudioNote, recordFamilyHash } from '../src/translators/audio-notes.js';
import { APP_NPUB } from '../src/app-identity.js';

describe('audio note translator', () => {
  it('materializes an audio note record into a local row', async () => {
    const record = {
      record_id: 'audio-1',
      owner_npub: 'npub_owner',
      signature_npub: 'npub_sender',
      version: 1,
      updated_at: '2026-03-15T02:00:00Z',
      owner_payload: {
        ciphertext: JSON.stringify({
          app_namespace: APP_NPUB,
          collection_space: 'audio_note',
          schema_version: 1,
          record_id: 'audio-1',
          data: {
            target_record_id: 'comment-1',
            target_record_family_hash: `${APP_NPUB}:comment`,
            title: 'Voice note',
            storage_object_id: 'obj-1',
            mime_type: 'audio/webm;codecs=opus',
            duration_seconds: 37,
            size_bytes: 12345,
            media_encryption: { scheme: 'aes-gcm', key_b64: 'a2V5', iv_b64: 'aXY=' },
            transcript_status: 'pending',
            transcript_preview: null,
            summary: null,
          },
        }),
      },
      group_payloads: [{ group_npub: 'gpub_1', ciphertext: '{}', write: true }],
    };

    const row = await inboundAudioNote(record);
    expect(row.record_id).toBe('audio-1');
    expect(row.target_record_id).toBe('comment-1');
    expect(row.storage_object_id).toBe('obj-1');
    expect(row.duration_seconds).toBe(37);
    expect(row.group_ids).toEqual(['gpub_1']);
    expect(row.sender_npub).toBe('npub_sender');
  });

  it('builds a valid outbound envelope', async () => {
    const envelope = await outboundAudioNote({
      record_id: 'audio-2',
      owner_npub: 'npub_owner',
      target_record_id: 'msg-1',
      target_record_family_hash: `${APP_NPUB}:chat_message`,
      title: 'Voice note',
      storage_object_id: 'obj-2',
      mime_type: 'audio/webm;codecs=opus',
      duration_seconds: 44,
      size_bytes: 999,
      media_encryption: { scheme: 'aes-gcm', key_b64: 'a2V5', iv_b64: 'aXY=' },
      target_group_ids: ['gpub_1'],
    });

    expect(envelope.record_family_hash).toBe(recordFamilyHash('audio_note'));
    expect(envelope.group_payloads).toHaveLength(1);
    const inner = JSON.parse(envelope.owner_payload.ciphertext);
    expect(inner.data.storage_object_id).toBe('obj-2');
    expect(inner.data.duration_seconds).toBe(44);
    expect(inner.data.media_encryption.scheme).toBe('aes-gcm');
  });
});
