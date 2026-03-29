import { describe, expect, it } from 'vitest';
import {
  normalizeScopeLevel,
  scopeDepth,
  scopeLevelLabel,
  SCOPE_LEVELS,
  LEGACY_LEVEL_MAP,
  levelLabel,
  resolveScopeChain,
  searchScopes,
  scopeBreadcrumb,
} from '../src/translators/scopes.js';
import {
  deriveScopeHierarchy,
  buildScopeTags,
  defaultScopeGroupIds,
  buildScopeLineage,
} from '../src/scope-delivery.js';
import {
  matchesTaskBoardScope,
  sortTaskBoardScopes,
  inferTaskScopeLevel,
  isTaskUnscoped,
  getTaskBoardScopeLabel,
} from '../src/task-board-scopes.js';
import {
  getAvailableParents,
} from '../src/scopes-manager.js';

// ---------------------------------------------------------------------------
// Helper factories
// ---------------------------------------------------------------------------

function makeScope(id, level, parentId = null, extras = {}) {
  return {
    record_id: id,
    level,
    title: extras.title ?? id,
    description: extras.description ?? '',
    parent_id: parentId,
    l1_id: extras.l1_id ?? null,
    l2_id: extras.l2_id ?? null,
    l3_id: extras.l3_id ?? null,
    l4_id: extras.l4_id ?? null,
    l5_id: extras.l5_id ?? null,
    group_ids: extras.group_ids ?? [],
    record_state: extras.record_state ?? 'active',
  };
}

function makeScopesMap(...scopes) {
  return new Map(scopes.map(s => [s.record_id, s]));
}

// ---------------------------------------------------------------------------
// 1. Generic level helpers
// ---------------------------------------------------------------------------

describe('generic scope level helpers', () => {
  describe('normalizeScopeLevel', () => {
    it('passes through canonical l1-l5 levels unchanged', () => {
      expect(normalizeScopeLevel('l1')).toBe('l1');
      expect(normalizeScopeLevel('l2')).toBe('l2');
      expect(normalizeScopeLevel('l3')).toBe('l3');
      expect(normalizeScopeLevel('l4')).toBe('l4');
      expect(normalizeScopeLevel('l5')).toBe('l5');
    });

    it('maps legacy product/project/deliverable to l1/l2/l3', () => {
      expect(normalizeScopeLevel('product')).toBe('l1');
      expect(normalizeScopeLevel('project')).toBe('l2');
      expect(normalizeScopeLevel('deliverable')).toBe('l3');
    });

    it('returns null for unknown or falsy levels', () => {
      expect(normalizeScopeLevel(null)).toBeNull();
      expect(normalizeScopeLevel(undefined)).toBeNull();
      expect(normalizeScopeLevel('')).toBeNull();
      expect(normalizeScopeLevel('banana')).toBeNull();
    });
  });

  describe('scopeDepth', () => {
    it('returns 1-5 for canonical levels', () => {
      expect(scopeDepth('l1')).toBe(1);
      expect(scopeDepth('l2')).toBe(2);
      expect(scopeDepth('l3')).toBe(3);
      expect(scopeDepth('l4')).toBe(4);
      expect(scopeDepth('l5')).toBe(5);
    });

    it('returns correct depth for legacy levels', () => {
      expect(scopeDepth('product')).toBe(1);
      expect(scopeDepth('project')).toBe(2);
      expect(scopeDepth('deliverable')).toBe(3);
    });

    it('returns 0 for unknown levels', () => {
      expect(scopeDepth(null)).toBe(0);
      expect(scopeDepth('banana')).toBe(0);
    });
  });

  describe('scopeLevelLabel', () => {
    it('returns L1-L5 labels for canonical levels', () => {
      expect(scopeLevelLabel('l1')).toBe('L1');
      expect(scopeLevelLabel('l2')).toBe('L2');
      expect(scopeLevelLabel('l3')).toBe('L3');
      expect(scopeLevelLabel('l4')).toBe('L4');
      expect(scopeLevelLabel('l5')).toBe('L5');
    });

    it('returns L1-L3 for legacy levels', () => {
      expect(scopeLevelLabel('product')).toBe('L1');
      expect(scopeLevelLabel('project')).toBe('L2');
      expect(scopeLevelLabel('deliverable')).toBe('L3');
    });

    it('returns empty string for unknown levels', () => {
      expect(scopeLevelLabel(null)).toBe('');
      expect(scopeLevelLabel('')).toBe('');
    });
  });

  describe('SCOPE_LEVELS includes all canonical levels', () => {
    it('contains l1 through l5', () => {
      expect(SCOPE_LEVELS).toEqual(['l1', 'l2', 'l3', 'l4', 'l5']);
    });
  });

  describe('LEGACY_LEVEL_MAP provides readable compat mapping', () => {
    it('maps product->l1, project->l2, deliverable->l3', () => {
      expect(LEGACY_LEVEL_MAP.product).toBe('l1');
      expect(LEGACY_LEVEL_MAP.project).toBe('l2');
      expect(LEGACY_LEVEL_MAP.deliverable).toBe('l3');
    });
  });

  describe('levelLabel backward compat', () => {
    it('still returns L1-L5 style labels for any level', () => {
      expect(levelLabel('product')).toBe('L1');
      expect(levelLabel('l2')).toBe('L2');
      expect(levelLabel('deliverable')).toBe('L3');
    });
  });
});

