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
let lastBootstrapDiagnostics = {
  attempted: 0,
  loaded: 0,
  failures: [],
  loadedById: [],
  loadedByNpub: [],
};

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

/**
 * Export all loaded group keys as plain serializable objects.
 * Used to transfer decrypted key material to the Web Worker via postMessage.
 */
export function exportDecryptedKeys() {
  return Array.from(groupKeysByNpub.values()).map((key) => ({
    group_id: key.group_id,
    group_npub: key.group_npub,
    name: key.name || '',
    key_version: key.key_version ?? 1,
    nsec: key.nsec,
  }));
}

/**
 * Import pre-decrypted group keys (from the main thread).
 * Each entry must have { group_npub, nsec } at minimum.
 */
export function importDecryptedKeys(entries = []) {
  clearGroupKeyCache();
  for (const entry of entries) {
    if (!entry?.group_npub || !entry?.nsec) continue;
    rememberGroupKey(entry);
  }
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

function buildLoadedGroupKeyDiagnostics() {
  const loadedById = Array.from(groupKeysById.entries()).map(([group_id, keyring]) => {
    const keys = Array.from(keyring.values());
    return {
      group_id,
      key_versions: Array.from(new Set(keys.map((key) => key.key_version).filter(Number.isInteger))).sort((a, b) => a - b),
      group_npubs: Array.from(new Set(keys.map((key) => key.group_npub).filter(Boolean))),
      names: Array.from(new Set(keys.map((key) => key.name).filter(Boolean))),
    };
  });

  const loadedByNpub = Array.from(groupKeysByNpub.values()).map((key) => ({
    group_npub: key.group_npub,
    group_id: key.group_id || null,
    key_version: key.key_version ?? null,
    name: key.name || '',
  }));

  return { loadedById, loadedByNpub };
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
        group_id: entry.group_id || null,
        group_npub: entry.group_npub,
        key_version: entry.key_version ?? null,
        wrapped_by_npub: entry.wrapped_by_npub || null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const loadedDiagnostics = buildLoadedGroupKeyDiagnostics();
  lastBootstrapDiagnostics = {
    attempted: entries.length,
    loaded: groupKeysByNpub.size,
    failures,
    loadedById: loadedDiagnostics.loadedById,
    loadedByNpub: loadedDiagnostics.loadedByNpub,
  };

  return {
    attempted: entries.length,
    loaded: groupKeysByNpub.size,
    failures,
    loadedById: loadedDiagnostics.loadedById,
    loadedByNpub: loadedDiagnostics.loadedByNpub,
  };
}

export function getLoadedGroupKeyDiagnostics(options = {}) {
  const limit = Number.isInteger(options.limit) ? Math.max(options.limit, 1) : 50;
  const diagnostics = buildLoadedGroupKeyDiagnostics();
  return {
    active_session_npub: activeSessionNpub,
    loaded_count: groupKeysByNpub.size,
    loaded_by_id: diagnostics.loadedById.slice(0, limit),
    loaded_by_npub: diagnostics.loadedByNpub.slice(0, limit),
  };
}

export function getLastGroupKeyBootstrapDiagnostics(options = {}) {
  const limit = Number.isInteger(options.limit) ? Math.max(options.limit, 1) : 50;
  return {
    attempted: lastBootstrapDiagnostics.attempted,
    loaded: lastBootstrapDiagnostics.loaded,
    failures: (lastBootstrapDiagnostics.failures || []).slice(0, limit),
    loadedById: (lastBootstrapDiagnostics.loadedById || []).slice(0, limit),
    loadedByNpub: (lastBootstrapDiagnostics.loadedByNpub || []).slice(0, limit),
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

export function encryptPayloadForGroup(groupRef, senderNpub, plaintext, options = {}) {
  const key = getGroupKey(groupRef, options);
  if (!key) throw new Error(`No group key loaded for ${groupRef}`);
  return localEncryptForNpub(key.secret, senderNpub, plaintext);
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
