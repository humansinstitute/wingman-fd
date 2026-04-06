import { describe, expect, it } from 'vitest';
import {
  resolveGroupId,
  getScopeAncestorPath,
  formatTaskBoardScopeDisplay,
  formatFocusedScopeMeta,
  getTaskBoardOptionLabel,
  getTaskBoardSearchText,
  normalizeTaskRowGroupRefs,
  normalizeTaskRowScopeRefs,
  normalizeScheduleRowGroupRefs,
  normalizeScopeRowGroupRefs,
  dedupeTasksByRecordId,
  computeBoardColumns,
  computeBoardScopedTasks,
  computeFilteredTasks,
  taskBoardStateMixin,
  UNSCOPED_TASK_BOARD_ID,
  ALL_TASK_BOARD_ID,
  RECENT_TASK_BOARD_ID,
  TASK_BOARD_STORAGE_KEY,
  TASK_BOARD_STORAGE_KEY_SUFFIX,
  WEEKDAY_OPTIONS,
} from '../src/task-board-state.js';

// --- test fixtures ---
const groups = [
  { group_id: 'g1', group_npub: 'npub1grp1', name: 'Team A' },
  { group_id: 'g2', group_npub: 'npub1grp2', name: 'Team B' },
];

const product = {
  record_id: 'scope-product',
  title: 'Product X',
  level: 'product',
  parent_id: null,
  record_state: 'active',
};

const project = {
  record_id: 'scope-project',
  title: 'Project Y',
  level: 'project',
  parent_id: 'scope-product',
  l1_id: 'scope-product',
  record_state: 'active',
};

const deliverable = {
  record_id: 'scope-deliverable',
  title: 'Deliverable Z',
  level: 'deliverable',
  parent_id: 'scope-project',
  l1_id: 'scope-product',
  l2_id: 'scope-project',
  record_state: 'active',
};

function buildScopesMap(scopes = [product, project, deliverable]) {
  const m = new Map();
  for (const s of scopes) m.set(s.record_id, s);
  return m;
}

// --- constants ---
describe('task-board-state constants', () => {
  it('exports UNSCOPED_TASK_BOARD_ID', () => {
    expect(UNSCOPED_TASK_BOARD_ID).toBe('__unscoped__');
  });

  it('exports TASK_BOARD_STORAGE_KEY (legacy)', () => {
    expect(TASK_BOARD_STORAGE_KEY).toBe('coworker:last-task-board-id');
  });

  it('exports TASK_BOARD_STORAGE_KEY_SUFFIX for namespaced keys', () => {
    expect(TASK_BOARD_STORAGE_KEY_SUFFIX).toBe('last-task-board-id');
  });

  it('exports WEEKDAY_OPTIONS', () => {
    expect(WEEKDAY_OPTIONS).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
  });
});

// --- resolveGroupId ---
describe('resolveGroupId', () => {
  it('returns null for empty input', () => {
    expect(resolveGroupId(null, groups)).toBeNull();
    expect(resolveGroupId('', groups)).toBeNull();
    expect(resolveGroupId(undefined, groups)).toBeNull();
  });

  it('resolves by group_id', () => {
    expect(resolveGroupId('g1', groups)).toBe('g1');
  });

  it('resolves by group_npub', () => {
    expect(resolveGroupId('npub1grp1', groups)).toBe('g1');
  });

  it('returns the value as-is when no match found', () => {
    expect(resolveGroupId('unknown', groups)).toBe('unknown');
  });

  it('handles empty groups array', () => {
    expect(resolveGroupId('g1', [])).toBe('g1');
  });
});

