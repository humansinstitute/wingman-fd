import { scopeDepth } from './translators/scopes.js';

export function normalizeGroupIds(groupIds = []) {
  return [...new Set((groupIds || []).map((value) => String(value || '').trim()).filter(Boolean))];
}

export function deriveScopeHierarchy({ parentId = null, scopesMap = new Map() }) {
  const normalizedParentId = String(parentId || '').trim() || null;
  const parentScope = normalizedParentId ? scopesMap.get(normalizedParentId) || null : null;

  if (!parentScope) {
    // Root scope (l1)
    return {
      parent_id: null,
      level: 'l1',
      l1_id: null, l2_id: null, l3_id: null, l4_id: null, l5_id: null,
    };
  }

  const parentDepth = scopeDepth(parentScope.level);
  if (parentDepth < 1 || parentDepth >= 5) return null; // Can't nest deeper than l5

  const childLevel = `l${parentDepth + 1}`;
  const result = {
    parent_id: normalizedParentId,
    level: childLevel,
    l1_id: parentScope.l1_id ?? null,
    l2_id: parentScope.l2_id ?? null,
    l3_id: parentScope.l3_id ?? null,
    l4_id: parentScope.l4_id ?? null,
    l5_id: parentScope.l5_id ?? null,
  };
  if (parentDepth >= 1 && parentDepth <= 5) result[`l${parentDepth}_id`] = parentScope.record_id;
  return result;
}

export function defaultScopeGroupIds({
  level = 'l1',
  parentId = null,
  scopesMap = new Map(),
  fallbackGroupId = null,
}) {
  if (scopeDepth(level) > 1 && parentId) {
    const parentScope = scopesMap.get(parentId);
    const inherited = normalizeGroupIds(parentScope?.group_ids);
    if (inherited.length > 0) return inherited;
  }

  return normalizeGroupIds(fallbackGroupId ? [fallbackGroupId] : []);
}

export function buildScopeShares(groupIds = [], groups = []) {
  const byId = new Map();
  for (const group of groups || []) {
    const key = String(group?.group_id || group?.group_npub || '').trim();
    if (!key) continue;
    byId.set(key, group);
  }

  return normalizeGroupIds(groupIds).map((groupId) => ({
    type: 'group',
    key: `group:${groupId}`,
    access: 'write',
    label: byId.get(groupId)?.name || '',
    person_npub: null,
    group_npub: groupId,
    via_group_npub: null,
    inherited: false,
    inherited_from_directory_id: null,
  }));
}

export function buildScopeTags(scope) {
  if (!scope?.record_id) {
    return {
      scope_id: null,
      scope_l1_id: null, scope_l2_id: null, scope_l3_id: null, scope_l4_id: null, scope_l5_id: null,
    };
  }
  const depth = scopeDepth(scope.level);
  const result = {
    scope_id: scope.record_id,
    scope_l1_id: scope.l1_id ?? null,
    scope_l2_id: scope.l2_id ?? null,
    scope_l3_id: scope.l3_id ?? null,
    scope_l4_id: scope.l4_id ?? null,
    scope_l5_id: scope.l5_id ?? null,
  };
  if (depth >= 1 && depth <= 5) result[`scope_l${depth}_id`] = scope.record_id;
  return result;
}

export function buildScopeLineage(scope, scopesMap = new Map()) {
  const lineage = [];
  let current = scope;
  const seen = new Set();

  while (current?.record_id && !seen.has(current.record_id)) {
    lineage.unshift(current);
    seen.add(current.record_id);
    current = current.parent_id ? scopesMap.get(current.parent_id) || null : null;
  }

  return lineage;
}

export function findActiveDirectoryByScopeId(directories = [], scopeId) {
  const needle = String(scopeId || '').trim();
  if (!needle) return null;
  return (directories || []).find((directory) =>
    directory?.record_state !== 'deleted'
    && String(directory.scope_id || '').trim() === needle
  ) || null;
}

export function findActiveRootDirectoryByTitle(directories = [], title) {
  const needle = String(title || '').trim().toLowerCase();
  if (!needle) return null;
  return (directories || []).find((directory) =>
    directory?.record_state !== 'deleted'
    && !directory?.parent_directory_id
    && String(directory.title || '').trim().toLowerCase() === needle
  ) || null;
}
