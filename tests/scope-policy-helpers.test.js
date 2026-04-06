import { describe, expect, it } from 'vitest';

import {
  buildScopedPolicyRepairPatch,
  sameScopePolicyGroupIds,
  shouldRefreshScopedPolicy,
} from '../src/scope-policy-helpers.js';

const groups = [
  { group_id: 'group-a', group_npub: 'group-a', name: 'Group A' },
  { group_id: 'group-b', group_npub: 'group-b', name: 'Group B' },
  { group_id: 'group-c', group_npub: 'group-c', name: 'Group C' },
  { group_id: 'group-explicit', group_npub: 'group-explicit', name: 'Explicit' },
];

describe('scope policy helpers', () => {
  it('preserves explicit shares while swapping scope policy groups', () => {
    const patch = buildScopedPolicyRepairPatch({
      record: {
        shares: [
          { type: 'group', key: 'group:group-a', group_npub: 'group-a', access: 'write' },
          { type: 'group', key: 'group:group-explicit', group_npub: 'group-explicit', access: 'write' },
        ],
        group_ids: ['group-a', 'group-explicit'],
        scope_policy_group_ids: ['group-a'],
        board_group_id: 'group-a',
      },
      nextScopeGroupIds: ['group-b', 'group-c'],
      groups,
      includeBoardGroupId: true,
    });

    expect(patch.group_ids).toEqual(['group-b', 'group-c', 'group-explicit']);
    expect(patch.scope_policy_group_ids).toEqual(['group-b', 'group-c']);
    expect(patch.board_group_id).toBe('group-b');
    expect(patch.shares.some((share) => share.group_npub === 'group-explicit')).toBe(true);
    expect(patch.shares.some((share) => share.group_npub === 'group-a')).toBe(false);
  });

  it('uses legacy group ids as a fallback when requested', () => {
    expect(shouldRefreshScopedPolicy(
      { group_ids: ['group-a'], scope_policy_group_ids: null },
      ['group-a', 'group-b'],
      { allowLegacyGroupFallback: true },
    )).toBe(true);
  });

  it('does not guess drift for records without stored scope policy ids by default', () => {
    expect(shouldRefreshScopedPolicy(
      { group_ids: ['group-a'], scope_policy_group_ids: null },
      ['group-a', 'group-b'],
    )).toBe(false);
  });

  it('treats scope policy group order as significant', () => {
    expect(sameScopePolicyGroupIds(['group-a', 'group-b'], ['group-a', 'group-b'])).toBe(true);
    expect(sameScopePolicyGroupIds(['group-a', 'group-b'], ['group-b', 'group-a'])).toBe(false);
  });
});
