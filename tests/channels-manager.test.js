import { describe, expect, it } from 'vitest';
import {
  mapGroupEntry,
  mapCreatedGroup,
  mapRotatedGroup,
  deduplicateMembers,
  computeGroupMemberDiff,
  parseGroupMemberQueryNpubs,
} from '../src/channels-manager.js';

describe('channels-manager pure utilities', () => {
  // --- mapGroupEntry ---
  describe('mapGroupEntry', () => {
    it('maps a group with id field', () => {
      const result = mapGroupEntry({
        id: 'g1',
        group_npub: 'npub1grp',
        current_epoch: 2,
        owner_npub: 'npub1owner',
        name: 'Team',
        group_kind: 'shared',
        private_member_npub: null,
        members: ['npub1a', 'npub1b'],
      });
      expect(result).toEqual({
        group_id: 'g1',
        group_npub: 'npub1grp',
        current_epoch: 2,
        owner_npub: 'npub1owner',
        name: 'Team',
        group_kind: 'shared',
        private_member_npub: null,
        member_npubs: ['npub1a', 'npub1b'],
      });
    });

    it('maps a group with group_id field', () => {
      const result = mapGroupEntry({
        group_id: 'g2',
        group_npub: 'npub1grp2',
        owner_npub: 'npub1owner',
        name: 'Dev',
        member_npubs: ['npub1c'],
      });
      expect(result.group_id).toBe('g2');
      expect(result.group_npub).toBe('npub1grp2');
      expect(result.member_npubs).toEqual(['npub1c']);
    });

    it('defaults current_epoch to 1', () => {
      const result = mapGroupEntry({ id: 'g3', owner_npub: 'npub1o', name: 'X' });
      expect(result.current_epoch).toBe(1);
    });

    it('defaults group_kind to shared', () => {
      const result = mapGroupEntry({ id: 'g4', owner_npub: 'npub1o', name: 'Y' });
      expect(result.group_kind).toBe('shared');
    });

    it('falls back group_npub to group_id then id', () => {
      expect(mapGroupEntry({ id: 'g5', owner_npub: 'o', name: 'Z' }).group_npub).toBe('g5');
      expect(mapGroupEntry({ group_id: 'g6', owner_npub: 'o', name: 'Z' }).group_npub).toBe('g6');
    });

    it('handles empty members gracefully', () => {
      const result = mapGroupEntry({ id: 'g7', owner_npub: 'o', name: 'Z' });
      expect(result.member_npubs).toEqual([]);
    });

    it('converts member entries to strings', () => {
      const result = mapGroupEntry({ id: 'g8', owner_npub: 'o', name: 'Z', members: [123, 'npub1x'] });
      expect(result.member_npubs).toEqual(['123', 'npub1x']);
    });
  });

  // --- mapCreatedGroup ---
  describe('mapCreatedGroup', () => {
    it('maps a create-group response', () => {
      const response = {
        group_id: 'g1',
        group_npub: 'npub1new',
        current_epoch: 1,
        name: 'Created',
        group_kind: 'shared',
        private_member_npub: null,
        members: [{ member_npub: 'npub1a' }, { member_npub: 'npub1b' }],
      };
      const result = mapCreatedGroup(response, 'Fallback Name', 'npub1owner');
      expect(result).toEqual({
        group_id: 'g1',
        group_npub: 'npub1new',
        current_epoch: 1,
        owner_npub: 'npub1owner',
        name: 'Created',
        group_kind: 'shared',
        private_member_npub: null,
        member_npubs: ['npub1a', 'npub1b'],
      });
    });

    it('falls back name to provided name', () => {
      const result = mapCreatedGroup({}, 'My Group', 'npub1owner');
      expect(result.name).toBe('My Group');
    });

    it('falls back group_npub to group_id then id', () => {
      expect(mapCreatedGroup({ id: 'x' }, 'n', 'o').group_npub).toBe('x');
      expect(mapCreatedGroup({ group_id: 'y' }, 'n', 'o').group_npub).toBe('y');
    });

    it('defaults current_epoch to 1', () => {
      const result = mapCreatedGroup({}, 'n', 'o');
      expect(result.current_epoch).toBe(1);
    });

    it('filters out falsy members', () => {
      const result = mapCreatedGroup({ members: [{ member_npub: 'npub1a' }, { member_npub: '' }] }, 'n', 'o');
      expect(result.member_npubs).toEqual(['npub1a']);
    });

    it('handles missing members array', () => {
      const result = mapCreatedGroup({}, 'n', 'o');
      expect(result.member_npubs).toEqual([]);
    });
  });

  // --- mapRotatedGroup ---
  describe('mapRotatedGroup', () => {
    const baseGroup = {
      group_id: 'g1',
      group_npub: 'npub1old',
      current_epoch: 2,
      owner_npub: 'npub1owner',
      name: 'Original',
      group_kind: 'shared',
      private_member_npub: null,
    };

    it('maps a rotate-group response', () => {
      const response = {
        group_id: 'g1',
        group_npub: 'npub1rotated',
        current_epoch: 3,
        owner_npub: 'npub1owner',
        name: 'Renamed',
        group_kind: 'shared',
        private_member_npub: null,
        members: [{ member_npub: 'npub1a' }],
      };
      const result = mapRotatedGroup(response, { npub: 'npub1identity' }, baseGroup, ['npub1a'], {});
      expect(result.group_npub).toBe('npub1rotated');
      expect(result.current_epoch).toBe(3);
      expect(result.name).toBe('Renamed');
      expect(result.member_npubs).toEqual(['npub1a']);
    });

    it('falls back to identity npub', () => {
      const result = mapRotatedGroup({}, { npub: 'npub1identity' }, baseGroup, ['npub1a'], {});
      expect(result.group_npub).toBe('npub1identity');
    });

    it('increments epoch when response lacks it', () => {
      const result = mapRotatedGroup({}, { npub: 'npub1id' }, baseGroup, [], {});
      expect(result.current_epoch).toBe(3);
    });

    it('falls back name to options.name then group.name', () => {
      expect(mapRotatedGroup({}, { npub: 'n' }, baseGroup, [], { name: 'Opt' }).name).toBe('Opt');
      expect(mapRotatedGroup({}, { npub: 'n' }, baseGroup, [], {}).name).toBe('Original');
    });

    it('falls back member_npubs to nextMembers', () => {
      const result = mapRotatedGroup({}, { npub: 'n' }, baseGroup, ['npub1x', 'npub1y'], {});
      expect(result.member_npubs).toEqual(['npub1x', 'npub1y']);
    });

    it('maps member objects from response', () => {
      const result = mapRotatedGroup(
        { members: [{ member_npub: 'npub1a' }, { member_npub: 'npub1b' }] },
        { npub: 'n' }, baseGroup, [], {},
      );
      expect(result.member_npubs).toEqual(['npub1a', 'npub1b']);
    });
  });

  // --- deduplicateMembers ---
  describe('deduplicateMembers', () => {
    it('includes the owner first', () => {
      const result = deduplicateMembers('npub1owner', ['npub1a', 'npub1b']);
      expect(result[0]).toBe('npub1owner');
    });

    it('deduplicates members', () => {
      const result = deduplicateMembers('npub1owner', ['npub1a', 'npub1a', 'npub1owner']);
      expect(result).toEqual(['npub1owner', 'npub1a']);
    });

    it('trims and filters blank entries', () => {
      const result = deduplicateMembers('npub1owner', ['  npub1a  ', '', null, undefined]);
      expect(result).toEqual(['npub1owner', 'npub1a']);
    });

    it('handles null memberNpubs', () => {
      const result = deduplicateMembers('npub1owner', null);
      expect(result).toEqual(['npub1owner']);
    });

    it('converts non-string members to strings', () => {
      const result = deduplicateMembers('npub1owner', [123]);
      expect(result).toEqual(['npub1owner', '123']);
    });
  });

  // --- computeGroupMemberDiff ---
  describe('computeGroupMemberDiff', () => {
    it('computes members to add and remove', () => {
      const result = computeGroupMemberDiff(
        ['npub1a', 'npub1b', 'npub1c'],
        ['npub1a', 'npub1d'],
      );
      expect(result.membersToAdd).toEqual(['npub1b', 'npub1c']);
      expect(result.membersToRemove).toEqual(['npub1d']);
    });

    it('returns empty arrays when lists are identical', () => {
      const result = computeGroupMemberDiff(['npub1a'], ['npub1a']);
      expect(result.membersToAdd).toEqual([]);
      expect(result.membersToRemove).toEqual([]);
    });

    it('handles empty desired list', () => {
      const result = computeGroupMemberDiff([], ['npub1a', 'npub1b']);
      expect(result.membersToAdd).toEqual([]);
      expect(result.membersToRemove).toEqual(['npub1a', 'npub1b']);
    });

    it('handles empty existing list', () => {
      const result = computeGroupMemberDiff(['npub1a', 'npub1b'], []);
      expect(result.membersToAdd).toEqual(['npub1a', 'npub1b']);
      expect(result.membersToRemove).toEqual([]);
    });
  });

  // --- parseGroupMemberQueryNpubs ---
  describe('parseGroupMemberQueryNpubs', () => {
    const fakeNpub = 'npub1' + 'a'.repeat(58);

    it('extracts valid npubs from comma-separated query', () => {
      const result = parseGroupMemberQueryNpubs(`${fakeNpub},npub1${'b'.repeat(58)}`);
      expect(result).toHaveLength(2);
      expect(result[0]).toBe(fakeNpub);
    });

    it('returns empty array for empty string', () => {
      expect(parseGroupMemberQueryNpubs('')).toEqual([]);
    });

    it('returns empty array for null', () => {
      expect(parseGroupMemberQueryNpubs(null)).toEqual([]);
    });

    it('ignores entries that are too short', () => {
      const result = parseGroupMemberQueryNpubs('npub1short,not-npub');
      expect(result).toEqual([]);
    });

    it('ignores entries not starting with npub1', () => {
      const result = parseGroupMemberQueryNpubs('nsec1' + 'a'.repeat(58));
      expect(result).toEqual([]);
    });

    it('trims whitespace around entries', () => {
      const result = parseGroupMemberQueryNpubs(`  ${fakeNpub}  `);
      expect(result).toEqual([fakeNpub]);
    });

    it('deduplicates entries', () => {
      const result = parseGroupMemberQueryNpubs(`${fakeNpub},${fakeNpub}`);
      expect(result).toEqual([fakeNpub]);
    });
  });
});
