import { describe, expect, it } from 'vitest';
import { filterDocItemsByScope } from '../src/docs-scope-filter.js';
import {
  UNSCOPED_TASK_BOARD_ID,
  ALL_TASK_BOARD_ID,
  RECENT_TASK_BOARD_ID,
} from '../src/task-board-state.js';

// --- scope fixtures ---
const product = {
  record_id: 'scope-product',
  title: 'Product X',
  level: 'product',
  parent_id: null,
  record_state: 'active',
};

const project = {
  record_id: 'scope-project',
  title: 'Project Y',
  level: 'project',
  parent_id: 'scope-product',
  product_id: 'scope-product',
  record_state: 'active',
};

const deliverable = {
  record_id: 'scope-deliverable',
  title: 'Deliverable Z',
  level: 'deliverable',
  parent_id: 'scope-project',
  product_id: 'scope-product',
  project_id: 'scope-project',
  record_state: 'active',
};

function buildScopesMap(scopes = [product, project, deliverable]) {
  const m = new Map();
  for (const s of scopes) m.set(s.record_id, s);
  return m;
}

// --- doc/dir fixtures ---
function makeDoc(overrides = {}) {
  return {
    record_id: 'doc-1',
    title: 'Test Doc',
    content: 'Hello world',
    parent_directory_id: null,
    scope_id: null,
    scope_product_id: null,
    scope_project_id: null,
    scope_deliverable_id: null,
    record_state: 'active',
    ...overrides,
  };
}

function makeDir(overrides = {}) {
  return {
    record_id: 'dir-1',
    title: 'Test Dir',
    parent_directory_id: null,
    scope_id: null,
    scope_product_id: null,
    scope_project_id: null,
    scope_deliverable_id: null,
    record_state: 'active',
    ...overrides,
  };
}

