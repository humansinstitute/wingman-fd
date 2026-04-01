/**
 * WP5: Scope Move Re-Sharing Contract
 *
 * When a record moves between scopes, shares and group_payloads must be
 * regenerated from the destination scope's policy. This eliminates silent
 * mismatch between scope_id and inherited access state.
 */
import { describe, it, expect } from 'vitest';

import {
  separateScopeShares,
  rebuildAccessForScope,
  buildScopeMoveUpdate,
} from '../src/scope-move.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeScope(id, level, groupIds = [], extras = {}) {
  return {
    record_id: id,
    level,
    title: extras.title ?? id,
    description: extras.description ?? '',
    parent_id: extras.parent_id ?? null,
    l1_id: extras.l1_id ?? null,
    l2_id: extras.l2_id ?? null,
    l3_id: extras.l3_id ?? null,
    l4_id: extras.l4_id ?? null,
    l5_id: extras.l5_id ?? null,
    group_ids: groupIds,
    record_state: extras.record_state ?? 'active',
  };
}

function makeGroup(id, name = '') {
  return {
    group_id: id,
    group_npub: id,
    name: name || `Group ${id}`,
  };
}

function makeShare(groupId, access = 'write', extras = {}) {
  return {
    type: extras.type ?? 'group',
    key: extras.key ?? `group:${groupId}`,
    access,
    label: extras.label ?? '',
    person_npub: extras.person_npub ?? null,
    group_npub: groupId,
    via_group_npub: extras.via_group_npub ?? null,
    inherited: extras.inherited ?? false,
    inherited_from_directory_id: extras.inherited_from_directory_id ?? null,
  };
}

function makePersonShare(npub, viaGroupId = null, access = 'read') {
  return {
    type: 'person',
    key: `person:${npub}`,
    access,
    label: '',
    person_npub: npub,
    group_npub: null,
    via_group_npub: viaGroupId,
    inherited: false,
    inherited_from_directory_id: null,
  };
}

function makeRecord(id, scopeId, shares, groupIds, version = 3, extras = {}) {
  return {
    record_id: id,
    owner_npub: extras.owner_npub ?? 'npub_owner',
    title: extras.title ?? 'Test Record',
    scope_id: scopeId,
    scope_l1_id: extras.scope_l1_id ?? null,
    scope_l2_id: extras.scope_l2_id ?? null,
    scope_l3_id: extras.scope_l3_id ?? null,
    scope_l4_id: extras.scope_l4_id ?? null,
    scope_l5_id: extras.scope_l5_id ?? null,
    shares,
    group_ids: groupIds,
    board_group_id: extras.board_group_id ?? groupIds[0] ?? null,
    version,
    sync_status: 'synced',
    updated_at: '2026-03-30T00:00:00.000Z',
    ...extras,
  };
}

// ---------------------------------------------------------------------------
// 1. separateScopeShares — identify which shares came from scope policy
// ---------------------------------------------------------------------------

