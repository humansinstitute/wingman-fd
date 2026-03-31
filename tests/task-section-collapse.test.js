import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  computeBoardColumns,
  taskBoardStateMixin,
} from '../src/task-board-state.js';

// ---------------------------------------------------------------------------
// Section collapse — pure state tests
// ---------------------------------------------------------------------------

describe('section collapse state', () => {
  let store;

  beforeEach(() => {
    store = {
      collapsedSections: {},
      currentWorkspaceSlug: 'test-ws',
      isSectionCollapsed: taskBoardStateMixin.isSectionCollapsed,
      toggleSectionCollapse: taskBoardStateMixin.toggleSectionCollapse,
      persistCollapsedSections: taskBoardStateMixin.persistCollapsedSections,
    };
  });

  it('isSectionCollapsed returns false for uncollapsed section', () => {
    expect(store.isSectionCollapsed('new')).toBe(false);
  });

  it('isSectionCollapsed returns true after toggling', () => {
    store.toggleSectionCollapse('new');
    expect(store.isSectionCollapsed('new')).toBe(true);
  });

  it('toggleSectionCollapse toggles back to expanded', () => {
    store.toggleSectionCollapse('new');
    store.toggleSectionCollapse('new');
    expect(store.isSectionCollapsed('new')).toBe(false);
  });

  it('tracks multiple sections independently', () => {
    store.toggleSectionCollapse('new');
    store.toggleSectionCollapse('done');
    expect(store.isSectionCollapsed('new')).toBe(true);
    expect(store.isSectionCollapsed('done')).toBe(true);
    expect(store.isSectionCollapsed('in_progress')).toBe(false);
  });

  it('collapsedSections starts as empty object', () => {
    expect(store.collapsedSections).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// localStorage persistence
// ---------------------------------------------------------------------------

describe('section collapse persistence', () => {
  let store;
  const storage = {};
  let origWindow;

  beforeEach(() => {
    // Clear storage mock
    for (const key of Object.keys(storage)) delete storage[key];
    origWindow = globalThis.window;

    globalThis.window = {
      localStorage: {
        getItem: (key) => storage[key] ?? null,
        setItem: (key, val) => { storage[key] = val; },
        removeItem: (key) => { delete storage[key]; },
      },
    };

    store = {
      collapsedSections: {},
      currentWorkspaceSlug: 'test-ws',
      persistCollapsedSections: taskBoardStateMixin.persistCollapsedSections,
      readStoredCollapsedSections: taskBoardStateMixin.readStoredCollapsedSections,
    };
  });

  afterEach(() => {
    globalThis.window = origWindow;
  });

  it('persistCollapsedSections writes to localStorage', () => {
    store.collapsedSections = { new: true, done: true };
    store.persistCollapsedSections();
    const key = `coworker:test-ws:collapsed-sections`;
    expect(storage[key]).toBe(JSON.stringify({ new: true, done: true }));
  });

  it('persistCollapsedSections removes key when all expanded', () => {
    const key = `coworker:test-ws:collapsed-sections`;
    storage[key] = JSON.stringify({ new: true });
    store.collapsedSections = {};
    store.persistCollapsedSections();
    expect(storage[key]).toBeUndefined();
  });

  it('readStoredCollapsedSections restores from localStorage', () => {
    const key = `coworker:test-ws:collapsed-sections`;
    storage[key] = JSON.stringify({ in_progress: true });
    const result = store.readStoredCollapsedSections();
    expect(result).toEqual({ in_progress: true });
  });

  it('readStoredCollapsedSections returns empty object when no stored data', () => {
    const result = store.readStoredCollapsedSections();
    expect(result).toEqual({});
  });

  it('readStoredCollapsedSections handles corrupted JSON gracefully', () => {
    const key = `coworker:test-ws:collapsed-sections`;
    storage[key] = 'not valid json';
    const result = store.readStoredCollapsedSections();
    expect(result).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Board columns are unaffected — collapse is purely UI
// ---------------------------------------------------------------------------

describe('computeBoardColumns is not affected by collapse', () => {
  it('still returns all columns with tasks regardless of collapse state', () => {
    const active = [
      { record_id: 'a1', state: 'new' },
      { record_id: 'a2', state: 'in_progress' },
    ];
    const cols = computeBoardColumns(active, [], []);
    // All 6 standard columns are always returned
    expect(cols).toHaveLength(6);
    expect(cols.find((c) => c.state === 'new').tasks).toHaveLength(1);
    expect(cols.find((c) => c.state === 'in_progress').tasks).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// listGroupedTasks still filters empty groups independently of collapse
// ---------------------------------------------------------------------------

describe('listGroupedTasks ignores collapse', () => {
  it('returns only non-empty columns from boardColumns', () => {
    const mockColumns = [
      { state: 'new', label: 'New', tasks: [{ record_id: 't1' }] },
      { state: 'ready', label: 'Ready', tasks: [] },
      { state: 'in_progress', label: 'In Progress', tasks: [{ record_id: 't2' }] },
      { state: 'done', label: 'Done', tasks: [] },
    ];

    const mockStore = {
      collapsedSections: { new: true },
    };

    // Use the getter directly
    Object.defineProperty(mockStore, 'boardColumns', {
      get: () => mockColumns,
      configurable: true,
    });
    Object.defineProperty(mockStore, 'listGroupedTasks', {
      get: Object.getOwnPropertyDescriptor(taskBoardStateMixin, 'listGroupedTasks').get,
      configurable: true,
    });

    // listGroupedTasks filters by tasks.length > 0 regardless of collapse state
    const result = mockStore.listGroupedTasks;
    expect(result).toHaveLength(2);
    expect(result[0].state).toBe('new');
    expect(result[1].state).toBe('in_progress');
  });
});
