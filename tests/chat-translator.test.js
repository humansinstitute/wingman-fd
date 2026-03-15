import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/translators/record-crypto.js', () => ({
  decryptRecordPayload: vi.fn(async (record) => JSON.parse(record.owner_payload.ciphertext)),
  encryptOwnerPayload: vi.fn(async (_ownerNpub, payload) => ({ ciphertext: JSON.stringify(payload) })),
  buildGroupPayloads: vi.fn(async (groupNpubs, payload) =>
    groupNpubs.map((group_npub) => ({ group_npub, ciphertext: JSON.stringify(payload), write: true }))),
}));
import {
  inboundChannel,
  inboundChatMessage,
  outboundChatMessage,
  outboundChannel,
  recordFamilyHash,
} from '../src/translators/chat.js';
import { APP_NPUB } from '../src/app-identity.js';

describe('chat translator — inbound', () => {
  it('materializes a channel record into a local row', async () => {
    const record = {
      record_id: 'ch-1',
      owner_npub: 'npub_owner',
      version: 2,
      updated_at: '2026-03-10T00:00:00Z',
      owner_payload: {
        ciphertext: JSON.stringify({
          app_namespace: 'coworker',
          collection_space: 'channel',
          schema_version: 1,
          record_id: 'ch-1',
          data: {
            title: 'Pete + wm21',
            participant_npubs: ['npub_owner', 'npub_wm21'],
          },
        }),
      },
      group_payloads: [
        { group_npub: 'gpub_abc', ciphertext: '{}', write: true },
      ],
    };

    const row = await inboundChannel(record);

    expect(row.record_id).toBe('ch-1');
    expect(row.owner_npub).toBe('npub_owner');
    expect(row.title).toBe('Pete + wm21');
    expect(row.group_ids).toEqual(['gpub_abc']);
    expect(row.participant_npubs).toContain('npub_owner');
    expect(row.participant_npubs).toContain('npub_wm21');
    expect(row.record_state).toBe('active');
    expect(row.version).toBe(2);
  });

  it('materializes a chat message record into a local row', async () => {
    const record = {
      record_id: 'msg-1',
      owner_npub: 'npub_owner',
      signature_npub: 'npub_owner',
      version: 1,
      updated_at: '2026-03-10T01:00:00Z',
      owner_payload: {
        ciphertext: JSON.stringify({
          app_namespace: 'coworker',
          collection_space: 'chat_message',
          schema_version: 1,
          record_id: 'msg-1',
          data: {
            channel_id: 'ch-1',
            parent_message_id: null,
            body: 'hello world',
            attachments: [{ kind: 'audio', audio_note_record_id: 'audio-1', title: 'Voice note' }],
          },
        }),
      },
      group_payloads: [],
    };

    const row = await inboundChatMessage(record);

    expect(row.record_id).toBe('msg-1');
    expect(row.channel_id).toBe('ch-1');
    expect(row.parent_message_id).toBeNull();
    expect(row.body).toBe('hello world');
    expect(row.attachments).toHaveLength(1);
    expect(row.sender_npub).toBe('npub_owner');
    expect(row.sync_status).toBe('synced');
    expect(row.record_state).toBe('active');
  });
});

describe('chat translator — outbound', () => {
  it('copies channel group_ids into the sync packet group_payloads', async () => {
    const envelope = await outboundChatMessage({
      record_id: 'msg-2',
      owner_npub: 'npub_owner',
      channel_id: 'ch-1',
      parent_message_id: null,
      body: 'hey bot',
      attachments: [{ kind: 'audio', audio_note_record_id: 'audio-1', title: 'Voice note' }],
      channel_group_ids: ['gpub_abc', 'gpub_def'],
    });

    expect(envelope.record_id).toBe('msg-2');
    expect(envelope.owner_npub).toBe('npub_owner');
    expect(envelope.record_family_hash).toBe(recordFamilyHash('chat_message'));
    expect(envelope.group_payloads).toHaveLength(2);
    expect(envelope.group_payloads[0].group_npub).toBe('gpub_abc');
    expect(envelope.group_payloads[1].group_npub).toBe('gpub_def');
    expect(envelope.group_payloads[0].write).toBe(true);

    // Verify inner payload is valid JSON
    const inner = JSON.parse(envelope.owner_payload.ciphertext);
    expect(inner.app_namespace).toBe(APP_NPUB);
    expect(inner.data.channel_id).toBe('ch-1');
    expect(inner.data.body).toBe('hey bot');
    expect(inner.data.attachments).toHaveLength(1);
  });

  it('preserves parent_message_id for thread replies', async () => {
    const envelope = await outboundChatMessage({
      record_id: 'msg-thread-1',
      owner_npub: 'npub_owner',
      channel_id: 'ch-1',
      parent_message_id: 'msg-parent',
      body: 'thread reply',
      channel_group_ids: ['gpub_abc'],
    });

    const inner = JSON.parse(envelope.owner_payload.ciphertext);
    expect(inner.data.parent_message_id).toBe('msg-parent');
  });

  it('builds a message update envelope for soft delete', async () => {
    const envelope = await outboundChatMessage({
      record_id: 'msg-delete',
      owner_npub: 'npub_owner',
      channel_id: 'ch-1',
      parent_message_id: 'msg-parent',
      body: 'remove me',
      channel_group_ids: ['gpub_abc'],
      version: 2,
      previous_version: 1,
      signature_npub: 'npub_other',
      record_state: 'deleted',
    });

    expect(envelope.version).toBe(2);
    expect(envelope.previous_version).toBe(1);
    expect(envelope.signature_npub).toBe('npub_other');

    const inner = JSON.parse(envelope.owner_payload.ciphertext);
    expect(inner.data.record_state).toBe('deleted');
  });

  it('builds a channel envelope with group_ids', async () => {
    const envelope = await outboundChannel({
      record_id: 'ch-2',
      owner_npub: 'npub_owner',
      title: 'Test channel',
      group_ids: ['gpub_xyz'],
      participant_npubs: ['npub_owner', 'npub_wm21'],
    });

    expect(envelope.record_id).toBe('ch-2');
    expect(envelope.record_family_hash).toBe(recordFamilyHash('channel'));
    expect(envelope.group_payloads).toHaveLength(1);
    expect(envelope.group_payloads[0].group_npub).toBe('gpub_xyz');
    const inner = JSON.parse(envelope.owner_payload.ciphertext);
    expect(inner.app_namespace).toBe(APP_NPUB);
    expect(inner.data.participant_npubs).toEqual(['npub_owner', 'npub_wm21']);
    expect(inner.data.record_state).toBe('active');
  });

  it('builds a channel update envelope for soft delete', async () => {
    const envelope = await outboundChannel({
      record_id: 'ch-delete',
      owner_npub: 'npub_owner',
      title: 'Delete me',
      group_ids: ['gpub_xyz'],
      participant_npubs: ['npub_owner', 'npub_wm21'],
      version: 2,
      previous_version: 1,
      record_state: 'deleted',
    });

    expect(envelope.version).toBe(2);
    expect(envelope.previous_version).toBe(1);

    const inner = JSON.parse(envelope.owner_payload.ciphertext);
    expect(inner.data.record_state).toBe('deleted');
  });
});
