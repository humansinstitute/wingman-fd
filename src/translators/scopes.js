import { APP_NPUB, recordFamilyNamespace } from '../app-identity.js';
import { buildGroupPayloads, decryptRecordPayload, encryptOwnerPayload } from './record-crypto.js';
import { buildWriteGroupFields } from './group-refs.js';

export function recordFamilyHash(collectionSpace) {
  return `${recordFamilyNamespace()}:${collectionSpace}`;
}

// --- inbound ---

export async function inboundScope(record) {
  const payload = await decryptRecordPayload(record);
  const data = payload.data ?? payload;
  const groupIds = (record.group_payloads || []).map((gp) => gp.group_id || gp.group_npub);

  return {
    record_id:    record.record_id,
    owner_npub:   record.owner_npub,
    title:        data.title ?? '',
    description:  data.description ?? '',
    level:        normalizeScopeLevel(data.level) || 'l1',
    parent_id:    data.parent_id ?? null,
    l1_id:        data.l1_id ?? null,
    l2_id:        data.l2_id ?? null,
    l3_id:        data.l3_id ?? null,
    l4_id:        data.l4_id ?? null,
    l5_id:        data.l5_id ?? null,
    group_ids:    groupIds,
    sync_status:  'synced',
    record_state: data.record_state ?? 'active',
    version:      record.version ?? 1,
    created_at:   record.created_at ?? record.updated_at ?? new Date().toISOString(),
    updated_at:   record.updated_at ?? new Date().toISOString(),
  };
}

// --- outbound ---

export async function outboundScope({
  record_id,
  owner_npub,
  title,
  description = '',
  level = 'l1',
  parent_id = null,
  l1_id = null,
  l2_id = null,
  l3_id = null,
  l4_id = null,
  l5_id = null,
  group_ids = [],
  version = 1,
  previous_version = 0,
  signature_npub = owner_npub,
  write_group_ref = null,
  record_state = 'active',
}) {
  const innerPayload = {
    app_namespace: APP_NPUB,
    collection_space: 'scope',
    schema_version: 1,
    record_id,
    data: {
      title,
      description,
      level,
      parent_id,
      l1_id,
      l2_id,
      l3_id,
      l4_id,
      l5_id,
      record_state,
    },
  };

  return {
    record_id,
    owner_npub,
    record_family_hash: recordFamilyHash('scope'),
    version,
    previous_version,
    signature_npub,
    ...buildWriteGroupFields(write_group_ref),
    owner_payload: await encryptOwnerPayload(owner_npub, innerPayload),
    group_payloads: await buildGroupPayloads(group_ids || [], innerPayload),
  };
}

// --- helpers ---

/** Canonical scope levels (generic hierarchy). */
export const SCOPE_LEVELS = ['l1', 'l2', 'l3', 'l4', 'l5'];

/** Map legacy semantic names to canonical levels for read compatibility. */
export const LEGACY_LEVEL_MAP = {
  product: 'l1',
  project: 'l2',
  deliverable: 'l3',
};

const DEPTH_BY_LEVEL = { l1: 1, l2: 2, l3: 3, l4: 4, l5: 5 };

/**
 * Normalize any scope level (legacy or canonical) to the canonical l1-l5 form.
 * Returns null for unknown / falsy input.
 */
export function normalizeScopeLevel(level) {
  if (!level) return null;
  if (DEPTH_BY_LEVEL[level] !== undefined) return level;
  return LEGACY_LEVEL_MAP[level] ?? null;
}

/**
 * Return the numeric depth (1-5) for a scope level. Returns 0 for unknown.
 */
export function scopeDepth(level) {
  const canonical = normalizeScopeLevel(level);
  return canonical ? DEPTH_BY_LEVEL[canonical] : 0;
}

/**
 * Return the user-facing label for a scope level: "L1" through "L5".
 */
export function scopeLevelLabel(level) {
  const canonical = normalizeScopeLevel(level);
  if (!canonical) return '';
  return canonical.toUpperCase();
}

/**
 * Backward-compatible label helper. Now delegates to scopeLevelLabel.
 */
export function levelLabel(level) {
  return scopeLevelLabel(level);
}

/**
 * Build a breadcrumb string for a scope, e.g. "Wingman > Flight Deck > Doc Comments"
 */
export function scopeBreadcrumb(scopeId, scopesMap) {
  const parts = [];
  let current = scopesMap.get(scopeId);
  while (current) {
    parts.unshift(current.title);
    current = current.parent_id ? scopesMap.get(current.parent_id) : null;
  }
  return parts.join(' > ');
}

export function resolveScopeChain(scopeId, scopesMap) {
  const scope = scopesMap.get(scopeId);
  if (!scope) return { scope_l1_id: null, scope_l2_id: null, scope_l3_id: null, scope_l4_id: null, scope_l5_id: null };
  const depth = scopeDepth(scope.level);
  const result = {
    scope_l1_id: scope.l1_id ?? null,
    scope_l2_id: scope.l2_id ?? null,
    scope_l3_id: scope.l3_id ?? null,
    scope_l4_id: scope.l4_id ?? null,
    scope_l5_id: scope.l5_id ?? null,
  };
  if (depth >= 1 && depth <= 5) result[`scope_l${depth}_id`] = scope.record_id;
  return result;
}

/**
 * Fuzzy search scopes, grouped by canonical level (l1-l5).
 */
export function searchScopes(query, scopes, scopesMap) {
  const needle = (query || '').trim().toLowerCase();
  if (!needle) {
    return groupByLevel(scopes.filter(s => s.record_state !== 'deleted'));
  }

  const matches = scopes
    .filter(s => s.record_state !== 'deleted')
    .filter(s => s.title.toLowerCase().includes(needle) || (s.description || '').toLowerCase().includes(needle));

  return groupByLevel(matches, scopesMap);
}

function groupByLevel(scopes, scopesMap) {
  const groups = { l1: [], l2: [], l3: [], l4: [], l5: [] };
  for (const s of scopes) {
    const canonical = normalizeScopeLevel(s.level);
    if (canonical && groups[canonical]) {
      const entry = { ...s };
      if (scopesMap && scopeDepth(s.level) > 1) {
        entry.breadcrumb = scopeBreadcrumb(s.record_id, scopesMap);
      }
      groups[canonical].push(entry);
    }
  }
  return groups;
}
