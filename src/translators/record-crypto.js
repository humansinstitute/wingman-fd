import { personalDecryptFromNpub, personalEncryptForNpub } from '../auth/nostr.js';
import {
  decryptPayloadForGroup,
  getActiveSessionNpub,
  hasGroupKey,
} from '../crypto/group-keys.js';

function parsePayloadJson(raw) {
  if (typeof raw !== 'string') return raw;
  return JSON.parse(raw);
}

function parseCiphertextEnvelope(value) {
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    if (
      parsed
      && typeof parsed === 'object'
      && typeof parsed.ciphertext === 'string'
      && typeof parsed.encrypted_by_npub === 'string'
    ) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

export async function encryptOwnerPayload(ownerNpub, payload) {
  return {
    ciphertext: await personalEncryptForNpub(ownerNpub, JSON.stringify(payload)),
  };
}

export async function buildGroupPayloads(groupNpubs, payload, canWriteByGroup = null) {
  const plaintext = JSON.stringify(payload);
  const uniqueGroups = [...new Set((groupNpubs || []).map((value) => String(value || '').trim()).filter(Boolean))];
  const senderNpub = getActiveSessionNpub();
  if (!senderNpub) throw new Error('No active session available for group payload encryption.');

  return Promise.all(uniqueGroups.map(async (group_npub) => ({
    group_npub,
    ciphertext: JSON.stringify({
      encrypted_by_npub: senderNpub,
      ciphertext: await personalEncryptForNpub(group_npub, plaintext),
    }),
    write: canWriteByGroup instanceof Map ? canWriteByGroup.get(group_npub) === true : true,
  })));
}

export async function decryptRecordPayload(record) {
  const ownerCiphertext = record.owner_payload?.ciphertext ?? record.owner_payload;
  const viewerNpub = getActiveSessionNpub();
  const errors = [];

  if (viewerNpub && viewerNpub === record.owner_npub && ownerCiphertext) {
    try {
      let decrypted = ownerCiphertext;
      for (let depth = 0; depth < 4; depth++) {
        const ownerEnvelope = parseCiphertextEnvelope(decrypted);
        if (!ownerEnvelope) break;
        const ownerSender = ownerEnvelope.encrypted_by_npub || record.signature_npub || record.owner_npub;
        decrypted = await personalDecryptFromNpub(ownerSender, ownerEnvelope.ciphertext);
      }
      return parsePayloadJson(decrypted);
    } catch (error) {
      errors.push(`owner:${error instanceof Error ? error.message : String(error)}`);
    }
  }

  for (const payload of (record.group_payloads || [])) {
    if (!payload?.group_npub || !payload?.ciphertext || !hasGroupKey(payload.group_npub)) continue;
    try {
      const groupEnvelope = parseCiphertextEnvelope(payload.ciphertext);
      const groupCiphertext = groupEnvelope?.ciphertext || payload.ciphertext;
      const candidateSenders = groupEnvelope?.encrypted_by_npub
        ? [groupEnvelope.encrypted_by_npub]
        : [record.signature_npub, payload.group_npub].filter(Boolean);

      let decrypted = null;
      let lastError = null;
      for (const senderNpub of candidateSenders) {
        try {
          decrypted = decryptPayloadForGroup(payload.group_npub, senderNpub, groupCiphertext);
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (decrypted == null) throw lastError || new Error('group decrypt failed');
      return parsePayloadJson(decrypted);
    } catch (error) {
      errors.push(`group:${payload.group_npub}:${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(
    errors.length > 0
      ? `Unable to decrypt record ${record.record_id}: ${errors.join('; ')}`
      : `Unable to decrypt record ${record.record_id}: no matching group key`
  );
}
