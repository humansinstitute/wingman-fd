import { describe, expect, it } from 'vitest';
import {
  getTaskBoardScopeLabel,
  inferTaskScopeLevel,
  isTaskUnscoped,
  matchesTaskBoardScope,
  sortTaskBoardScopes,
} from '../src/task-board-scopes.js';

describe('task board scopes', () => {
  const product = {
    record_id: 'scope-product',
    title: 'Scratch',
    level: 'product',
    parent_id: null,
    record_state: 'active',
  };

  const project = {
    record_id: 'scope-project',
    title: 'Launch',
    level: 'project',
    parent_id: 'scope-product',
    product_id: 'scope-product',
    record_state: 'active',
  };

  const deliverable = {
    record_id: 'scope-deliverable',
    title: 'Website',
    level: 'deliverable',
    parent_id: 'scope-project',
    product_id: 'scope-product',
    project_id: 'scope-project',
    record_state: 'active',
  };

  const scopesMap = new Map([
    [product.record_id, product],
    [project.record_id, project],
    [deliverable.record_id, deliverable],
  ]);

  it('infers task level from scope lineage fields', () => {
    expect(inferTaskScopeLevel({ scope_product_id: 'scope-product' }, scopesMap)).toBe('product');
    expect(inferTaskScopeLevel({ scope_project_id: 'scope-project' }, scopesMap)).toBe('project');
    expect(inferTaskScopeLevel({ scope_deliverable_id: 'scope-deliverable' }, scopesMap)).toBe('deliverable');
  });

  it('builds board labels from scope hierarchy', () => {
    expect(getTaskBoardScopeLabel(product, scopesMap)).toBe('Scratch');
    expect(getTaskBoardScopeLabel(project, scopesMap)).toBe('Scratch > Launch');
    expect(getTaskBoardScopeLabel(deliverable, scopesMap)).toBe('Scratch > Launch > Website');
  });

  it('sorts product, project, then deliverable boards', () => {
    const ordered = sortTaskBoardScopes([deliverable, product, project], scopesMap);
    expect(ordered.map((scope) => scope.record_id)).toEqual([
      'scope-product',
      'scope-project',
      'scope-deliverable',
    ]);
  });

  it('matches product boards to product and project tasks by default', () => {
    const productTask = { scope_id: 'scope-product', scope_product_id: 'scope-product', record_state: 'active' };
    const projectTask = {
      scope_id: 'scope-project',
      scope_product_id: 'scope-product',
      scope_project_id: 'scope-project',
      record_state: 'active',
    };
    const deliverableTask = {
      scope_id: 'scope-deliverable',
      scope_product_id: 'scope-product',
      scope_project_id: 'scope-project',
      scope_deliverable_id: 'scope-deliverable',
      record_state: 'active',
    };

    expect(matchesTaskBoardScope(productTask, product, scopesMap)).toBe(true);
    expect(matchesTaskBoardScope(projectTask, product, scopesMap)).toBe(true);
    expect(matchesTaskBoardScope(deliverableTask, product, scopesMap)).toBe(false);
    expect(matchesTaskBoardScope(deliverableTask, product, scopesMap, { includeDescendants: true })).toBe(true);
  });

  it('matches legacy tasks that only carry scope_id by deriving lineage from scopes', () => {
    const legacyProjectTask = {
      scope_id: 'scope-project',
      record_state: 'active',
    };
    const legacyDeliverableTask = {
      scope_id: 'scope-deliverable',
      record_state: 'active',
    };

    expect(matchesTaskBoardScope(legacyProjectTask, product, scopesMap)).toBe(true);
    expect(matchesTaskBoardScope(legacyProjectTask, project, scopesMap)).toBe(true);
    expect(matchesTaskBoardScope(legacyDeliverableTask, project, scopesMap)).toBe(false);
    expect(matchesTaskBoardScope(legacyDeliverableTask, project, scopesMap, { includeDescendants: true })).toBe(true);
  });

  it('detects truly unscoped tasks', () => {
    expect(isTaskUnscoped({ record_state: 'active' }, scopesMap)).toBe(true);
    expect(isTaskUnscoped({ scope_id: 'scope-project', record_state: 'active' }, scopesMap)).toBe(false);
    expect(isTaskUnscoped({ scope_project_id: 'scope-project', record_state: 'active' }, scopesMap)).toBe(false);
  });

  it('matches project boards to project tasks and optionally deliverables', () => {
    const projectTask = {
      scope_id: 'scope-project',
      scope_product_id: 'scope-product',
      scope_project_id: 'scope-project',
      record_state: 'active',
    };
    const deliverableTask = {
      scope_id: 'scope-deliverable',
      scope_product_id: 'scope-product',
      scope_project_id: 'scope-project',
      scope_deliverable_id: 'scope-deliverable',
      record_state: 'active',
    };

    expect(matchesTaskBoardScope(projectTask, project, scopesMap)).toBe(true);
    expect(matchesTaskBoardScope(deliverableTask, project, scopesMap)).toBe(false);
    expect(matchesTaskBoardScope(deliverableTask, project, scopesMap, { includeDescendants: true })).toBe(true);
  });

  it('matches deliverable boards only to deliverable tasks', () => {
    const deliverableTask = {
      scope_id: 'scope-deliverable',
      scope_product_id: 'scope-product',
      scope_project_id: 'scope-project',
      scope_deliverable_id: 'scope-deliverable',
      record_state: 'active',
    };
    const projectTask = {
      scope_id: 'scope-project',
      scope_product_id: 'scope-product',
      scope_project_id: 'scope-project',
      record_state: 'active',
    };

    expect(matchesTaskBoardScope(deliverableTask, deliverable, scopesMap)).toBe(true);
    expect(matchesTaskBoardScope(projectTask, deliverable, scopesMap)).toBe(false);
  });
});