// --- getScopeAncestorPath ---
describe('getScopeAncestorPath', () => {
  const scopesMap = buildScopesMap();

  it('returns empty string for a root scope', () => {
    expect(getScopeAncestorPath('scope-product', scopesMap)).toBe('');
  });

  it('returns parent title for one level deep', () => {
    expect(getScopeAncestorPath('scope-project', scopesMap)).toBe('Product X >');
  });

  it('returns full ancestor chain for deeply nested scope', () => {
    expect(getScopeAncestorPath('scope-deliverable', scopesMap)).toBe('Product X > Project Y >');
  });

  it('returns empty string for unknown scope', () => {
    expect(getScopeAncestorPath('nonexistent', scopesMap)).toBe('');
  });

  it('returns empty string for null/undefined', () => {
    expect(getScopeAncestorPath(null, scopesMap)).toBe('');
    expect(getScopeAncestorPath(undefined, scopesMap)).toBe('');
  });
});

// --- formatTaskBoardScopeDisplay ---
describe('formatTaskBoardScopeDisplay', () => {
  const scopesMap = buildScopesMap();

  it('returns empty string for null scope', () => {
    expect(formatTaskBoardScopeDisplay(null, scopesMap)).toBe('');
  });

  it('returns empty string for scope without record_id', () => {
    expect(formatTaskBoardScopeDisplay({}, scopesMap)).toBe('');
  });

  it('formats root-level product', () => {
    expect(formatTaskBoardScopeDisplay(product, scopesMap)).toBe('Product X (L1)');
  });

  it('formats nested project with ancestor path', () => {
    expect(formatTaskBoardScopeDisplay(project, scopesMap)).toBe('Project Y (L2): Product X >');
  });

  it('formats deeply nested deliverable with ancestor path', () => {
    expect(formatTaskBoardScopeDisplay(deliverable, scopesMap)).toBe(
      'Deliverable Z (L3): Product X > Project Y >'
    );
  });

  it('handles scope with empty title', () => {
    const scope = { ...product, title: '' };
    expect(formatTaskBoardScopeDisplay(scope, scopesMap)).toBe('Untitled scope (L1)');
  });
});

describe('formatFocusedScopeMeta', () => {
  const scopesMap = buildScopesMap();

  it('returns empty string for null scope', () => {
    expect(formatFocusedScopeMeta(null, scopesMap)).toBe('');
  });

  it('returns level only for a root scope', () => {
    expect(formatFocusedScopeMeta(product, scopesMap)).toBe('L1');
  });

  it('returns level and trimmed ancestor path for nested scope', () => {
    expect(formatFocusedScopeMeta(deliverable, scopesMap)).toBe('L3 · Product X > Project Y');
  });
});

// --- getTaskBoardOptionLabel ---
describe('getTaskBoardOptionLabel', () => {
  const scopesMap = buildScopesMap();

  it('returns Unscoped for UNSCOPED_TASK_BOARD_ID', () => {
    expect(getTaskBoardOptionLabel(UNSCOPED_TASK_BOARD_ID, scopesMap)).toBe('Unscoped');
  });

  it('returns Scope board for unknown scope', () => {
    expect(getTaskBoardOptionLabel('nonexistent', scopesMap)).toBe('Scope board');
  });

  it('returns formatted display for known scope', () => {
    expect(getTaskBoardOptionLabel('scope-product', scopesMap)).toBe('Product X (L1)');
  });
});

// --- getTaskBoardSearchText ---
describe('getTaskBoardSearchText', () => {
  const scopesMap = buildScopesMap();

  it('returns unscoped search text for UNSCOPED_TASK_BOARD_ID', () => {
    const result = getTaskBoardSearchText(UNSCOPED_TASK_BOARD_ID, scopesMap);
    expect(result).toContain('unscoped');
  });

  it('returns empty string for unknown scope', () => {
    expect(getTaskBoardSearchText('nonexistent', scopesMap)).toBe('');
  });

  it('includes scope title and level for known scope', () => {
    const result = getTaskBoardSearchText('scope-product', scopesMap);
    expect(result).toContain('product x');
    expect(result).toContain('product');
  });
});

