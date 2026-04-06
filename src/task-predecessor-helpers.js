import { inferTaskScopeLevel } from './task-board-scopes.js';
import { scopeDepth } from './translators/scopes.js';

const SCOPE_KEYS = ['scope_l1_id', 'scope_l2_id', 'scope_l3_id', 'scope_l4_id', 'scope_l5_id'];

function getLineageIds(task, scopesMap = new Map()) {
  const ids = {
    l1: task?.scope_l1_id ?? null,
    l2: task?.scope_l2_id ?? null,
    l3: task?.scope_l3_id ?? null,
    l4: task?.scope_l4_id ?? null,
    l5: task?.scope_l5_id ?? null,
  };

  const primaryScope = task?.scope_id ? (scopesMap.get(task.scope_id) || null) : null;
  if (primaryScope) {
    if (primaryScope.l1_id) ids.l1 = primaryScope.l1_id;
    if (primaryScope.l2_id) ids.l2 = primaryScope.l2_id;
    if (primaryScope.l3_id) ids.l3 = primaryScope.l3_id;
    if (primaryScope.l4_id) ids.l4 = primaryScope.l4_id;
    if (primaryScope.l5_id) ids.l5 = primaryScope.l5_id;
    const depth = scopeDepth(primaryScope.level);
    if (depth >= 1 && depth <= 5) ids[`l${depth}`] = primaryScope.record_id;
  }

  return ids;
}

export function getTaskScopeLineage(task, scopesMap = new Map()) {
  const level = inferTaskScopeLevel(task, scopesMap);
  const ids = getLineageIds(task, scopesMap);
  const deepestTaggedDepth = SCOPE_KEYS.reduce((maxDepth, key, index) => (
    ids[`l${index + 1}`] ? index + 1 : maxDepth
  ), 0);
  const depth = scopeDepth(level) || deepestTaggedDepth;
  const primaryScopeId = task?.scope_id
    || (depth > 0 ? ids[`l${depth}`] : null)
    || null;
  return {
    level,
    depth,
    primaryScopeId,
    ids,
  };
}

export function isTaskInSameScopeTree(baseTask, candidateTask, scopesMap = new Map()) {
  const base = getTaskScopeLineage(baseTask, scopesMap);
  const candidate = getTaskScopeLineage(candidateTask, scopesMap);

  if (base.depth === 0 || candidate.depth === 0) {
    return base.depth === 0 && candidate.depth === 0;
  }

  const compareDepth = Math.min(base.depth, candidate.depth);
  for (let depth = 1; depth <= compareDepth; depth += 1) {
    const baseId = base.ids[`l${depth}`];
    const candidateId = candidate.ids[`l${depth}`];
    if (!baseId || !candidateId || baseId !== candidateId) return false;
  }
  return compareDepth > 0;
}

function normalizeSearchText(task = {}, scopeLabel = '') {
  return [
    task.title,
    task.record_id,
    task.tags,
    scopeLabel,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function queryScore(text, query) {
  if (!query) return 0;
  if (text.startsWith(query)) return 80;
  if (text.includes(query)) return 35;
  return -Infinity;
}

export function rankPredecessorCandidate(baseTask, candidateTask, scopesMap = new Map(), { query = '', scopeLabel = '' } = {}) {
  if (!baseTask || !candidateTask) return Number.NEGATIVE_INFINITY;

  const base = getTaskScopeLineage(baseTask, scopesMap);
  const candidate = getTaskScopeLineage(candidateTask, scopesMap);
  const sameTree = isTaskInSameScopeTree(baseTask, candidateTask, scopesMap);
  const normalizedQuery = String(query || '').trim().toLowerCase();
  const searchText = normalizeSearchText(candidateTask, scopeLabel);
  const queryBoost = queryScore(searchText, normalizedQuery);
  if (queryBoost === Number.NEGATIVE_INFINITY) return Number.NEGATIVE_INFINITY;

  let score = queryBoost;
  if (sameTree) score += 400;

  const sameDepth = base.depth > 0 && base.depth === candidate.depth;
  if (sameDepth) score += 160;

  const sameScope = base.primaryScopeId && candidate.primaryScopeId && base.primaryScopeId === candidate.primaryScopeId;
  if (sameScope) score += 120;

  if (sameTree) {
    score += Math.max(0, 40 - (Math.abs(base.depth - candidate.depth) * 10));
    if (candidate.depth < base.depth) score += 15;
    if (candidate.depth > base.depth) score += 5;
  }

  if ((candidateTask.state || '') !== 'done' && (candidateTask.state || '') !== 'archive') score += 10;

  return score;
}

export function buildPredecessorTaskSuggestions(tasks = [], baseTask = null, scopesMap = new Map(), options = {}) {
  if (!baseTask) return [];
  const excludedIds = new Set((options.excludedIds || []).filter(Boolean));
  const normalizedQuery = String(options.query || '').trim().toLowerCase();

  return (tasks || [])
    .filter((task) => task && task.record_state !== 'deleted')
    .filter((task) => task.record_id !== baseTask.record_id)
    .filter((task) => !excludedIds.has(task.record_id))
    .map((task) => {
      const score = rankPredecessorCandidate(baseTask, task, scopesMap, {
        query: normalizedQuery,
        scopeLabel: options.scopeLabelForTask ? options.scopeLabelForTask(task) : '',
      });
      return { task, score };
    })
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      const updatedDelta = new Date(right.task.updated_at || 0).getTime() - new Date(left.task.updated_at || 0).getTime();
      if (updatedDelta !== 0) return updatedDelta;
      return String(left.task.title || '').localeCompare(String(right.task.title || ''));
    })
    .map((entry) => entry.task);
}

export function normalizePredecessorTaskIds(taskIds = [], taskId = null) {
  const seen = new Set();
  const normalized = [];
  const currentTaskId = String(taskId || '').trim();

  for (const candidate of (Array.isArray(taskIds) ? taskIds : [])) {
    const recordId = String(candidate || '').trim();
    if (!recordId || recordId === currentTaskId || seen.has(recordId)) continue;
    seen.add(recordId);
    normalized.push(recordId);
  }

  return normalized;
}

export function describePredecessorRelationship(baseTask, candidateTask, scopesMap = new Map()) {
  const base = getTaskScopeLineage(baseTask, scopesMap);
  const candidate = getTaskScopeLineage(candidateTask, scopesMap);
  if (base.depth === 0 && candidate.depth === 0) return 'Unscoped';
  if (!isTaskInSameScopeTree(baseTask, candidateTask, scopesMap)) return 'Other scope';
  if (base.depth === candidate.depth) return 'Same level';
  if (candidate.depth < base.depth) return 'Higher level';
  return 'Lower level';
}

export function getTaskPredecessorReferenceRows(task, tasks = []) {
  const taskMap = new Map((tasks || []).map((item) => [item.record_id, item]));
  return normalizePredecessorTaskIds(task?.predecessor_task_ids || [], task?.record_id).map((recordId) => {
    const linkedTask = taskMap.get(recordId);
    if (linkedTask) return linkedTask;
    return {
      record_id: recordId,
      title: recordId,
      missing_predecessor: true,
      record_state: 'deleted',
    };
  });
}
