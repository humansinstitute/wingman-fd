import { describe, expect, it } from 'vitest';
import {
  filterSelectableTaskIds,
  getSelectableColumnTaskIds,
  toggleColumnTaskSelection,
} from '../src/task-selection-helpers.js';

describe('task selection helpers', () => {
  it('filters parent summary tasks out of selectable task ids', () => {
    const parentIds = new Set(['parent-1', 'parent-2']);
    expect(filterSelectableTaskIds(['parent-1', 'child-1', 'parent-2'], (taskId) => parentIds.has(taskId))).toEqual([
      'child-1',
    ]);
  });

  it('returns no selectable ids for a summary column containing only parent tasks', () => {
    const parentIds = new Set(['parent-1', 'parent-2']);
    expect(getSelectableColumnTaskIds([
      { record_id: 'parent-1' },
      { record_id: 'parent-2' },
    ], (taskId) => parentIds.has(taskId))).toEqual([]);
  });

  it('toggles a selectable column without selecting summary parents', () => {
    expect(toggleColumnTaskSelection(['existing'], ['child-1', 'child-2'])).toEqual([
      'existing',
      'child-1',
      'child-2',
    ]);
    expect(toggleColumnTaskSelection(['child-1', 'child-2'], ['child-1', 'child-2'])).toEqual([]);
  });
});