// --- normalizeTaskRowGroupRefs ---
describe('normalizeTaskRowGroupRefs', () => {
  const resolver = (ref) => resolveGroupId(ref, groups);

  it('returns falsy input as-is', () => {
    expect(normalizeTaskRowGroupRefs(null, resolver)).toBeNull();
    expect(normalizeTaskRowGroupRefs(undefined, resolver)).toBeUndefined();
  });

  it('returns non-object input as-is', () => {
    expect(normalizeTaskRowGroupRefs('string', resolver)).toBe('string');
  });

  it('returns task unchanged when no group refs to resolve', () => {
    const task = { board_group_id: 'g1', group_ids: ['g1'], shares: [] };
    expect(normalizeTaskRowGroupRefs(task, resolver)).toBe(task);
  });

  it('resolves group_npub to group_id in board_group_id', () => {
    const task = { board_group_id: 'npub1grp1', group_ids: [], shares: [] };
    const result = normalizeTaskRowGroupRefs(task, resolver);
    expect(result.board_group_id).toBe('g1');
  });

  it('resolves group_npub in group_ids', () => {
    const task = { board_group_id: null, group_ids: ['npub1grp2'], shares: [] };
    const result = normalizeTaskRowGroupRefs(task, resolver);
    expect(result.group_ids).toEqual(['g2']);
  });

  it('deduplicates group_ids', () => {
    const task = { board_group_id: null, group_ids: ['g1', 'npub1grp1'], shares: [] };
    const result = normalizeTaskRowGroupRefs(task, resolver);
    expect(result.group_ids).toEqual(['g1']);
  });

  it('resolves group_npub and via_group_npub in shares', () => {
    const task = {
      board_group_id: null,
      group_ids: [],
      shares: [{ group_npub: 'npub1grp1', via_group_npub: 'npub1grp2' }],
    };
    const result = normalizeTaskRowGroupRefs(task, resolver);
    expect(result.shares[0].group_npub).toBe('g1');
    expect(result.shares[0].via_group_npub).toBe('g2');
  });
});

// --- normalizeTaskRowScopeRefs ---
describe('normalizeTaskRowScopeRefs', () => {
  const scopesMap = buildScopesMap();

  it('returns falsy input as-is', () => {
    expect(normalizeTaskRowScopeRefs(null, scopesMap)).toBeNull();
  });

  it('returns task unchanged when scope_id missing', () => {
    const task = { title: 'Test' };
    expect(normalizeTaskRowScopeRefs(task, scopesMap)).toBe(task);
  });

  it('returns task unchanged when scope_id not in map', () => {
    const task = { scope_id: 'unknown' };
    expect(normalizeTaskRowScopeRefs(task, scopesMap)).toBe(task);
  });

  it('fills in scope hierarchy fields for known scope', () => {
    const task = { scope_id: 'scope-deliverable', scope_l1_id: null, scope_l2_id: null, scope_l3_id: null };
    const result = normalizeTaskRowScopeRefs(task, scopesMap);
    expect(result.scope_l3_id).toBe('scope-deliverable');
    expect(result.scope_l2_id).toBe('scope-project');
    expect(result.scope_l1_id).toBe('scope-product');
  });
});

// --- normalizeScheduleRowGroupRefs ---
describe('normalizeScheduleRowGroupRefs', () => {
  const resolver = (ref) => resolveGroupId(ref, groups);

  it('returns falsy input as-is', () => {
    expect(normalizeScheduleRowGroupRefs(null, resolver)).toBeNull();
  });

  it('returns schedule unchanged when no refs to resolve', () => {
    const schedule = { assigned_group_id: 'g1', group_ids: ['g1'], shares: [] };
    expect(normalizeScheduleRowGroupRefs(schedule, resolver)).toBe(schedule);
  });

  it('resolves assigned_group_id', () => {
    const schedule = { assigned_group_id: 'npub1grp1', group_ids: [], shares: [] };
    const result = normalizeScheduleRowGroupRefs(schedule, resolver);
    expect(result.assigned_group_id).toBe('g1');
  });
});

