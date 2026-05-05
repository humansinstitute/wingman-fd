import {
  getAllApprovals,
  getChannelsByOwner,
  getDirectoriesByOwner,
  getDocumentsByOwner,
  getFlowsByOwner,
  getMessagesByChannel,
  getReportsByOwner,
  getScopesByOwner,
  getTasksByOwner,
} from './db.js';
import { ALL_TASK_BOARD_ID } from './task-board-state.js';

const COMMAND_GROUP_LABELS = Object.freeze({
  shortcut: 'Shortcuts',
  scope: 'Scopes',
  doc: 'Docs',
  task: 'Tasks',
  channel: 'Chat channels',
  thread: 'Chat threads',
  flow: 'Flows',
  approval: 'Approvals',
  command: 'Commands',
  report: 'Flight Deck',
});

const COMMAND_GROUP_ORDER = Object.freeze([
  'shortcut',
  'scope',
  'doc',
  'task',
  'channel',
  'thread',
  'flow',
  'approval',
  'command',
  'report',
]);

const MAX_GROUP_RESULTS = 8;
const QUICK_DOC_SCOPE_STORAGE_KEY = 'flightdeck:quick-doc-default-scope-id';
const NEW_WORK_SCOPE_STORAGE_KEY = 'flightdeck:new-work-default-scope-id';

function readStoredScopeId(key) {
  if (typeof window === 'undefined' || !window.localStorage) return '';
  return String(window.localStorage.getItem(key) || '').trim();
}

export function createCommandPaletteState() {
  return {
    showCommandPalette: false,
    commandPaletteQuery: '',
    commandPaletteActiveId: '',
    commandPaletteIndex: [],
    commandPaletteLoading: false,
    commandPaletteNotice: '',
    commandPaletteShortcutHandler: null,
    commandPaletteQuickDocScopeId: readStoredScopeId(QUICK_DOC_SCOPE_STORAGE_KEY),
    commandPaletteNewWorkDefaultScopeId: readStoredScopeId(NEW_WORK_SCOPE_STORAGE_KEY),
    showCommandPaletteNewWorkModal: false,
    commandPaletteNewWorkTitle: '',
    commandPaletteNewWorkScopeId: '',
  };
}

function scopeIdFromRecord(record = {}) {
  return record.scope_id
    ?? record.scope_l5_id
    ?? record.scope_l4_id
    ?? record.scope_l3_id
    ?? record.scope_l2_id
    ?? record.scope_l1_id
    ?? null;
}

function recordUpdatedTs(record = {}) {
  return Date.parse(record.updated_at || record.generated_at || '') || 0;
}

function compactText(parts = []) {
  return parts
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' ');
}

function matchesCommandPaletteQuery(item, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return true;
  const haystack = compactText([
    item.title,
    item.subtitle,
    item.groupLabel,
    item.kindLabel,
    item.searchText,
  ]).toLowerCase();
  return needle.split(/\s+/).every((part) => haystack.includes(part));
}

function sortByFreshness(left, right) {
  return (right.updatedTs || 0) - (left.updatedTs || 0)
    || String(left.title || '').localeCompare(String(right.title || ''));
}

function groupItems(items = []) {
  const byGroup = new Map();
  for (const item of items) {
    if (!byGroup.has(item.group)) byGroup.set(item.group, []);
    byGroup.get(item.group).push(item);
  }
  return COMMAND_GROUP_ORDER
    .filter((group) => byGroup.has(group))
    .map((group) => ({
      id: group,
      label: COMMAND_GROUP_LABELS[group] || group,
      items: byGroup.get(group).slice(0, MAX_GROUP_RESULTS),
    }))
    .filter((group) => group.items.length > 0);
}

function buildItem(input = {}) {
  const groupLabel = COMMAND_GROUP_LABELS[input.group] || input.group || '';
  return {
    groupLabel,
    kindLabel: groupLabel,
    updatedTs: 0,
    ...input,
  };
}

function isEditableShortcutTarget(target) {
  if (!target || typeof target.closest !== 'function') return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]'));
}

function isCommandPaletteOpenShortcut(event, key) {
  if (key !== 'k' || event.shiftKey) return false;
  const targetIsEditable = isEditableShortcutTarget(event.target);
  if (event.metaKey && !event.ctrlKey && !event.altKey) return true;
  if (!targetIsEditable && event.altKey && !event.metaKey && !event.ctrlKey) return true;
  if (!targetIsEditable && event.ctrlKey && !event.metaKey && !event.altKey) return true;
  return false;
}

