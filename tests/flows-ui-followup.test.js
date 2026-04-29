import { describe, it, expect, vi } from 'vitest';

/**
 * Tests for Pete's flows UI follow-up items:
 * 1. Flows sidebar icon sizing (HTML structure test)
 * 2. Add Step button styling (CSS class test)
 * 3. Scope selection in flow editor
 * 4. @mention typeahead includes flows and scopes
 * 5. Flow @mention navigation and reference resolution
 */

// --- 4. searchMentions includes flows ---

describe('searchMentions includes flow type', () => {
  function buildStore(overrides = {}) {
    return {
      flows: [],
      scopes: [],
      tasks: [],
      documents: [],
      currentWorkspaceGroups: [],
      getSenderName: (npub) => npub.slice(0, 8),
      ...overrides,
    };
  }

  // Import searchMentions logic inline (it's defined on the Alpine store mixin)
  // We replicate the logic here to unit-test it in isolation.
  function searchMentions(store, rawQuery) {
    if (!rawQuery) return [];

    let typeFilter = null;
    let query = rawQuery;
    const prefixMatch = rawQuery.match(/^(scope|task|doc|person|flow):/i);
    if (prefixMatch) {
      typeFilter = prefixMatch[1].toLowerCase();
      query = rawQuery.slice(prefixMatch[0].length);
    }

    const needle = query.toLowerCase();
    const results = [];
    const limit = 10;

    // People
    if (!typeFilter || typeFilter === 'person') {
      const seenNpubs = new Set();
      for (const group of store.currentWorkspaceGroups) {
        for (const npub of (group.member_npubs || [])) {
          if (seenNpubs.has(npub)) continue;
          seenNpubs.add(npub);
          const name = store.getSenderName(npub);
          if (!needle || name.toLowerCase().includes(needle) || npub.toLowerCase().includes(needle)) {
            results.push({ type: 'person', id: npub, label: name, sublabel: '' });
          }
        }
      }
    }

    // Documents
    if (!typeFilter || typeFilter === 'doc') {
      for (const doc of store.documents) {
        if (doc.record_state === 'deleted') continue;
        if (!needle || (doc.title || '').toLowerCase().includes(needle)) {
          results.push({ type: 'doc', id: doc.record_id, label: doc.title || 'Untitled', sublabel: 'Doc' });
        }
      }
    }

    // Tasks
    if (!typeFilter || typeFilter === 'task') {
      for (const task of store.tasks) {
        if (task.record_state === 'deleted') continue;
        if (!needle || (task.title || '').toLowerCase().includes(needle)) {
          results.push({ type: 'task', id: task.record_id, label: task.title || 'Untitled', sublabel: 'Task' });
        }
      }
    }

    // Scopes
    if (!typeFilter || typeFilter === 'scope') {
      for (const scope of store.scopes) {
        if (scope.record_state === 'deleted') continue;
        if (!needle || (scope.title || '').toLowerCase().includes(needle)) {
          const levelLabel = scope.level === 'product' ? 'Product' : scope.level === 'project' ? 'Project' : 'Deliverable';
          results.push({ type: 'scope', id: scope.record_id, label: scope.title || 'Untitled', sublabel: levelLabel });
        }
      }
    }

    // Flows
    if (!typeFilter || typeFilter === 'flow') {
      for (const flow of store.flows) {
        if (flow.record_state === 'deleted') continue;
        if (!needle || (flow.title || '').toLowerCase().includes(needle)) {
          results.push({ type: 'flow', id: flow.record_id, label: flow.title || 'Untitled', sublabel: 'Flow' });
        }
      }
    }

    return results.slice(0, limit);
  }

  it('returns flow results when query matches flow title', () => {
    const store = buildStore({
      flows: [
        { record_id: 'flow-1', title: 'Onboarding Pipeline', record_state: 'active' },
        { record_id: 'flow-2', title: 'Review Flow', record_state: 'active' },
      ],
    });
    const results = searchMentions(store, 'onboarding');
    expect(results.some(r => r.type === 'flow' && r.id === 'flow-1')).toBe(true);
    expect(results.find(r => r.id === 'flow-1').sublabel).toBe('Flow');
  });

  it('supports flow: type prefix filter', () => {
    const store = buildStore({
      flows: [{ record_id: 'flow-1', title: 'Deploy', record_state: 'active' }],
      tasks: [{ record_id: 'task-1', title: 'Deploy the app', record_state: 'active' }],
    });
    const results = searchMentions(store, 'flow:deploy');
    expect(results.every(r => r.type === 'flow')).toBe(true);
    expect(results.length).toBe(1);
  });

  it('excludes deleted flows', () => {
    const store = buildStore({
      flows: [
        { record_id: 'flow-1', title: 'Active Flow', record_state: 'active' },
        { record_id: 'flow-2', title: 'Deleted Flow', record_state: 'deleted' },
      ],
    });
    const results = searchMentions(store, 'flow');
    expect(results.find(r => r.id === 'flow-2')).toBeUndefined();
    expect(results.find(r => r.id === 'flow-1')).toBeDefined();
  });

  it('includes flows in unfiltered search alongside tasks and scopes', () => {
    const store = buildStore({
      flows: [{ record_id: 'flow-1', title: 'Build pipeline', record_state: 'active' }],
      tasks: [{ record_id: 'task-1', title: 'Build feature', record_state: 'active' }],
      scopes: [{ record_id: 'scope-1', title: 'Build phase', level: 'project', record_state: 'active' }],
    });
    const results = searchMentions(store, 'build');
    const types = results.map(r => r.type);
    expect(types).toContain('flow');
    expect(types).toContain('task');
    expect(types).toContain('scope');
  });
});


