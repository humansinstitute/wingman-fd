import { scopeBreadcrumb } from './translators/scopes.js';

const LEVEL_ORDER = {
  product: 0,
  project: 1,
  deliverable: 2,
};

function getTaskScope(scopeRef, scopesMap = new Map()) {
  if (!scopeRef) return null;
  return scopesMap.get(scopeRef) || null;
}

function getTaskScopeRefs(task, scopesMap = new Map()) {
  const scopedDeliverable = getTaskScope(task?.scope_deliverable_id, scopesMap);
  const scopedProject = getTaskScope(task?.scope_project_id, scopesMap);
  const scopedProduct = getTaskScope(task?.scope_product_id, scopesMap);
  const primaryScope = getTaskScope(task?.scope_id, scopesMap);

  if (primaryScope?.level === 'deliverable') {
    return {
      productId: task?.scope_product_id || primaryScope.product_id || null,
      projectId: task?.scope_project_id || primaryScope.project_id || primaryScope.parent_id || null,
      deliverableId: task?.scope_deliverable_id || primaryScope.record_id,
      primaryScope,
    };
  }

  if (primaryScope?.level === 'project') {
    return {
      productId: task?.scope_product_id || primaryScope.product_id || primaryScope.parent_id || null,
      projectId: task?.scope_project_id || primaryScope.record_id,
      deliverableId: task?.scope_deliverable_id || null,
      primaryScope,
    };
  }

  if (primaryScope?.level === 'product') {
    return {
      productId: task?.scope_product_id || primaryScope.record_id,
      projectId: task?.scope_project_id || null,
      deliverableId: task?.scope_deliverable_id || null,
      primaryScope,
    };
  }

  return {
    productId: task?.scope_product_id || scopedDeliverable?.product_id || scopedProject?.product_id || scopedProject?.parent_id || scopedProduct?.record_id || null,
    projectId: task?.scope_project_id || scopedDeliverable?.project_id || scopedDeliverable?.parent_id || scopedProject?.record_id || null,
    deliverableId: task?.scope_deliverable_id || scopedDeliverable?.record_id || null,
    primaryScope,
  };
}

export function isTaskUnscoped(task, scopesMap = new Map()) {
  const refs = getTaskScopeRefs(task, scopesMap);
  return !refs.primaryScope && !refs.productId && !refs.projectId && !refs.deliverableId;
}

export function inferTaskScopeLevel(task, scopesMap = new Map()) {
  const scope = task?.scope_id ? scopesMap.get(task.scope_id) || null : null;
  if (scope?.level) return scope.level;
  if (task?.scope_deliverable_id) return 'deliverable';
  if (task?.scope_project_id) return 'project';
  if (task?.scope_product_id) return 'product';
  return null;
}

export function getTaskBoardScopeLabel(scope, scopesMap = new Map()) {
  if (!scope?.record_id) return '';
  if (scope.level === 'product') return scope.title || '';
  return scopeBreadcrumb(scope.record_id, scopesMap) || scope.title || '';
}

export function sortTaskBoardScopes(scopes = [], scopesMap = new Map()) {
  return [...(scopes || [])].sort((left, right) => {
    const levelDelta = (LEVEL_ORDER[left?.level] ?? 99) - (LEVEL_ORDER[right?.level] ?? 99);
    if (levelDelta !== 0) return levelDelta;
    return getTaskBoardScopeLabel(left, scopesMap).localeCompare(getTaskBoardScopeLabel(right, scopesMap));
  });
}

export function matchesTaskBoardScope(task, boardScope, scopesMap = new Map(), { includeDescendants = false } = {}) {
  if (!task || task.record_state === 'deleted' || !boardScope?.record_id) return false;
  const refs = getTaskScopeRefs(task, scopesMap);

  if (boardScope.level === 'deliverable') {
    return String(refs.deliverableId || '') === String(boardScope.record_id);
  }

  if (boardScope.level === 'project') {
    if (String(refs.projectId || '') !== String(boardScope.record_id)) return false;
    if (includeDescendants) return true;
    return inferTaskScopeLevel(task, scopesMap) === 'project';
  }

  if (String(refs.productId || '') !== String(boardScope.record_id)) return false;
  if (includeDescendants) return true;
  return inferTaskScopeLevel(task, scopesMap) !== 'deliverable';
}