export const commandPaletteMixin = {
  get commandPalettePrimaryAgentNpub() {
    return String(this.defaultAgentNpub || this.botNpub || '').trim();
  },

  get commandPalettePrimaryAgentLabel() {
    const npub = this.commandPalettePrimaryAgentNpub;
    if (!npub) return 'primary agent';
    return this.getSenderName?.(npub) || 'primary agent';
  },

  get commandPaletteCurrentScopeLabel() {
    if (this.selectedBoardScope) {
      return this.selectedBoardScope.title || this.selectedBoardLabel || 'Current scope';
    }
    return '';
  },

  get commandPaletteQuickLaunchItems() {
    const quickDocScopeId = this.resolveCommandPaletteQuickDocScopeId();
    const quickDocScope = quickDocScopeId ? this.scopesMap?.get(quickDocScopeId) : null;
    return [
      buildItem({
        id: 'quick:whats-on',
        group: 'shortcut',
        title: "What's on",
        subtitle: 'Open Flight Deck across the business',
        action: 'all-flightdeck',
        scopeId: ALL_TASK_BOARD_ID,
        shortcutKey: '1',
        icon: 'flightdeck',
        searchText: 'status dashboard flight deck whats on what is on',
      }),
      buildItem({
        id: 'quick:chat-primary-agent',
        group: 'shortcut',
        title: 'Chat',
        subtitle: `DM ${this.commandPalettePrimaryAgentLabel}`,
        action: 'primary-agent-chat',
        shortcutKey: '2',
        icon: 'bot',
        searchText: 'agent bot dm direct message chat',
      }),
      buildItem({
        id: 'quick:new-work',
        group: 'shortcut',
        title: 'New Work',
        subtitle: 'Create a task in the current scope',
        action: 'new-work',
        shortcutKey: '3',
        icon: 'plus',
        searchText: 'create add task work todo',
      }),
      buildItem({
        id: 'quick:quick-doc',
        group: 'shortcut',
        title: 'Quick Doc',
        subtitle: quickDocScope?.title ? `Create in ${quickDocScope.title}` : 'Create in the default doc scope',
        action: 'quick-doc',
        scopeId: quickDocScopeId,
        shortcutKey: '4',
        icon: 'doc',
        searchText: 'create add document doc note',
      }),
    ];
  },

  get commandPaletteDefaultItems() {
    return this.commandPaletteQuickLaunchItems;
  },

  get commandPaletteFlatResults() {
    const query = String(this.commandPaletteQuery || '').trim();
    const source = query
      ? [...this.commandPaletteDefaultItems, ...this.commandPaletteIndex]
      : this.commandPaletteDefaultItems;
    return source
      .filter((item) => matchesCommandPaletteQuery(item, query))
      .sort((left, right) => {
        const groupDelta = COMMAND_GROUP_ORDER.indexOf(left.group) - COMMAND_GROUP_ORDER.indexOf(right.group);
        if (groupDelta) return groupDelta;
        if (query) return sortByFreshness(left, right);
        return 0;
      });
  },

  get commandPaletteGroups() {
    return groupItems(this.commandPaletteFlatResults);
  },

  get commandPaletteActiveItem() {
    const results = this.commandPaletteFlatResults;
    if (results.length === 0) return null;
    return results.find((item) => item.id === this.commandPaletteActiveId) || results[0];
  },

  initCommandPaletteShortcuts() {
    if (typeof window === 'undefined' || this.commandPaletteShortcutHandler) return;
    this.commandPaletteShortcutHandler = (event) => {
      if (event.defaultPrevented) return;
      const key = String(event.key || '').toLowerCase();
      if (this.showCommandPalette
        && !this.commandPaletteQuery
        && !event.metaKey
        && !event.ctrlKey
        && !event.altKey
        && !event.shiftKey
        && /^[1-4]$/.test(key)) {
        const item = this.commandPaletteQuickLaunchItems[Number(key) - 1];
        if (!item) return;
        event.preventDefault();
        void this.executeCommandPaletteItem(item);
        return;
      }
      if (!isCommandPaletteOpenShortcut(event, key)) return;
      event.preventDefault();
      this.openCommandPalette();
    };
    window.addEventListener('keydown', this.commandPaletteShortcutHandler, true);
  },

  async openCommandPalette(options = {}) {
    if (!this.isLoggedIn) return;
    this.commandPaletteQuery = options.query ?? '';
    this.commandPaletteActiveId = '';
    this.commandPaletteNotice = '';
    this.showCommandPalette = true;
    this.focusCommandPaletteInput();
    await this.refreshCommandPaletteIndex();
    this.focusCommandPaletteInput();
  },

  focusCommandPaletteInput() {
    const focus = () => {
      if (typeof document === 'undefined') return;
      const input = document.querySelector('[data-command-palette-input]');
      input?.focus();
      input?.select?.();
    };
    this.$nextTick?.(focus);
    if (typeof window !== 'undefined') window.setTimeout(focus, 0);
  },

  closeCommandPalette() {
    this.showCommandPalette = false;
    this.commandPaletteQuery = '';
    this.commandPaletteActiveId = '';
    this.commandPaletteNotice = '';
  },

  moveCommandPaletteSelection(delta) {
    const results = this.commandPaletteFlatResults;
    if (results.length === 0) return;
    const activeId = this.commandPaletteActiveItem?.id;
    const currentIndex = Math.max(0, results.findIndex((item) => item.id === activeId));
    const nextIndex = (currentIndex + delta + results.length) % results.length;
    this.commandPaletteActiveId = results[nextIndex].id;
  },

  async selectCommandPaletteActiveItem() {
    await this.executeCommandPaletteItem(this.commandPaletteActiveItem);
  },

  async refreshCommandPaletteIndex() {
    const ownerNpub = this.workspaceOwnerNpub;
    if (!ownerNpub) {
      this.commandPaletteIndex = [];
      return;
    }
    this.commandPaletteLoading = true;
    try {
      const [
        channels,
        directories,
        documents,
        tasks,
        reports,
        scopes,
        flows,
        approvals,
      ] = await Promise.all([
        getChannelsByOwner(ownerNpub),
        getDirectoriesByOwner(ownerNpub),
        getDocumentsByOwner(ownerNpub),
        getTasksByOwner(ownerNpub),
        getReportsByOwner(ownerNpub),
        getScopesByOwner(ownerNpub),
        getFlowsByOwner(ownerNpub),
        getAllApprovals(),
      ]);
      const channelMessages = await Promise.all(
        channels.map((channel) => getMessagesByChannel(channel.record_id)),
      );
      this.commandPaletteIndex = this.buildCommandPaletteIndex({
        channels,
        directories,
        documents,
        tasks,
        reports,
        scopes,
        flows,
        approvals,
        messages: channelMessages.flat(),
      });
    } finally {
      this.commandPaletteLoading = false;
    }
  },

  buildCommandPaletteIndex(records = {}) {
    const items = [];
    const channelById = new Map((records.channels || []).map((channel) => [channel.record_id, channel]));

    for (const scope of records.scopes || []) {
      items.push(buildItem({
        id: `scope:${scope.record_id}`,
        group: 'scope',
        title: scope.title || 'Untitled scope',
        subtitle: compactText([this.getScopeBreadcrumb?.(scope.record_id), this.scopeLevelLabel?.(scope.level)]),
        action: 'select-scope',
        recordId: scope.record_id,
        scopeId: scope.record_id,
        updatedTs: recordUpdatedTs(scope),
        searchText: compactText([scope.description, scope.level]),
      }));
    }

    for (const directory of records.directories || []) {
      items.push(buildItem({
        id: `doc:directory:${directory.record_id}`,
        group: 'doc',
        title: directory.title || 'Untitled folder',
        subtitle: 'Folder',
        action: 'open-doc',
        recordId: directory.record_id,
        docType: 'directory',
        scopeId: scopeIdFromRecord(directory),
        updatedTs: recordUpdatedTs(directory),
      }));
    }

    for (const document of records.documents || []) {
      items.push(buildItem({
        id: `doc:document:${document.record_id}`,
        group: 'doc',
        title: document.title || 'Untitled document',
        subtitle: 'Document',
        action: 'open-doc',
        recordId: document.record_id,
        docType: 'document',
        scopeId: scopeIdFromRecord(document),
        updatedTs: recordUpdatedTs(document),
        searchText: document.content || '',
      }));
    }

    for (const task of records.tasks || []) {
      items.push(buildItem({
        id: `task:${task.record_id}`,
        group: 'task',
        title: task.title || 'Untitled task',
        subtitle: task.scope_id ? this.getTaskBoardLabel?.(task) : 'Task',
        action: 'open-task',
        recordId: task.record_id,
        scopeId: scopeIdFromRecord(task),
        updatedTs: recordUpdatedTs(task),
        searchText: compactText([task.description, task.state, task.tags]),
      }));
    }

    for (const channel of records.channels || []) {
      items.push(buildItem({
        id: `channel:${channel.record_id}`,
        group: 'channel',
        title: this.getChannelLabel?.(channel) || channel.title || 'Chat channel',
        subtitle: channel.scope_id ? this.getScopeBreadcrumb?.(channel.scope_id) : 'Chat channel',
        action: 'open-channel',
        channelId: channel.record_id,
        scopeId: scopeIdFromRecord(channel),
        updatedTs: recordUpdatedTs(channel),
        searchText: compactText([channel.description, channel.label]),
      }));
    }

    const repliesByParentId = new Map();
    for (const message of records.messages || []) {
      if (!message.parent_message_id) continue;
      repliesByParentId.set(message.parent_message_id, (repliesByParentId.get(message.parent_message_id) || 0) + 1);
    }
    for (const message of records.messages || []) {
      if (message.parent_message_id || !repliesByParentId.has(message.record_id)) continue;
      const channel = channelById.get(message.channel_id);
      items.push(buildItem({
        id: `thread:${message.record_id}`,
        group: 'thread',
        title: message.body || 'Untitled thread',
        subtitle: channel ? this.getChannelLabel?.(channel) || channel.title || 'Chat thread' : 'Chat thread',
        action: 'open-thread',
        recordId: message.record_id,
        channelId: message.channel_id,
        threadId: message.record_id,
        scopeId: scopeIdFromRecord(channel),
        updatedTs: recordUpdatedTs(message),
        searchText: `${repliesByParentId.get(message.record_id)} replies`,
      }));
    }

    for (const flow of records.flows || []) {
      items.push(buildItem({
        id: `flow:${flow.record_id}`,
        group: 'flow',
        title: flow.title || 'Untitled flow',
        subtitle: flow.scope_id ? this.getTaskBoardLabel?.(flow) : 'Flow',
        action: 'open-flow',
        recordId: flow.record_id,
        scopeId: scopeIdFromRecord(flow),
        updatedTs: recordUpdatedTs(flow),
        searchText: compactText([flow.description, flow.trigger_type]),
      }));
    }

    for (const approval of records.approvals || []) {
      items.push(buildItem({
        id: `approval:${approval.record_id}`,
        group: 'approval',
        title: approval.title || 'Untitled approval',
        subtitle: compactText([approval.status || 'approval', approval.approval_mode]),
        action: 'open-approval',
        recordId: approval.record_id,
        scopeId: scopeIdFromRecord(approval),
        updatedTs: recordUpdatedTs(approval),
        searchText: compactText([approval.brief, approval.agent_review_note]),
      }));
    }

    for (const report of records.reports || []) {
      items.push(buildItem({
        id: `report:${report.record_id}`,
        group: 'report',
        title: report.title || this.getReportMetricLabel?.(report) || 'Untitled report',
        subtitle: this.getFlightDeckReportTypeLabel?.(report) || 'Flight Deck report',
        action: 'open-report',
        recordId: report.record_id,
        scopeId: scopeIdFromRecord(report),
        updatedTs: recordUpdatedTs(report),
        searchText: compactText([report.declaration_type, report.surface]),
      }));
    }

    return items.sort(sortByFreshness);
  },

  async executeCommandPaletteItem(item) {
    if (!item) return;
    this.closeCommandPalette();
    await this.runCommandPaletteAction(item);
  },

  async runCommandPaletteAction(item) {
    if (item.scopeId && item.scopeId !== ALL_TASK_BOARD_ID) {
      await this.refreshScopes?.();
    }
    if (item.scopeId) this.applyCommandPaletteScope(item.scopeId);
    switch (item.action) {
      case 'all-flightdeck':
      case 'current-flightdeck':
        this.navigateTo('status');
        return;
      case 'all-tasks':
      case 'current-tasks':
        this.navigateTo('tasks');
        return;
      case 'current-docs':
        await this.refreshDirectories();
        await this.refreshDocuments();
        this.navigateTo('docs');
        return;
      case 'current-chat':
        await this.refreshChannels();
        this.navigateTo('chat');
        return;
      case 'new-task':
        if (typeof this.openNewTaskModal === 'function') {
          this.openNewTaskModal({ scopeId: item.scopeId || this.selectedBoardId || null });
          return;
        }
        await this.refreshTasks();
        this.navigateTo('tasks');
        this.$nextTick?.(() => document.querySelector('[data-new-task-input]')?.focus());
        return;
      case 'new-work':
        this.openCommandPaletteNewWorkModal();
        return;
      case 'primary-agent-chat':
        await this.openCommandPalettePrimaryAgentChat();
        return;
      case 'quick-doc':
        await this.createCommandPaletteQuickDoc();
        return;
      case 'new-chat':
        await this.refreshChannels();
        this.navigateTo('chat');
        this.openNewChannelModal?.();
        return;
      case 'select-scope':
        this.applyCommandPaletteScope(item.recordId);
        this.commandPaletteNotice = `${item.title} is now the active scope.`;
        this.navigateTo('status');
        return;
      case 'open-doc':
        await this.refreshDirectories();
        await this.refreshDocuments();
        if (item.docType === 'directory') this.navigateToFolder(item.recordId);
        else this.openDoc(item.recordId);
        return;
      case 'open-task':
        await this.refreshTasks();
        this.navigateTo('tasks', { syncRoute: false });
        this.openTaskDetail(item.recordId);
        this.syncRoute();
        return;
      case 'open-channel':
        await this.refreshChannels();
        this.navigateTo('chat', { syncRoute: false });
        if (item.channelId) await this.selectChannel(item.channelId);
        return;
      case 'open-thread':
        await this.refreshChannels();
        this.navigateTo('chat', { syncRoute: false });
        if (item.channelId) await this.selectChannel(item.channelId, { syncRoute: false });
        if (item.threadId) this.openThread(item.threadId, { scrollToLatest: false });
        this.syncRoute();
        return;
      case 'open-flow':
        this.navigateTo('settings', { syncRoute: false });
        this.settingsTab = 'flows';
        await this.refreshFlows();
        await this.refreshApprovals();
        this.openFlowEditor(item.recordId);
        this.syncRoute();
        return;
      case 'open-approval':
        this.navigateTo('status', { syncRoute: false });
        await this.refreshApprovals();
        this.activeApprovalId = item.recordId;
        this.showApprovalDetail = true;
        this.syncRoute();
        return;
      case 'open-report':
        await this.refreshReports();
        this.navigateTo('status', { syncRoute: false });
        this.openReportModalById?.(item.recordId);
        this.syncRoute();
        return;
      default:
    }
  },

  applyCommandPaletteScope(scopeId) {
    const nextScopeId = scopeId || null;
    this.selectedBoardId = nextScopeId;
    this.persistSelectedBoardId?.(nextScopeId);
    this.validateSelectedBoardId?.();
    this.normalizeTaskFilterTags?.();
  },

  resolveCommandPaletteQuickDocScopeId() {
    const configured = String(this.commandPaletteQuickDocScopeId || readStoredScopeId(QUICK_DOC_SCOPE_STORAGE_KEY)).trim();
    if (configured && this.scopesMap?.has(configured)) return configured;
    if (this.selectedBoardScope?.record_id) return this.selectedBoardScope.record_id;
    if (this.selectedBoardId && this.scopesMap?.has(this.selectedBoardId)) return this.selectedBoardId;
    const firstScope = (this.scopes || []).find((scope) => scope?.record_id && scope.record_state !== 'deleted');
    return firstScope?.record_id || null;
  },

  persistCommandPaletteQuickDocScopeId(scopeId = '') {
    const nextScopeId = String(scopeId || '').trim();
    this.commandPaletteQuickDocScopeId = nextScopeId;
    if (typeof window === 'undefined' || !window.localStorage) return;
    if (nextScopeId) window.localStorage.setItem(QUICK_DOC_SCOPE_STORAGE_KEY, nextScopeId);
    else window.localStorage.removeItem(QUICK_DOC_SCOPE_STORAGE_KEY);
  },

  resolveCommandPaletteNewWorkScopeId() {
    const configured = String(this.commandPaletteNewWorkDefaultScopeId || readStoredScopeId(NEW_WORK_SCOPE_STORAGE_KEY)).trim();
    if (configured && this.scopesMap?.has(configured)) return configured;
    if (this.selectedBoardScope?.record_id) return this.selectedBoardScope.record_id;
    if (this.selectedBoardId && this.scopesMap?.has(this.selectedBoardId)) return this.selectedBoardId;
    const firstScope = (this.scopes || []).find((scope) => scope?.record_id && scope.record_state !== 'deleted');
    return firstScope?.record_id || '';
  },

  persistCommandPaletteNewWorkDefaultScopeId(scopeId = '') {
    const nextScopeId = String(scopeId || '').trim();
    this.commandPaletteNewWorkDefaultScopeId = nextScopeId;
    if (typeof window === 'undefined' || !window.localStorage) return;
    if (nextScopeId) window.localStorage.setItem(NEW_WORK_SCOPE_STORAGE_KEY, nextScopeId);
    else window.localStorage.removeItem(NEW_WORK_SCOPE_STORAGE_KEY);
  },

  focusCommandPaletteNewWorkInput() {
    const focus = () => {
      if (typeof document === 'undefined') return;
      const input = document.querySelector('[data-command-palette-new-work-input]');
      input?.focus();
      input?.select?.();
    };
    this.$nextTick?.(focus);
    if (typeof window !== 'undefined') window.setTimeout(focus, 0);
  },

  openCommandPaletteNewWorkModal() {
    this.commandPaletteNewWorkTitle = '';
    this.commandPaletteNewWorkScopeId = this.resolveCommandPaletteNewWorkScopeId();
    this.showCommandPaletteNewWorkModal = true;
    this.focusCommandPaletteNewWorkInput();
  },

  closeCommandPaletteNewWorkModal() {
    this.showCommandPaletteNewWorkModal = false;
    this.commandPaletteNewWorkTitle = '';
    this.commandPaletteNewWorkScopeId = '';
  },

  async createCommandPaletteNewWork() {
    const title = String(this.commandPaletteNewWorkTitle || '').trim();
    if (!title) return;
    if (this.commandPaletteNewWorkScopeId) this.applyCommandPaletteScope(this.commandPaletteNewWorkScopeId);
    this.newTaskTitle = title;
    const createdTask = await this.addTask?.();
    if (!createdTask?.record_id) return;
    this.closeCommandPaletteNewWorkModal();
    this.navigateTo?.('tasks', { syncRoute: false });
    this.openTaskDetail?.(createdTask.record_id);
    this.syncRoute?.();
  },

  findPrimaryAgentChannel(agentNpub) {
    const target = String(agentNpub || '').trim();
    const viewer = String(this.session?.npub || '').trim();
    if (!target || !viewer) return null;
    return (this.channels || []).find((channel) => {
      if (channel?.record_state === 'deleted') return false;
      const participants = Array.isArray(channel?.participant_npubs) ? channel.participant_npubs : [];
      return participants.includes(target) && participants.includes(viewer);
    }) || null;
  },

  async openCommandPalettePrimaryAgentChat() {
    await this.refreshChannels?.();
    this.navigateTo('chat', { syncRoute: false });
    const targetNpub = this.commandPalettePrimaryAgentNpub;
    if (!targetNpub) {
      this.openNewChannelModal?.();
      this.syncRoute?.();
      return;
    }
    const existing = this.findPrimaryAgentChannel(targetNpub);
    if (existing?.record_id) {
      await this.selectChannel(existing.record_id);
      return;
    }
    await this.createBotDm?.(targetNpub);
  },

  async createCommandPaletteQuickDoc() {
    const scopeId = this.resolveCommandPaletteQuickDocScopeId();
    if (!scopeId) {
      this.navigateTo('docs');
      this.error = 'Select a scope before creating a document.';
      return;
    }
    this.applyCommandPaletteScope(scopeId);
    await this.refreshDirectories?.();
    await this.refreshDocuments?.();
    await this.createDocument?.('Untitled document', { scopeId });
  },
};