// --- normalizeScopeRowGroupRefs ---
describe('normalizeScopeRowGroupRefs', () => {
  const resolver = (ref) => resolveGroupId(ref, groups);

  it('returns falsy input as-is', () => {
    expect(normalizeScopeRowGroupRefs(null, resolver)).toBeNull();
  });

  it('returns scope unchanged when group_ids already resolved', () => {
    const scope = { group_ids: ['g1'] };
    expect(normalizeScopeRowGroupRefs(scope, resolver)).toBe(scope);
  });

  it('resolves group_npub in group_ids', () => {
    const scope = { group_ids: ['npub1grp2'] };
    const result = normalizeScopeRowGroupRefs(scope, resolver);
    expect(result.group_ids).toEqual(['g2']);
  });
});

// --- computeBoardScopedTasks ---
describe('computeBoardScopedTasks', () => {
  const scopesMap = buildScopesMap();
  const tasks = [
    { record_id: 't1', record_state: 'active', scope_id: 'scope-product' },
    { record_id: 't2', record_state: 'active', scope_id: null },
    { record_id: 't3', record_state: 'deleted', scope_id: null },
    { record_id: 't4', record_state: 'active', scope_id: 'scope-project', scope_l1_id: 'scope-product' },
  ];

  it('filters deleted tasks', () => {
    const result = computeBoardScopedTasks(tasks, null, null, scopesMap, false);
    expect(result.every((t) => t.record_state !== 'deleted')).toBe(true);
  });

  it('returns all active tasks when no board selected', () => {
    const result = computeBoardScopedTasks(tasks, null, null, scopesMap, false);
    expect(result.length).toBe(3);
  });

  it('returns only unscoped tasks for UNSCOPED_TASK_BOARD_ID', () => {
    const result = computeBoardScopedTasks(tasks, UNSCOPED_TASK_BOARD_ID, null, scopesMap, false);
    expect(result.every((t) => !t.scope_id || !scopesMap.has(t.scope_id))).toBe(true);
  });
});

