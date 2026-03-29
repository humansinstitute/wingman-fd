import { describe, expect, it } from 'vitest';
import {
  normalizeScopeLevel,
  scopeDepth,
  scopeLevelLabel,
  SCOPE_LEVELS,
  resolveScopeChain,
  searchScopes,
  scopeBreadcrumb,
} from '../src/translators/scopes.js';
import {
  deriveScopeHierarchy,
  buildScopeTags,
  buildScopeLineage,
} from '../src/scope-delivery.js';
import {
  matchesTaskBoardScope,
  inferTaskScopeLevel,
  isTaskUnscoped,
} from '../src/task-board-scopes.js';
import {
  readScopeAssignment,
  sameScopeAssignment,
  getAvailableParents,
} from '../src/scopes-manager.js';

// ---------------------------------------------------------------------------
// Helper factories for canonical l1-l5 data model
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
// 1. deriveScopeHierarchy — returns l1_id-l5_id lineage
// ---------------------------------------------------------------------------

describe('deriveScopeHierarchy returns canonical lineage slots', () => {
  it('returns null lineage for l1 (root scope)', () => {
    const result = deriveScopeHierarchy({ parentId: null, scopesMap: new Map() });
    expect(result).toEqual({
      parent_id: null,
      level: 'l1',
      l1_id: null,
      l2_id: null,
      l3_id: null,
      l4_id: null,
      l5_id: null,
    });
  });

  it('returns l1 parent lineage for l2', () => {
    const l1 = makeScope('s1', 'l1', null, { l1_id: 's1' });
    const map = makeScopesMap(l1);
    const result = deriveScopeHierarchy({ parentId: 's1', scopesMap: map });
    expect(result).toEqual({
      parent_id: 's1',
      level: 'l2',
      l1_id: 's1',
      l2_id: null,
      l3_id: null,
      l4_id: null,
      l5_id: null,
    });
  });

  it('returns full lineage for l3', () => {
    const l1 = makeScope('s1', 'l1', null, { l1_id: 's1' });
    const l2 = makeScope('s2', 'l2', 's1', { l1_id: 's1', l2_id: 's2' });
    const map = makeScopesMap(l1, l2);
    const result = deriveScopeHierarchy({ parentId: 's2', scopesMap: map });
    expect(result).toEqual({
      parent_id: 's2',
      level: 'l3',
      l1_id: 's1',
      l2_id: 's2',
      l3_id: null,
      l4_id: null,
      l5_id: null,
    });
  });

  it('returns full lineage for l4', () => {
    const l1 = makeScope('s1', 'l1', null, { l1_id: 's1' });
    const l2 = makeScope('s2', 'l2', 's1', { l1_id: 's1', l2_id: 's2' });
    const l3 = makeScope('s3', 'l3', 's2', { l1_id: 's1', l2_id: 's2', l3_id: 's3' });
    const map = makeScopesMap(l1, l2, l3);
    const result = deriveScopeHierarchy({ parentId: 's3', scopesMap: map });
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

  it('returns full lineage for l5', () => {
    const l1 = makeScope('s1', 'l1', null, { l1_id: 's1' });
    const l2 = makeScope('s2', 'l2', 's1', { l1_id: 's1', l2_id: 's2' });
    const l3 = makeScope('s3', 'l3', 's2', { l1_id: 's1', l2_id: 's2', l3_id: 's3' });
    const l4 = makeScope('s4', 'l4', 's3', { l1_id: 's1', l2_id: 's2', l3_id: 's3', l4_id: 's4' });
    const map = makeScopesMap(l1, l2, l3, l4);
    const result = deriveScopeHierarchy({ parentId: 's4', scopesMap: map });
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

  it('rejects depth beyond l5', () => {
    const l5 = makeScope('s5', 'l5', 's4', { l1_id: 's1', l2_id: 's2', l3_id: 's3', l4_id: 's4', l5_id: 's5' });
    const map = makeScopesMap(l5);
    const result = deriveScopeHierarchy({ parentId: 's5', scopesMap: map });
    // Should return null or indicate error — depth 6 is not allowed
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. buildScopeTags — returns scope_l1_id-scope_l5_id
// ---------------------------------------------------------------------------

describe('buildScopeTags returns canonical scope lineage tags', () => {
  it('returns null tags for null scope', () => {
    expect(buildScopeTags(null)).toEqual({
      scope_id: null,
      scope_l1_id: null,
      scope_l2_id: null,
      scope_l3_id: null,
      scope_l4_id: null,
      scope_l5_id: null,
    });
  });

  it('returns tags for l1 scope', () => {
    const scope = makeScope('s1', 'l1', null, { l1_id: 's1' });
    expect(buildScopeTags(scope)).toEqual({
      scope_id: 's1',
      scope_l1_id: 's1',
      scope_l2_id: null,
      scope_l3_id: null,
      scope_l4_id: null,
      scope_l5_id: null,
    });
  });

  it('returns tags for l3 scope', () => {
    const scope = makeScope('s3', 'l3', 's2', {
      l1_id: 's1', l2_id: 's2', l3_id: 's3',
    });
    expect(buildScopeTags(scope)).toEqual({
      scope_id: 's3',
      scope_l1_id: 's1',
      scope_l2_id: 's2',
      scope_l3_id: 's3',
      scope_l4_id: null,
      scope_l5_id: null,
    });
  });

  it('returns tags for l5 scope', () => {
    const scope = makeScope('s5', 'l5', 's4', {
      l1_id: 's1', l2_id: 's2', l3_id: 's3', l4_id: 's4', l5_id: 's5',
    });
    expect(buildScopeTags(scope)).toEqual({
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
// 3. resolveScopeChain — returns canonical scope_l1_id-scope_l5_id
// ---------------------------------------------------------------------------

describe('resolveScopeChain returns canonical lineage', () => {
  it('resolves l1 scope', () => {
    const l1 = makeScope('s1', 'l1', null, { l1_id: 's1' });
    const map = makeScopesMap(l1);
    expect(resolveScopeChain('s1', map)).toEqual({
      scope_l1_id: 's1',
      scope_l2_id: null,
      scope_l3_id: null,
      scope_l4_id: null,
      scope_l5_id: null,
    });
  });

  it('resolves l3 scope', () => {
    const l1 = makeScope('s1', 'l1', null, { l1_id: 's1' });
    const l2 = makeScope('s2', 'l2', 's1', { l1_id: 's1', l2_id: 's2' });
    const l3 = makeScope('s3', 'l3', 's2', { l1_id: 's1', l2_id: 's2', l3_id: 's3' });
    const map = makeScopesMap(l1, l2, l3);
    expect(resolveScopeChain('s3', map)).toEqual({
      scope_l1_id: 's1',
      scope_l2_id: 's2',
      scope_l3_id: 's3',
      scope_l4_id: null,
      scope_l5_id: null,
    });
  });

  it('returns null for unknown scope_id', () => {
    expect(resolveScopeChain('unknown', new Map())).toEqual({
      scope_l1_id: null,
      scope_l2_id: null,
      scope_l3_id: null,
      scope_l4_id: null,
      scope_l5_id: null,
    });
  });
});

// ---------------------------------------------------------------------------
// 4. Task board matching with canonical lineage
// ---------------------------------------------------------------------------

describe('task board matching with canonical scope_l1_id-scope_l5_id', () => {
  const l1 = makeScope('scope-l1', 'l1', null, { l1_id: 'scope-l1', title: 'Product' });
  const l2 = makeScope('scope-l2', 'l2', 'scope-l1', { l1_id: 'scope-l1', l2_id: 'scope-l2', title: 'Project' });
  const l3 = makeScope('scope-l3', 'l3', 'scope-l2', { l1_id: 'scope-l1', l2_id: 'scope-l2', l3_id: 'scope-l3', title: 'Feature' });
  const l4 = makeScope('scope-l4', 'l4', 'scope-l3', { l1_id: 'scope-l1', l2_id: 'scope-l2', l3_id: 'scope-l3', l4_id: 'scope-l4', title: 'Sub-feature' });
  const scopesMap = makeScopesMap(l1, l2, l3, l4);

  function makeTask(scopeId, tags = {}) {
    return { scope_id: scopeId, record_state: 'active', ...tags };
  }

  it('matches l1 board with descendant toggle', () => {
    const l1Task = makeTask('scope-l1', { scope_l1_id: 'scope-l1' });
    const l3Task = makeTask('scope-l3', { scope_l1_id: 'scope-l1', scope_l2_id: 'scope-l2', scope_l3_id: 'scope-l3' });

    expect(matchesTaskBoardScope(l1Task, l1, scopesMap)).toBe(true);
    expect(matchesTaskBoardScope(l3Task, l1, scopesMap)).toBe(false);
    expect(matchesTaskBoardScope(l3Task, l1, scopesMap, { includeDescendants: true })).toBe(true);
  });

  it('matches l2 board with descendant toggle', () => {
    const l2Task = makeTask('scope-l2', { scope_l1_id: 'scope-l1', scope_l2_id: 'scope-l2' });
    const l3Task = makeTask('scope-l3', { scope_l1_id: 'scope-l1', scope_l2_id: 'scope-l2', scope_l3_id: 'scope-l3' });

    expect(matchesTaskBoardScope(l2Task, l2, scopesMap)).toBe(true);
    expect(matchesTaskBoardScope(l3Task, l2, scopesMap)).toBe(false);
    expect(matchesTaskBoardScope(l3Task, l2, scopesMap, { includeDescendants: true })).toBe(true);
  });

  it('matches l3 board exact', () => {
    const l3Task = makeTask('scope-l3', { scope_l1_id: 'scope-l1', scope_l2_id: 'scope-l2', scope_l3_id: 'scope-l3' });
    const l4Task = makeTask('scope-l4', { scope_l1_id: 'scope-l1', scope_l2_id: 'scope-l2', scope_l3_id: 'scope-l3', scope_l4_id: 'scope-l4' });

    expect(matchesTaskBoardScope(l3Task, l3, scopesMap)).toBe(true);
    expect(matchesTaskBoardScope(l4Task, l3, scopesMap)).toBe(false);
    expect(matchesTaskBoardScope(l4Task, l3, scopesMap, { includeDescendants: true })).toBe(true);
  });

  it('matches l4 board exact', () => {
    const l4Task = makeTask('scope-l4', { scope_l1_id: 'scope-l1', scope_l2_id: 'scope-l2', scope_l3_id: 'scope-l3', scope_l4_id: 'scope-l4' });
    expect(matchesTaskBoardScope(l4Task, l4, scopesMap)).toBe(true);
  });

  it('detects unscoped tasks', () => {
    expect(isTaskUnscoped({ record_state: 'active' }, scopesMap)).toBe(true);
    expect(isTaskUnscoped({ scope_id: 'scope-l1', scope_l1_id: 'scope-l1', record_state: 'active' }, scopesMap)).toBe(false);
  });

  it('infers scope level from canonical fields', () => {
    expect(inferTaskScopeLevel({ scope_id: 'scope-l1' }, scopesMap)).toBe('l1');
    expect(inferTaskScopeLevel({ scope_id: 'scope-l3' }, scopesMap)).toBe('l3');
  });

  it('infers scope level from lineage fields when scope_id is absent', () => {
    expect(inferTaskScopeLevel({ scope_l5_id: 'x' }, new Map())).toBe('l5');
    expect(inferTaskScopeLevel({ scope_l4_id: 'x' }, new Map())).toBe('l4');
    expect(inferTaskScopeLevel({ scope_l3_id: 'x' }, new Map())).toBe('l3');
    expect(inferTaskScopeLevel({ scope_l2_id: 'x' }, new Map())).toBe('l2');
    expect(inferTaskScopeLevel({ scope_l1_id: 'x' }, new Map())).toBe('l1');
    expect(inferTaskScopeLevel({}, new Map())).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. readScopeAssignment / sameScopeAssignment — canonical fields
// ---------------------------------------------------------------------------

describe('scope assignment helpers use canonical fields', () => {
  it('readScopeAssignment reads canonical lineage fields', () => {
    const record = {
      scope_id: 's3',
      scope_l1_id: 's1',
      scope_l2_id: 's2',
      scope_l3_id: 's3',
      scope_l4_id: null,
      scope_l5_id: null,
    };
    expect(readScopeAssignment(record)).toEqual({
      scope_id: 's3',
      scope_l1_id: 's1',
      scope_l2_id: 's2',
      scope_l3_id: 's3',
      scope_l4_id: null,
      scope_l5_id: null,
    });
  });

  it('readScopeAssignment returns null fields for null record', () => {
    expect(readScopeAssignment(null)).toEqual({
      scope_id: null,
      scope_l1_id: null,
      scope_l2_id: null,
      scope_l3_id: null,
      scope_l4_id: null,
      scope_l5_id: null,
    });
  });

  it('sameScopeAssignment compares canonical fields', () => {
    const a = { scope_id: 's1', scope_l1_id: 's1', scope_l2_id: null, scope_l3_id: null, scope_l4_id: null, scope_l5_id: null };
    const b = { scope_id: 's1', scope_l1_id: 's1', scope_l2_id: null, scope_l3_id: null, scope_l4_id: null, scope_l5_id: null };
    const c = { scope_id: 's2', scope_l1_id: 's2', scope_l2_id: null, scope_l3_id: null, scope_l4_id: null, scope_l5_id: null };
    expect(sameScopeAssignment(a, b)).toBe(true);
    expect(sameScopeAssignment(a, c)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. Five-level depth hierarchy test
// ---------------------------------------------------------------------------

describe('full five-level hierarchy end-to-end', () => {
  const l1 = makeScope('s1', 'l1', null, { l1_id: 's1', title: 'Department' });
  const l2 = makeScope('s2', 'l2', 's1', { l1_id: 's1', l2_id: 's2', title: 'Team' });
  const l3 = makeScope('s3', 'l3', 's2', { l1_id: 's1', l2_id: 's2', l3_id: 's3', title: 'Project' });
  const l4 = makeScope('s4', 'l4', 's3', { l1_id: 's1', l2_id: 's2', l3_id: 's3', l4_id: 's4', title: 'Sprint' });
  const l5 = makeScope('s5', 'l5', 's4', { l1_id: 's1', l2_id: 's2', l3_id: 's3', l4_id: 's4', l5_id: 's5', title: 'Task Group' });
  const scopesMap = makeScopesMap(l1, l2, l3, l4, l5);

  it('builds lineage from l1 to l5', () => {
    const lineage = buildScopeLineage(l5, scopesMap);
    expect(lineage.map(s => s.record_id)).toEqual(['s1', 's2', 's3', 's4', 's5']);
  });

  it('builds breadcrumb for l5', () => {
    expect(scopeBreadcrumb('s5', scopesMap)).toBe('Department > Team > Project > Sprint > Task Group');
  });

  it('buildScopeTags copies lineage for l5 scope', () => {
    expect(buildScopeTags(l5)).toEqual({
      scope_id: 's5',
      scope_l1_id: 's1',
      scope_l2_id: 's2',
      scope_l3_id: 's3',
      scope_l4_id: 's4',
      scope_l5_id: 's5',
    });
  });

  it('search groups by canonical level', () => {
    const all = [l1, l2, l3, l4, l5];
    const result = searchScopes('', all, scopesMap);
    expect(result.l1).toHaveLength(1);
    expect(result.l2).toHaveLength(1);
    expect(result.l3).toHaveLength(1);
    expect(result.l4).toHaveLength(1);
    expect(result.l5).toHaveLength(1);
  });

  it('getAvailableParents returns correct parents for each level', () => {
    const all = [l1, l2, l3, l4, l5];
    expect(getAvailableParents(all, 'l1')).toEqual([]);
    expect(getAvailableParents(all, 'l2').map(s => s.record_id)).toEqual(['s1']);
    expect(getAvailableParents(all, 'l3').map(s => s.record_id)).toEqual(['s2']);
    expect(getAvailableParents(all, 'l4').map(s => s.record_id)).toEqual(['s3']);
    expect(getAvailableParents(all, 'l5').map(s => s.record_id)).toEqual(['s4']);
  });
});