// ---------------------------------------------------------------------------
// 2. resolveScopeChain — depth-driven
// ---------------------------------------------------------------------------

describe('resolveScopeChain with generic levels', () => {
  it('resolves an l1 scope', () => {
    const l1 = makeScope('s1', 'l1');
    const map = makeScopesMap(l1);
    expect(resolveScopeChain('s1', map)).toEqual({
      scope_l1_id: 's1',
      scope_l2_id: null,
      scope_l3_id: null,
      scope_l4_id: null,
      scope_l5_id: null,
    });
  });

  it('resolves an l2 scope', () => {
    const l1 = makeScope('s1', 'l1');
    const l2 = makeScope('s2', 'l2', 's1', { l1_id: 's1' });
    const map = makeScopesMap(l1, l2);
    expect(resolveScopeChain('s2', map)).toEqual({
      scope_l1_id: 's1',
      scope_l2_id: 's2',
      scope_l3_id: null,
      scope_l4_id: null,
      scope_l5_id: null,
    });
  });

  it('resolves an l3 scope', () => {
    const l1 = makeScope('s1', 'l1');
    const l2 = makeScope('s2', 'l2', 's1', { l1_id: 's1' });
    const l3 = makeScope('s3', 'l3', 's2', { l1_id: 's1', l2_id: 's2' });
    const map = makeScopesMap(l1, l2, l3);
    expect(resolveScopeChain('s3', map)).toEqual({
      scope_l1_id: 's1',
      scope_l2_id: 's2',
      scope_l3_id: 's3',
      scope_l4_id: null,
      scope_l5_id: null,
    });
  });

  it('resolves legacy product/project/deliverable levels identically', () => {
    const product = makeScope('p1', 'product');
    const project = makeScope('p2', 'project', 'p1', { l1_id: 'p1' });
    const deliverable = makeScope('p3', 'deliverable', 'p2', { l1_id: 'p1', l2_id: 'p2' });
    const map = makeScopesMap(product, project, deliverable);

    expect(resolveScopeChain('p1', map)).toEqual({
      scope_l1_id: 'p1',
      scope_l2_id: null,
      scope_l3_id: null,
      scope_l4_id: null,
      scope_l5_id: null,
    });
    expect(resolveScopeChain('p3', map)).toEqual({
      scope_l1_id: 'p1',
      scope_l2_id: 'p2',
      scope_l3_id: 'p3',
      scope_l4_id: null,
      scope_l5_id: null,
    });
  });
});

// ---------------------------------------------------------------------------
// 3. searchScopes — groups by generic level
// ---------------------------------------------------------------------------

describe('searchScopes with generic levels', () => {
  const l1 = makeScope('s1', 'l1', null, { title: 'Alpha' });
  const l2 = makeScope('s2', 'l2', 's1', { title: 'Beta' });
  const legacyProduct = makeScope('s3', 'product', null, { title: 'Gamma' });
  const scopes = [l1, l2, legacyProduct];
  const map = makeScopesMap(...scopes);

  it('groups scopes by normalized level key', () => {
    const result = searchScopes('', scopes, map);
    // l1 group should contain both l1 and legacy product scopes
    expect(result.l1.map(s => s.record_id)).toContain('s1');
    expect(result.l1.map(s => s.record_id)).toContain('s3');
    expect(result.l2.map(s => s.record_id)).toContain('s2');
  });

  it('filters by query', () => {
    const result = searchScopes('alpha', scopes, map);
    expect(result.l1).toHaveLength(1);
    expect(result.l1[0].record_id).toBe('s1');
  });
});

// ---------------------------------------------------------------------------
// 4. scope-delivery: depth-driven hierarchy
// ---------------------------------------------------------------------------