// --- computeFilteredTasks ---
describe('computeFilteredTasks', () => {
  const tasks = [
    { record_id: 't1', title: 'Fix login bug', description: '', tags: 'bug,urgent' },
    { record_id: 't2', title: 'Add dashboard', description: 'new feature', tags: 'feature' },
    { record_id: 't3', title: 'Refactor auth', description: '', tags: 'refactor' },
  ];

  it('returns all tasks when no query or filter tags', () => {
    expect(computeFilteredTasks(tasks, '', [])).toEqual(tasks);
  });

  it('filters by text query matching title', () => {
    const result = computeFilteredTasks(tasks, 'login', []);
    expect(result).toHaveLength(1);
    expect(result[0].record_id).toBe('t1');
  });

  it('filters by text query matching description', () => {
    const result = computeFilteredTasks(tasks, 'feature', []);
    expect(result).toHaveLength(1);
    expect(result[0].record_id).toBe('t2');
  });

  it('filters by tag', () => {
    const result = computeFilteredTasks(tasks, '', ['bug']);
    expect(result).toHaveLength(1);
    expect(result[0].record_id).toBe('t1');
  });

  it('combines text and tag filters', () => {
    const result = computeFilteredTasks(tasks, 'Fix', ['bug']);
    expect(result).toHaveLength(1);
    expect(result[0].record_id).toBe('t1');
  });

  it('returns empty when query matches nothing', () => {
    expect(computeFilteredTasks(tasks, 'nonexistent', [])).toHaveLength(0);
  });

  // --- assignee filtering (filter-to-me) ---
  const tasksWithAssignee = [
    { record_id: 't1', title: 'Fix login bug', description: '', tags: 'bug', assigned_to_npub: 'npub1me' },
    { record_id: 't2', title: 'Add dashboard', description: '', tags: 'feature', assigned_to_npub: 'npub1other' },
    { record_id: 't3', title: 'Refactor auth', description: '', tags: 'refactor', assigned_to_npub: null },
    { record_id: 't4', title: 'Write docs', description: '', tags: 'docs', assigned_to_npub: 'npub1me' },
  ];

  it('filters by assignee npub when provided', () => {
    const result = computeFilteredTasks(tasksWithAssignee, '', [], 'npub1me');
    expect(result).toHaveLength(2);
    expect(result.map(t => t.record_id)).toEqual(['t1', 't4']);
  });

  it('returns all tasks when assigneeNpub is null', () => {
    const result = computeFilteredTasks(tasksWithAssignee, '', [], null);
    expect(result).toHaveLength(4);
  });

  it('returns all tasks when assigneeNpub is empty string', () => {
    const result = computeFilteredTasks(tasksWithAssignee, '', [], '');
    expect(result).toHaveLength(4);
  });

  it('combines assignee filter with text query', () => {
    const result = computeFilteredTasks(tasksWithAssignee, 'Fix', [], 'npub1me');
    expect(result).toHaveLength(1);
    expect(result[0].record_id).toBe('t1');
  });

  it('combines assignee filter with tag filter', () => {
    const result = computeFilteredTasks(tasksWithAssignee, '', ['docs'], 'npub1me');
    expect(result).toHaveLength(1);
    expect(result[0].record_id).toBe('t4');
  });

  it('combines all three filters together', () => {
    const result = computeFilteredTasks(tasksWithAssignee, 'Write', ['docs'], 'npub1me');
    expect(result).toHaveLength(1);
    expect(result[0].record_id).toBe('t4');
  });

  it('returns empty when assignee matches but text does not', () => {
    const result = computeFilteredTasks(tasksWithAssignee, 'nonexistent', [], 'npub1me');
    expect(result).toHaveLength(0);
  });

  it('returns empty when no tasks match assignee', () => {
    const result = computeFilteredTasks(tasksWithAssignee, '', [], 'npub1nobody');
    expect(result).toHaveLength(0);
  });

  it('existing callers without assignee param still work (backwards compatible)', () => {
    // Calling with only 3 args should behave identically to before
    const result = computeFilteredTasks(tasksWithAssignee, 'Fix', []);
    expect(result).toHaveLength(1);
    expect(result[0].record_id).toBe('t1');
  });
});

// --- computeBoardColumns ---
describe('computeBoardColumns', () => {
  it('produces standard columns', () => {
    const cols = computeBoardColumns([], [], []);
    const stateNames = cols.map((c) => c.state);
    expect(stateNames).toEqual(['new', 'ready', 'in_progress', 'review', 'done']);
    expect(stateNames).not.toContain('definition');
  });

  it('prepends summary column when summaryTasks present', () => {
    const summary = [{ record_id: 's1', state: 'new' }];
    const cols = computeBoardColumns([], [], summary);
    expect(cols[0].state).toBe('summary');
    expect(cols[0].tasks).toBe(summary);
  });

  it('distributes active tasks to correct columns', () => {
    const active = [
      { record_id: 'a1', state: 'new' },
      { record_id: 'a2', state: 'in_progress' },
    ];
    const cols = computeBoardColumns(active, [], []);
    expect(cols.find((c) => c.state === 'new').tasks).toHaveLength(1);
    expect(cols.find((c) => c.state === 'in_progress').tasks).toHaveLength(1);
    expect(cols.find((c) => c.state === 'ready').tasks).toHaveLength(0);
  });

  it('places done tasks in done column', () => {
    const done = [{ record_id: 'd1', state: 'done' }];
    const cols = computeBoardColumns([], done, []);
    expect(cols.find((c) => c.state === 'done').tasks).toBe(done);
  });

  it('deduplicates duplicate task ids before rendering columns', () => {
    const active = [
      { record_id: 'a1', state: 'new', version: 1, updated_at: '2026-04-01T00:00:00.000Z' },
      { record_id: 'a1', state: 'new', version: 2, updated_at: '2026-04-01T00:01:00.000Z' },
    ];
    const cols = computeBoardColumns(active, [], []);
    expect(cols.find((c) => c.state === 'new').tasks).toHaveLength(1);
    expect(cols.find((c) => c.state === 'new').tasks[0].version).toBe(2);
  });
});

