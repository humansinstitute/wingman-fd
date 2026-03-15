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

export function setActiveSessionNpub(npub) {
  activeSessionNpub = npub || null;
}

export function getActiveSessionNpub() {
  return activeSessionNpub;
}

export function clearGroupKeyCache() {
  groupKeysByNpub.clear();
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
  groupKeysByNpub.set(groupEntry.group_npub, {
    group_id: groupEntry.group_id,
    group_npub: groupEntry.group_npub,
    name: groupEntry.name || '',
    key_version: groupEntry.key_version ?? 1,
    nsec: groupEntry.nsec,
    secret,
    secretHex: bytesToHex(secret),
    pubkeyHex: secretToPubkey(secret),
  });
}

export async function bootstrapWrappedGroupKeys(entries = []) {
  clearGroupKeyCache();

  const latestByGroup = new Map();
  for (const entry of entries) {
    if (!entry?.group_npub || !entry?.wrapped_group_nsec) continue;
    const existing = latestByGroup.get(entry.group_npub);
    if (!existing || (entry.key_version ?? 0) >= (existing.key_version ?? 0)) {
      latestByGroup.set(entry.group_npub, entry);
    }
  }

  const failures = [];
  for (const entry of latestByGroup.values()) {
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
  return groupKeysByNpub.has(groupNpub);
}

export function getGroupKey(groupNpub) {
  return groupKeysByNpub.get(groupNpub) ?? null;
}

export async function createGroupWriteAuthHeader(groupNpub, url, method, body = null) {
  const key = getGroupKey(groupNpub);
  if (!key) throw new Error(`No group key loaded for ${groupNpub}`);
  return createNip98AuthHeaderForSecret(url, method, body, key.secret);
}

export function decryptPayloadForGroup(groupNpub, senderNpub, ciphertext) {
  const key = getGroupKey(groupNpub);
  if (!key) throw new Error(`No group key loaded for ${groupNpub}`);
  return localDecryptFromNpub(key.secret, senderNpub, ciphertext);
}

export async function wrapKnownGroupKeyForMember(groupNpub, memberNpub, wrappedByNpub) {
  const key = getGroupKey(groupNpub);
  if (!key) throw new Error(`No group key loaded for ${groupNpub}`);
  return {
    member_npub: memberNpub,
    wrapped_group_nsec: await personalEncryptForNpub(memberNpub, key.nsec),
    wrapped_by_npub: wrappedByNpub,
  };
}
