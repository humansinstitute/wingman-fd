import { buildScopeShares, normalizeGroupIds } from './scope-delivery.js';
import { rebuildAccessForScope, separateScopeShares } from './scope-move.js';

function identityResolveGroupId(groupRef) {
  const value = String(groupRef || '').trim();
  return value || null;
}

export function normalizeScopePolicyGroupIds(groupIds = [], resolveGroupId = identityResolveGroupId) {
  return normalizeGroupIds(groupIds)
    .map((groupId) => resolveGroupId(groupId))
    .filter(Boolean);
}

export function getRecordScopePolicyGroupIds(record = null, resolveGroupId = identityResolveGroupId) {
  return normalizeScopePolicyGroupIds(record?.scope_policy_group_ids || [], resolveGroupId);
}

export function sameScopePolicyGroupIds(left = [], right = [], resolveGroupId = identityResolveGroupId) {
  const a = normalizeScopePolicyGroupIds(left, resolveGroupId);
  const b = normalizeScopePolicyGroupIds(right, resolveGroupId);
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

export function shouldRefreshScopedPolicy(record, nextScopeGroupIds = [], options = {}) {
  const resolveGroupId = options.resolveGroupId || identityResolveGroupId;
  const allowLegacyGroupFallback = options.allowLegacyGroupFallback === true;
  const storedPolicyGroupIds = getRecordScopePolicyGroupIds(record, resolveGroupId);
  if (storedPolicyGroupIds.length > 0) {
    return !sameScopePolicyGroupIds(storedPolicyGroupIds, nextScopeGroupIds, resolveGroupId);
  }
  if (!allowLegacyGroupFallback) return false;

  const currentGroupIds = normalizeScopePolicyGroupIds(record?.group_ids || [], resolveGroupId);
  const nextPolicyGroupIds = normalizeScopePolicyGroupIds(nextScopeGroupIds, resolveGroupId);
  if (nextPolicyGroupIds.length === 0) return currentGroupIds.length > 0;
  return nextPolicyGroupIds.some((groupId) => !currentGroupIds.includes(groupId));
}

export function buildScopedPolicyRepairPatch({
  record,
  previousScopeGroupIds = [],
  nextScopeGroupIds = [],
  groups = [],
  resolveGroupId = identityResolveGroupId,
  includeBoardGroupId = false,
  fallbackPolicyGroupIds = [],
} = {}) {
  const nextPolicyGroupIds = normalizeScopePolicyGroupIds(nextScopeGroupIds, resolveGroupId);
  const storedPolicyGroupIds = getRecordScopePolicyGroupIds(record, resolveGroupId);
  const previousPolicyGroupIds = storedPolicyGroupIds.length > 0
    ? storedPolicyGroupIds
    : normalizeScopePolicyGroupIds(
      previousScopeGroupIds.length > 0 ? previousScopeGroupIds : fallbackPolicyGroupIds,
      resolveGroupId,
    );
  const existingShares = Array.isArray(record?.shares) && record.shares.length > 0
    ? record.shares
    : (previousPolicyGroupIds.length > 0 ? buildScopeShares(previousPolicyGroupIds, groups) : []);
  const { explicitShares } = separateScopeShares(existingShares, previousPolicyGroupIds);
  const rebuilt = rebuildAccessForScope(explicitShares, { group_ids: nextPolicyGroupIds }, groups);
  const groupIds = normalizeScopePolicyGroupIds(rebuilt.group_ids, resolveGroupId);
  const patch = {
    shares: rebuilt.shares,
    group_ids: groupIds,
    scope_policy_group_ids: nextPolicyGroupIds,
  };

  if (includeBoardGroupId) {
    const currentBoardGroupId = resolveGroupId(record?.board_group_id);
    patch.board_group_id = currentBoardGroupId && groupIds.includes(currentBoardGroupId)
      ? currentBoardGroupId
      : (nextPolicyGroupIds[0] || groupIds[0] || null);
  }

  return patch;
}
