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

// ---------------------------------------------------------------------------
// Pure utility functions (no `this` dependency)
// ---------------------------------------------------------------------------

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
    || JSON.stringify(nextGroupIds) !== JSON.stringify(task.group_ids || [])
    || JSON.stringify(nextShares) !== JSON.stringify(task.shares || []);

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
    || JSON.stringify(nextGroupIds) !== JSON.stringify(schedule.group_ids || [])
    || JSON.stringify(nextShares) !== JSON.stringify(schedule.shares || []);

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

export function computeFilteredTasks(boardScopedTasks, query, filterTags) {
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
  return tasks;
}

export function computeBoardColumns(activeTasks, doneTasks, summaryTasks) {
  const cols = [];
  if (summaryTasks.length > 0) {
    cols.push({ state: 'summary', label: 'Summary', tasks: summaryTasks });
  }
  const states = ['new', 'ready', 'definition', 'in_progress', 'review', 'done'];
  const labels = {
    new: 'New',
    ready: 'Ready',
    definition: 'Definition',
    in_progress: 'In Progress',
    review: 'Review',
    done: 'Done',
  };
  for (const state of states) {
    const tasks = state === 'done'
      ? doneTasks
      : activeTasks.filter(t => t.state === state);
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
    return this.tasks.some(t => t.parent_task_id === taskId && t.record_state !== 'deleted');
  },

  getSubtasks(parentId) {
    return this.tasks.filter(t => t.parent_task_id === parentId && t.record_state !== 'deleted');
  },

  computedParentState(parentId) {
    return computeParentState(this.getSubtasks(parentId));
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
    const cols = this.boardColumns;
    return cols.filter(col => col.tasks.length > 0);
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
      const groupId = this.getWorkspaceSettingsGroupRef();
      const shares = groupId ? this.buildScopeDefaultShares([groupId]) : this.getDefaultPrivateShares();
      return {
        scope_id: null,
        scope_l1_id: null,
        scope_l2_id: null,
        scope_l3_id: null,
        scope_l4_id: null,
        scope_l5_id: null,
        board_group_id: groupId || fallbackTask?.board_group_id || null,
        group_ids: this.getShareGroupIds(shares),
        shares: toRaw(shares),
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
        board_group_id: fallbackTask?.board_group_id ?? null,
        group_ids: toRaw(fallbackTask?.group_ids ?? []),
        shares: toRaw(fallbackTask?.shares ?? []),
      };
    }

    const groupIds = this.getScopeShareGroupIds(scope);
    return {
      ...buildScopeTags(scope),
      board_group_id: groupIds[0] || null,
      group_ids: groupIds,
      shares: this.buildScopeDefaultShares(groupIds),
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
    const exists = this.selectedBoardId === ALL_TASK_BOARD_ID
      || this.selectedBoardId === RECENT_TASK_BOARD_ID
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
    return computeBoardScopedTasks(
      this.tasks,
      this.selectedBoardIsUnscoped ? UNSCOPED_TASK_BOARD_ID : this.selectedBoardId,
      this.selectedBoardScope,
      this.scopesMap,
      this.showBoardDescendantTasks,
    );
  },

  get filteredTasks() {
    return computeFilteredTasks(this.boardScopedTasks, this.taskFilter, this.taskFilterTags);
  },

  get activeTasks() {
    return this.filteredTasks.filter(t =>
      t.state !== 'done' && t.state !== 'archive' && !this.isParentTask(t.record_id)
    );
  },

  get doneTasks() {
    return this.filteredTasks.filter(t =>
      t.state === 'done' && !this.isParentTask(t.record_id)
    );
  },

  get summaryTasks() {
    return this.filteredTasks.filter(t =>
      t.state !== 'archive' && this.isParentTask(t.record_id)
    );
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
    return computeBoardColumns(this.activeTasks, this.doneTasks, this.summaryTasks);
  },

  // --- calendar ---

  get calendarScheduledTasks() {
    return this.filteredTasks.filter((task) =>
      task.record_state !== 'deleted'
      && task.state !== 'archive'
      && !this.isParentTask(task.record_id)
      && Boolean(task.scheduled_for)
    );
  },

  get taskCalendar() {
    return buildTaskCalendar(this.calendarScheduledTasks, {
      view: this.calendarView,
      anchorDateKey: this.calendarAnchorDate,
    });
  },

  // --- visible board tasks / tags ---

  get visibleBoardTasks() {
    let tasks = this.boardScopedTasks.filter((t) => t.state !== 'archive');
    const query = String(this.taskFilter || '').trim().toLowerCase();
    if (query) {
      tasks = tasks.filter((t) =>
        String(t.title || '').toLowerCase().includes(query)
        || String(t.description || '').toLowerCase().includes(query)
        || String(t.tags || '').toLowerCase().includes(query)
      );
    }
    return tasks;
  },

  get allTaskTags() {
    const tagSet = new Set();
    for (const task of this.visibleBoardTasks) {
      for (const tag of parseTaskTags(task.tags)) {
        tagSet.add(tag);
      }
    }
    return [...tagSet].sort();
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
    return this.currentWorkspaceGroups.map((group) => ({
      groupId: group.group_id || group.group_npub,
      label: group.name || 'Group',
      subtitle: group.group_kind === 'private'
        ? 'Private group'
        : `${(group.member_npubs || []).length} members`,
    }));
  },

  get scopeAssignableGroups() {
    return this.currentWorkspaceGroups.map((group) => ({
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
    const m = new Map();
    for (const s of this.scopes) m.set(s.record_id, s);
    return m;
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
