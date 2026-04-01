export function looksLikeUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

export function buildWriteGroupFields(writeGroupRef) {
  const normalized = String(writeGroupRef || '').trim();
  if (!normalized) return {};

  if (looksLikeUuid(normalized)) {
    return { write_group_id: normalized };
  }

  return { write_group_npub: normalized };
}

/**
 * Build a map from any group ref (npub or UUID) to the stable group_id.
 * group_payloads carry both group_id (stable UUID) and group_npub (rotating).
 * This map resolves either form to the canonical UUID.
 */
export function buildGroupRefMap(groupPayloads) {
  const map = new Map();
  if (!Array.isArray(groupPayloads)) return map;
  for (const payload of groupPayloads) {
    const stableId = payload?.group_id || payload?.group_npub || null;
    if (!stableId) continue;
    if (payload?.group_npub) map.set(payload.group_npub, stableId);
    if (payload?.group_id) map.set(payload.group_id, payload.group_id);
  }
  return map;
}

/**
 * Resolve a single group ref (npub or UUID) to the stable UUID via the ref map.
 * Returns null for empty/falsy input. Unknown refs pass through unchanged.
 */
export function normalizeGroupRef(groupRef, groupRefMap) {
  const value = String(groupRef || '').trim();
  if (!value) return null;
  return groupRefMap.get(value) || value;
}

/**
 * Extract deduplicated stable group_ids from group_payloads.
 * Prefers group_id, falls back to group_npub.
 */
export function extractGroupIds(groupPayloads) {
  if (!Array.isArray(groupPayloads)) return [];
  const seen = new Set();
  const ids = [];
  for (const payload of groupPayloads) {
    const id = payload?.group_id || payload?.group_npub;
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

/**
 * Normalize share objects so group refs prefer stable UUIDs.
 * When dataShares is empty, synthesizes shares from group_payloads.
 *
 * Output shares always include:
 *   - group_id: stable UUID (canonical ref)
 *   - group_npub: kept for backward compat (may equal group_id)
 *   - via_group_id: stable UUID for via ref
 */
export function normalizeShareGroupRefs(dataShares = [], groupPayloads = []) {
  const groupRefMap = buildGroupRefMap(groupPayloads);

  if (Array.isArray(dataShares) && dataShares.length > 0) {
    return dataShares.map((share) => {
      const type = share?.type === 'person' ? 'person' : 'group';
      const groupRef = normalizeGroupRef(share?.group_id || share?.group_npub, groupRefMap);
      const viaGroupRef = normalizeGroupRef(share?.via_group_id || share?.via_group_npub, groupRefMap);
      const key = share?.key
        ?? (type === 'person' ? share?.person_npub : groupRef);

      return {
        type,
        key,
        access: share?.access === 'write' ? 'write' : 'read',
        label: share?.label ?? '',
        person_npub: share?.person_npub ?? null,
        group_id: groupRef,
        group_npub: groupRef,
        via_group_id: viaGroupRef,
        via_group_npub: viaGroupRef,
        inherited: share?.inherited === true,
        inherited_from_directory_id: share?.inherited_from_directory_id ?? null,
      };
    });
  }

  // Synthesize from group_payloads when no explicit shares exist
  return groupPayloads.map((payload) => {
    const groupRef = payload?.group_id || payload?.group_npub;
    return {
      type: 'group',
      key: groupRef,
      access: payload?.write ? 'write' : 'read',
      label: '',
      person_npub: null,
      group_id: groupRef,
      group_npub: groupRef,
      via_group_id: null,
      via_group_npub: null,
      inherited: false,
      inherited_from_directory_id: null,
    };
  });
}
