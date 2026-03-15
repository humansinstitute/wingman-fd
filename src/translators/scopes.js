import { APP_NPUB, recordFamilyNamespace } from '../app-identity.js';
import { buildGroupPayloads, decryptRecordPayload, encryptOwnerPayload } from './record-crypto.js';

export function recordFamilyHash(collectionSpace) {
  return `${recordFamilyNamespace()}:${collectionSpace}`;
}

// --- inbound ---

export async function inboundScope(record) {
  const payload = await decryptRecordPayload(record);
  const data = payload.data ?? payload;
  const groupIds = (record.group_payloads || []).map(gp => gp.group_npub);

  return {
    record_id:    record.record_id,
    owner_npub:   record.owner_npub,
    title:        data.title ?? '',
    description:  data.description ?? '',
    level:        data.level ?? 'product',
    parent_id:    data.parent_id ?? null,
    product_id:   data.product_id ?? null,
    project_id:   data.project_id ?? null,
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
  level = 'product',
  parent_id = null,
  product_id = null,
  project_id = null,
  group_ids = [],
  version = 1,
  previous_version = 0,
  signature_npub = owner_npub,
  write_group_npub = null,
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
      product_id,
      project_id,
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
    write_group_npub: write_group_npub || undefined,
    owner_payload: await encryptOwnerPayload(owner_npub, innerPayload),
    group_payloads: await buildGroupPayloads(group_ids || [], innerPayload),
  };
}

// --- helpers ---

export const SCOPE_LEVELS = ['product', 'project', 'deliverable'];

export function levelLabel(level) {
  if (!level) return '';
  return level.charAt(0).toUpperCase() + level.slice(1);
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

/**
 * Resolve the full scope chain for a scope_id.
 * Returns { scope_product_id, scope_project_id, scope_deliverable_id }.
 */
export function resolveScopeChain(scopeId, scopesMap) {
  const scope = scopesMap.get(scopeId);
  if (!scope) return { scope_product_id: null, scope_project_id: null, scope_deliverable_id: null };

  if (scope.level === 'product') {
    return { scope_product_id: scope.record_id, scope_project_id: null, scope_deliverable_id: null };
  }
  if (scope.level === 'project') {
    return { scope_product_id: scope.product_id || scope.parent_id, scope_project_id: scope.record_id, scope_deliverable_id: null };
  }
  // deliverable
  return {
    scope_product_id: scope.product_id,
    scope_project_id: scope.project_id || scope.parent_id,
    scope_deliverable_id: scope.record_id,
  };
}

/**
 * Fuzzy search scopes, grouped by level.
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
  const groups = { product: [], project: [], deliverable: [] };
  for (const s of scopes) {
    if (groups[s.level]) {
      const entry = { ...s };
      if (scopesMap && s.level !== 'product') {
        entry.breadcrumb = scopeBreadcrumb(s.record_id, scopesMap);
      }
      groups[s.level].push(entry);
    }
  }
  return groups;
}
