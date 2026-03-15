/**
 * In-memory store for decrypted group secret keys.
 *
 * Keys are kept ONLY in memory — never persisted to IndexedDB or localStorage.
 * Cleared on logout or page unload.
 */

const _groupKeys = new Map();

export function setGroupKey(groupNpub, secretKeyBytes) {
  if (!(secretKeyBytes instanceof Uint8Array) || secretKeyBytes.length !== 32) {
    throw new Error('Group secret key must be 32-byte Uint8Array');
  }
  _groupKeys.set(groupNpub, secretKeyBytes);
}

export function getGroupKey(groupNpub) {
  return _groupKeys.get(groupNpub) ?? null;
}

export function hasGroupKey(groupNpub) {
  return _groupKeys.has(groupNpub);
}

export function clearGroupKeys() {
  _groupKeys.clear();
}

export function getAllGroupNpubs() {
  return [..._groupKeys.keys()];
}