describe('separateScopeShares', () => {
  it('separates group shares matching scope group_ids from explicit shares', () => {
    const shares = [
      makeShare('g-eng'),        // from scope
      makeShare('g-design'),     // from scope
      makeShare('g-personal'),   // explicit — not in scope groups
    ];
    const scopeGroupIds = ['g-eng', 'g-design'];

    const { scopeShares, explicitShares } = separateScopeShares(shares, scopeGroupIds);

    expect(scopeShares).toHaveLength(2);
    expect(scopeShares.map(s => s.group_npub)).toEqual(['g-eng', 'g-design']);
    expect(explicitShares).toHaveLength(1);
    expect(explicitShares[0].group_npub).toBe('g-personal');
  });

  it('classifies person shares as explicit even if routed via scope group', () => {
    const shares = [
      makeShare('g-eng'),
      makePersonShare('npub_alice', 'g-eng'),
    ];
    const scopeGroupIds = ['g-eng'];

    const { scopeShares, explicitShares } = separateScopeShares(shares, scopeGroupIds);

    expect(scopeShares).toHaveLength(1);
    expect(scopeShares[0].group_npub).toBe('g-eng');
    expect(explicitShares).toHaveLength(1);
    expect(explicitShares[0].person_npub).toBe('npub_alice');
  });

  it('returns all shares as explicit when scope has no groups', () => {
    const shares = [makeShare('g-eng'), makeShare('g-design')];

    const { scopeShares, explicitShares } = separateScopeShares(shares, []);

    expect(scopeShares).toHaveLength(0);
    expect(explicitShares).toHaveLength(2);
  });

  it('returns all shares as scope-granted when all match', () => {
    const shares = [makeShare('g-eng'), makeShare('g-design')];

    const { scopeShares, explicitShares } = separateScopeShares(shares, ['g-eng', 'g-design']);

    expect(scopeShares).toHaveLength(2);
    expect(explicitShares).toHaveLength(0);
  });

  it('handles empty shares gracefully', () => {
    const { scopeShares, explicitShares } = separateScopeShares([], ['g-eng']);

    expect(scopeShares).toHaveLength(0);
    expect(explicitShares).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2. rebuildAccessForScope — rebuild shares from destination scope policy
// ---------------------------------------------------------------------------

describe('rebuildAccessForScope', () => {
  it('builds shares from destination scope groups and preserves explicit shares', () => {
    const explicitShares = [makePersonShare('npub_alice', 'g-eng')];
    const destScope = makeScope('scope-dest', 'l2', ['g-delivery', 'g-stakeholders']);
    const groups = [makeGroup('g-delivery', 'Delivery'), makeGroup('g-stakeholders', 'Stakeholders')];

    const result = rebuildAccessForScope(explicitShares, destScope, groups);

    expect(result.shares).toHaveLength(3); // 2 scope groups + 1 explicit person
    expect(result.shares.find(s => s.group_npub === 'g-delivery')).toBeTruthy();
    expect(result.shares.find(s => s.group_npub === 'g-stakeholders')).toBeTruthy();
    expect(result.shares.find(s => s.person_npub === 'npub_alice')).toBeTruthy();
    expect(result.group_ids).toContain('g-delivery');
    expect(result.group_ids).toContain('g-stakeholders');
  });

  it('deduplicates when explicit share matches a destination scope group', () => {
    const explicitShares = [makeShare('g-delivery', 'read')];
    const destScope = makeScope('scope-dest', 'l2', ['g-delivery']);
    const groups = [makeGroup('g-delivery', 'Delivery')];

    const result = rebuildAccessForScope(explicitShares, destScope, groups);

    expect(result.shares).toHaveLength(1);
    // Scope grants write; should be promoted to write
    expect(result.shares[0].access).toBe('write');
  });

  it('returns only explicit shares when destination scope has no groups', () => {
    const explicitShares = [makeShare('g-personal')];
    const destScope = makeScope('scope-dest', 'l1', []);
    const groups = [];

    const result = rebuildAccessForScope(explicitShares, destScope, groups);

    expect(result.shares).toHaveLength(1);
    expect(result.shares[0].group_npub).toBe('g-personal');
    expect(result.group_ids).toEqual(['g-personal']);
  });

  it('includes person share via_group in group_ids', () => {
    const explicitShares = [makePersonShare('npub_bob', 'g-private')];
    const destScope = makeScope('scope-dest', 'l1', ['g-team']);
    const groups = [makeGroup('g-team'), makeGroup('g-private')];

    const result = rebuildAccessForScope(explicitShares, destScope, groups);

    expect(result.group_ids).toContain('g-team');
    expect(result.group_ids).toContain('g-private');
  });
});

// ---------------------------------------------------------------------------
// 3. buildScopeMoveUpdate — full scope-move version bump
// ---------------------------------------------------------------------------

describe('buildScopeMoveUpdate', () => {
  const NOW = '2026-04-01T10:00:00.000Z';

  it('creates a new version with regenerated shares on scope move', () => {
    const fromScope = makeScope('scope-A', 'l1', ['g-eng', 'g-design']);
    const toScope = makeScope('scope-B', 'l1', ['g-delivery'], {
      l1_id: 'scope-B',
    });
    const groups = [
      makeGroup('g-eng'), makeGroup('g-design'), makeGroup('g-delivery'),
    ];
    const record = makeRecord(
      'task-1', 'scope-A',
      [makeShare('g-eng'), makeShare('g-design')],
      ['g-eng', 'g-design'],
      3,
      { scope_l1_id: 'scope-A' },
    );

    const result = buildScopeMoveUpdate(record, fromScope, toScope, groups, NOW);

    expect(result.version).toBe(4);
    expect(result.sync_status).toBe('pending');
    expect(result.scope_id).toBe('scope-B');
    expect(result.scope_l1_id).toBe('scope-B');
    expect(result.shares).toHaveLength(1);
    expect(result.shares[0].group_npub).toBe('g-delivery');
    expect(result.group_ids).toEqual(['g-delivery']);
    expect(result.updated_at).toBe(NOW);
  });

  it('preserves explicit shares through a scope move', () => {
    const fromScope = makeScope('scope-A', 'l1', ['g-eng']);
    const toScope = makeScope('scope-B', 'l1', ['g-delivery']);
    const groups = [makeGroup('g-eng'), makeGroup('g-delivery')];
    const record = makeRecord(
      'task-1', 'scope-A',
      [makeShare('g-eng'), makePersonShare('npub_alice', 'g-eng')],
      ['g-eng'],
      2,
    );

    const result = buildScopeMoveUpdate(record, fromScope, toScope, groups, NOW);

    expect(result.shares).toHaveLength(2);
    expect(result.shares.find(s => s.group_npub === 'g-delivery')).toBeTruthy();
    expect(result.shares.find(s => s.person_npub === 'npub_alice')).toBeTruthy();
    expect(result.group_ids).toContain('g-delivery');
  });

  // --- Broad-to-Restricted ---

  it('broad-to-restricted: removes groups not in destination scope', () => {
    const broadScope = makeScope('scope-broad', 'l1', ['g-eng', 'g-design', 'g-marketing']);
    const restrictedScope = makeScope('scope-restricted', 'l2', ['g-eng'], {
      parent_id: 'scope-broad', l1_id: 'scope-broad', l2_id: 'scope-restricted',
    });
    const groups = [
      makeGroup('g-eng'), makeGroup('g-design'), makeGroup('g-marketing'),
    ];
    const record = makeRecord(
      'task-1', 'scope-broad',
      [makeShare('g-eng'), makeShare('g-design'), makeShare('g-marketing')],
      ['g-eng', 'g-design', 'g-marketing'],
      5,
      { scope_l1_id: 'scope-broad' },
    );

    const result = buildScopeMoveUpdate(record, broadScope, restrictedScope, groups, NOW);

    expect(result.scope_id).toBe('scope-restricted');
    expect(result.scope_l1_id).toBe('scope-broad');
    expect(result.scope_l2_id).toBe('scope-restricted');
    expect(result.shares).toHaveLength(1);
    expect(result.shares[0].group_npub).toBe('g-eng');
    expect(result.group_ids).toEqual(['g-eng']);
    expect(result.version).toBe(6);
  });

  it('broad-to-restricted: keeps explicit person shares even when narrowing', () => {
    const broadScope = makeScope('scope-broad', 'l1', ['g-eng', 'g-design']);
    const restrictedScope = makeScope('scope-restricted', 'l1', ['g-eng']);
    const groups = [makeGroup('g-eng'), makeGroup('g-design')];
    const record = makeRecord(
      'task-1', 'scope-broad',
      [
        makeShare('g-eng'),
        makeShare('g-design'),
        makePersonShare('npub_bob', 'g-design'),
      ],
      ['g-eng', 'g-design'],
      2,
    );

    const result = buildScopeMoveUpdate(record, broadScope, restrictedScope, groups, NOW);

    expect(result.shares).toHaveLength(2); // g-eng from scope + person bob
    expect(result.shares.find(s => s.group_npub === 'g-eng')).toBeTruthy();
    expect(result.shares.find(s => s.person_npub === 'npub_bob')).toBeTruthy();
    // g-design removed as scope share, but bob's via_group still in group_ids
    expect(result.group_ids).toContain('g-eng');
    expect(result.group_ids).toContain('g-design'); // via person share route
  });

  // --- Restricted-to-Broad ---

  it('restricted-to-broad: adds new groups from destination scope', () => {
    const restrictedScope = makeScope('scope-restricted', 'l2', ['g-eng'], {
      parent_id: 'scope-broad', l1_id: 'scope-broad',
    });
    const broadScope = makeScope('scope-broad', 'l1', ['g-eng', 'g-design', 'g-marketing'], {
      l1_id: 'scope-broad',
    });
    const groups = [
      makeGroup('g-eng'), makeGroup('g-design'), makeGroup('g-marketing'),
    ];
    const record = makeRecord(
      'task-1', 'scope-restricted',
      [makeShare('g-eng')],
      ['g-eng'],
      4,
      { scope_l1_id: 'scope-broad', scope_l2_id: 'scope-restricted' },
    );

    const result = buildScopeMoveUpdate(record, restrictedScope, broadScope, groups, NOW);

    expect(result.scope_id).toBe('scope-broad');
    expect(result.scope_l1_id).toBe('scope-broad');
    expect(result.scope_l2_id).toBeNull();
    expect(result.shares).toHaveLength(3);
    expect(result.group_ids).toContain('g-eng');
    expect(result.group_ids).toContain('g-design');
    expect(result.group_ids).toContain('g-marketing');
    expect(result.version).toBe(5);
  });

  it('restricted-to-broad: preserves explicit group shares not in either scope', () => {
    const restrictedScope = makeScope('scope-restricted', 'l1', ['g-eng']);
    const broadScope = makeScope('scope-broad', 'l1', ['g-eng', 'g-design']);
    const groups = [makeGroup('g-eng'), makeGroup('g-design'), makeGroup('g-personal')];
    const record = makeRecord(
      'task-1', 'scope-restricted',
      [makeShare('g-eng'), makeShare('g-personal')],
      ['g-eng', 'g-personal'],
      1,
    );

    const result = buildScopeMoveUpdate(record, restrictedScope, broadScope, groups, NOW);

    expect(result.shares).toHaveLength(3); // g-eng, g-design from scope + g-personal explicit
    expect(result.shares.find(s => s.group_npub === 'g-personal')).toBeTruthy();
    expect(result.shares.find(s => s.group_npub === 'g-design')).toBeTruthy();
    expect(result.group_ids).toContain('g-personal');
  });

  // --- Edge cases ---

  it('moving to a scope with overlapping groups keeps deduplication clean', () => {
    const scopeA = makeScope('scope-A', 'l1', ['g-shared', 'g-only-A']);
    const scopeB = makeScope('scope-B', 'l1', ['g-shared', 'g-only-B']);
    const groups = [makeGroup('g-shared'), makeGroup('g-only-A'), makeGroup('g-only-B')];
    const record = makeRecord(
      'task-1', 'scope-A',
      [makeShare('g-shared'), makeShare('g-only-A')],
      ['g-shared', 'g-only-A'],
      2,
    );

    const result = buildScopeMoveUpdate(record, scopeA, scopeB, groups, NOW);

    expect(result.shares).toHaveLength(2);
    expect(result.shares.find(s => s.group_npub === 'g-shared')).toBeTruthy();
    expect(result.shares.find(s => s.group_npub === 'g-only-B')).toBeTruthy();
    expect(result.shares.find(s => s.group_npub === 'g-only-A')).toBeFalsy();
    expect(result.group_ids).toEqual(['g-shared', 'g-only-B']);
  });

  it('moving to scope with no groups strips scope shares, keeps explicit', () => {
    const fromScope = makeScope('scope-A', 'l1', ['g-eng']);
    const toScope = makeScope('scope-empty', 'l1', []);
    const groups = [makeGroup('g-eng'), makeGroup('g-personal')];
    const record = makeRecord(
      'task-1', 'scope-A',
      [makeShare('g-eng'), makeShare('g-personal')],
      ['g-eng', 'g-personal'],
      2,
    );

    const result = buildScopeMoveUpdate(record, fromScope, toScope, groups, NOW);

    expect(result.shares).toHaveLength(1);
    expect(result.shares[0].group_npub).toBe('g-personal');
    expect(result.group_ids).toEqual(['g-personal']);
  });

  it('handles null fromScope (unscoped record gaining a scope)', () => {
    const toScope = makeScope('scope-B', 'l1', ['g-delivery'], {
      l1_id: 'scope-B',
    });
    const groups = [makeGroup('g-delivery'), makeGroup('g-personal')];
    const record = makeRecord(
      'task-1', null,
      [makeShare('g-personal')],
      ['g-personal'],
      2,
    );

    const result = buildScopeMoveUpdate(record, null, toScope, groups, NOW);

    expect(result.scope_id).toBe('scope-B');
    expect(result.shares).toHaveLength(2); // g-delivery + g-personal (all explicit when no from scope)
    expect(result.group_ids).toContain('g-delivery');
    expect(result.group_ids).toContain('g-personal');
    expect(result.version).toBe(3);
  });

  it('handles null toScope (removing scope from record)', () => {
    const fromScope = makeScope('scope-A', 'l1', ['g-eng']);
    const groups = [makeGroup('g-eng'), makeGroup('g-personal')];
    const record = makeRecord(
      'task-1', 'scope-A',
      [makeShare('g-eng'), makeShare('g-personal')],
      ['g-eng', 'g-personal'],
      4,
    );

    const result = buildScopeMoveUpdate(record, fromScope, null, groups, NOW);

    expect(result.scope_id).toBeNull();
    expect(result.scope_l1_id).toBeNull();
    expect(result.shares).toHaveLength(1);
    expect(result.shares[0].group_npub).toBe('g-personal');
    expect(result.group_ids).toEqual(['g-personal']);
    expect(result.version).toBe(5);
  });

  it('updates board_group_id to first destination scope group', () => {
    const fromScope = makeScope('scope-A', 'l1', ['g-eng']);
    const toScope = makeScope('scope-B', 'l1', ['g-delivery']);
    const groups = [makeGroup('g-eng'), makeGroup('g-delivery')];
    const record = makeRecord(
      'task-1', 'scope-A',
      [makeShare('g-eng')],
      ['g-eng'],
      1,
      { board_group_id: 'g-eng' },
    );

    const result = buildScopeMoveUpdate(record, fromScope, toScope, groups, NOW);

    expect(result.board_group_id).toBe('g-delivery');
  });

  it('preserves board_group_id if it exists in destination scope groups', () => {
    const fromScope = makeScope('scope-A', 'l1', ['g-shared', 'g-only-A']);
    const toScope = makeScope('scope-B', 'l1', ['g-shared', 'g-only-B']);
    const groups = [makeGroup('g-shared'), makeGroup('g-only-A'), makeGroup('g-only-B')];
    const record = makeRecord(
      'task-1', 'scope-A',
      [makeShare('g-shared'), makeShare('g-only-A')],
      ['g-shared', 'g-only-A'],
      1,
      { board_group_id: 'g-shared' },
    );

    const result = buildScopeMoveUpdate(record, fromScope, toScope, groups, NOW);

    expect(result.board_group_id).toBe('g-shared');
  });
});
