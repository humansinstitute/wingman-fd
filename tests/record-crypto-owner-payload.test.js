import { afterEach, describe, expect, it } from 'vitest';
import { localEncryptForNpub } from '@nostr-superbased/core/client';
import {
  cacheGroupKey,
  clearCryptoContext,
  createGroupIdentity,
  setActiveSessionNpub,
} from '../src/crypto/group-keys.js';
import {
  clearActiveWorkspaceKey,
  generateWorkspaceSessionKey,
  setActiveWorkspaceKey,
} from '../src/crypto/workspace-keys.js';
import {
  buildGroupPayloads,
  decryptRecordPayload,
  encryptOwnerPayload,
} from '../src/translators/record-crypto.js';

function activateWorkspaceKey() {
  const key = generateWorkspaceSessionKey();
  setActiveWorkspaceKey({
    ...key,
    epoch: 7,
    workspaceOwnerNpub: 'npub1workspace-service',
    userNpub: 'npub1real-user',
  });
  return key;
}

describe('workspace-key owner payload crypto', () => {
  afterEach(() => {
    clearActiveWorkspaceKey();
    clearCryptoContext();
  });

  it('encrypts active workspace-key owner payloads with canonical library fields', async () => {
    const key = activateWorkspaceKey();
    setActiveSessionNpub('npub1real-user');

    const ownerPayload = await encryptOwnerPayload('npub1workspace-service', {
      data: { title: 'Canonical workspace payload' },
    });

    const envelope = JSON.parse(ownerPayload.ciphertext);
    expect(envelope).toMatchObject({
      encrypted_by_npub: key.npub,
      workspace_user_key_npub: key.npub,
      ws_key_npub: key.npub,
      workspace_user_key_epoch: 7,
      ws_key_epoch: 7,
    });

    await expect(decryptRecordPayload({
      record_id: 'rec-new-workspace-payload',
      owner_npub: 'npub1workspace-service',
      signature_npub: key.npub,
      owner_payload: ownerPayload,
      group_payloads: [],
    })).resolves.toEqual({
      data: { title: 'Canonical workspace payload' },
    });
  });

  it('keeps old workspace-key owner envelopes readable', async () => {
    const key = activateWorkspaceKey();
    const payload = { data: { title: 'Legacy workspace payload' } };
    const legacyOwnerPayload = {
      ciphertext: JSON.stringify({
        encrypted_by_npub: key.npub,
        ciphertext: localEncryptForNpub(key.secret, key.npub, JSON.stringify(payload)),
        ws_key_epoch: 7,
      }),
    };

    await expect(decryptRecordPayload({
      record_id: 'rec-old-workspace-payload',
      owner_npub: 'npub1workspace-service',
      signature_npub: key.npub,
      owner_payload: legacyOwnerPayload,
      group_payloads: [],
    })).resolves.toEqual(payload);
  });

  it('rejects partial group payload encryption when any delivery key is missing', () => {
    setActiveSessionNpub('npub1real-user');
    const identity = createGroupIdentity();
    cacheGroupKey({
      group_id: 'group-loaded',
      group_npub: identity.npub,
      nsec: identity.nsec,
    });

    expect(() => buildGroupPayloads(
      ['group-loaded', 'group-missing'],
      { data: { title: 'Strict delivery groups' } },
    )).toThrow(/Missing group keys for group-missing/);
  });

  it('does not require group crypto context for empty delivery groups', () => {
    expect(buildGroupPayloads([], { data: { record_state: 'deleted' } })).toEqual([]);
  });
});
