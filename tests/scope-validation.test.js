import { describe, expect, it } from 'vitest';
import {
  taskBoardStateMixin,
  ALL_TASK_BOARD_ID,
  RECENT_TASK_BOARD_ID,
  UNSCOPED_TASK_BOARD_ID,
  getScopeAncestorPath,
  formatTaskBoardScopeDisplay,
  getTaskBoardSearchText,
} from '../src/task-board-state.js';
import {
  isTaskUnscoped,
  matchesTaskBoardScope,
  sortTaskBoardScopes,
} from '../src/task-board-scopes.js';

// --- fixtures ---

const scopeA = {
  record_id: 'scope-a',
  title: 'Product A',
  level: 'product',
  parent_id: null,
  record_state: 'active',
};

const scopeB = {
  record_id: 'scope-b',
  title: 'Project B',
  level: 'project',
  parent_id: 'scope-a',
  l1_id: 'scope-a',
  record_state: 'active',
};

function buildScopesMap(scopes = [scopeA, scopeB]) {
  const m = new Map();
  for (const s of scopes) m.set(s.record_id, s);
  return m;
}

function buildMockStore({ scopes = [scopeA, scopeB], tasks = [], scopesLoaded = true } = {}) {
  const scopesMap = buildScopesMap(scopes);
  const store = {
    scopes,
    tasks,
    scopesMap,
    scopesLoaded,
    selectedBoardId: null,
    showBoardDescendantTasks: false,
    boardPickerQuery: '',
    taskBoardScopeSetupInFlight: false,
    currentWorkspaceSlug: 'test-ws',
    _persistedBoardId: null,
    getScopeAncestorPath(id) { return getScopeAncestorPath(id, scopesMap); },
    formatTaskBoardScopeDisplay(scope) { return formatTaskBoardScopeDisplay(scope, scopesMap); },
    getTaskBoardSearchText(id) { return getTaskBoardSearchText(id, scopesMap); },
    persistSelectedBoardId(id) { store._persistedBoardId = id; },
    getWorkspaceSettingsGroupRef() { return null; },
    getScopeShareGroupIds() { return []; },
    getDefaultPrivateShares() { return []; },
    buildScopeDefaultShares() { return []; },
  };
  // Bind mixin getters
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(taskBoardStateMixin))) {
    if (descriptor.get) {
      Object.defineProperty(store, key, { get: descriptor.get.bind(store), configurable: true });
    } else if (typeof descriptor.value === 'function') {
      store[key] = descriptor.value.bind(store);
    }
  }
  return store;
}

// --------------------------------------------------------------------------
// Core validation: does not clobber scope-based board when scopes not loaded
// --------------------------------------------------------------------------

describe('validateSelectedBoardId — scope loading guard', () => {
  it('preserves a scope-based board ID when scopes have not loaded yet', () => {
    const store = buildMockStore({ scopes: [], scopesLoaded: false });
    store.selectedBoardId = 'scope-a';
    store.validateSelectedBoardId();
    expect(store.selectedBoardId).toBe('scope-a');
  });

  it('resets a scope-based board ID that is genuinely missing after scopes load', () => {
    const store = buildMockStore({ scopes: [scopeA], scopesLoaded: true });
    store.selectedBoardId = 'scope-nonexistent';
    store.validateSelectedBoardId();
    // Should be reset to a valid board
    expect(store.selectedBoardId).not.toBe('scope-nonexistent');
  });

  it('preserves a valid scope-based board ID after scopes load', () => {
    const store = buildMockStore({ scopes: [scopeA, scopeB], scopesLoaded: true });
    store.selectedBoardId = 'scope-a';
    store.validateSelectedBoardId();
    expect(store.selectedBoardId).toBe('scope-a');
  });

  it('always validates system board IDs even before scopes load', () => {
    const store = buildMockStore({ scopes: [], scopesLoaded: false });
    store.selectedBoardId = ALL_TASK_BOARD_ID;
    store.validateSelectedBoardId();
    expect(store.selectedBoardId).toBe(ALL_TASK_BOARD_ID);
  });

  it('always validates RECENT board even before scopes load', () => {
    const store = buildMockStore({ scopes: [], scopesLoaded: false });
    store.selectedBoardId = RECENT_TASK_BOARD_ID;
    store.validateSelectedBoardId();
    expect(store.selectedBoardId).toBe(RECENT_TASK_BOARD_ID);
  });

  it('sets preferred board when selectedBoardId is null regardless of scopesLoaded', () => {
    const store = buildMockStore({ scopes: [], scopesLoaded: false });
    store.selectedBoardId = null;
    store.validateSelectedBoardId();
    // With no scopes and no tasks, should default to ALL
    expect(store.selectedBoardId).toBeTruthy();
  });
});

// --------------------------------------------------------------------------
// Post-sync / post-task-creation: scope selection stability
// --------------------------------------------------------------------------

describe('validateSelectedBoardId — post-sync stability', () => {
  it('does not reset scope board after sync refreshes scopes with the same set', () => {
    const store = buildMockStore({ scopes: [scopeA, scopeB], scopesLoaded: true });
    store.selectedBoardId = 'scope-b';
    // Simulate post-sync validation
    store.validateSelectedBoardId();
    expect(store.selectedBoardId).toBe('scope-b');
  });

  it('preserves scope board when a new scope is added during sync', () => {
    const scopeC = { record_id: 'scope-c', title: 'New scope', level: 'product', parent_id: null, record_state: 'active' };
    const store = buildMockStore({ scopes: [scopeA, scopeB, scopeC], scopesLoaded: true });
    store.selectedBoardId = 'scope-b';
    store.validateSelectedBoardId();
    expect(store.selectedBoardId).toBe('scope-b');
  });

  it('resets to preferred board when selected scope is deleted during sync', () => {
    // Only scopeA exists; scopeB was deleted
    const store = buildMockStore({ scopes: [scopeA], scopesLoaded: true });
    store.selectedBoardId = 'scope-b';
    store.validateSelectedBoardId();
    expect(store.selectedBoardId).not.toBe('scope-b');
  });
});

// --------------------------------------------------------------------------
// ensureTaskBoardScopeSetup guards
// --------------------------------------------------------------------------

describe('ensureTaskBoardScopeSetup', () => {
  it('calls validateSelectedBoardId', async () => {
    const store = buildMockStore({ scopes: [scopeA], scopesLoaded: true });
    store.selectedBoardId = 'scope-a';
    await store.ensureTaskBoardScopeSetup();
    expect(store.selectedBoardId).toBe('scope-a');
  });

  it('does not run concurrently (inflight guard)', async () => {
    const store = buildMockStore({ scopes: [scopeA], scopesLoaded: true });
    store.selectedBoardId = 'scope-a';
    store.taskBoardScopeSetupInFlight = true;
    // Should be a no-op
    await store.ensureTaskBoardScopeSetup();
    expect(store.selectedBoardId).toBe('scope-a');
  });
});