describe('deriveScopeHierarchy depth-driven', () => {
  it('derives hierarchy for l1 (no parent)', () => {
    expect(deriveScopeHierarchy({ parentId: null, scopesMap: new Map() })).toEqual({
      parent_id: null,
      level: 'l1',
      l1_id: null,
      l2_id: null,
      l3_id: null,
      l4_id: null,
      l5_id: null,
    });
  });

  it('derives hierarchy for l2 with l1 parent', () => {
    const l1 = makeScope('s1', 'l1');
    const map = makeScopesMap(l1);
    expect(deriveScopeHierarchy({ parentId: 's1', scopesMap: map })).toEqual({
      parent_id: 's1',
      level: 'l2',
      l1_id: 's1',
      l2_id: null,
      l3_id: null,
      l4_id: null,
      l5_id: null,
    });
  });

  it('derives hierarchy for l3 with l2 parent', () => {
    const l1 = makeScope('s1', 'l1');
    const l2 = makeScope('s2', 'l2', 's1', { l1_id: 's1' });
    const map = makeScopesMap(l1, l2);
    expect(deriveScopeHierarchy({ parentId: 's2', scopesMap: map })).toEqual({
      parent_id: 's2',
      level: 'l3',
      l1_id: 's1',
      l2_id: 's2',
      l3_id: null,
      l4_id: null,
      l5_id: null,
    });
  });

  it('still works with legacy product/project/deliverable levels', () => {
    const product = makeScope('p1', 'product');
    const project = makeScope('p2', 'project', 'p1', { l1_id: 'p1' });
    const map = makeScopesMap(product, project);

    expect(deriveScopeHierarchy({ parentId: 'p1', scopesMap: map })).toEqual({
      parent_id: 'p1',
      level: 'l2',
      l1_id: 'p1',
      l2_id: null,
      l3_id: null,
      l4_id: null,
      l5_id: null,
    });

    expect(deriveScopeHierarchy({ parentId: 'p2', scopesMap: map })).toEqual({
      parent_id: 'p2',
      level: 'l3',
      l1_id: 'p1',
      l2_id: 'p2',
      l3_id: null,
      l4_id: null,
      l5_id: null,
    });
  });
});

describe('buildScopeTags depth-driven', () => {
  it('builds tags for an l1 scope', () => {
    expect(buildScopeTags({ record_id: 's1', level: 'l1' })).toEqual({
      scope_id: 's1',
      scope_l1_id: 's1',
      scope_l2_id: null,
      scope_l3_id: null,
      scope_l4_id: null,
      scope_l5_id: null,
    });
  });

  it('builds tags for an l2 scope', () => {
    expect(buildScopeTags({ record_id: 's2', level: 'l2', l1_id: 's1', parent_id: 's1' })).toEqual({
      scope_id: 's2',
      scope_l1_id: 's1',
      scope_l2_id: 's2',
      scope_l3_id: null,
      scope_l4_id: null,
      scope_l5_id: null,
    });
  });

  it('builds tags for an l3 scope', () => {
    expect(buildScopeTags({
      record_id: 's3',
      level: 'l3',
      l1_id: 's1',
      l2_id: 's2',
      parent_id: 's2',
    })).toEqual({
      scope_id: 's3',
      scope_l1_id: 's1',
      scope_l2_id: 's2',
      scope_l3_id: 's3',
      scope_l4_id: null,
      scope_l5_id: null,
    });
  });

  it('still works with legacy levels', () => {
    expect(buildScopeTags({ record_id: 'p1', level: 'product' })).toEqual({
      scope_id: 'p1',
      scope_l1_id: 'p1',
      scope_l2_id: null,
      scope_l3_id: null,
      scope_l4_id: null,
      scope_l5_id: null,
    });
  });
});

describe('defaultScopeGroupIds depth-driven', () => {
  it('inherits groups from parent for any non-root level', () => {
    const l1 = makeScope('s1', 'l1', null, { group_ids: ['g1'] });
    const map = makeScopesMap(l1);
    expect(defaultScopeGroupIds({ level: 'l2', parentId: 's1', scopesMap: map })).toEqual(['g1']);
  });

  it('falls back for root l1 level', () => {
    expect(defaultScopeGroupIds({ level: 'l1', parentId: null, scopesMap: new Map(), fallbackGroupId: 'g-priv' }))
      .toEqual(['g-priv']);
  });
});

// ---------------------------------------------------------------------------
// 5. task-board-scopes: depth-driven matching
// ---------------------------------------------------------------------------

