import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { commandPaletteMixin, createCommandPaletteState } from '../src/command-palette.js';
import { ALL_TASK_BOARD_ID } from '../src/task-board-state.js';

const indexPath = path.resolve(import.meta.dirname, '..', 'index.html');
const indexSource = fs.readFileSync(indexPath, 'utf-8');
const originalWindow = globalThis.window;

afterEach(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: originalWindow,
  });
});

function stubWindow(windowMock) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: windowMock,
  });
}

function applyPalette(store) {
  Object.defineProperties(store, Object.getOwnPropertyDescriptors(commandPaletteMixin));
  return store;
}

function createStore(overrides = {}) {
  return applyPalette({
    ...createCommandPaletteState(),
    isLoggedIn: true,
    selectedBoardId: null,
    selectedBoardScope: null,
    scopes: [],
    scopesMap: new Map(),
    selectedBoardLabel: 'Scope board',
    channels: [],
    documents: [],
    session: { npub: 'npub-me' },
    workspaceOwnerNpub: 'npub-owner',
    botNpub: 'npub-bot',
    defaultAgentNpub: 'npub-agent',
    commandPaletteIndex: [],
    getChannelLabel: (channel) => channel.title || channel.label || channel.record_id,
    getSenderName: (npub) => (npub === 'npub-agent' ? 'wm21' : npub),
    getScopeBreadcrumb: (scopeId) => `Business > ${scopeId}`,
    scopeLevelLabel: (level) => String(level || '').toUpperCase(),
    getTaskBoardLabel: (record) => `Scope ${record.scope_id}`,
    getFlightDeckReportTypeLabel: () => 'Report',
    getReportMetricLabel: () => 'Metric',
    refreshCommandPaletteIndex: vi.fn(async () => {}),
    refreshScopes: vi.fn(async () => {}),
    refreshTasks: vi.fn(async () => {}),
    refreshChannels: vi.fn(async () => {}),
    refreshDocuments: vi.fn(async () => {}),
    refreshDirectories: vi.fn(async () => {}),
    refreshFlows: vi.fn(async () => {}),
    refreshApprovals: vi.fn(async () => {}),
    refreshReports: vi.fn(async () => {}),
    persistSelectedBoardId: vi.fn(),
    validateSelectedBoardId: vi.fn(),
    normalizeTaskFilterTags: vi.fn(),
    navigateTo: vi.fn(),
    openTaskDetail: vi.fn(),
    openDoc: vi.fn(),
    navigateToFolder: vi.fn(),
    selectChannel: vi.fn(async () => {}),
    openThread: vi.fn(),
    openFlowEditor: vi.fn(),
    openReportModalById: vi.fn(),
    syncRoute: vi.fn(),
    openNewChannelModal: vi.fn(),
    createBotDm: vi.fn(async () => {}),
    createDocument: vi.fn(async () => {}),
    addTask: vi.fn(async () => ({ record_id: 'task-new' })),
    buildTaskBoardAssignment: vi.fn((scopeId) => ({ scope_id: scopeId, group_ids: ['group-default'] })),
    handleInlineImagePaste: vi.fn(async () => {}),
    containsInlineImageUploadToken: vi.fn((value) => String(value || '').includes('[ Uploading image')),
    $nextTick: (fn) => fn(),
    ...overrides,
  });
}