describe('dedupeTasksByRecordId', () => {
  it('keeps the newest version for duplicate record ids', () => {
    const deduped = dedupeTasksByRecordId([
      { record_id: 'task-1', version: 1, updated_at: '2026-04-01T00:00:00.000Z' },
      { record_id: 'task-1', version: 3, updated_at: '2026-04-01T00:00:05.000Z' },
      { record_id: 'task-2', version: 1, updated_at: '2026-04-01T00:00:00.000Z' },
    ]);

    expect(deduped).toHaveLength(2);
    expect(deduped.find((task) => task.record_id === 'task-1')?.version).toBe(3);
  });
});

// --- flightDeckScopeOptions (mixin) ---
describe('flightDeckScopeOptions includes virtual boards', () => {
  function buildMockStore(scopes = [product, project, deliverable], tasks = []) {
    const scopesMap = buildScopesMap(scopes);
    const store = {
      scopes,
      tasks,
      scopesMap,
      boardPickerQuery: '',
      getScopeAncestorPath(id) { return getScopeAncestorPath(id, scopesMap); },
      formatTaskBoardScopeDisplay(scope) { return formatTaskBoardScopeDisplay(scope, scopesMap); },
      getTaskBoardSearchText(id) { return getTaskBoardSearchText(id, scopesMap); },
    };
    // Bind mixin getters as regular properties via Object.defineProperties
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(taskBoardStateMixin))) {
      if (descriptor.get) {
        Object.defineProperty(store, key, { get: descriptor.get.bind(store), configurable: true });
      }
    }
    return store;
  }

  it('includes All and Recent in flightDeckScopeOptions', () => {
    const store = buildMockStore();
    const options = store.flightDeckScopeOptions;
    const ids = options.map((o) => o.id);
    expect(ids).toContain(ALL_TASK_BOARD_ID);
    expect(ids).toContain(RECENT_TASK_BOARD_ID);
  });

  it('excludes Unscoped from flightDeckScopeOptions', () => {
    const unscopedTask = { record_id: 't1', record_state: 'active', scope_id: null };
    const store = buildMockStore([product], [unscopedTask]);
    const options = store.flightDeckScopeOptions;
    const ids = options.map((o) => o.id);
    expect(ids).not.toContain(UNSCOPED_TASK_BOARD_ID);
  });

  it('places All and Recent before scope boards', () => {
    const store = buildMockStore();
    const options = store.flightDeckScopeOptions;
    const allIdx = options.findIndex((o) => o.id === ALL_TASK_BOARD_ID);
    const recentIdx = options.findIndex((o) => o.id === RECENT_TASK_BOARD_ID);
    const firstScopeIdx = options.findIndex((o) => o.id !== ALL_TASK_BOARD_ID && o.id !== RECENT_TASK_BOARD_ID);
    expect(allIdx).toBeLessThan(firstScopeIdx);
    expect(recentIdx).toBeLessThan(firstScopeIdx);
  });

  it('includes All and Recent in filteredFlightDeckScopeOptions with no query', () => {
    const store = buildMockStore();
    const options = store.filteredFlightDeckScopeOptions;
    const ids = options.map((o) => o.id);
    expect(ids).toContain(ALL_TASK_BOARD_ID);
    expect(ids).toContain(RECENT_TASK_BOARD_ID);
  });

  it('filters All/Recent by search query', () => {
    const store = buildMockStore();
    store.boardPickerQuery = 'recent';
    const options = store.filteredFlightDeckScopeOptions;
    const ids = options.map((o) => o.id);
    expect(ids).toContain(RECENT_TASK_BOARD_ID);
    // All should not match 'recent'
    expect(ids).not.toContain(ALL_TASK_BOARD_ID);
  });

  it('filterFlightDeckScopeOptions method includes virtual boards', () => {
    const store = buildMockStore();
    const options = store.flightDeckScopeOptions;
    // Use the method form via the mixin
    const filtered = taskBoardStateMixin.filterFlightDeckScopeOptions.call(
      { ...store, flightDeckScopeOptions: options, getTaskBoardSearchText: store.getTaskBoardSearchText },
      ''
    );
    const ids = filtered.map((o) => o.id);
    expect(ids).toContain(ALL_TASK_BOARD_ID);
    expect(ids).toContain(RECENT_TASK_BOARD_ID);
  });

  it('filterFlightDeckScopeOptions method filters by query', () => {
    const store = buildMockStore();
    const options = store.flightDeckScopeOptions;
    const filtered = taskBoardStateMixin.filterFlightDeckScopeOptions.call(
      { ...store, flightDeckScopeOptions: options, getTaskBoardSearchText: store.getTaskBoardSearchText },
      'all'
    );
    const ids = filtered.map((o) => o.id);
    expect(ids).toContain(ALL_TASK_BOARD_ID);
  });
});