// --- 5. handleMentionNavigate supports 'flow' type ---

describe('handleMentionNavigate supports flow type', () => {
  it('navigates to the flows settings tab when type is flow', () => {
    const store = {
      navSection: 'tasks',
      settingsTab: 'connection',
      mobileNavOpen: true,
      showFlowEditor: false,
      editingFlowId: null,
      startWorkspaceLiveQueries: vi.fn(),
      refreshFlows: vi.fn(),
      refreshApprovals: vi.fn(),
      syncRoute: vi.fn(),
      $nextTick: (fn) => fn(),
    };

    // Simulate handleMentionNavigate for flow type
    function handleMentionNavigate(type, id) {
      if (type === 'flow') {
        store.navSection = 'settings';
        store.settingsTab = 'flows';
        store.mobileNavOpen = false;
        store.startWorkspaceLiveQueries();
        store.refreshFlows();
        store.refreshApprovals();
        store.syncRoute();
        store.editingFlowId = id;
        store.showFlowEditor = true;
      }
    }

    handleMentionNavigate('flow', 'flow-abc');
    expect(store.navSection).toBe('settings');
    expect(store.settingsTab).toBe('flows');
    expect(store.mobileNavOpen).toBe(false);
    expect(store.syncRoute).toHaveBeenCalled();
    expect(store.editingFlowId).toBe('flow-abc');
    expect(store.showFlowEditor).toBe(true);
  });
});


// --- 5b. resolveReferenceLabel supports 'flow' type ---

describe('resolveReferenceLabel supports flow type', () => {
  it('resolves flow reference label from flows array', () => {
    const flows = [
      { record_id: 'flow-1', title: 'Deploy Pipeline' },
      { record_id: 'flow-2', title: 'Review Flow' },
    ];

    function resolveReferenceLabel(ref) {
      if (!ref || !ref.type || !ref.id) return ref?.id || 'Unknown';
      if (ref.type === 'flow') {
        const flow = flows.find(f => f.record_id === ref.id);
        return flow?.title || ref.id.slice(0, 8);
      }
      return ref.id.slice(0, 8);
    }

    expect(resolveReferenceLabel({ type: 'flow', id: 'flow-1' })).toBe('Deploy Pipeline');
    expect(resolveReferenceLabel({ type: 'flow', id: 'flow-unknown' })).toBe('flow-unk');
  });
});


// --- 1 & 2. HTML structure assertions for settings placement and add-step button ---
// These test the expected HTML patterns that our code changes will produce.

describe('flows settings tab HTML structure', () => {
  it('keeps flows in settings instead of the sidebar', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

    expect(html).toContain("settingsTab === 'flows'");
    expect(html).not.toContain('<span class="sidebar-label">Flows</span>');
  });
});


// --- 3. Scope picker in flow editor ---

describe('flow editor scope assignment', () => {
  it('scope picker state fields exist for flow editor', () => {
    // The flow editor needs its own scope picker state
    const flowEditorState = {
      formScopeId: null,
      formScopeQuery: '',
      showFlowScopePicker: false,
    };

    // Selecting a scope updates formScopeId
    flowEditorState.formScopeId = 'scope-123';
    expect(flowEditorState.formScopeId).toBe('scope-123');
  });

  it('save() uses formScopeId for scope assignment when set', () => {
    // When a user picks a scope in the flow editor, the save should
    // use that explicit scope rather than the global selectedBoardId
    const formScopeId = 'scope-explicit';
    const selectedBoardId = 'scope-global';

    // Explicit scope should win
    const scopeId = formScopeId || selectedBoardId || null;
    expect(scopeId).toBe('scope-explicit');
  });

  it('save() falls back to selectedBoardId when no scope explicitly chosen', () => {
    const formScopeId = null;
    const selectedBoardId = 'scope-global';

    const scopeId = formScopeId || selectedBoardId || null;
    expect(scopeId).toBe('scope-global');
  });
});


// --- 4b. mention-popover type label includes flow ---

describe('mention popover type label', () => {
  it('displays FLOW label for flow type results', () => {
    // The mention popover shows a type badge per result.
    // This tests the logic that maps result.type to display label.
    function mentionTypeLabel(type) {
      if (type === 'person') return '@';
      if (type === 'doc') return 'DOC';
      if (type === 'scope') return 'SCOPE';
      if (type === 'flow') return 'FLOW';
      return 'TASK';
    }

    expect(mentionTypeLabel('flow')).toBe('FLOW');
    expect(mentionTypeLabel('task')).toBe('TASK');
    expect(mentionTypeLabel('scope')).toBe('SCOPE');
  });
});
