import {
  createGroupIdentity as createLocalIdentity,
  createNip98AuthHeaderForSecret,
  decodeNsec,
  personalEncryptForNpub,
  personalDecryptFromNpub,
  secretToPubkey,
  bytesToHex,
  localEncryptForNpub,
  localDecryptFromNpub,
} from '../auth/nostr.js';

let activeSessionNpub = null;
const groupKeysByNpub = new Map();
const groupKeysById = new Map();

export function setActiveSessionNpub(npub) {
  activeSessionNpub = npub || null;
}

export function getActiveSessionNpub() {
  return activeSessionNpub;
}

export function clearGroupKeyCache() {
  groupKeysByNpub.clear();
  groupKeysById.clear();
}

export function clearCryptoContext() {
  activeSessionNpub = null;
  clearGroupKeyCache();
}

export function createGroupIdentity() {
  return createLocalIdentity();
}

export async function buildWrappedMemberKeys(groupIdentity, memberNpubs, wrappedByNpub) {
  const uniqueMembers = [...new Set((memberNpubs || []).map((value) => String(value || '').trim()).filter(Boolean))];

  return Promise.all(uniqueMembers.map(async (member_npub) => ({
    member_npub,
    wrapped_group_nsec: await personalEncryptForNpub(member_npub, groupIdentity.nsec),
    wrapped_by_npub: wrappedByNpub,
  })));
}

function rememberGroupKey(groupEntry) {
  const secret = decodeNsec(groupEntry.nsec);
  const key = {
    group_id: groupEntry.group_id,
    group_npub: groupEntry.group_npub,
    name: groupEntry.name || '',
    key_version: groupEntry.key_version ?? 1,
    nsec: groupEntry.nsec,
    secret,
    secretHex: bytesToHex(secret),
    pubkeyHex: secretToPubkey(secret),
  };
  groupKeysByNpub.set(groupEntry.group_npub, key);
  if (groupEntry.group_id) {
    const keyring = groupKeysById.get(groupEntry.group_id) ?? new Map();
    keyring.set(key.key_version, key);
    groupKeysById.set(groupEntry.group_id, keyring);
  }
}

export async function bootstrapWrappedGroupKeys(entries = []) {
  clearGroupKeyCache();
  for (const entry of entries) {
    if (!entry?.group_npub || !entry?.wrapped_group_nsec) continue;
  }

  const failures = [];
  for (const entry of entries) {
    try {
      const nsec = await personalDecryptFromNpub(entry.wrapped_by_npub, entry.wrapped_group_nsec);
      rememberGroupKey({
        ...entry,
        nsec,
      });
    } catch (error) {
      failures.push({
        group_npub: entry.group_npub,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    loaded: groupKeysByNpub.size,
    failures,
  };
}

export function hasGroupKey(groupNpub) {
  return Boolean(getGroupKey(groupNpub));
}

export function getGroupKey(groupRef, options = {}) {
  const ref = String(groupRef || '').trim();
  if (!ref) return null;

  if (groupKeysByNpub.has(ref)) {
    return groupKeysByNpub.get(ref) ?? null;
  }

  const keyring = groupKeysById.get(ref);
  if (!keyring || keyring.size === 0) return null;

  const targetVersion = Number.isInteger(options.keyVersion) ? Number(options.keyVersion) : null;
  if (targetVersion != null && keyring.has(targetVersion)) {
    return keyring.get(targetVersion) ?? null;
  }

  let latest = null;
  for (const key of keyring.values()) {
    if (!latest || (key.key_version ?? 0) > (latest.key_version ?? 0)) latest = key;
  }
  return latest;
}

export async function createGroupWriteAuthHeader(groupRef, url, method, body = null) {
  const key = getGroupKey(groupRef);
  if (!key) throw new Error(`No group key loaded for ${groupRef}`);
  return createNip98AuthHeaderForSecret(url, method, body, key.secret);
}

export function decryptPayloadForGroup(groupRef, senderNpub, ciphertext, options = {}) {
  const key = getGroupKey(groupRef, options);
  if (!key) throw new Error(`No group key loaded for ${groupRef}`);
  return localDecryptFromNpub(key.secret, senderNpub, ciphertext);
}

export async function wrapKnownGroupKeyForMember(groupRef, memberNpub, wrappedByNpub, options = {}) {
  const key = getGroupKey(groupRef, options);
  if (!key) throw new Error(`No group key loaded for ${groupRef}`);
  return {
    member_npub: memberNpub,
    wrapped_group_nsec: await personalEncryptForNpub(memberNpub, key.nsec),
    wrapped_by_npub: wrappedByNpub,
  };
}