describe('task board scopes depth-driven', () => {
  // Build a 3-level hierarchy using canonical levels
  const l1 = makeScope('scope-l1', 'l1', null, { title: 'Product' });
  const l2 = makeScope('scope-l2', 'l2', 'scope-l1', { title: 'Project', l1_id: 'scope-l1' });
  const l3 = makeScope('scope-l3', 'l3', 'scope-l2', { title: 'Feature', l1_id: 'scope-l1', l2_id: 'scope-l2' });
  const scopesMap = makeScopesMap(l1, l2, l3);

  it('infers scope level from scope_id for canonical levels', () => {
    expect(inferTaskScopeLevel({ scope_id: 'scope-l1' }, scopesMap)).toBe('l1');
    expect(inferTaskScopeLevel({ scope_id: 'scope-l2' }, scopesMap)).toBe('l2');
    expect(inferTaskScopeLevel({ scope_id: 'scope-l3' }, scopesMap)).toBe('l3');
  });

  it('infers scope level from lineage fields', () => {
    expect(inferTaskScopeLevel({ scope_l5_id: 'x' }, scopesMap)).toBe('l5');
    expect(inferTaskScopeLevel({ scope_l4_id: 'x' }, scopesMap)).toBe('l4');
    expect(inferTaskScopeLevel({ scope_l3_id: 'x' }, scopesMap)).toBe('l3');
    expect(inferTaskScopeLevel({ scope_l2_id: 'x' }, scopesMap)).toBe('l2');
    expect(inferTaskScopeLevel({ scope_l1_id: 'x' }, scopesMap)).toBe('l1');
  });

  it('sorts by depth then title', () => {
    const sorted = sortTaskBoardScopes([l3, l1, l2], scopesMap);
    expect(sorted.map(s => s.record_id)).toEqual(['scope-l1', 'scope-l2', 'scope-l3']);
  });

  it('matches l1 board: exact and descendant tasks', () => {
    const l1Task = { scope_id: 'scope-l1', scope_l1_id: 'scope-l1', record_state: 'active' };
    const l2Task = { scope_id: 'scope-l2', scope_l1_id: 'scope-l1', scope_l2_id: 'scope-l2', record_state: 'active' };
    const l3Task = { scope_id: 'scope-l3', scope_l1_id: 'scope-l1', scope_l2_id: 'scope-l2', scope_l3_id: 'scope-l3', record_state: 'active' };

    expect(matchesTaskBoardScope(l1Task, l1, scopesMap)).toBe(true);
    // Without descendants, l3 tasks should not appear on l1 board
    expect(matchesTaskBoardScope(l3Task, l1, scopesMap)).toBe(false);
    expect(matchesTaskBoardScope(l3Task, l1, scopesMap, { includeDescendants: true })).toBe(true);
  });

  it('matches l2 board: exact and descendant tasks', () => {
    const l2Task = { scope_id: 'scope-l2', scope_l1_id: 'scope-l1', scope_l2_id: 'scope-l2', record_state: 'active' };
    const l3Task = { scope_id: 'scope-l3', scope_l1_id: 'scope-l1', scope_l2_id: 'scope-l2', scope_l3_id: 'scope-l3', record_state: 'active' };

    expect(matchesTaskBoardScope(l2Task, l2, scopesMap)).toBe(true);
    expect(matchesTaskBoardScope(l3Task, l2, scopesMap)).toBe(false);
    expect(matchesTaskBoardScope(l3Task, l2, scopesMap, { includeDescendants: true })).toBe(true);
  });

  it('matches l3 board: exact only', () => {
    const l3Task = { scope_id: 'scope-l3', scope_l1_id: 'scope-l1', scope_l2_id: 'scope-l2', scope_l3_id: 'scope-l3', record_state: 'active' };
    const l2Task = { scope_id: 'scope-l2', scope_l1_id: 'scope-l1', scope_l2_id: 'scope-l2', record_state: 'active' };

    expect(matchesTaskBoardScope(l3Task, l3, scopesMap)).toBe(true);
    expect(matchesTaskBoardScope(l2Task, l3, scopesMap)).toBe(false);
  });

  it('detects unscoped tasks regardless of canonical vs legacy', () => {
    expect(isTaskUnscoped({ record_state: 'active' }, scopesMap)).toBe(true);
    expect(isTaskUnscoped({ scope_id: 'scope-l1', record_state: 'active' }, scopesMap)).toBe(false);
  });

  it('builds board labels with breadcrumb', () => {
    expect(getTaskBoardScopeLabel(l1, scopesMap)).toBe('Product');
    expect(getTaskBoardScopeLabel(l2, scopesMap)).toBe('Product > Project');
    expect(getTaskBoardScopeLabel(l3, scopesMap)).toBe('Product > Project > Feature');
  });
});

// ---------------------------------------------------------------------------
// 6. scopes-manager: getAvailableParents depth-driven
// ---------------------------------------------------------------------------