// --- sidebar scope picker as single source of scope selection ---
describe('sidebar scope picker covers all active scopes', () => {
  function buildMockStore(scopes = [product, project, deliverable], tasks = []) {
    const scopesMap = buildScopesMap(scopes);
    const store = {
      scopes,
      tasks,
      scopesMap,
      boardPickerQuery: '',
      getScopeAncestorPath(id) { return getScopeAncestorPath(id, scopesMap); },
      formatTaskBoardScopeDisplay(scope) { return formatTaskBoardScopeDisplay(scope, scopesMap); },
      getTaskBoardSearchText(id) { return getTaskBoardSearchText(id, scopesMap); },
    };
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(taskBoardStateMixin))) {
      if (descriptor.get) {
        Object.defineProperty(store, key, { get: descriptor.get.bind(store), configurable: true });
      }
    }
    return store;
  }

  it('includes every active scope from taskBoards (except Unscoped)', () => {
    const unscopedTask = { record_id: 't1', record_state: 'active', scope_id: null };
    const store = buildMockStore([product, project, deliverable], [unscopedTask]);
    const sidebarIds = store.flightDeckScopeOptions.map((o) => o.id);
    const inlineIds = store.taskBoards.map((o) => o.id);

    // Sidebar should contain every scope board that the inline selector had
    for (const id of inlineIds) {
      if (id === UNSCOPED_TASK_BOARD_ID) continue; // Unscoped intentionally excluded
      expect(sidebarIds).toContain(id);
    }
  });

  it('sidebar options include all scope levels (product, project, deliverable)', () => {
    const store = buildMockStore();
    const ids = store.flightDeckScopeOptions.map((o) => o.id);
    expect(ids).toContain(product.record_id);
    expect(ids).toContain(project.record_id);
    expect(ids).toContain(deliverable.record_id);
  });

  it('sidebar filterFlightDeckScopeOptions can find scopes by title', () => {
    const store = buildMockStore();
    const filtered = taskBoardStateMixin.filterFlightDeckScopeOptions.call(
      { ...store, flightDeckScopeOptions: store.flightDeckScopeOptions, getTaskBoardSearchText: store.getTaskBoardSearchText },
      'Product X'
    );
    expect(filtered.length).toBeGreaterThanOrEqual(1);
    expect(filtered.some((o) => o.id === product.record_id)).toBe(true);
  });

  it('sidebar filterFlightDeckScopeOptions returns all options with empty query', () => {
    const store = buildMockStore();
    const all = store.flightDeckScopeOptions;
    const filtered = taskBoardStateMixin.filterFlightDeckScopeOptions.call(
      { ...store, flightDeckScopeOptions: all, getTaskBoardSearchText: store.getTaskBoardSearchText },
      ''
    );
    expect(filtered).toEqual(all);
  });
});