describe('command palette launchers', () => {
  it('opens from the Flight Deck logo instead of routing the logo directly', () => {
    expect(indexSource).toContain("@click=\"if ($store.chat.isLoggedIn) $store.chat.openCommandPalette()\"");
    expect(indexSource).not.toContain('mobile-radar');
  });

  it('renders quick launch items as a quadrant grid with icon shortcut labels', () => {
    expect(indexSource).toContain('command-palette-results-quick');
    expect(indexSource).toContain('command-palette-group-quick');
    expect(indexSource).toContain('command-palette-result-icon-svg');
    expect(indexSource).toContain('getCommandPaletteIconSvg(item.icon || item.group)');
    expect(indexSource).toContain('command-palette-result-icon-key');
    expect(indexSource).not.toContain('command-palette-result-key');
  });

  it('uses SVG icons for command palette items', () => {
    const store = createStore();

    expect(store.getCommandPaletteIconSvg('bot')).toContain('<svg');
    expect(store.getCommandPaletteIconSvg('bot')).toContain('<rect');
    expect(store.getCommandPaletteIconSvg('missing')).toContain('<path d="M9 18l6-6-6-6">');
  });

  it('renders a two-line New Work description field with image paste handling', () => {
    expect(indexSource).toContain('x-model="$store.chat.commandPaletteNewWorkDescription"');
    expect(indexSource).toContain('rows="2"');
    expect(indexSource).toContain('@paste="$store.chat.handleCommandPaletteNewWorkDescriptionPaste($event)"');
  });

  it('registers Command/Super+J to open the palette in capture phase', () => {
    let handler = null;
    const windowMock = {
      addEventListener: vi.fn((eventName, callback) => {
        if (eventName === 'keydown') handler = callback;
      }),
    };
    stubWindow(windowMock);
    const openCommandPalette = vi.fn();
    const store = createStore();
    store.openCommandPalette = openCommandPalette;

    store.initCommandPaletteShortcuts();
    handler({
      key: 'j',
      code: 'KeyJ',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      defaultPrevented: false,
      preventDefault: vi.fn(),
    });

    expect(windowMock.addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function), true);
    expect(openCommandPalette).toHaveBeenCalledTimes(1);
  });

  it('keeps Command/Super+K as a best-effort shortcut', () => {
    let handler = null;
    const preventDefault = vi.fn();
    stubWindow({
      addEventListener: vi.fn((eventName, callback) => {
        if (eventName === 'keydown') handler = callback;
      }),
    });
    const store = createStore();
    store.openCommandPalette = vi.fn();

    store.initCommandPaletteShortcuts();
    handler({
      key: 'k',
      code: 'KeyK',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      defaultPrevented: false,
      target: { closest: () => ({ tagName: 'INPUT' }) },
      preventDefault,
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(store.openCommandPalette).toHaveBeenCalledTimes(1);
  });

  it('supports Ctrl+Shift+K as a fallback shortcut', () => {
    let handler = null;
    const preventDefault = vi.fn();
    stubWindow({
      addEventListener: vi.fn((eventName, callback) => {
        if (eventName === 'keydown') handler = callback;
      }),
    });
    const store = createStore();
    store.openCommandPalette = vi.fn();

    store.initCommandPaletteShortcuts();
    handler({
      key: 'k',
      code: 'KeyK',
      metaKey: false,
      ctrlKey: true,
      altKey: false,
      shiftKey: true,
      defaultPrevented: false,
      target: { closest: () => ({ tagName: 'TEXTAREA' }) },
      preventDefault,
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(store.openCommandPalette).toHaveBeenCalledTimes(1);
  });

  it('supports Ctrl+J inside editable fields', () => {
    let handler = null;
    const preventDefault = vi.fn();
    stubWindow({
      addEventListener: vi.fn((eventName, callback) => {
        if (eventName === 'keydown') handler = callback;
      }),
    });
    const store = createStore();
    store.openCommandPalette = vi.fn();

    store.initCommandPaletteShortcuts();
    handler({
      key: 'j',
      code: 'KeyJ',
      metaKey: false,
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
      defaultPrevented: false,
      target: { closest: () => ({ tagName: 'INPUT' }) },
      preventDefault,
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(store.openCommandPalette).toHaveBeenCalledTimes(1);
  });

  it('does not open for plain K in editable fields', () => {
    let handler = null;
    stubWindow({
      addEventListener: vi.fn((eventName, callback) => {
        if (eventName === 'keydown') handler = callback;
      }),
    });
    const store = createStore();
    store.openCommandPalette = vi.fn();

    store.initCommandPaletteShortcuts();
    handler({
      key: 'k',
      code: 'KeyK',
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      defaultPrevented: false,
      target: { closest: () => ({ tagName: 'INPUT' }) },
      preventDefault: vi.fn(),
    });

    expect(store.openCommandPalette).not.toHaveBeenCalled();
  });

  it('executes quick launch items with number keys while the palette is open', async () => {
    let handler = null;
    const preventDefault = vi.fn();
    stubWindow({
      addEventListener: vi.fn((eventName, callback) => {
        if (eventName === 'keydown') handler = callback;
      }),
    });
    const store = createStore({ showCommandPalette: true });
    store.executeCommandPaletteItem = vi.fn(async () => {});

    store.initCommandPaletteShortcuts();
    handler({
      key: '2',
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      defaultPrevented: false,
      preventDefault,
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(store.executeCommandPaletteItem).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Chat',
      shortcutKey: '2',
    }));
  });
});

describe('command palette defaults and search', () => {
  it('shows exactly four quick launch items before typing', () => {
    const store = createStore({
      selectedBoardScope: { record_id: 'scope-a', title: 'Apollo' },
      scopesMap: new Map([['scope-a', { record_id: 'scope-a', title: 'Apollo' }]]),
    });

    const titles = store.commandPaletteDefaultItems.map((item) => item.title);

    expect(titles).toEqual(["What's on", 'Chat', 'New Work', 'Quick Doc']);
    expect(store.commandPaletteDefaultItems.map((item) => item.shortcutKey)).toEqual(['1', '2', '3', '4']);
  });

  it('groups searched scopes, records, threads, approvals, and commands by target type', () => {
    const store = createStore();
    store.commandPaletteIndex = store.buildCommandPaletteIndex({
      scopes: [{ record_id: 'scope-a', title: 'Apollo scope', level: 'l2', updated_at: '2026-05-05T00:00:00Z' }],
      directories: [{ record_id: 'dir-a', title: 'Apollo folder', updated_at: '2026-05-05T00:00:00Z' }],
      documents: [{ record_id: 'doc-a', title: 'Apollo plan', content: 'orbit', updated_at: '2026-05-05T00:00:00Z' }],
      tasks: [{ record_id: 'task-a', title: 'Apollo task', scope_id: 'scope-a', updated_at: '2026-05-05T00:00:00Z' }],
      channels: [{ record_id: 'chan-a', title: 'Apollo chat', scope_id: 'scope-a', updated_at: '2026-05-05T00:00:00Z' }],
      messages: [
        { record_id: 'msg-root', channel_id: 'chan-a', body: 'Apollo thread', updated_at: '2026-05-05T00:00:00Z' },
        { record_id: 'msg-reply', channel_id: 'chan-a', parent_message_id: 'msg-root', body: 'Reply', updated_at: '2026-05-05T00:00:00Z' },
      ],
      flows: [{ record_id: 'flow-a', title: 'Apollo flow', scope_id: 'scope-a', updated_at: '2026-05-05T00:00:00Z' }],
      approvals: [{ record_id: 'approval-a', title: 'Apollo approval', status: 'pending', updated_at: '2026-05-05T00:00:00Z' }],
      reports: [{ record_id: 'report-a', title: 'Apollo metric', updated_at: '2026-05-05T00:00:00Z' }],
    });
    store.commandPaletteQuery = 'apollo';

    const groupLabels = store.commandPaletteGroups.map((group) => group.label);

    expect(groupLabels).toEqual(expect.arrayContaining([
      'Scopes',
      'Docs',
      'Tasks',
      'Chat channels',
      'Chat threads',
      'Flows',
      'Approvals',
      'Flight Deck',
    ]));
  });
});

describe('command palette actions', () => {
  it('selects a scope and lands on the scoped Flight Deck', async () => {
    const store = createStore();

    await store.runCommandPaletteAction({
      action: 'select-scope',
      recordId: 'scope-a',
      scopeId: 'scope-a',
      title: 'Apollo',
    });

    expect(store.refreshScopes).toHaveBeenCalledTimes(1);
    expect(store.selectedBoardId).toBe('scope-a');
    expect(store.persistSelectedBoardId).toHaveBeenCalledWith('scope-a');
    expect(store.navigateTo).toHaveBeenCalledWith('status');
  });

  it('opens or creates a DM with the configured primary agent', async () => {
    const store = createStore({
      channels: [{
        record_id: 'chan-agent',
        participant_npubs: ['npub-me', 'npub-agent'],
      }],
    });

    await store.runCommandPaletteAction({ action: 'primary-agent-chat' });

    expect(store.refreshChannels).toHaveBeenCalledTimes(1);
    expect(store.navigateTo).toHaveBeenCalledWith('chat', { syncRoute: false });
    expect(store.selectChannel).toHaveBeenCalledWith('chan-agent');
    expect(store.createBotDm).not.toHaveBeenCalled();
  });

  it('creates a quick doc in the resolved default scope', async () => {
    const store = createStore({
      selectedBoardScope: { record_id: 'scope-a', title: 'Apollo' },
      scopesMap: new Map([['scope-a', { record_id: 'scope-a', title: 'Apollo' }]]),
    });

    await store.runCommandPaletteAction({ action: 'quick-doc' });

    expect(store.selectedBoardId).toBe('scope-a');
    expect(store.refreshDirectories).toHaveBeenCalledTimes(1);
    expect(store.refreshDocuments).toHaveBeenCalledTimes(1);
    expect(store.createDocument).toHaveBeenCalledWith('Untitled document', { scopeId: 'scope-a' });
  });

  it('opens a New Work modal and creates a scoped task through the existing task path', async () => {
    const store = createStore({
      selectedBoardScope: { record_id: 'scope-a', title: 'Apollo' },
      scopesMap: new Map([['scope-a', { record_id: 'scope-a', title: 'Apollo' }]]),
    });

    await store.runCommandPaletteAction({ action: 'new-work' });
    store.commandPaletteNewWorkTitle = 'Draft launch checklist';
    store.commandPaletteNewWorkDescription = 'Use the notes from today.';
    await store.createCommandPaletteNewWork();

    expect(store.showCommandPaletteNewWorkModal).toBe(false);
    expect(store.selectedBoardId).toBe('scope-a');
    expect(store.newTaskTitle).toBe('Draft launch checklist');
    expect(store.addTask).toHaveBeenCalledWith({ description: 'Use the notes from today.' });
    expect(store.navigateTo).toHaveBeenCalledWith('tasks', { syncRoute: false });
    expect(store.openTaskDetail).toHaveBeenCalledWith('task-new');
    expect(store.syncRoute).toHaveBeenCalledTimes(1);
  });

  it('pastes images into the New Work description with the selected board groups', async () => {
    const pasteEvent = { type: 'paste' };
    const store = createStore({
      selectedBoardScope: { record_id: 'scope-a', title: 'Apollo' },
      scopesMap: new Map([['scope-a', { record_id: 'scope-a', title: 'Apollo', group_ids: ['group-scope'] }]]),
      buildTaskBoardAssignment: vi.fn(() => ({ scope_id: 'scope-a', group_ids: ['group-board'] })),
    });

    await store.runCommandPaletteAction({ action: 'new-work' });
    await store.handleCommandPaletteNewWorkDescriptionPaste(pasteEvent);

    expect(store.handleInlineImagePaste).toHaveBeenCalledWith(pasteEvent, {
      modelKey: 'commandPaletteNewWorkDescription',
      ownerNpub: 'npub-owner',
      accessGroupIds: ['group-board'],
      fileLabel: 'task',
    });
  });

  it('uses the configured default New Work board while keeping the modal board selectable', async () => {
    const store = createStore({
      selectedBoardScope: { record_id: 'scope-a', title: 'Apollo' },
      commandPaletteNewWorkDefaultScopeId: 'scope-b',
      scopesMap: new Map([
        ['scope-a', { record_id: 'scope-a', title: 'Apollo' }],
        ['scope-b', { record_id: 'scope-b', title: 'Pete Scratch' }],
      ]),
    });

    await store.runCommandPaletteAction({ action: 'new-work' });
    expect(store.commandPaletteNewWorkScopeId).toBe('scope-b');

    store.commandPaletteNewWorkScopeId = 'scope-a';
    store.commandPaletteNewWorkTitle = 'Override board';
    await store.createCommandPaletteNewWork();

    expect(store.selectedBoardId).toBe('scope-a');
  });

  it('routes all-scope task board shortcuts through the all board', async () => {
    const store = createStore();

    await store.runCommandPaletteAction({
      action: 'all-tasks',
      scopeId: ALL_TASK_BOARD_ID,
    });

    expect(store.selectedBoardId).toBe(ALL_TASK_BOARD_ID);
    expect(store.refreshScopes).not.toHaveBeenCalled();
    expect(store.navigateTo).toHaveBeenCalledWith('tasks');
  });

  it('opens scoped records after applying their scope context', async () => {
    const store = createStore();

    await store.runCommandPaletteAction({
      action: 'open-task',
      recordId: 'task-a',
      scopeId: 'scope-a',
    });

    expect(store.refreshScopes).toHaveBeenCalledTimes(1);
    expect(store.selectedBoardId).toBe('scope-a');
    expect(store.refreshTasks).toHaveBeenCalledTimes(1);
    expect(store.navigateTo).toHaveBeenCalledWith('tasks', { syncRoute: false });
    expect(store.openTaskDetail).toHaveBeenCalledWith('task-a');
    expect(store.syncRoute).toHaveBeenCalledTimes(1);
  });
});