describe('getAvailableParents depth-driven', () => {
  const scopes = [
    makeScope('s1', 'l1', null, { title: 'Product A' }),
    makeScope('s2', 'l1', null, { title: 'Product B', record_state: 'deleted' }),
    makeScope('s3', 'l2', 's1', { title: 'Project X' }),
    makeScope('s4', 'l3', 's3', { title: 'Feature Y' }),
  ];

  it('returns empty for l1', () => {
    expect(getAvailableParents(scopes, 'l1')).toEqual([]);
  });

  it('returns l1 scopes as parents for l2', () => {
    const result = getAvailableParents(scopes, 'l2');
    expect(result).toHaveLength(1);
    expect(result[0].record_id).toBe('s1');
  });

  it('returns l2 scopes as parents for l3', () => {
    const result = getAvailableParents(scopes, 'l3');
    expect(result).toHaveLength(1);
    expect(result[0].record_id).toBe('s3');
  });

  it('returns l3 scopes as parents for l4', () => {
    const result = getAvailableParents(scopes, 'l4');
    expect(result).toHaveLength(1);
    expect(result[0].record_id).toBe('s4');
  });

  it('still works with legacy level names as input', () => {
    // Legacy scopes mixed in
    const mixed = [
      makeScope('p1', 'product', null, { title: 'Legacy Product' }),
      makeScope('p2', 'project', 'p1', { title: 'Legacy Project' }),
    ];
    // Asking for parents of 'project' should return products
    const result = getAvailableParents(mixed, 'project');
    expect(result).toHaveLength(1);
    expect(result[0].record_id).toBe('p1');

    // Asking for parents of 'l2' should also return legacy products
    const result2 = getAvailableParents(mixed, 'l2');
    expect(result2).toHaveLength(1);
    expect(result2[0].record_id).toBe('p1');
  });
});

// ---------------------------------------------------------------------------
// 7. Existing tests still pass with legacy data (backward compat)
// ---------------------------------------------------------------------------

describe('backward compatibility: existing legacy data still works', () => {
  const product = makeScope('scope-product', 'product', null, { title: 'Scratch' });
  const project = makeScope('scope-project', 'project', 'scope-product', { title: 'Launch', l1_id: 'scope-product' });
  const deliverable = makeScope('scope-deliverable', 'deliverable', 'scope-project', {
    title: 'Website',
    l1_id: 'scope-product',
    l2_id: 'scope-project',
  });
  const scopesMap = makeScopesMap(product, project, deliverable);

  it('resolveScopeChain still works for legacy product', () => {
    expect(resolveScopeChain('scope-product', scopesMap)).toEqual({
      scope_l1_id: 'scope-product',
      scope_l2_id: null,
      scope_l3_id: null,
      scope_l4_id: null,
      scope_l5_id: null,
    });
  });

  it('resolveScopeChain still works for legacy deliverable', () => {
    expect(resolveScopeChain('scope-deliverable', scopesMap)).toEqual({
      scope_l1_id: 'scope-product',
      scope_l2_id: 'scope-project',
      scope_l3_id: 'scope-deliverable',
      scope_l4_id: null,
      scope_l5_id: null,
    });
  });

  it('buildScopeTags still works for legacy project', () => {
    expect(buildScopeTags(project)).toEqual({
      scope_id: 'scope-project',
      scope_l1_id: 'scope-product',
      scope_l2_id: 'scope-project',
      scope_l3_id: null,
      scope_l4_id: null,
      scope_l5_id: null,
    });
  });

  it('matchesTaskBoardScope still works for legacy scoped tasks', () => {
    const deliverableTask = {
      scope_id: 'scope-deliverable',
      scope_l1_id: 'scope-product',
      scope_l2_id: 'scope-project',
      scope_l3_id: 'scope-deliverable',
      record_state: 'active',
    };

    expect(matchesTaskBoardScope(deliverableTask, deliverable, scopesMap)).toBe(true);
    expect(matchesTaskBoardScope(deliverableTask, project, scopesMap)).toBe(false);
    expect(matchesTaskBoardScope(deliverableTask, project, scopesMap, { includeDescendants: true })).toBe(true);
  });

  it('buildScopeLineage traverses legacy data correctly', () => {
    const lineage = buildScopeLineage(deliverable, scopesMap);
    expect(lineage.map(s => s.record_id)).toEqual(['scope-product', 'scope-project', 'scope-deliverable']);
  });

  it('scopeBreadcrumb works for legacy data', () => {
    expect(scopeBreadcrumb('scope-deliverable', scopesMap)).toBe('Scratch > Launch > Website');
  });
});