describe('filterDocItemsByScope', () => {
  const scopesMap = buildScopesMap();

  describe('ALL board — returns all items', () => {
    it('returns all active documents regardless of scope', () => {
      const docs = [
        makeDoc({ record_id: 'd1', scope_id: 'scope-product', scope_product_id: 'scope-product' }),
        makeDoc({ record_id: 'd2' }),
      ];
      const result = filterDocItemsByScope(docs, [], ALL_TASK_BOARD_ID, null, scopesMap);
      expect(result.documents).toHaveLength(2);
    });

    it('returns all active directories', () => {
      const dirs = [makeDir({ record_id: 'dir1' }), makeDir({ record_id: 'dir2' })];
      const result = filterDocItemsByScope([], dirs, ALL_TASK_BOARD_ID, null, scopesMap);
      expect(result.directories).toHaveLength(2);
    });
  });

  describe('RECENT board — returns all items (no time filter for docs)', () => {
    it('returns all items when Recent is selected', () => {
      const docs = [makeDoc({ record_id: 'd1' }), makeDoc({ record_id: 'd2' })];
      const result = filterDocItemsByScope(docs, [], RECENT_TASK_BOARD_ID, null, scopesMap);
      expect(result.documents).toHaveLength(2);
    });
  });

  describe('UNSCOPED board — only unscoped items', () => {
    it('returns documents with no scope', () => {
      const docs = [
        makeDoc({ record_id: 'd1' }),
        makeDoc({ record_id: 'd2', scope_id: 'scope-product', scope_product_id: 'scope-product' }),
      ];
      const result = filterDocItemsByScope(docs, [], UNSCOPED_TASK_BOARD_ID, null, scopesMap);
      expect(result.documents).toHaveLength(1);
      expect(result.documents[0].record_id).toBe('d1');
    });

    it('returns directories with no scope', () => {
      const dirs = [
        makeDir({ record_id: 'dir1' }),
        makeDir({ record_id: 'dir2', scope_id: 'scope-project', scope_product_id: 'scope-product', scope_project_id: 'scope-project' }),
      ];
      const result = filterDocItemsByScope([], dirs, UNSCOPED_TASK_BOARD_ID, null, scopesMap);
      expect(result.directories).toHaveLength(1);
      expect(result.directories[0].record_id).toBe('dir1');
    });
  });

  describe('specific scope — filters by scope match', () => {
    it('shows docs scoped to the selected product', () => {
      const docs = [
        makeDoc({ record_id: 'd1', scope_id: 'scope-product', scope_product_id: 'scope-product' }),
        makeDoc({ record_id: 'd2', scope_id: 'scope-project', scope_product_id: 'scope-product', scope_project_id: 'scope-project' }),
        makeDoc({ record_id: 'd3' }),
      ];
      const result = filterDocItemsByScope(docs, [], product.record_id, product, scopesMap);
      // Product scope with includeDescendants: true should match d1 and d2
      expect(result.documents.map(d => d.record_id)).toContain('d1');
      expect(result.documents.map(d => d.record_id)).toContain('d2');
      expect(result.documents.map(d => d.record_id)).not.toContain('d3');
    });

    it('shows docs scoped to the selected project', () => {
      const docs = [
        makeDoc({ record_id: 'd1', scope_id: 'scope-project', scope_product_id: 'scope-product', scope_project_id: 'scope-project' }),
        makeDoc({ record_id: 'd2', scope_id: 'scope-deliverable', scope_product_id: 'scope-product', scope_project_id: 'scope-project', scope_deliverable_id: 'scope-deliverable' }),
        makeDoc({ record_id: 'd3', scope_id: 'scope-product', scope_product_id: 'scope-product' }),
      ];
      const result = filterDocItemsByScope(docs, [], project.record_id, project, scopesMap);
      // Project scope with includeDescendants: true should match d1 and d2
      expect(result.documents.map(d => d.record_id)).toContain('d1');
      expect(result.documents.map(d => d.record_id)).toContain('d2');
      expect(result.documents.map(d => d.record_id)).not.toContain('d3');
    });

    it('shows docs scoped to the selected deliverable', () => {
      const docs = [
        makeDoc({ record_id: 'd1', scope_id: 'scope-deliverable', scope_product_id: 'scope-product', scope_project_id: 'scope-project', scope_deliverable_id: 'scope-deliverable' }),
        makeDoc({ record_id: 'd2', scope_id: 'scope-project', scope_product_id: 'scope-product', scope_project_id: 'scope-project' }),
      ];
      const result = filterDocItemsByScope(docs, [], deliverable.record_id, deliverable, scopesMap);
      expect(result.documents).toHaveLength(1);
      expect(result.documents[0].record_id).toBe('d1');
    });

    it('filters directories by own scope', () => {
      const dirs = [
        makeDir({ record_id: 'dir1', scope_id: 'scope-product', scope_product_id: 'scope-product' }),
        makeDir({ record_id: 'dir2' }),
      ];
      // dir2 has no scope and no scoped children — excluded
      const result = filterDocItemsByScope([], dirs, product.record_id, product, scopesMap);
      expect(result.directories).toHaveLength(1);
      expect(result.directories[0].record_id).toBe('dir1');
    });
  });

  describe('ancestor directory containment', () => {
    it('includes unscoped directory when it contains a scope-matched doc', () => {
      const dirs = [
        makeDir({ record_id: 'dir-parent' }), // no scope
      ];
      const docs = [
        makeDoc({ record_id: 'd1', parent_directory_id: 'dir-parent', scope_id: 'scope-product', scope_product_id: 'scope-product' }),
      ];
      const result = filterDocItemsByScope(docs, dirs, product.record_id, product, scopesMap);
      expect(result.documents).toHaveLength(1);
      expect(result.directories).toHaveLength(1);
      expect(result.directories[0].record_id).toBe('dir-parent');
    });

    it('includes ancestor chain when matched doc is deeply nested', () => {
      const dirs = [
        makeDir({ record_id: 'dir-root' }),
        makeDir({ record_id: 'dir-child', parent_directory_id: 'dir-root' }),
      ];
      const docs = [
        makeDoc({ record_id: 'd1', parent_directory_id: 'dir-child', scope_id: 'scope-project', scope_product_id: 'scope-product', scope_project_id: 'scope-project' }),
      ];
      const result = filterDocItemsByScope(docs, dirs, project.record_id, project, scopesMap);
      expect(result.documents).toHaveLength(1);
      expect(result.directories.map(d => d.record_id).sort()).toEqual(['dir-child', 'dir-root']);
    });

    it('excludes directories with no matching descendants', () => {
      const dirs = [
        makeDir({ record_id: 'dir-empty' }),
        makeDir({ record_id: 'dir-with-match' }),
      ];
      const docs = [
        makeDoc({ record_id: 'd1', parent_directory_id: 'dir-with-match', scope_id: 'scope-product', scope_product_id: 'scope-product' }),
        makeDoc({ record_id: 'd2', parent_directory_id: 'dir-empty' }), // unscoped doc
      ];
      const result = filterDocItemsByScope(docs, dirs, product.record_id, product, scopesMap);
      expect(result.directories).toHaveLength(1);
      expect(result.directories[0].record_id).toBe('dir-with-match');
    });

    it('includes directory by own scope even without matching children', () => {
      const dirs = [
        makeDir({ record_id: 'dir1', scope_id: 'scope-product', scope_product_id: 'scope-product' }),
      ];
      const result = filterDocItemsByScope([], dirs, product.record_id, product, scopesMap);
      expect(result.directories).toHaveLength(1);
    });

    it('includes unscoped directory containing a scope-matched subdirectory', () => {
      const dirs = [
        makeDir({ record_id: 'dir-root' }),
        makeDir({ record_id: 'dir-scoped', parent_directory_id: 'dir-root', scope_id: 'scope-product', scope_product_id: 'scope-product' }),
      ];
      const result = filterDocItemsByScope([], dirs, product.record_id, product, scopesMap);
      expect(result.directories.map(d => d.record_id).sort()).toEqual(['dir-root', 'dir-scoped']);
    });

    it('does not include ancestor dirs for unscoped board', () => {
      const dirs = [
        makeDir({ record_id: 'dir-root' }),
      ];
      const docs = [
        makeDoc({ record_id: 'd1', parent_directory_id: 'dir-root' }), // unscoped
        makeDoc({ record_id: 'd2', parent_directory_id: 'dir-root', scope_id: 'scope-product', scope_product_id: 'scope-product' }),
      ];
      const result = filterDocItemsByScope(docs, dirs, UNSCOPED_TASK_BOARD_ID, null, scopesMap);
      // Unscoped board: dir-root itself is unscoped, so it should be included
      expect(result.directories).toHaveLength(1);
      expect(result.documents).toHaveLength(1);
      expect(result.documents[0].record_id).toBe('d1');
    });
  });

  describe('null/missing board scope — returns all', () => {
    it('returns all items when selectedBoardId is null', () => {
      const docs = [makeDoc({ record_id: 'd1' })];
      const dirs = [makeDir({ record_id: 'dir1' })];
      const result = filterDocItemsByScope(docs, dirs, null, null, scopesMap);
      expect(result.documents).toHaveLength(1);
      expect(result.directories).toHaveLength(1);
    });

    it('returns all items when selectedBoardId is set but scope not found', () => {
      const docs = [makeDoc({ record_id: 'd1' })];
      const result = filterDocItemsByScope(docs, [], 'unknown-scope-id', null, scopesMap);
      expect(result.documents).toHaveLength(1);
    });
  });

  describe('excludes deleted items', () => {
    it('excludes deleted documents', () => {
      const docs = [
        makeDoc({ record_id: 'd1', record_state: 'deleted' }),
        makeDoc({ record_id: 'd2' }),
      ];
      const result = filterDocItemsByScope(docs, [], ALL_TASK_BOARD_ID, null, scopesMap);
      expect(result.documents).toHaveLength(1);
      expect(result.documents[0].record_id).toBe('d2');
    });

    it('excludes deleted directories', () => {
      const dirs = [
        makeDir({ record_id: 'dir1', record_state: 'deleted' }),
        makeDir({ record_id: 'dir2' }),
      ];
      const result = filterDocItemsByScope([], dirs, ALL_TASK_BOARD_ID, null, scopesMap);
      expect(result.directories).toHaveLength(1);
    });
  });

  describe('unscoped docs include those with empty scope fields', () => {
    it('treats null scope fields as unscoped', () => {
      const docs = [
        makeDoc({ record_id: 'd1', scope_id: null, scope_product_id: null, scope_project_id: null, scope_deliverable_id: null }),
      ];
      const result = filterDocItemsByScope(docs, [], UNSCOPED_TASK_BOARD_ID, null, scopesMap);
      expect(result.documents).toHaveLength(1);
    });
  });
});
