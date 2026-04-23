import { describe, expect, it } from 'vitest';
import {
  normalizeDocShare,
  normalizeDocAccessRow,
  serializeDocShares,
  mergeDocShareLists,
  getShareGroupIds,
  getPreferredDocWriteGroupRef,
  getDocCommentSummary,
  getStoredDocShares,
  getExplicitDocShares,
} from '../src/docs-manager.js';

describe('docs-manager pure utilities', () => {
  // --- normalizeDocShare ---
  describe('normalizeDocShare', () => {
    it('returns null for falsy input', () => {
      expect(normalizeDocShare(null)).toBeNull();
      expect(normalizeDocShare(undefined)).toBeNull();
    });

    it('normalizes a person share with defaults', () => {
      const result = normalizeDocShare({
        type: 'person',
        person_npub: 'npub1abc',
        access: 'read',
      });
      expect(result).toMatchObject({
        type: 'person',
        key: 'person:npub1abc',
        access: 'read',
        person_npub: 'npub1abc',
        group_npub: null,
        via_group_npub: null,
        inherited: false,
        inherited_from_directory_id: null,
      });
    });

    it('normalizes a group share', () => {
      const result = normalizeDocShare({
        type: 'group',
        group_npub: 'npub1grp',
        access: 'write',
      });
      expect(result).toMatchObject({
        type: 'group',
        key: 'group:npub1grp',
        access: 'write',
        group_npub: 'npub1grp',
      });
    });

    it('defaults access to read for unknown values', () => {
      const result = normalizeDocShare({
        type: 'person',
        person_npub: 'npub1abc',
        access: 'admin',
      });
      expect(result.access).toBe('read');
    });

    it('marks as inherited when inheritedFromDirectoryId is provided', () => {
      const result = normalizeDocShare(
        { type: 'person', person_npub: 'npub1abc', access: 'read' },
        'dir-123',
      );
      expect(result.inherited).toBe(true);
      expect(result.inherited_from_directory_id).toBe('dir-123');
    });

    it('canonicalizes group keys even when an existing key is provided', () => {
      const result = normalizeDocShare({
        type: 'person',
        key: 'custom-key',
        person_npub: 'npub1abc',
        access: 'read',
      });
      expect(result.key).toBe('person:npub1abc');
    });

    it('falls back to via_group_npub for group key when group_npub is missing', () => {
      const result = normalizeDocShare({
        type: 'group',
        via_group_npub: 'npub1via',
        access: 'read',
      });
      expect(result.key).toBe('group:npub1via');
    });

    it('prefers stable group_id fields when present', () => {
      const result = normalizeDocShare({
        type: 'group',
        group_id: 'uuid-1',
        group_npub: 'npub_old_epoch',
        access: 'write',
      });
      expect(result.key).toBe('group:uuid-1');
      expect(result.group_id).toBe('uuid-1');
      expect(result.group_npub).toBe('npub_old_epoch');
    });
  });

  // --- serializeDocShares ---
  describe('serializeDocShares', () => {
    it('returns sorted JSON for shares', () => {
      const shares = [
        { type: 'person', key: 'person:z', access: 'read', person_npub: 'z' },
        { type: 'group', key: 'group:a', access: 'write', group_npub: 'a' },
      ];
      const result = serializeDocShares(shares);
      const parsed = JSON.parse(result);
      expect(parsed[0].key).toBe('group:a');
      expect(parsed[1].key).toBe('person:z');
    });

    it('handles empty array', () => {
      expect(serializeDocShares([])).toBe('[]');
    });

    it('handles null/undefined', () => {
      expect(serializeDocShares(null)).toBe('[]');
      expect(serializeDocShares(undefined)).toBe('[]');
    });
  });

  // --- mergeDocShareLists ---
  describe('mergeDocShareLists', () => {
    it('merges primary and inherited shares without duplicates', () => {
      const primary = [
        { type: 'person', key: 'person:npub1', person_npub: 'npub1', access: 'read' },
      ];
      const inherited = [
        { type: 'group', key: 'group:grp1', group_npub: 'grp1', access: 'write' },
      ];
      const result = mergeDocShareLists(primary, inherited);
      expect(result).toHaveLength(2);
    });

    it('primary share wins over inherited with same key, access promoted to write', () => {
      const primary = [
        { type: 'person', key: 'person:npub1', person_npub: 'npub1', access: 'read' },
      ];
      const inherited = [
        { type: 'person', key: 'person:npub1', person_npub: 'npub1', access: 'write', inherited_from_directory_id: 'dir1' },
      ];
      const result = mergeDocShareLists(primary, inherited);
      expect(result).toHaveLength(1);
      expect(result[0].access).toBe('write');
    });

    it('returns sorted by key', () => {
      const shares = [
        { type: 'person', key: 'person:z', person_npub: 'z', access: 'read' },
        { type: 'person', key: 'person:a', person_npub: 'a', access: 'read' },
      ];
      const result = mergeDocShareLists(shares, []);
      expect(result[0].key).toBe('person:a');
      expect(result[1].key).toBe('person:z');
    });

    it('handles empty lists', () => {
      expect(mergeDocShareLists([], [])).toEqual([]);
      expect(mergeDocShareLists()).toEqual([]);
    });
  });

  // --- getShareGroupIds ---
  describe('getShareGroupIds', () => {
    it('extracts unique group npubs', () => {
      const shares = [
        { type: 'group', group_npub: 'grp1' },
        { type: 'person', via_group_npub: 'grp2', group_npub: null },
        { type: 'group', group_npub: 'grp1' },
      ];
      const ids = getShareGroupIds(shares);
      expect(ids).toEqual(['grp1', 'grp2']);
    });

    it('returns empty for no shares', () => {
      expect(getShareGroupIds([])).toEqual([]);
      expect(getShareGroupIds()).toEqual([]);
    });
  });

  // --- getDocCommentSummary ---
  describe('getDocCommentSummary', () => {
    it('returns full body when 7 words or less', () => {
      expect(getDocCommentSummary({ body: 'Short comment' })).toBe('Short comment');
    });

    it('truncates body longer than 7 words', () => {
      const body = 'one two three four five six seven eight nine';
      const result = getDocCommentSummary({ body });
      expect(result).toBe('one two three four five six seven…');
    });

    it('handles empty/null body', () => {
      expect(getDocCommentSummary({})).toBe('');
      expect(getDocCommentSummary(null)).toBe('');
    });
  });

  // --- getStoredDocShares ---
  describe('getStoredDocShares', () => {
    it('normalizes shares from item', () => {
      const item = {
        shares: [
          { type: 'person', person_npub: 'npub1abc', access: 'read' },
        ],
      };
      const result = getStoredDocShares(item);
      expect(result).toHaveLength(1);
      expect(result[0].key).toBe('person:npub1abc');
    });

    it('returns empty for item with no shares', () => {
      expect(getStoredDocShares({})).toEqual([]);
      expect(getStoredDocShares({ shares: null })).toEqual([]);
    });
  });

  // --- getExplicitDocShares ---
  describe('getExplicitDocShares', () => {
    it('filters out inherited shares', () => {
      const item = {
        shares: [
          { type: 'person', person_npub: 'npub1', access: 'read' },
          { type: 'group', group_npub: 'grp1', access: 'write', inherited: true, inherited_from_directory_id: 'dir1' },
        ],
      };
      const result = getExplicitDocShares(item);
      expect(result).toHaveLength(1);
      expect(result[0].person_npub).toBe('npub1');
    });
  });

  describe('normalizeDocAccessRow', () => {
    it('normalizes group_ids, share refs, and write_group_id through a resolver', () => {
      const result = normalizeDocAccessRow({
        group_ids: ['npub_old_epoch'],
        write_group_id: 'npub_old_epoch',
        shares: [
          { type: 'group', group_npub: 'npub_old_epoch', access: 'write' },
        ],
      }, (value) => value === 'npub_old_epoch' ? 'uuid-1' : value);

      expect(result.group_ids).toEqual(['uuid-1']);
      expect(result.write_group_id).toBe('uuid-1');
      expect(result.shares[0].group_id).toBe('uuid-1');
      expect(result.shares[0].key).toBe('group:uuid-1');
    });

    it('materializes scope policy groups into delivery groups before share groups', () => {
      const result = normalizeDocAccessRow({
        scope_policy_group_ids: ['g-scope'],
        shares: [
          { type: 'group', group_id: 'g-direct', access: 'read' },
        ],
      });

      expect(result.group_ids).toEqual(['g-scope', 'g-direct']);
      expect(result.write_group_id).toBe('g-scope');
    });
  });

  describe('getPreferredDocWriteGroupRef', () => {
    it('prefers scope policy groups before generic group order', () => {
      const result = getPreferredDocWriteGroupRef({
        group_ids: ['g-read', 'g-scope'],
        scope_policy_group_ids: ['g-scope'],
        shares: [
          { type: 'group', group_npub: 'g-read', access: 'read' },
          { type: 'group', group_npub: 'g-scope', access: 'write' },
        ],
      });
      expect(result).toBe('g-scope');
    });

    it('keeps the scope policy group as canonical even when another writable group is loaded', () => {
      const result = getPreferredDocWriteGroupRef({
        group_ids: ['g-scope', 'g-direct'],
        scope_policy_group_ids: ['g-scope'],
        shares: [
          { type: 'group', group_id: 'g-scope', access: 'write' },
          { type: 'person', person_npub: 'npub1friend', via_group_id: 'g-direct', access: 'write' },
        ],
      }, {
        hasKey: (groupId) => groupId === 'g-direct',
      });
      expect(result).toBe('g-scope');
    });
  });
});
