import { describe, expect, it } from 'vitest';

import {
  buildScopeShares,
  buildScopeTags,
  defaultScopeGroupIds,
  deriveScopeHierarchy,
  normalizeGroupIds,
} from '../src/scope-delivery.js';

describe('scope delivery helpers', () => {
  it('normalizes unique group ids', () => {
    expect(normalizeGroupIds(['group-a', 'group-a', '', null, 'group-b']))
      .toEqual(['group-a', 'group-b']);
  });

  it('derives project and deliverable hierarchy from parents', () => {
    const product = { record_id: 'product-1', level: 'product', parent_id: null, l1_id: null, l2_id: null };
    const project = { record_id: 'project-1', level: 'project', parent_id: 'product-1', l1_id: 'product-1', l2_id: null };
    const scopesMap = new Map([
      [product.record_id, product],
      [project.record_id, project],
    ]);

    expect(deriveScopeHierarchy({ parentId: 'product-1', scopesMap })).toEqual({
      parent_id: 'product-1',
      level: 'l2',
      l1_id: 'product-1',
      l2_id: null,
      l3_id: null,
      l4_id: null,
      l5_id: null,
    });

    expect(deriveScopeHierarchy({ parentId: 'project-1', scopesMap })).toEqual({
      parent_id: 'project-1',
      level: 'l3',
      l1_id: 'product-1',
      l2_id: 'project-1',
      l3_id: null,
      l4_id: null,
      l5_id: null,
    });
  });

  it('inherits default scope groups from the parent scope when present', () => {
    const scopesMap = new Map([
      ['product-1', { record_id: 'product-1', level: 'product', group_ids: ['group-product'] }],
    ]);

    expect(defaultScopeGroupIds({
      level: 'project',
      parentId: 'product-1',
      scopesMap,
      fallbackGroupId: 'group-private',
    })).toEqual(['group-product']);
  });

  it('falls back to the private group for top-level scopes', () => {
    expect(defaultScopeGroupIds({
      level: 'product',
      parentId: null,
      scopesMap: new Map(),
      fallbackGroupId: 'group-private',
    })).toEqual(['group-private']);
  });

  it('builds writable group shares for scope defaults', () => {
    expect(buildScopeShares(['group-a'], [{ group_id: 'group-a', name: 'Delivery' }])).toEqual([
      {
        type: 'group',
        key: 'group:group-a',
        access: 'write',
        label: 'Delivery',
        person_npub: null,
        group_npub: 'group-a',
        via_group_npub: null,
        inherited: false,
        inherited_from_directory_id: null,
      },
    ]);
  });

  it('builds scope tags for directories', () => {
    expect(buildScopeTags({ record_id: 'product-1', level: 'product' })).toEqual({
      scope_id: 'product-1',
      scope_l1_id: 'product-1',
      scope_l2_id: null,
      scope_l3_id: null,
      scope_l4_id: null,
      scope_l5_id: null,
    });

    expect(buildScopeTags({
      record_id: 'deliverable-1',
      level: 'deliverable',
      l1_id: 'product-1',
      l2_id: 'project-1',
    })).toEqual({
      scope_id: 'deliverable-1',
      scope_l1_id: 'product-1',
      scope_l2_id: 'project-1',
      scope_l3_id: 'deliverable-1',
      scope_l4_id: null,
      scope_l5_id: null,
    });
  });

});
