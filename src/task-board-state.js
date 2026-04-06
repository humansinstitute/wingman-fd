/**
 * Task board computed state and filtering extracted from app.js.
 *
 * Pure utility functions are exported individually for direct testing.
 * The taskBoardStateMixin object contains methods that use `this` (the Alpine store)
 * and should be spread into the store definition.
 */

import {
  computeParentState,
  stateColor,
  formatStateLabel,
  parseTags as parseTaskTags,
} from './translators/tasks.js';
import {
  resolveScopeChain,
  levelLabel,
  scopeDepth,
} from './translators/scopes.js';
import {
  buildScopeTags,
  normalizeGroupIds,
} from './scope-delivery.js';
import {
  separateScopeShares,
  rebuildAccessForScope,
  mergeShareLists,
} from './scope-move.js';
import {
  getTaskBoardScopeLabel,
  isTaskUnscoped,
  matchesTaskBoardScope,
  sortTaskBoardScopes,
} from './task-board-scopes.js';
import {
  buildTaskCalendar,
} from './task-calendar.js';
import { toRaw } from './utils/state-helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shallow-compare two arrays of primitives or share objects (avoids JSON.stringify). */
function sameShallowArray(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      // For object entries (shares), compare by stringified key fields only
      if (typeof a[i] === 'object' && typeof b[i] === 'object') {
        const ak = a[i], bk = b[i];
        if ((ak?.group_npub ?? null) !== (bk?.group_npub ?? null)
          || (ak?.via_group_npub ?? null) !== (bk?.via_group_npub ?? null)) return false;
      } else {
        return false;
      }
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const TASK_BOARD_STORAGE_KEY_SUFFIX = 'last-task-board-id';
/** @deprecated Use namespacedBoardKey() instead */
export const TASK_BOARD_STORAGE_KEY = 'coworker:last-task-board-id';

function namespacedBoardKey(slug) {
  return slug
    ? `coworker:${slug}:${TASK_BOARD_STORAGE_KEY_SUFFIX}`
    : TASK_BOARD_STORAGE_KEY;
}

export const UNSCOPED_TASK_BOARD_ID = '__unscoped__';
export const RECENT_TASK_BOARD_ID = '__recent__';
export const ALL_TASK_BOARD_ID = '__all__';
export const WEEKDAY_OPTIONS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const EMPTY_ARRAY = Object.freeze([]);
const scopesMapCache = new WeakMap();
const taskGraphCache = new WeakMap();
const taskBoardDerivedCache = new WeakMap();

function chooseTaskRecord(current, candidate) {
  const currentVersion = Number(current?.version ?? 0);
  const candidateVersion = Number(candidate?.version ?? 0);
  if (candidateVersion !== currentVersion) {
    return candidateVersion > currentVersion ? candidate : current;
  }
  const currentUpdatedAt = String(current?.updated_at || '');
  const candidateUpdatedAt = String(candidate?.updated_at || '');
  if (candidateUpdatedAt !== currentUpdatedAt) {
    return candidateUpdatedAt > currentUpdatedAt ? candidate : current;
  }
  return current;
}

export function dedupeTasksByRecordId(tasks = []) {
  if (!Array.isArray(tasks) || tasks.length <= 1) return Array.isArray(tasks) ? tasks : [];
  const deduped = [];
  const indexByRecordId = new Map();
  for (const task of tasks) {
    const recordId = String(task?.record_id || '').trim();
    if (!recordId) {
      deduped.push(task);
      continue;
    }
    const existingIndex = indexByRecordId.get(recordId);
    if (existingIndex === undefined) {
      indexByRecordId.set(recordId, deduped.length);
      deduped.push(task);
      continue;
    }
    deduped[existingIndex] = chooseTaskRecord(deduped[existingIndex], task);
  }
  return deduped;
}

// ---------------------------------------------------------------------------
// Pure utility functions (no `this` dependency)
// ---------------------------------------------------------------------------

function getCachedScopesMap(store) {
  const scopes = Array.isArray(store?.scopes) ? store.scopes : EMPTY_ARRAY;
  let cached = scopesMapCache.get(scopes);
  if (cached) return cached;
  cached = new Map();
  for (const scope of scopes) cached.set(scope.record_id, scope);
  scopesMapCache.set(scopes, cached);
  return cached;
}

function getTaskGraph(store) {
  const tasks = Array.isArray(store?.tasks) ? store.tasks : EMPTY_ARRAY;
  let cached = taskGraphCache.get(tasks);
  if (cached) return cached;

  const parentIds = new Set();
  const subtasksByParent = new Map();
  for (const task of tasks) {
    if (task?.record_state === 'deleted' || !task?.parent_task_id) continue;
    parentIds.add(task.parent_task_id);
    const subtasks = subtasksByParent.get(task.parent_task_id);
    if (subtasks) subtasks.push(task);
    else subtasksByParent.set(task.parent_task_id, [task]);
  }

  const parentStateByParent = new Map();
  for (const [parentId, subtasks] of subtasksByParent.entries()) {
    parentStateByParent.set(parentId, computeParentState(subtasks));
  }

  cached = {
    parentIds,
    subtasksByParent,
    parentStateByParent,
  };
  taskGraphCache.set(tasks, cached);
  return cached;
}

function getDerivedSelectedBoardScope(store, scopesMap) {
  const selectedBoardId = store?.selectedBoardId;
  if (!selectedBoardId
    || selectedBoardId === ALL_TASK_BOARD_ID
    || selectedBoardId === RECENT_TASK_BOARD_ID
    || selectedBoardId === UNSCOPED_TASK_BOARD_ID) {
    return null;
  }
  return scopesMap.get(selectedBoardId) || null;
}

function getTaskBoardDerived(store) {
  const tasks = Array.isArray(store?.tasks) ? store.tasks : EMPTY_ARRAY;
  const scopes = Array.isArray(store?.scopes) ? store.scopes : EMPTY_ARRAY;
  const taskFilterTags = Array.isArray(store?.taskFilterTags) ? store.taskFilterTags : EMPTY_ARRAY;
  const scopesMap = getCachedScopesMap(store);
  const selectedBoardId = store?.selectedBoardId ?? null;
  const selectedBoardScope = getDerivedSelectedBoardScope(store, scopesMap);

  const previous = taskBoardDerivedCache.get(store);
  if (previous
    && previous.tasks === tasks
    && previous.scopes === scopes
    && previous.selectedBoardId === selectedBoardId
    && previous.showBoardDescendantTasks === store?.showBoardDescendantTasks
    && previous.taskFilter === store?.taskFilter
    && previous.taskFilterTags === taskFilterTags
    && previous.taskFilterAssignee === store?.taskFilterAssignee) {
    return previous.value;
  }

  const graph = getTaskGraph(store);
  const normalizedSelectedBoardId = selectedBoardId === UNSCOPED_TASK_BOARD_ID
    ? UNSCOPED_TASK_BOARD_ID
    : selectedBoardId;
  const boardScopedTasks = computeBoardScopedTasks(
    tasks,
    normalizedSelectedBoardId,
    selectedBoardScope,
    scopesMap,
    Boolean(store?.showBoardDescendantTasks),
  );
  const filteredTasks = computeFilteredTasks(
    boardScopedTasks,
    store?.taskFilter,
    taskFilterTags,
    store?.taskFilterAssignee,
  );
  const activeTasks = filteredTasks.filter((task) =>
    task.state !== 'done' && task.state !== 'archive' && !graph.parentIds.has(task.record_id)
  );
  const doneTasks = filteredTasks.filter((task) =>
    task.state === 'done' && !graph.parentIds.has(task.record_id)
  );
  const summaryTasks = filteredTasks.filter((task) =>
    task.state !== 'archive' && graph.parentIds.has(task.record_id)
  );
  const boardColumns = computeBoardColumns(activeTasks, doneTasks, summaryTasks);
  const listGroupedTasks = boardColumns.filter((column) => column.tasks.length > 0);

  let visibleBoardTasks = boardScopedTasks.filter((task) => task.state !== 'archive');
  const query = String(store?.taskFilter || '').trim().toLowerCase();
  if (query) {
    visibleBoardTasks = visibleBoardTasks.filter((task) =>
      String(task.title || '').toLowerCase().includes(query)
      || String(task.description || '').toLowerCase().includes(query)
      || String(task.tags || '').toLowerCase().includes(query)
    );
  }

  const allTaskTagsSet = new Set();
  for (const task of visibleBoardTasks) {
    for (const tag of parseTaskTags(task.tags)) allTaskTagsSet.add(tag);
  }

  const calendarScheduledTasks = filteredTasks.filter((task) =>
    task.record_state !== 'deleted'
    && task.state !== 'archive'
    && !graph.parentIds.has(task.record_id)
    && Boolean(task.scheduled_for)
  );

  const value = {
    boardScopedTasks,
    filteredTasks,
    activeTasks,
    doneTasks,
    summaryTasks,
    boardColumns,
    listGroupedTasks,
    visibleBoardTasks,
    allTaskTags: [...allTaskTagsSet].sort(),
    calendarScheduledTasks,
  };

  taskBoardDerivedCache.set(store, {
    tasks,
    scopes,
    selectedBoardId,
    showBoardDescendantTasks: store?.showBoardDescendantTasks,
    taskFilter: store?.taskFilter,
    taskFilterTags,
    taskFilterAssignee: store?.taskFilterAssignee,
    value,
  });

  return value;
}

export function resolveGroupId(groupRef, groups) {
  const value = String(groupRef || '').trim();
  if (!value) return null;
  const group = groups.find((item) => item.group_id === value || item.group_npub === value);
  return group?.group_id || group?.group_npub || value;
}

export function getScopeAncestorPath(scopeId, scopesMap) {
  const parts = [];
  let current = scopeId ? scopesMap.get(scopeId) || null : null;
  current = current?.parent_id ? scopesMap.get(current.parent_id) || null : null;
  while (current) {
    parts.unshift(current.title);
    current = current.parent_id ? scopesMap.get(current.parent_id) || null : null;
  }
  return parts.length > 0 ? `${parts.join(' > ')} >` : '';
}

export function formatTaskBoardScopeDisplay(scope, scopesMap) {
  if (!scope?.record_id) return '';
  const title = String(scope.title || '').trim() || 'Untitled scope';
  const level = levelLabel(scope.level) || 'Scope';
  const ancestorPath = getScopeAncestorPath(scope.record_id, scopesMap);
  return ancestorPath ? `${title} (${level}): ${ancestorPath}` : `${title} (${level})`;
}

export function formatFocusedScopeMeta(scope, scopesMap) {
  if (!scope?.record_id) return '';
  const level = levelLabel(scope.level) || 'Scope';
  const ancestorPath = getScopeAncestorPath(scope.record_id, scopesMap).replace(/\s*>\s*$/, '');
  return ancestorPath ? `${level} · ${ancestorPath}` : level;
}

export function getTaskBoardOptionLabel(scopeId, scopesMap) {
  if (scopeId === ALL_TASK_BOARD_ID) return 'All';
  if (scopeId === RECENT_TASK_BOARD_ID) return 'Recent';
  if (scopeId === UNSCOPED_TASK_BOARD_ID) return 'Unscoped';
  const scope = scopesMap.get(scopeId);
  if (!scope) return 'Scope board';
  return formatTaskBoardScopeDisplay(scope, scopesMap);
}

export function getTaskBoardSearchText(scopeId, scopesMap) {
  if (scopeId === ALL_TASK_BOARD_ID) return 'all tasks everything';
  if (scopeId === RECENT_TASK_BOARD_ID) return 'recent updated today';
  if (scopeId === UNSCOPED_TASK_BOARD_ID) return 'unscoped no scope unsorted';
  const scope = scopesMap.get(scopeId);
  if (!scope) return '';
  return [
    scope.title,
    scope.description,
    scope.level,
    getTaskBoardScopeLabel(scope, scopesMap),
    getScopeAncestorPath(scope.record_id, scopesMap),
  ].filter(Boolean).join(' ').toLowerCase();
}

export function normalizeTaskRowGroupRefs(task, resolverFn) {
  if (!task || typeof task !== 'object') return task;

  const nextBoardId = resolverFn(task.board_group_id);
  const nextGroupIds = [...new Set((task.group_ids || [])
    .map((value) => resolverFn(value))
    .filter(Boolean))];
  const nextShares = Array.isArray(task.shares)
    ? task.shares.map((share) => ({
        ...share,
        group_npub: resolverFn(share?.group_npub),
        via_group_npub: resolverFn(share?.via_group_npub),
      }))
    : task.shares;

  const changed = nextBoardId !== (task.board_group_id ?? null)
    || !sameShallowArray(nextGroupIds, task.group_ids || [])
    || !sameShallowArray(nextShares, task.shares || []);

  if (!changed) return task;

  return {
    ...task,
    board_group_id: nextBoardId,
    group_ids: nextGroupIds,
    shares: nextShares,
  };
}

export function normalizeTaskRowScopeRefs(task, scopesMap) {
  if (!task || typeof task !== 'object') return task;
  if (!task.scope_id || !scopesMap.has(task.scope_id)) return task;

  const chain = resolveScopeChain(task.scope_id, scopesMap);
  const changed = (task.scope_l1_id ?? null) !== (chain.scope_l1_id ?? null)
    || (task.scope_l2_id ?? null) !== (chain.scope_l2_id ?? null)
    || (task.scope_l3_id ?? null) !== (chain.scope_l3_id ?? null)
    || (task.scope_l4_id ?? null) !== (chain.scope_l4_id ?? null)
    || (task.scope_l5_id ?? null) !== (chain.scope_l5_id ?? null);

  if (!changed) return task;

  return {
    ...task,
    scope_l1_id: chain.scope_l1_id,
    scope_l2_id: chain.scope_l2_id,
    scope_l3_id: chain.scope_l3_id,
    scope_l4_id: chain.scope_l4_id,
    scope_l5_id: chain.scope_l5_id,
  };
}

export function normalizeScheduleRowGroupRefs(schedule, resolverFn) {
  if (!schedule || typeof schedule !== 'object') return schedule;

  const nextAssignedGroupId = resolverFn(schedule.assigned_group_id);
  const nextGroupIds = [...new Set((schedule.group_ids || [])
    .map((value) => resolverFn(value))
    .filter(Boolean))];
  const nextShares = Array.isArray(schedule.shares)
    ? schedule.shares.map((share) => {
        if (typeof share === 'string') return resolverFn(share);
        return {
          ...share,
          group_npub: resolverFn(share?.group_npub),
          via_group_npub: resolverFn(share?.via_group_npub),
        };
      })
    : schedule.shares;

  const changed = nextAssignedGroupId !== (schedule.assigned_group_id ?? null)
    || !sameShallowArray(nextGroupIds, schedule.group_ids || [])
    || !sameShallowArray(nextShares, schedule.shares || []);

  if (!changed) return schedule;

  return {
    ...schedule,
    assigned_group_id: nextAssignedGroupId,
    group_ids: nextGroupIds,
    shares: nextShares,
  };
}

export function normalizeScopeRowGroupRefs(scope, resolverFn) {
  if (!scope || typeof scope !== 'object') return scope;

  const nextGroupIds = normalizeGroupIds((scope.group_ids || [])
    .map((value) => resolverFn(value))
    .filter(Boolean));

  const changed = JSON.stringify(nextGroupIds) !== JSON.stringify(scope.group_ids || []);
  if (!changed) return scope;

  return {
    ...scope,
    group_ids: nextGroupIds,
  };
}

export function computeBoardScopedTasks(tasks, selectedBoardId, selectedBoardScope, scopesMap, showBoardDescendantTasks) {
  const live = tasks.filter((task) => task.record_state !== 'deleted');
  if (selectedBoardId === ALL_TASK_BOARD_ID) {
    return live;
  }
  if (selectedBoardId === RECENT_TASK_BOARD_ID) {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    return live.filter(task => task.updated_at >= cutoff);
  }
  if (selectedBoardId === UNSCOPED_TASK_BOARD_ID) {
    return live.filter((task) => isTaskUnscoped(task, scopesMap));
  }
  if (!selectedBoardScope) return live;
  return live.filter((task) => matchesTaskBoardScope(task, selectedBoardScope, scopesMap, {
    includeDescendants: showBoardDescendantTasks,
  }));
}

export function computeFilteredTasks(boardScopedTasks, query, filterTags, assigneeNpub) {
  let tasks = boardScopedTasks;

  const q = String(query || '').trim().toLowerCase();
  if (q) {
    tasks = tasks.filter(t =>
      String(t.title || '').toLowerCase().includes(q)
      || String(t.description || '').toLowerCase().includes(q)
      || String(t.tags || '').toLowerCase().includes(q)
    );
  }
  if (filterTags.length > 0) {
    tasks = tasks.filter(t => {
      const tags = parseTaskTags(t.tags);
      return filterTags.some(ft => tags.includes(ft.toLowerCase()));
    });
  }
  if (assigneeNpub) {
    tasks = tasks.filter(t => t.assigned_to_npub === assigneeNpub);
  }
  return tasks;
}

export function computeBoardColumns(activeTasks, doneTasks, summaryTasks) {
  const normalizedSummaryTasks = dedupeTasksByRecordId(summaryTasks);
  const normalizedActiveTasks = dedupeTasksByRecordId(activeTasks);
  const normalizedDoneTasks = dedupeTasksByRecordId(doneTasks);
  const cols = [];
  if (normalizedSummaryTasks.length > 0) {
    cols.push({ state: 'summary', label: 'Summary', tasks: normalizedSummaryTasks });
  }
  const states = ['new', 'ready', 'in_progress', 'review', 'done'];
  const labels = {
    new: 'New',
    ready: 'Ready',
    in_progress: 'In Progress',
    review: 'Review',
    done: 'Done',
  };
  for (const state of states) {
    const tasks = state === 'done'
      ? normalizedDoneTasks
      : normalizedActiveTasks.filter(t => t.state === state);
    cols.push({ state, label: labels[state], tasks });
  }
  return cols;
}

// ---------------------------------------------------------------------------
// Mixin — methods that use `this` (the Alpine store)
// ---------------------------------------------------------------------------

export const taskBoardStateMixin = {
  // --- subtask handling ---

  isParentTask(taskId) {
    return getTaskGraph(this).parentIds.has(taskId);
  },

  getSubtasks(parentId) {
    return getTaskGraph(this).subtasksByParent.get(parentId) || EMPTY_ARRAY;
  },

  computedParentState(parentId) {
    return getTaskGraph(this).parentStateByParent.get(parentId) || 'new';
  },

  stateColor(state) {
    return stateColor(state);
  },

  formatState(state) {
    return formatStateLabel(state);
  },

  resolveReferenceLabel(ref) {
    if (!ref || !ref.type || !ref.id) return ref?.id || 'Unknown';
    if (ref.type === 'task') {
      const task = this.tasks.find(t => t.record_id === ref.id);
      return task?.title || ref.id.slice(0, 8);
    }
    if (ref.type === 'doc') {
      const doc = this.documents.find(d => d.record_id === ref.id);
      return doc?.title || ref.id.slice(0, 8);
    }
    if (ref.type === 'scope') {
      const scope = this.scopesMap?.get(ref.id);
      return scope?.title || ref.id.slice(0, 8);
    }
    if (ref.type === 'flow') {
      const flow = this.flows.find(f => f.record_id === ref.id);
      return flow?.title || ref.id.slice(0, 8);
    }
    return ref.id.slice(0, 8);
  },

  navigateReference(ref) {
    if (!ref || !ref.type || !ref.id) return;
    this.handleMentionNavigate(ref.type, ref.id);
  },

  // --- board computation ---

  get taskBoards() {
    const boards = sortTaskBoardScopes(
      this.scopes.filter((scope) => scope.record_state !== 'deleted'),
      this.scopesMap,
    ).map((scope) => ({
      id: scope.record_id,
      level: scope.level,
      label: this.formatTaskBoardScopeDisplay(scope),
      breadcrumb: this.getScopeAncestorPath(scope.record_id),
      description: scope.description || '',
    }));
    const hasUnscopedTasks = this.tasks.some((task) => task.record_state !== 'deleted' && isTaskUnscoped(task, this.scopesMap));
    if (hasUnscopedTasks) {
      boards.unshift({
        id: UNSCOPED_TASK_BOARD_ID,
        level: 'system',
        label: 'Unscoped',
        breadcrumb: 'Unscoped',
        description: 'Tasks with no scope assignment',
      });
    }
    boards.unshift(
      {
        id: ALL_TASK_BOARD_ID,
        level: 'system',
        label: 'All',
        breadcrumb: 'All',
        description: 'All tasks regardless of scope',
      },
      {
        id: RECENT_TASK_BOARD_ID,
        level: 'system',
        label: 'Recent',
        breadcrumb: 'Recent',
        description: 'Tasks updated in the last 24 hours',
      },
    );
    return boards;
  },

  get selectedBoardScope() {
    if (!this.selectedBoardId || this.selectedBoardId === UNSCOPED_TASK_BOARD_ID || this.selectedBoardId === ALL_TASK_BOARD_ID || this.selectedBoardId === RECENT_TASK_BOARD_ID) return null;
    return this.scopesMap.get(this.selectedBoardId) || null;
  },

  get selectedBoardIsUnscoped() {
    return this.selectedBoardId === UNSCOPED_TASK_BOARD_ID;
  },

  get selectedBoardLabel() {
    if (this.selectedBoardId === ALL_TASK_BOARD_ID) return 'All';
    if (this.selectedBoardId === RECENT_TASK_BOARD_ID) return 'Recent';
    if (this.selectedBoardIsUnscoped) return 'Unscoped';
    if (!this.selectedBoardScope) return 'Scope board';
    return this.formatTaskBoardScopeDisplay(this.selectedBoardScope);
  },

  get flightDeckScopeOptions() {
    return this.taskBoards.filter((board) =>
      board.level !== 'system' || board.id === ALL_TASK_BOARD_ID || board.id === RECENT_TASK_BOARD_ID
    );
  },

  get filteredFlightDeckScopeOptions() {
    const query = String(this.boardPickerQuery || '').trim().toLowerCase();
    if (!query) return this.flightDeckScopeOptions;
    return this.flightDeckScopeOptions.filter((board) => this.getTaskBoardSearchText(board.id).includes(query));
  },

  filterFlightDeckScopeOptions(query = '') {
    const needle = String(query || '').trim().toLowerCase();
    if (!needle) return this.flightDeckScopeOptions;
    return this.flightDeckScopeOptions.filter((board) => this.getTaskBoardSearchText(board.id).includes(needle));
  },

  get focusScopeTitle() {
    if (this.selectedBoardScope) {
      return String(this.selectedBoardScope.title || '').trim() || 'Untitled scope';
    }
    if (this.selectedBoardId === ALL_TASK_BOARD_ID) return 'All work';
    if (this.selectedBoardId === RECENT_TASK_BOARD_ID) return 'Recent work';
    if (this.selectedBoardIsUnscoped) return 'Unscoped work';
    return 'No scope selected';
  },

  get focusScopeMeta() {
    if (this.selectedBoardScope) {
      return formatFocusedScopeMeta(this.selectedBoardScope, this.scopesMap);
    }
    if (this.selectedBoardId === ALL_TASK_BOARD_ID) return 'Every scope';
    if (this.selectedBoardId === RECENT_TASK_BOARD_ID) return 'Tasks updated in the last 24 hours';
    if (this.selectedBoardIsUnscoped) return 'Tasks without scope assignment';
    return 'Select a scope to focus the day';
  },

  get focusScopeSidebarMeta() {
    return 'Scope';
  },

  get canToggleBoardDescendants() {
    if (this.selectedBoardId === ALL_TASK_BOARD_ID || this.selectedBoardId === RECENT_TASK_BOARD_ID || this.selectedBoardId === UNSCOPED_TASK_BOARD_ID) return false;
    const depth = scopeDepth(this.selectedBoardScope?.level);
    return depth >= 1 && depth < 5;
  },

  get boardDescendantToggleTitle() {
    if (!this.canToggleBoardDescendants) return '';
    return this.showBoardDescendantTasks ? 'Hide lower levels' : 'Show lower levels';
  },

  get preferredTaskBoardId() {
    const activeTasks = this.tasks.filter((task) => task.record_state !== 'deleted');
    const boards = this.taskBoards.filter((b) => b.id !== UNSCOPED_TASK_BOARD_ID);
    if (boards.length > 0) {
      let bestBoard = boards[0];
      let bestCount = 0;
      for (const board of boards) {
        const scope = this.scopesMap.get(board.id);
        if (!scope) continue;
        const count = activeTasks.filter((task) => matchesTaskBoardScope(task, scope, this.scopesMap, { includeDescendants: true })).length;
        if (count > bestCount) {
          bestCount = count;
          bestBoard = board;
        }
      }
      return bestBoard.id;
    }
    if (activeTasks.some((task) => isTaskUnscoped(task, this.scopesMap))) {
      return UNSCOPED_TASK_BOARD_ID;
    }
    return this.taskBoards[0]?.id || null;
  },

  toggleBoardDescendantTasks() {
    this.showBoardDescendantTasks = !this.showBoardDescendantTasks;
    this.normalizeTaskFilterTags();
    if (this.showTaskDetail) this.closeTaskDetail();
    else this.syncRoute();
  },

  toggleTaskViewMode() {
    this.taskViewMode = this.taskViewMode === 'kanban' ? 'list' : 'kanban';
    this.syncRoute();
  },

  get listGroupedTasks() {
    return getTaskBoardDerived(this).listGroupedTasks;
  },

  getTaskBoardOptionLabel(scopeId) {
    return getTaskBoardOptionLabel(scopeId, this.scopesMap);
  },

  getTaskBoardSearchText(scopeId) {
    return getTaskBoardSearchText(scopeId, this.scopesMap);
  },

  getScopeAncestorPath(scopeId) {
    return getScopeAncestorPath(scopeId, this.scopesMap);
  },

  formatTaskBoardScopeDisplay(scope) {
    return formatTaskBoardScopeDisplay(scope, this.scopesMap);
  },

  getTaskBoardWriteGroup(scopeId) {
    if (scopeId === ALL_TASK_BOARD_ID || scopeId === RECENT_TASK_BOARD_ID || scopeId === UNSCOPED_TASK_BOARD_ID) return this.getWorkspaceSettingsGroupRef();
    const scope = this.scopesMap.get(scopeId);
    if (!scope) return null;
    return this.getScopeShareGroupIds(scope)[0] || null;
  },

  buildTaskBoardAssignment(scopeId, fallbackTask = null) {
    if (scopeId === ALL_TASK_BOARD_ID || scopeId === RECENT_TASK_BOARD_ID || scopeId === UNSCOPED_TASK_BOARD_ID) {
      // Moving to unscoped — strip old scope shares, keep explicit
      const groupId = this.getWorkspaceSettingsGroupRef();
      const fromScope = fallbackTask?.scope_id ? this.scopesMap.get(fallbackTask.scope_id) : null;
      const fromGroupIds = fromScope ? this.getScopeShareGroupIds(fromScope) : [];
      const { explicitShares } = separateScopeShares(toRaw(fallbackTask?.shares ?? []), fromGroupIds);
      const defaultShares = groupId ? this.buildScopeDefaultShares([groupId]) : this.getDefaultPrivateShares();
      const merged = mergeShareLists(defaultShares, explicitShares);
      return {
        scope_id: null,
        scope_l1_id: null,
        scope_l2_id: null,
        scope_l3_id: null,
        scope_l4_id: null,
        scope_l5_id: null,
        scope_policy_group_ids: null,
        board_group_id: groupId || fallbackTask?.board_group_id || null,
        group_ids: this.getShareGroupIds(merged),
        shares: toRaw(merged),
      };
    }
    const scope = this.scopesMap.get(scopeId) || null;
    if (!scope) {
      return {
        scope_id: fallbackTask?.scope_id ?? null,
        scope_l1_id: fallbackTask?.scope_l1_id ?? null,
        scope_l2_id: fallbackTask?.scope_l2_id ?? null,
        scope_l3_id: fallbackTask?.scope_l3_id ?? null,
        scope_l4_id: fallbackTask?.scope_l4_id ?? null,
        scope_l5_id: fallbackTask?.scope_l5_id ?? null,
        scope_policy_group_ids: toRaw(fallbackTask?.scope_policy_group_ids ?? null),
        board_group_id: fallbackTask?.board_group_id ?? null,
        group_ids: toRaw(fallbackTask?.group_ids ?? []),
        shares: toRaw(fallbackTask?.shares ?? []),
      };
    }

    // Scope move: separate old scope shares from explicit, rebuild for destination
    const fromScope = fallbackTask?.scope_id ? this.scopesMap.get(fallbackTask.scope_id) : null;
    const fromGroupIds = fromScope ? this.getScopeShareGroupIds(fromScope) : [];
    const { explicitShares } = separateScopeShares(toRaw(fallbackTask?.shares ?? []), fromGroupIds);
    const rebuilt = rebuildAccessForScope(explicitShares, scope, this.groups);
    const groupIds = rebuilt.group_ids.map((id) => this.resolveGroupId(id)).filter(Boolean);
    const boardGroupId = groupIds.includes(fallbackTask?.board_group_id) ? fallbackTask.board_group_id : (groupIds[0] || null);

    return {
      ...buildScopeTags(scope),
      scope_policy_group_ids: groupIds,
      board_group_id: boardGroupId,
      group_ids: groupIds,
      shares: toRaw(rebuilt.shares),
    };
  },

  getTaskBoardScopeFromTask(task) {
    if (!task) return null;
    if (task.scope_id && this.scopesMap.has(task.scope_id)) return this.scopesMap.get(task.scope_id) || null;
    for (const key of ['scope_l5_id', 'scope_l4_id', 'scope_l3_id', 'scope_l2_id', 'scope_l1_id']) {
      if (task[key] && this.scopesMap.has(task[key])) return this.scopesMap.get(task[key]) || null;
    }
    return null;
  },

  get filteredTaskBoards() {
    const query = String(this.boardPickerQuery || '').trim().toLowerCase();
    if (!query) return this.taskBoards;
    return this.taskBoards.filter((board) => this.getTaskBoardSearchText(board.id).includes(query));
  },

  get weekdayOptions() {
    return WEEKDAY_OPTIONS;
  },

  // --- group resolution ---

  resolveGroupId(groupRef) {
    return resolveGroupId(groupRef, this.groups);
  },

  normalizeTaskRowGroupRefs(task) {
    return normalizeTaskRowGroupRefs(task, (ref) => this.resolveGroupId(ref));
  },

  normalizeTaskRowScopeRefs(task) {
    return normalizeTaskRowScopeRefs(task, this.scopesMap);
  },

  normalizeScheduleRowGroupRefs(schedule) {
    return normalizeScheduleRowGroupRefs(schedule, (ref) => this.resolveGroupId(ref));
  },

  normalizeScopeRowGroupRefs(scope) {
    return normalizeScopeRowGroupRefs(scope, (ref) => this.resolveGroupId(ref));
  },

  // --- section collapse ---

  isSectionCollapsed(state) {
    return Boolean(this.collapsedSections[state]);
  },

  toggleSectionCollapse(state) {
    this.collapsedSections = {
      ...this.collapsedSections,
      [state]: !this.collapsedSections[state],
    };
    this.persistCollapsedSections();
  },

  persistCollapsedSections() {
    if (typeof window === 'undefined') return;
    const slug = this.currentWorkspaceSlug;
    const key = slug
      ? `coworker:${slug}:collapsed-sections`
      : 'coworker:collapsed-sections';
    const active = Object.fromEntries(
      Object.entries(this.collapsedSections).filter(([, v]) => v)
    );
    if (Object.keys(active).length > 0) {
      window.localStorage.setItem(key, JSON.stringify(active));
    } else {
      window.localStorage.removeItem(key);
    }
  },

  readStoredCollapsedSections() {
    if (typeof window === 'undefined') return {};
    const slug = this.currentWorkspaceSlug;
    const key = slug
      ? `coworker:${slug}:collapsed-sections`
      : 'coworker:collapsed-sections';
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  },

  // --- board picker ---

  toggleBoardPicker() {
    this.showBoardPicker = !this.showBoardPicker;
    if (!this.showBoardPicker) this.boardPickerQuery = '';
  },

  closeBoardPicker() {
    this.showBoardPicker = false;
    this.boardPickerQuery = '';
  },

  selectBoard(boardId) {
    this.selectedBoardId = boardId;
    this.persistSelectedBoardId(boardId);
    this.showBoardDescendantTasks = false;
    this.clearSelectedTasks();
    this.normalizeTaskFilterTags();
    this.closeBoardPicker();
    if (this.showTaskDetail) this.closeTaskDetail();
    else this.syncRoute();
  },

  readStoredTaskBoardId() {
    if (typeof window === 'undefined') return null;
    const slug = this.currentWorkspaceSlug;
    const key = namespacedBoardKey(slug);
    // Migrate: if namespaced key is empty but legacy key has a value, copy it over
    if (slug) {
      const namespaced = window.localStorage.getItem(key);
      if (!namespaced) {
        const legacy = window.localStorage.getItem(TASK_BOARD_STORAGE_KEY);
        if (legacy) {
          window.localStorage.setItem(key, legacy);
          window.localStorage.removeItem(TASK_BOARD_STORAGE_KEY);
          return legacy;
        }
      }
    }
    return window.localStorage.getItem(key) || null;
  },

  persistSelectedBoardId(boardId) {
    if (typeof window === 'undefined') return;
    const key = namespacedBoardKey(this.currentWorkspaceSlug);
    if (boardId) window.localStorage.setItem(key, boardId);
    else window.localStorage.removeItem(key);
  },

  validateSelectedBoardId() {
    if (!this.selectedBoardId) {
      this.selectedBoardId = this.preferredTaskBoardId;
      this.persistSelectedBoardId(this.selectedBoardId);
      return;
    }
    const isSystemBoard = this.selectedBoardId === ALL_TASK_BOARD_ID
      || this.selectedBoardId === RECENT_TASK_BOARD_ID
      || this.selectedBoardId === UNSCOPED_TASK_BOARD_ID;
    // If scopes haven't loaded yet, don't invalidate a scope-based board ID —
    // it may become valid once scopes arrive from the DB or sync.
    if (!isSystemBoard && !this.scopesLoaded) return;
    const exists = isSystemBoard
      || this.taskBoards.some((board) => board.id === this.selectedBoardId);
    if (!exists) {
      this.selectedBoardId = this.preferredTaskBoardId;
      this.persistSelectedBoardId(this.selectedBoardId);
    }
  },

  normalizeTaskFilterTags() {
    const availableTags = new Set(this.allTaskTags);
    this.taskFilterTags = this.taskFilterTags.filter((tag) => availableTags.has(tag));
  },

  // --- task filtering ---

  get boardScopedTasks() {
    return getTaskBoardDerived(this).boardScopedTasks;
  },

  get filteredTasks() {
    return getTaskBoardDerived(this).filteredTasks;
  },

  get activeTasks() {
    return getTaskBoardDerived(this).activeTasks;
  },

  get doneTasks() {
    return getTaskBoardDerived(this).doneTasks;
  },

  get summaryTasks() {
    return getTaskBoardDerived(this).summaryTasks;
  },

  get selectedTasks() {
    return this.tasks.filter((task) => this.selectedTaskIds.includes(task.record_id));
  },

  get selectedTaskCount() {
    return this.selectedTasks.length;
  },

  get canBulkAssignToDefaultAgent() {
    return Boolean(this.defaultAgentNpub && this.selectedTaskCount > 0 && !this.bulkTaskBusy);
  },

  get boardColumns() {
    return getTaskBoardDerived(this).boardColumns;
  },

  // --- calendar ---

  get calendarScheduledTasks() {
    return getTaskBoardDerived(this).calendarScheduledTasks;
  },

  get taskCalendar() {
    return buildTaskCalendar(this.calendarScheduledTasks, {
      view: this.calendarView,
      anchorDateKey: this.calendarAnchorDate,
    });
  },

  // --- visible board tasks / tags ---

  get visibleBoardTasks() {
    return getTaskBoardDerived(this).visibleBoardTasks;
  },

  get allTaskTags() {
    return getTaskBoardDerived(this).allTaskTags;
  },

  getTaskTags(task) {
    return parseTaskTags(task?.tags);
  },

  getTaskBoardLabel(taskOrScopeRef) {
    if (!taskOrScopeRef) return 'Scope board';
    if (typeof taskOrScopeRef !== 'string' && isTaskUnscoped(taskOrScopeRef, this.scopesMap)) return 'Unscoped';
    if (taskOrScopeRef === UNSCOPED_TASK_BOARD_ID) return 'Unscoped';
    const scope = typeof taskOrScopeRef === 'string'
      ? this.scopesMap.get(taskOrScopeRef) || null
      : this.getTaskBoardScopeFromTask(taskOrScopeRef);
    if (!scope) return 'Scope board';
    return this.getTaskBoardOptionLabel(scope.record_id);
  },

  get selectedBoardWriteGroup() {
    return this.getTaskBoardWriteGroup(this.selectedBoardId)
      || this.getWorkspaceSettingsGroupRef()
      || null;
  },

  async ensureTaskBoardScopeSetup() {
    if (this.taskBoardScopeSetupInFlight) return;
    this.taskBoardScopeSetupInFlight = true;
    try {
      this.validateSelectedBoardId();
    } finally {
      this.taskBoardScopeSetupInFlight = false;
    }
  },

  // --- schedule/scope group suggestions ---

  getScheduleAssignedGroupLabel(groupId) {
    const resolvedGroupId = this.resolveGroupId(groupId);
    if (!resolvedGroupId) return 'Unassigned';
    if (resolvedGroupId === this.memberPrivateGroupRef) return 'Private group';
    return this.scheduleAssignableGroups.find((group) => group.groupId === resolvedGroupId)?.label || resolvedGroupId;
  },

  getPreferredChannelWriteGroup(channel) {
    const groups = Array.isArray(channel?.group_ids)
      ? channel.group_ids.map((value) => String(value || '').trim()).filter(Boolean)
      : [];
    return groups[0] || null;
  },

  get activeTaskDetail() {
    if (!this.activeTaskId) return null;
    return this.tasks.find(t => t.record_id === this.activeTaskId) ?? null;
  },

  get scheduleAssignableGroups() {
    return this.currentWorkspaceContentGroups.map((group) => ({
      groupId: group.group_id || group.group_npub,
      label: group.name || 'Group',
      subtitle: group.group_kind === 'private'
        ? 'Private group'
        : `${(group.member_npubs || []).length} members`,
    }));
  },

  get scopeAssignableGroups() {
    return this.currentWorkspaceContentGroups.map((group) => ({
      groupId: group.group_id || group.group_npub,
      label: group.name || 'Group',
      subtitle: group.group_kind === 'private'
        ? 'Private group'
        : `${(group.member_npubs || []).length} members`,
    }));
  },

  get newScheduleGroupSuggestions() {
    return this.findScheduleGroupSuggestions(
      this.newScheduleGroupQuery,
      [this.newScheduleAssignedGroupId],
    );
  },

  get editingScheduleGroupSuggestions() {
    return this.findScheduleGroupSuggestions(
      this.editingScheduleGroupQuery,
      [this.editingScheduleDraft?.assigned_group_id],
    );
  },

  get newScopeGroupSuggestions() {
    return this.findScopeGroupSuggestions(
      this.newScopeGroupQuery,
      this.newScopeAssignedGroupIds,
    );
  },

  get editingScopeGroupSuggestions() {
    return this.findScopeGroupSuggestions(
      this.editingScopeGroupQuery,
      this.editingScopeAssignedGroupIds,
    );
  },

  findScheduleGroupSuggestions(query, excludeGroupIds = []) {
    const needle = String(query || '').trim().toLowerCase();
    if (!needle) return [];

    const existing = new Set((excludeGroupIds || []).map((value) => this.resolveGroupId(value)).filter(Boolean));
    return this.scheduleAssignableGroups
      .filter((group) => !existing.has(group.groupId))
      .filter((group) =>
        String(group.label || '').toLowerCase().includes(needle)
        || String(group.groupId || '').toLowerCase().includes(needle)
        || String(group.subtitle || '').toLowerCase().includes(needle)
      )
      .slice(0, 8);
  },

  findScopeGroupSuggestions(query, excludeGroupIds = []) {
    const needle = String(query || '').trim().toLowerCase();
    if (!needle) return [];

    const existing = new Set((excludeGroupIds || []).map((value) => this.resolveGroupId(value)).filter(Boolean));
    return this.scopeAssignableGroups
      .filter((group) => !existing.has(group.groupId))
      .filter((group) =>
        String(group.label || '').toLowerCase().includes(needle)
        || String(group.groupId || '').toLowerCase().includes(needle)
        || String(group.subtitle || '').toLowerCase().includes(needle)
      )
      .slice(0, 8);
  },

  getScopeAssignedGroupLabel(groupId) {
    const resolvedGroupId = this.resolveGroupId(groupId);
    if (!resolvedGroupId) return 'Group';
    return this.scopeAssignableGroups.find((group) => group.groupId === resolvedGroupId)?.label || resolvedGroupId;
  },

  getScopeAssignedGroupSubtitle(groupId) {
    const resolvedGroupId = this.resolveGroupId(groupId);
    if (!resolvedGroupId) return '';
    return this.scopeAssignableGroups.find((group) => group.groupId === resolvedGroupId)?.subtitle || resolvedGroupId;
  },

  getScopeGroupSummary(scope) {
    const groupIds = normalizeGroupIds(scope?.group_ids).map((groupId) => this.resolveGroupId(groupId)).filter(Boolean);
    if (groupIds.length === 0) return 'No groups';
    return groupIds.map((groupId) => this.getScopeAssignedGroupLabel(groupId)).join(', ');
  },

  // --- scope helpers ---

  get scopesMap() {
    return getCachedScopesMap(this);
  },

  get scopeTree() {
    const active = this.scopes.filter(s => s.record_state !== 'deleted');
    const buildChildren = (parentId) =>
      active
        .filter(s => (s.parent_id || null) === (parentId || null) && scopeDepth(s.level) > (parentId ? scopeDepth(this.scopesMap.get(parentId)?.level) : 0))
        .map(s => ({ ...s, children: buildChildren(s.record_id) }));
    // Root nodes are depth-1 scopes with no parent
    return active
      .filter(s => scopeDepth(s.level) === 1 && !s.parent_id)
      .map(s => ({ ...s, children: buildChildren(s.record_id) }));
  },

  scopeLevelLabel(level) {
    return levelLabel(level);
  },

  get editingScope() {
    if (!this.editingScopeId) return null;
    return this.scopesMap.get(this.editingScopeId) || null;
  },

  get editingScopeLevelLabel() {
    return this.scopeLevelLabel(this.editingScope?.level || '');
  },

};
