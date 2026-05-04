import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/translators/record-crypto.js', () => ({
  decryptRecordPayload: vi.fn(async (record) => JSON.parse(record.owner_payload.ciphertext)),
  encryptOwnerPayload: vi.fn(async (_ownerNpub, payload) => ({ ciphertext: JSON.stringify(payload) })),
  buildGroupPayloads: vi.fn(async (groupNpubs, payload) =>
    groupNpubs.map((group_npub) => ({ group_npub, ciphertext: JSON.stringify(payload), write: true }))),
}));

import { APP_NPUB } from '../src/app-identity.js';
import { inboundReaction, outboundReaction, recordFamilyHash } from '../src/translators/reactions.js';

describe('reaction translator', () => {
  it('materializes inbound reaction records', async () => {
    const row = await inboundReaction({
      record_id: 'reaction-1',
      owner_npub: 'npub_owner',
      signature_npub: 'npub_signer',
      version: 2,
      created_at: '2026-04-30T00:00:00.000Z',
      updated_at: '2026-04-30T00:01:00.000Z',
      owner_payload: {
        ciphertext: JSON.stringify({
          data: {
            target_record_id: 'message-1',
            target_record_family_hash: `${APP_NPUB}:chat_message`,
            emoji: 'heart',
            emoji_shortcode: ':heart:',
            reactor_npub: 'npub_actor',
            record_state: 'active',
          },
        }),
      },
    });

    expect(row).toMatchObject({
      record_id: 'reaction-1',
      target_record_id: 'message-1',
      target_record_family_hash: `${APP_NPUB}:chat_message`,
      emoji: 'heart',
      emoji_shortcode: ':heart:',
      reactor_npub: 'npub_actor',
      sender_npub: 'npub_signer',
      record_state: 'active',
      version: 2,
    });
  });

  it('builds outbound reaction envelopes', async () => {
    const envelope = await outboundReaction({
      record_id: 'reaction-2',
      owner_npub: 'npub_owner',
      target_record_id: 'comment-1',
      target_record_family_hash: `${APP_NPUB}:comment`,
      emoji: 'thumbs_up',
      reactor_npub: 'npub_actor',
      target_group_ids: ['group-1'],
      signature_npub: 'npub_ws_key',
      version: 3,
      previous_version: 2,
      record_state: 'deleted',
    });

    expect(envelope.record_family_hash).toBe(`${APP_NPUB}:reaction`);
    expect(envelope.group_payloads).toHaveLength(1);
    expect(envelope.signature_npub).toBe('npub_ws_key');

    const payload = JSON.parse(envelope.owner_payload.ciphertext);
    expect(payload.collection_space).toBe('reaction');
    expect(payload.data).toMatchObject({
      target_record_id: 'comment-1',
      target_record_family_hash: `${APP_NPUB}:comment`,
      emoji: 'thumbs_up',
      emoji_shortcode: ':thumbs_up:',
      reactor_npub: 'npub_actor',
      record_state: 'deleted',
    });
  });

  it('rejects outbound reaction envelopes without target group ids', async () => {
    await expect(outboundReaction({
      record_id: 'reaction-no-groups',
      owner_npub: 'npub_owner',
      target_record_id: 'message-1',
      target_record_family_hash: `${APP_NPUB}:chat_message`,
      emoji: 'thumbs_up',
      reactor_npub: 'npub_actor',
      target_group_ids: [],
    })).rejects.toThrow(/target_group_ids are required/);

    await expect(outboundReaction({
      record_id: 'reaction-missing-groups',
      owner_npub: 'npub_owner',
      target_record_id: 'comment-1',
      target_record_family_hash: `${APP_NPUB}:comment`,
      emoji: 'heart',
      reactor_npub: 'npub_actor',
    })).rejects.toThrow(/target_group_ids are required/);
  });

  it('rejects unsupported target families and emoji tokens', async () => {
    await expect(inboundReaction({
      record_id: 'reaction-invalid-inbound',
      owner_npub: 'npub_owner',
      signature_npub: 'npub_signer',
      owner_payload: {
        ciphertext: JSON.stringify({
          data: {
            target_record_id: 'message-1',
            target_record_family_hash: `${APP_NPUB}:chat_message`,
            emoji: 'rocket',
            reactor_npub: 'npub_actor',
            record_state: 'active',
          },
        }),
      },
    })).rejects.toThrow(/Unsupported reaction emoji/);

    await expect(outboundReaction({
      record_id: 'reaction-3',
      owner_npub: 'npub_owner',
      target_record_id: 'task-1',
      target_record_family_hash: `${APP_NPUB}:task`,
      emoji: 'thumbs_up',
      reactor_npub: 'npub_actor',
    })).rejects.toThrow(/Unsupported reaction target family/);

    await expect(outboundReaction({
      record_id: 'reaction-4',
      owner_npub: 'npub_owner',
      target_record_id: 'message-1',
      target_record_family_hash: `${APP_NPUB}:chat_message`,
      emoji: 'rocket',
      reactor_npub: 'npub_actor',
    })).rejects.toThrow(/Unsupported reaction emoji/);
  });

  it('returns the reaction family hash', () => {
    expect(recordFamilyHash('reaction')).toBe(`${APP_NPUB}:reaction`);
  });
});
