import { describe, expect, it } from 'vitest';
import {
  findDirectoryByParentAndTitle,
  getAvailableParents,
} from '../src/scopes-manager.js';

describe('scopes-manager pure utilities', () => {
  // --- findDirectoryByParentAndTitle ---
  describe('findDirectoryByParentAndTitle', () => {
    const directories = [
      { record_id: 'd1', parent_directory_id: null, title: 'Products', record_state: 'active' },
      { record_id: 'd2', parent_directory_id: 'd1', title: 'Alpha', record_state: 'active' },
      { record_id: 'd3', parent_directory_id: 'd1', title: 'Beta', record_state: 'deleted' },
      { record_id: 'd4', parent_directory_id: 'd1', title: 'Gamma', record_state: 'active' },
    ];

    it('finds a directory by parent and title', () => {
      const result = findDirectoryByParentAndTitle(directories, 'd1', 'Alpha');
      expect(result).toEqual(directories[1]);
    });

    it('is case-insensitive', () => {
      const result = findDirectoryByParentAndTitle(directories, 'd1', 'alpha');
      expect(result).toEqual(directories[1]);
    });

    it('trims whitespace in the search title', () => {
      const result = findDirectoryByParentAndTitle(directories, 'd1', '  Alpha  ');
      expect(result).toEqual(directories[1]);
    });

    it('skips deleted directories', () => {
      const result = findDirectoryByParentAndTitle(directories, 'd1', 'Beta');
      expect(result).toBeNull();
    });

    it('returns null when no match', () => {
      const result = findDirectoryByParentAndTitle(directories, 'd1', 'Nonexistent');
      expect(result).toBeNull();
    });

    it('matches root directories with null parent', () => {
      const result = findDirectoryByParentAndTitle(directories, null, 'Products');
      expect(result).toEqual(directories[0]);
    });

    it('returns null for empty directories array', () => {
      const result = findDirectoryByParentAndTitle([], null, 'Products');
      expect(result).toBeNull();
    });

    it('handles falsy title gracefully', () => {
      const result = findDirectoryByParentAndTitle(directories, null, '');
      expect(result).toBeNull();
    });
  });

  // --- getAvailableParents ---
  describe('getAvailableParents', () => {
    const scopes = [
      { record_id: 's1', level: 'product', title: 'Product A', record_state: 'active' },
      { record_id: 's2', level: 'product', title: 'Product B', record_state: 'deleted' },
      { record_id: 's3', level: 'project', title: 'Project X', record_state: 'active' },
      { record_id: 's4', level: 'project', title: 'Project Y', record_state: 'deleted' },
      { record_id: 's5', level: 'deliverable', title: 'Deliverable 1', record_state: 'active' },
    ];

    it('returns empty array for product level', () => {
      expect(getAvailableParents(scopes, 'product')).toEqual([]);
    });

    it('returns active products for project level', () => {
      const result = getAvailableParents(scopes, 'project');
      expect(result).toHaveLength(1);
      expect(result[0].record_id).toBe('s1');
    });

    it('excludes deleted products from project parents', () => {
      const result = getAvailableParents(scopes, 'project');
      expect(result.every(s => s.record_state !== 'deleted')).toBe(true);
    });

    it('returns active projects for deliverable level', () => {
      const result = getAvailableParents(scopes, 'deliverable');
      expect(result).toHaveLength(1);
      expect(result[0].record_id).toBe('s3');
    });

    it('excludes deleted projects from deliverable parents', () => {
      const result = getAvailableParents(scopes, 'deliverable');
      expect(result.every(s => s.record_state !== 'deleted')).toBe(true);
    });

    it('returns empty array for unknown level', () => {
      expect(getAvailableParents(scopes, 'unknown')).toEqual([]);
    });
  });
});
