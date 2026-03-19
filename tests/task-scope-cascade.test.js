import { describe, expect, it } from 'vitest';

import {
  buildCascadedSubtaskUpdate,
  taskScopeAssignmentChanged,
} from '../src/task-scope-cascade.js';

describe('task scope cascade helpers', () => {
  it('detects scope, group, and share changes that require a cascade', () => {
    const previousTask = {
      scope_id: 'scope-scratch',
      scope_product_id: 'scope-scratch',
      scope_project_id: null,
      scope_deliverable_id: null,
      board_group_id: 'group-private',
      group_ids: ['group-private'],
      shares: [{ key: 'group:group-private', access: 'write' }],
    };
    const nextTask = {
      scope_id: 'scope-project',
      scope_product_id: 'scope-product',
      scope_project_id: 'scope-project',
      scope_deliverable_id: null,
      board_group_id: 'group-delivery',
      group_ids: ['group-delivery', 'group-stakeholders'],
      shares: [{ key: 'group:group-delivery', access: 'write' }],
    };

    expect(taskScopeAssignmentChanged(previousTask, nextTask)).toBe(true);
    expect(taskScopeAssignmentChanged(nextTask, { ...nextTask })).toBe(false);
  });

  it('applies the new scope assignment to a subtask and bumps its write metadata', () => {
    const subtask = {
      record_id: 'task-sub-1',
      parent_task_id: 'task-parent-1',
      scope_id: 'scope-scratch',
      scope_product_id: 'scope-scratch',
      scope_project_id: null,
      scope_deliverable_id: null,
      board_group_id: 'group-private',
      group_ids: ['group-private'],
      shares: [{ key: 'group:group-private', access: 'write' }],
      version: 4,
      sync_status: 'synced',
      updated_at: '2026-03-18T00:00:00.000Z',
    };
    const assignment = {
      scope_id: 'scope-project',
      scope_product_id: 'scope-product',
      scope_project_id: 'scope-project',
      scope_deliverable_id: null,
      board_group_id: 'group-delivery',
      group_ids: ['group-delivery', 'group-stakeholders'],
      shares: [
        { key: 'group:group-delivery', access: 'write' },
        { key: 'group:group-stakeholders', access: 'write' },
      ],
    };

    expect(buildCascadedSubtaskUpdate(subtask, assignment, '2026-03-18T12:34:56.000Z')).toEqual({
      ...subtask,
      ...assignment,
      version: 5,
      sync_status: 'pending',
      updated_at: '2026-03-18T12:34:56.000Z',
    });
  });
});
