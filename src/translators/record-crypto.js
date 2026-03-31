import { personalDecryptFromNpub, personalEncryptForNpub } from '../auth/nostr.js';
import {
  decryptPayloadForGroup,
  encryptPayloadForGroup,
  getActiveSessionNpub,
  getGroupKey,
  getLoadedGroupKeyDiagnostics,
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

function describeRecordGroupPayloads(record) {
  return (record.group_payloads || []).map((payload) => {
    const groupRef = payload?.group_id || payload?.group_npub || null;
    const keyVersion = Number.isInteger(payload?.group_epoch) ? payload.group_epoch : null;
    const anyLoadedKey = groupRef ? getGroupKey(groupRef) : null;
    const exactLoadedKey = groupRef && keyVersion != null ? getGroupKey(groupRef, { keyVersion }) : anyLoadedKey;
    return {
      group_ref: groupRef,
      group_id: payload?.group_id || null,
      group_npub: payload?.group_npub || null,
      group_epoch: keyVersion,
      has_any_loaded_key: Boolean(anyLoadedKey),
      has_exact_epoch_key: Boolean(exactLoadedKey),
      loaded_key_version: anyLoadedKey?.key_version ?? null,
      loaded_group_npub: anyLoadedKey?.group_npub ?? null,
      exact_key_version: exactLoadedKey?.key_version ?? null,
    };
  });
}

export async function encryptOwnerPayload(ownerNpub, payload) {
  return {
    ciphertext: await personalEncryptForNpub(ownerNpub, JSON.stringify(payload)),
  };
}

export function buildGroupPayloads(groupNpubs, payload, canWriteByGroup = null) {
  const plaintext = JSON.stringify(payload);
  const uniqueGroups = [...new Set((groupNpubs || []).map((value) => String(value || '').trim()).filter(Boolean))];
  const senderNpub = getActiveSessionNpub();
  if (!senderNpub) throw new Error('No active session available for group payload encryption.');

  return uniqueGroups.map((groupRef) => {
    const groupKey = getGroupKey(groupRef);
    if (!groupKey?.group_npub) {
      throw new Error(`No group key loaded for ${groupRef}`);
    }

    const ciphertext = encryptPayloadForGroup(groupRef, senderNpub, plaintext);
    if (typeof ciphertext !== 'string' || ciphertext.length === 0) {
      throw new Error(`Group encryption produced empty ciphertext for ${groupKey.group_npub}`);
    }

    return {
      group_id: groupKey.group_id || undefined,
      group_epoch: groupKey.key_version || undefined,
      group_npub: groupKey.group_npub,
      ciphertext: JSON.stringify({
        encrypted_by_npub: senderNpub,
        ciphertext,
      }),
      write: canWriteByGroup instanceof Map ? canWriteByGroup.get(groupRef) === true : true,
    };
  });
}

export async function decryptRecordPayload(record) {
  const ownerCiphertext = record.owner_payload?.ciphertext ?? record.owner_payload;
  const viewerNpub = getActiveSessionNpub();
  const errors = [];
  const payloadDiagnostics = describeRecordGroupPayloads(record);

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
    const groupRef = payload?.group_id || payload?.group_npub;
    const keyVersion = Number.isInteger(payload?.group_epoch) ? payload.group_epoch : null;
    if (!groupRef || !payload?.ciphertext) continue;
    if (!hasGroupKey(groupRef)) {
      errors.push(`group:${payload.group_npub || groupRef}:missing-loaded-key(ref=${groupRef},epoch=${keyVersion ?? 'none'})`);
      continue;
    }
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
          decrypted = decryptPayloadForGroup(groupRef, senderNpub, groupCiphertext, { keyVersion });
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
  const message = errors.length > 0
    ? `Unable to decrypt record ${record.record_id}: ${errors.join('; ')}`
    : `Unable to decrypt record ${record.record_id}: no matching group key`;
  const error = new Error(message);
  error.diagnostics = {
    record_id: record.record_id,
    owner_npub: record.owner_npub,
    signature_npub: record.signature_npub || null,
    viewer_npub: viewerNpub || null,
    group_payloads: payloadDiagnostics,
    loaded_group_keys: getLoadedGroupKeyDiagnostics(),
  };
  throw error;
}
