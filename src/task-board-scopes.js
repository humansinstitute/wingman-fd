import { scopeBreadcrumb, scopeDepth, normalizeScopeLevel } from './translators/scopes.js';

function getTaskScopeRefs(task, scopesMap = new Map()) {
  const primaryScope = task?.scope_id ? scopesMap.get(task.scope_id) || null : null;
  const refs = {
    primaryScope,
    l1Id: task?.scope_l1_id || primaryScope?.l1_id || null,
    l2Id: task?.scope_l2_id || primaryScope?.l2_id || null,
    l3Id: task?.scope_l3_id || primaryScope?.l3_id || null,
    l4Id: task?.scope_l4_id || primaryScope?.l4_id || null,
    l5Id: task?.scope_l5_id || primaryScope?.l5_id || null,
  };
  if (primaryScope) {
    const depth = scopeDepth(primaryScope.level);
    if (depth >= 1 && depth <= 5) refs[`l${depth}Id`] = primaryScope.record_id;
  }
  return refs;
}

export function isTaskUnscoped(task, scopesMap = new Map()) {
  const refs = getTaskScopeRefs(task, scopesMap);
  return !refs.primaryScope && !refs.l1Id && !refs.l2Id && !refs.l3Id && !refs.l4Id && !refs.l5Id;
}

export function inferTaskScopeLevel(task, scopesMap = new Map()) {
  const scope = task?.scope_id ? scopesMap.get(task.scope_id) || null : null;
  if (scope?.level) {
    // Return the canonical level so callers get consistent values
    return normalizeScopeLevel(scope.level) || scope.level;
  }
  if (task?.scope_l5_id) return 'l5';
  if (task?.scope_l4_id) return 'l4';
  if (task?.scope_l3_id) return 'l3';
  if (task?.scope_l2_id) return 'l2';
  if (task?.scope_l1_id) return 'l1';
  return null;
}

export function getTaskBoardScopeLabel(scope, scopesMap = new Map()) {
  if (!scope?.record_id) return '';
  if (scopeDepth(scope.level) === 1) return scope.title || '';
  return scopeBreadcrumb(scope.record_id, scopesMap) || scope.title || '';
}

export function sortTaskBoardScopes(scopes = [], scopesMap = new Map()) {
  return [...(scopes || [])].sort((left, right) => {
    const levelDelta = (scopeDepth(left?.level) || 99) - (scopeDepth(right?.level) || 99);
    if (levelDelta !== 0) return levelDelta;
    return getTaskBoardScopeLabel(left, scopesMap).localeCompare(getTaskBoardScopeLabel(right, scopesMap));
  });
}

export function matchesTaskBoardScope(task, boardScope, scopesMap = new Map(), { includeDescendants = false } = {}) {
  if (!task || task.record_state === 'deleted' || !boardScope?.record_id) return false;
  const refs = getTaskScopeRefs(task, scopesMap);
  const boardDepth = scopeDepth(boardScope.level);
  if (boardDepth < 1) return false;

  // Check if the task's lineage at the board's depth matches the board scope
  const lineageKey = `l${boardDepth}Id`;
  if (refs[lineageKey] !== boardScope.record_id) return false;

  if (includeDescendants) return true;

  // Exact level match: task must be AT this depth, not deeper
  const taskLevel = inferTaskScopeLevel(task, scopesMap);
  return scopeDepth(taskLevel) === boardDepth;
}
