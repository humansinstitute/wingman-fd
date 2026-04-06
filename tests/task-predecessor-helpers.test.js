import { describe, expect, it } from 'vitest';
import {
  buildPredecessorTaskSuggestions,
  describePredecessorRelationship,
  getTaskPredecessorReferenceRows,
  isTaskInSameScopeTree,
  normalizePredecessorTaskIds,
} from '../src/task-predecessor-helpers.js';

const scopesMap = new Map([
  ['scope-l1', { record_id: 'scope-l1', level: 'product', title: 'Product', l1_id: null, l2_id: null, l3_id: null, l4_id: null, l5_id: null }],
  ['scope-l2', { record_id: 'scope-l2', level: 'project', title: 'Project', l1_id: 'scope-l1', l2_id: null, l3_id: null, l4_id: null, l5_id: null }],
  ['scope-l3', { record_id: 'scope-l3', level: 'deliverable', title: 'Deliverable', l1_id: 'scope-l1', l2_id: 'scope-l2', l3_id: null, l4_id: null, l5_id: null }],
  ['scope-l3b', { record_id: 'scope-l3b', level: 'deliverable', title: 'Sibling Deliverable', l1_id: 'scope-l1', l2_id: 'scope-l2', l3_id: null, l4_id: null, l5_id: null }],
  ['scope-l4', { record_id: 'scope-l4', level: 'component', title: 'Component', l1_id: 'scope-l1', l2_id: 'scope-l2', l3_id: 'scope-l3', l4_id: null, l5_id: null }],
]);

function makeTask(overrides = {}) {
  return {
    record_id: 'task-base',
    title: 'Base task',
    record_state: 'active',
    state: 'new',
    scope_id: 'scope-l3',
    scope_l1_id: 'scope-l1',
    scope_l2_id: 'scope-l2',
    scope_l3_id: 'scope-l3',
    scope_l4_id: null,
    scope_l5_id: null,
    predecessor_task_ids: [],
    updated_at: '2026-04-06T00:00:00.000Z',
    ...overrides,
  };
}

describe('task predecessor helpers', () => {
  it('normalizes predecessor ids by removing duplicates and self refs', () => {
    expect(normalizePredecessorTaskIds(['task-1', 'task-1', 'task-2', 'task-self'], 'task-self')).toEqual(['task-1', 'task-2']);
  });

  it('detects tasks in the same scope tree including ancestors and descendants', () => {
    const base = makeTask();
    const ancestor = makeTask({
      record_id: 'task-ancestor',
      scope_id: 'scope-l2',
      scope_l1_id: 'scope-l1',
      scope_l2_id: 'scope-l2',
      scope_l3_id: null,
    });
    const descendant = makeTask({
      record_id: 'task-descendant',
      scope_id: 'scope-l4',
      scope_l4_id: 'scope-l4',
    });
    const siblingBranch = makeTask({
      record_id: 'task-sibling-branch',
      scope_id: 'scope-l3b',
      scope_l3_id: 'scope-l3b',
    });

    expect(isTaskInSameScopeTree(base, ancestor, scopesMap)).toBe(true);
    expect(isTaskInSameScopeTree(base, descendant, scopesMap)).toBe(true);
    expect(isTaskInSameScopeTree(base, siblingBranch, scopesMap)).toBe(false);
  });

  it('prioritizes same-level tasks above ancestors and descendants', () => {
    const base = makeTask({ predecessor_task_ids: ['task-existing'] });
    const sameLevel = makeTask({
      record_id: 'task-same-level',
      title: 'Alpha prep',
      updated_at: '2026-04-06T02:00:00.000Z',
    });
    const ancestor = makeTask({
      record_id: 'task-ancestor',
      title: 'Alpha parent',
      scope_id: 'scope-l2',
      scope_l1_id: 'scope-l1',
      scope_l2_id: 'scope-l2',
      scope_l3_id: null,
      updated_at: '2026-04-06T03:00:00.000Z',
    });
    const descendant = makeTask({
      record_id: 'task-descendant',
      title: 'Alpha child',
      scope_id: 'scope-l4',
      scope_l4_id: 'scope-l4',
      updated_at: '2026-04-06T04:00:00.000Z',
    });
    const otherBranch = makeTask({
      record_id: 'task-other-branch',
      title: 'Alpha elsewhere',
      scope_id: 'scope-l3b',
      scope_l3_id: 'scope-l3b',
      updated_at: '2026-04-06T05:00:00.000Z',
    });

    const suggestions = buildPredecessorTaskSuggestions(
      [base, sameLevel, ancestor, descendant, otherBranch],
      base,
      scopesMap,
      { query: 'alpha', excludedIds: ['task-existing'] },
    );

    expect(suggestions.map((task) => task.record_id)).toEqual([
      'task-same-level',
      'task-ancestor',
      'task-descendant',
      'task-other-branch',
    ]);
  });

  it('describes predecessor relationships for ui copy', () => {
    const base = makeTask();
    const ancestor = makeTask({
      record_id: 'task-ancestor',
      scope_id: 'scope-l2',
      scope_l1_id: 'scope-l1',
      scope_l2_id: 'scope-l2',
      scope_l3_id: null,
    });
    expect(describePredecessorRelationship(base, ancestor, scopesMap)).toBe('Higher level');
  });

  it('returns placeholder rows for missing predecessor ids', () => {
    const task = makeTask({
      predecessor_task_ids: ['task-known', 'task-missing'],
    });
    const rows = getTaskPredecessorReferenceRows(task, [
      makeTask({ record_id: 'task-known', title: 'Known task' }),
    ]);

    expect(rows[0].title).toBe('Known task');
    expect(rows[1].record_id).toBe('task-missing');
    expect(rows[1].missing_predecessor).toBe(true);
  });
});
