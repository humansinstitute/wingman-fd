export function normalizeGroupIds(groupIds = []) {
  return [...new Set((groupIds || []).map((value) => String(value || '').trim()).filter(Boolean))];
}

export function deriveScopeHierarchy({ level = 'product', parentId = null, scopesMap = new Map() }) {
  const normalizedParentId = String(parentId || '').trim() || null;
  const parentScope = normalizedParentId ? scopesMap.get(normalizedParentId) || null : null;

  if (level === 'product') {
    return {
      parent_id: null,
      product_id: null,
      project_id: null,
    };
  }

  if (level === 'project') {
    return {
      parent_id: normalizedParentId,
      product_id: normalizedParentId || (parentScope?.level === 'product' ? parentScope.record_id : parentScope?.product_id ?? null),
      project_id: null,
    };
  }

  return {
    parent_id: normalizedParentId,
    product_id: parentScope?.level === 'product'
      ? parentScope.record_id
      : parentScope?.product_id ?? null,
    project_id: parentScope?.level === 'project'
      ? parentScope.record_id
      : parentScope?.project_id ?? normalizedParentId,
  };
}

export function defaultScopeGroupIds({
  level = 'product',
  parentId = null,
  scopesMap = new Map(),
  fallbackGroupId = null,
}) {
  if (level !== 'product' && parentId) {
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
      scope_product_id: null,
      scope_project_id: null,
      scope_deliverable_id: null,
    };
  }

  if (scope.level === 'product') {
    return {
      scope_id: scope.record_id,
      scope_product_id: scope.record_id,
      scope_project_id: null,
      scope_deliverable_id: null,
    };
  }

  if (scope.level === 'project') {
    return {
      scope_id: scope.record_id,
      scope_product_id: scope.product_id ?? scope.parent_id ?? null,
      scope_project_id: scope.record_id,
      scope_deliverable_id: null,
    };
  }

  return {
    scope_id: scope.record_id,
    scope_product_id: scope.product_id ?? null,
    scope_project_id: scope.project_id ?? scope.parent_id ?? null,
    scope_deliverable_id: scope.record_id,
  };
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
