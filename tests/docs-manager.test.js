import { describe, expect, it } from 'vitest';
import {
  normalizeDocShare,
  serializeDocShares,
  mergeDocShareLists,
  getShareGroupIds,
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

    it('uses existing key if provided', () => {
      const result = normalizeDocShare({
        type: 'person',
        key: 'custom-key',
        person_npub: 'npub1abc',
        access: 'read',
      });
      expect(result.key).toBe('custom-key');
    });

    it('falls back to via_group_npub for group key when group_npub is missing', () => {
      const result = normalizeDocShare({
        type: 'group',
        via_group_npub: 'npub1via',
        access: 'read',
      });
      expect(result.key).toBe('group:npub1via');
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
});
