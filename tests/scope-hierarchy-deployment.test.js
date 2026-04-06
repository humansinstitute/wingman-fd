import { describe, expect, it } from 'vitest';
import {
  normalizeScopeLevel,
  scopeDepth,
  scopeLevelLabel,
  resolveScopeChain,
  searchScopes,
  scopeBreadcrumb,
} from '../src/translators/scopes.js';
import {
  deriveScopeHierarchy,
  buildScopeTags,
} from '../src/scope-delivery.js';
import {
  matchesTaskBoardScope,
  inferTaskScopeLevel,
  isTaskUnscoped,
  getTaskBoardScopeLabel,
  sortTaskBoardScopes,
} from '../src/task-board-scopes.js';
import {
  getAvailableParents,
  readScopeAssignment,
  sameScopeAssignment,
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

// Build a full 5-level hierarchy for testing
const l1 = makeScope('s1', 'l1', null, { title: 'Org', l1_id: 's1' });
const l2 = makeScope('s2', 'l2', 's1', { title: 'Division', l1_id: 's1', l2_id: 's2' });
const l3 = makeScope('s3', 'l3', 's2', { title: 'Team', l1_id: 's1', l2_id: 's2', l3_id: 's3' });
const l4 = makeScope('s4', 'l4', 's3', { title: 'Project', l1_id: 's1', l2_id: 's2', l3_id: 's3', l4_id: 's4' });
const l5 = makeScope('s5', 'l5', 's4', { title: 'Task Group', l1_id: 's1', l2_id: 's2', l3_id: 's3', l4_id: 's4', l5_id: 's5' });
const allScopes = [l1, l2, l3, l4, l5];
const fullMap = makeScopesMap(...allScopes);

// ---------------------------------------------------------------------------
// 1. Depth 4-5 hierarchy derivation
// ---------------------------------------------------------------------------

describe('depth 4-5 scope hierarchy derivation', () => {
  it('derives l4 hierarchy from l3 parent', () => {
    const result = deriveScopeHierarchy({ parentId: 's3', scopesMap: fullMap });
    expect(result).toEqual({
      parent_id: 's3',
      level: 'l4',
      l1_id: 's1',
      l2_id: 's2',
      l3_id: 's3',
      l4_id: null,
      l5_id: null,
    });
  });

  it('derives l5 hierarchy from l4 parent', () => {
    const result = deriveScopeHierarchy({ parentId: 's4', scopesMap: fullMap });
    expect(result).toEqual({
      parent_id: 's4',
      level: 'l5',
      l1_id: 's1',
      l2_id: 's2',
      l3_id: 's3',
      l4_id: 's4',
      l5_id: null,
    });
  });

  it('rejects nesting deeper than l5', () => {
    const result = deriveScopeHierarchy({ parentId: 's5', scopesMap: fullMap });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Scope tags at depth 4 and 5
// ---------------------------------------------------------------------------

describe('buildScopeTags at depth 4-5', () => {
  it('builds tags for l4 scope', () => {
    expect(buildScopeTags(l4)).toEqual({
      scope_id: 's4',
      scope_l1_id: 's1',
      scope_l2_id: 's2',
      scope_l3_id: 's3',
      scope_l4_id: 's4',
      scope_l5_id: null,
    });
  });

  it('builds tags for l5 scope', () => {
    expect(buildScopeTags(l5)).toEqual({
      scope_id: 's5',
      scope_l1_id: 's1',
      scope_l2_id: 's2',
      scope_l3_id: 's3',
      scope_l4_id: 's4',
      scope_l5_id: 's5',
    });
  });
});

// ---------------------------------------------------------------------------
// 3. resolveScopeChain at depth 4-5
// ---------------------------------------------------------------------------

describe('resolveScopeChain at depth 4-5', () => {
  it('resolves l4 scope chain', () => {
    expect(resolveScopeChain('s4', fullMap)).toEqual({
      scope_l1_id: 's1',
      scope_l2_id: 's2',
      scope_l3_id: 's3',
      scope_l4_id: 's4',
      scope_l5_id: null,
    });
  });

  it('resolves l5 scope chain', () => {
    expect(resolveScopeChain('s5', fullMap)).toEqual({
      scope_l1_id: 's1',
      scope_l2_id: 's2',
      scope_l3_id: 's3',
      scope_l4_id: 's4',
      scope_l5_id: 's5',
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Board matching at depth 4-5
// ---------------------------------------------------------------------------

describe('task board matching at depth 4-5', () => {
  const l4Task = {
    scope_id: 's4',
    scope_l1_id: 's1', scope_l2_id: 's2', scope_l3_id: 's3', scope_l4_id: 's4',
    record_state: 'active',
  };
  const l5Task = {
    scope_id: 's5',
    scope_l1_id: 's1', scope_l2_id: 's2', scope_l3_id: 's3', scope_l4_id: 's4', scope_l5_id: 's5',
    record_state: 'active',
  };

  it('matches l4 task to l4 board exactly', () => {
    expect(matchesTaskBoardScope(l4Task, l4, fullMap)).toBe(true);
  });

  it('matches l5 task to l5 board exactly', () => {
    expect(matchesTaskBoardScope(l5Task, l5, fullMap)).toBe(true);
  });

  it('l5 task matches l1 board with descendants only', () => {
    expect(matchesTaskBoardScope(l5Task, l1, fullMap)).toBe(false);
    expect(matchesTaskBoardScope(l5Task, l1, fullMap, { includeDescendants: true })).toBe(true);
  });

  it('l5 task matches l3 board with descendants only', () => {
    expect(matchesTaskBoardScope(l5Task, l3, fullMap)).toBe(false);
    expect(matchesTaskBoardScope(l5Task, l3, fullMap, { includeDescendants: true })).toBe(true);
  });

  it('l4 task does not match l5 board', () => {
    expect(matchesTaskBoardScope(l4Task, l5, fullMap)).toBe(false);
    expect(matchesTaskBoardScope(l4Task, l5, fullMap, { includeDescendants: true })).toBe(false);
  });

  it('infers l4 and l5 from task lineage fields', () => {
    expect(inferTaskScopeLevel(l4Task, fullMap)).toBe('l4');
    expect(inferTaskScopeLevel(l5Task, fullMap)).toBe('l5');
  });

  it('infers l4 and l5 from lineage-only fields (no scope_id)', () => {
    expect(inferTaskScopeLevel({ scope_l4_id: 'x' }, new Map())).toBe('l4');
    expect(inferTaskScopeLevel({ scope_l5_id: 'x' }, new Map())).toBe('l5');
  });
});

// ---------------------------------------------------------------------------
// 5. Scope breadcrumbs at depth 4-5
// ---------------------------------------------------------------------------

describe('breadcrumbs at depth 4-5', () => {
  it('builds 4-level breadcrumb', () => {
    expect(scopeBreadcrumb('s4', fullMap)).toBe('Org > Division > Team > Project');
  });

  it('builds 5-level breadcrumb', () => {
    expect(scopeBreadcrumb('s5', fullMap)).toBe('Org > Division > Team > Project > Task Group');
  });

  it('board label uses breadcrumb for depth > 1', () => {
    expect(getTaskBoardScopeLabel(l4, fullMap)).toBe('Org > Division > Team > Project');
    expect(getTaskBoardScopeLabel(l5, fullMap)).toBe('Org > Division > Team > Project > Task Group');
  });
});

// ---------------------------------------------------------------------------
// 6. searchScopes groups all 5 levels
// ---------------------------------------------------------------------------

describe('searchScopes groups all 5 levels', () => {
  it('returns l4 and l5 groups', () => {
    const result = searchScopes('', allScopes, fullMap);
    expect(result.l4).toHaveLength(1);
    expect(result.l4[0].record_id).toBe('s4');
    expect(result.l5).toHaveLength(1);
    expect(result.l5[0].record_id).toBe('s5');
  });

  it('adds breadcrumb to l4 and l5 entries when searching', () => {
    // Breadcrumbs are only added when a search query is provided
    const result = searchScopes('Project', allScopes, fullMap);
    const l4Match = result.l4.find(s => s.record_id === 's4');
    expect(l4Match).toBeTruthy();
    expect(l4Match.breadcrumb).toBe('Org > Division > Team > Project');
  });
});

// ---------------------------------------------------------------------------
// 8. getAvailableParents at depth 4-5
// ---------------------------------------------------------------------------

describe('getAvailableParents at depth 4-5', () => {
  it('returns l3 scopes as parents for l4', () => {
    const result = getAvailableParents(allScopes, 'l4');
    expect(result).toHaveLength(1);
    expect(result[0].record_id).toBe('s3');
  });

  it('returns l4 scopes as parents for l5', () => {
    const result = getAvailableParents(allScopes, 'l5');
    expect(result).toHaveLength(1);
    expect(result[0].record_id).toBe('s4');
  });
});

// ---------------------------------------------------------------------------
// 9. sortTaskBoardScopes orders all 5 levels correctly
// ---------------------------------------------------------------------------

describe('sort task board scopes across 5 levels', () => {
  it('sorts by depth then title', () => {
    const shuffled = [l5, l2, l4, l1, l3];
    const sorted = sortTaskBoardScopes(shuffled, fullMap);
    expect(sorted.map(s => s.record_id)).toEqual(['s1', 's2', 's3', 's4', 's5']);
  });
});

// ---------------------------------------------------------------------------
// 10. readScopeAssignment and sameScopeAssignment with l4/l5
// ---------------------------------------------------------------------------

describe('scope assignment helpers with depth 4-5', () => {
  it('reads scope assignment including l4 and l5', () => {
    const record = {
      scope_id: 's5',
      scope_l1_id: 's1', scope_l2_id: 's2', scope_l3_id: 's3',
      scope_l4_id: 's4', scope_l5_id: 's5',
    };
    const assignment = readScopeAssignment(record);
    expect(assignment).toEqual({
      scope_id: 's5',
      scope_l1_id: 's1', scope_l2_id: 's2', scope_l3_id: 's3',
      scope_l4_id: 's4', scope_l5_id: 's5',
    });
  });

  it('detects same scope assignment at depth 5', () => {
    const a = { scope_id: 's5', scope_l1_id: 's1', scope_l2_id: 's2', scope_l3_id: 's3', scope_l4_id: 's4', scope_l5_id: 's5' };
    const b = { scope_id: 's5', scope_l1_id: 's1', scope_l2_id: 's2', scope_l3_id: 's3', scope_l4_id: 's4', scope_l5_id: 's5' };
    expect(sameScopeAssignment(a, b)).toBe(true);
  });

  it('detects changed scope assignment at depth 4', () => {
    const a = { scope_id: 's4', scope_l1_id: 's1', scope_l2_id: 's2', scope_l3_id: 's3', scope_l4_id: 's4', scope_l5_id: null };
    const b = { scope_id: 's5', scope_l1_id: 's1', scope_l2_id: 's2', scope_l3_id: 's3', scope_l4_id: 's4', scope_l5_id: 's5' };
    expect(sameScopeAssignment(a, b)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 11. Level label does not expose L1-L5 as user-facing (uses title only)
// ---------------------------------------------------------------------------

describe('scope level labels are generic', () => {
  it('returns L1-L5 for internal use, not semantic names', () => {
    expect(scopeLevelLabel('l1')).toBe('L1');
    expect(scopeLevelLabel('l4')).toBe('L4');
    expect(scopeLevelLabel('l5')).toBe('L5');
    // Legacy inputs still map to generic
    expect(scopeLevelLabel('product')).toBe('L1');
    expect(scopeLevelLabel('deliverable')).toBe('L3');
  });
});

// ---------------------------------------------------------------------------
// 12. CSS data-level attribute values match canonical levels
// ---------------------------------------------------------------------------

describe('CSS data-level attribute conventions', () => {
  it('all scope levels have consistent data-level values l1-l5', () => {
    for (const level of ['l1', 'l2', 'l3', 'l4', 'l5']) {
      const canonical = normalizeScopeLevel(level);
      expect(canonical).toBe(level);
      expect(scopeDepth(level)).toBeGreaterThan(0);
    }
  });
});
