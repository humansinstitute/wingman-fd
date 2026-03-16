/**
 * Alpine.js app store — the single source of reactive UI state.
 * All data comes from Dexie; network goes through the sync worker.
 */

import Alpine from 'alpinejs';

/** Strip Alpine proxy wrappers so objects survive IndexedDB structured clone. */
function toRaw(obj) {
  if (obj == null || typeof obj !== 'object') return obj;
  return JSON.parse(JSON.stringify(obj));
}
import {
  getSettings,
  saveSettings,
  getWorkspaceSettings,
  upsertWorkspaceSettings,
  getCachedStorageImage,
  cacheStorageImage,
  getChannelsByOwner,
  getMessagesByChannel,
  getMessageById,
  getRecentChatMessagesSince,
  getRecentDocumentChangesSince,
  getRecentDirectoryChangesSince,
  getRecentTaskChangesSince,
  getRecentCommentsSince,
  upsertChannel,
  upsertMessage,
  getAudioNotesByOwner,
  getAudioNoteById,
  getDocumentsByOwner,
  upsertDocument,
  getDocumentById,
  getDirectoriesByOwner,
  upsertDirectory,
  getDirectoryById,
  getTasksByOwner,
  upsertTask,
  getTaskById,
  getCommentsByTarget,
  upsertComment,
  upsertAudioNote,
  getScopesByOwner,
  upsertScope,
  getScopeById,
  deleteGroupById,
  addPendingWrite,
  getPendingWrites,
  upsertGroup,
  getChannelById,
  getAddressBookPeople,
  upsertAddressBookPerson,
  clearRuntimeData,
  clearSyncState,
} from './db.js';
import {
  setBaseUrl,
  createGroup,
  addGroupMember,
  deleteGroupMember,
  updateGroup,
  getGroups,
  getGroupKeys,
  deleteGroup,
  createWorkspace,
  getWorkspaces,
  prepareStorageObject,
  uploadStorageObject,
  completeStorageObject,
  downloadStorageObject,
  downloadStorageObjectBlob,
} from './api.js';
import {
  outboundChatMessage,
  outboundChannel,
  recordFamilyHash,
} from './translators/chat.js';
import {
  outboundDocument,
  outboundDirectory,
} from './translators/docs.js';
import {
  outboundTask,
  computeParentState,
  stateColor,
  formatStateLabel,
  parseTags as parseTaskTags,
} from './translators/tasks.js';
import { outboundComment } from './translators/comments.js';
import { outboundAudioNote } from './translators/audio-notes.js';
import { recordFamilyHash as taskFamilyHash } from './translators/tasks.js';
import {
  outboundScope,
  resolveScopeChain,
  searchScopes,
  scopeBreadcrumb,
  levelLabel,
  SCOPE_LEVELS,
} from './translators/scopes.js';
import { outboundWorkspaceSettings, normalizeHarnessUrl } from './translators/settings.js';
import { runSync } from './worker/sync-worker.js';
import { parseSuperBasedToken } from './superbased-token.js';
import { buildAgentConnectPackage } from './agent-connect.js';
import {
  signLoginEvent,
  getPubkeyFromEvent,
  pubkeyToNpub,
  personalEncryptForNpub,
  tryAutoLoginFromStorage,
  clearAutoLogin,
  setAutoLogin,
  hasExtensionSigner,
  waitForExtensionSigner,
} from './auth/nostr.js';
import {
  bootstrapWrappedGroupKeys,
  buildWrappedMemberKeys,
  clearCryptoContext,
  createGroupIdentity,
  setActiveSessionNpub,
  wrapKnownGroupKeyForMember,
} from './crypto/group-keys.js';
import { fetchProfileByNpub } from './profiles.js';
import { DEFAULT_SUPERBASED_URL } from './app-identity.js';
import { mergeWorkspaceEntries, normalizeWorkspaceEntry, workspaceFromToken } from './workspaces.js';
import { buildSuperBasedConnectionToken } from './superbased-token.js';
import { decryptAudioBytes, encryptAudioBlob, measureAudioDuration } from './audio-notes.js';

const TASK_BOARD_STORAGE_KEY = 'coworker:last-task-board-id';

function guessDefaultBackendUrl() {
  return DEFAULT_SUPERBASED_URL || (typeof window === 'undefined' ? '' : window.location.origin);
}

function normalizeBackendUrl(url) {
  if (!url) return '';

  try {
    const parsed = new URL(url);
    const normalized = parsed.toString().replace(/\/+$/, '');

    if (typeof window === 'undefined') return normalized;

    const current = new URL(window.location.origin);

    if (
      parsed.hostname === current.hostname
      && parsed.pathname === '/'
      && parsed.port === '3100'
    ) {
      return current.origin;
    }

    return normalized;
  } catch {
    return String(url).trim().replace(/\/+$/, '');
  }
}

function workspaceSettingsRecordId(workspaceOwnerNpub) {
  return `workspace-settings:${workspaceOwnerNpub}`;
}

function parseMarkdownBlocks(content) {
  const source = String(content || '').replace(/\r\n?/g, '\n');
  if (!source.trim()) return [];
  const lines = source.split('\n');
  const blocks = [];
  let currentLines = [];
  let startLine = 1;

  const flush = () => {
    if (currentLines.length === 0) return;
    const raw = currentLines.join('\n').trimEnd();
    if (!raw) {
      currentLines = [];
      return;
    }
    blocks.push({
      id: `block-${blocks.length}-${startLine}`,
      raw,
      start_line: startLine,
      end_line: startLine + currentLines.length - 1,
    });
    currentLines = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (!line.trim()) {
      flush();
      startLine = index + 2;
      continue;
    }
    if (currentLines.length === 0) startLine = index + 1;
    currentLines.push(line);
  }

  flush();
  return blocks;
}

function assembleMarkdownBlocks(blocks = []) {
  return (blocks || [])
    .map((block) => String(block?.raw || '').trimEnd())
    .filter((raw) => raw.length > 0)
    .join('\n\n');
}

function parseRouteLocation() {
  if (typeof window === 'undefined') {
    return { section: 'chat', params: {} };
  }

  const url = new URL(window.location.href);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  let section = 'chat';
  if (path === '/notifications' || path === '/status') section = 'status';
  else if (path === '/tasks') section = 'tasks';
  else if (path === '/chat') section = 'chat';
  else if (path === '/docs') section = 'docs';
  else if (path === '/people') section = 'people';
  else if (path === '/scopes') section = 'scopes';
  else if (path === '/settings') section = 'settings';

  return {
    section,
    params: {
      channelid: url.searchParams.get('channelid') || null,
      threadid: url.searchParams.get('threadid') || null,
      folderid: url.searchParams.get('folderid') || null,
      docid: url.searchParams.get('docid') || null,
      commentid: url.searchParams.get('commentid') || null,
      groupid: url.searchParams.get('groups') || url.searchParams.get('groupid') || null,
      taskid: url.searchParams.get('taskid') || null,
    },
  };
}

export function initApp() {
  Alpine.store('chat', {
    FAST_SYNC_MS: 1000,
    IDLE_SYNC_MS: 5000,

    // settings
    backendUrl: '',
    ownerNpub: '',
    botNpub: '',
    session: null,
    navSection: 'chat',
    navCollapsed: false,
    mobileNavOpen: false,
    routeSyncPaused: false,
    popstateHandler: null,
    showAvatarMenu: false,
    showChannelSettingsModal: false,
    showSuperBasedModal: false,
    showAgentConnectModal: false,
    syncStatus: 'synced',
    hasForcedInitialBackfill: false,
    backgroundSyncTimer: null,
    backgroundSyncInFlight: false,
    visibilityHandler: null,
    docConnectorFrame: null,
    docConnectorScrollHandler: null,
    docConnectorResizeHandler: null,

    // data
    channels: [],
    selectedChannelId: null,
    messages: [],
    audioNotes: [],
    groups: [],
    documents: [],
    directories: [],
    addressBookPeople: [],
    activeThreadId: null,
    threadInput: '',
    threadAudioDrafts: [],
    threadImageUploadCount: 0,
    threadSize: 'default',
    focusMessageId: null,
    chatProfiles: {},
    statusTimeRange: '1h',
    statusRecentChanges: [],
    selectedDocType: null,
    selectedDocId: null,
    selectedDocCommentId: null,
    activeTaskId: null,
    tasks: [],
    taskComments: [],
    taskCommentAudioDrafts: [],
    taskFilter: '',
    taskFilterTags: [],
    selectedBoardId: null,
    showBoardPicker: false,
    boardPickerQuery: '',
    newTaskTitle: '',
    newSubtaskTitle: '',
    newTaskCommentBody: '',
    copiedTaskLinkId: null,
    editingTask: null,
    showTaskDetail: false,
    _dragTaskId: null,
    _taskWasDragged: false,
    _dragDocBrowserItem: null,
    _docBrowserWasDragged: false,
    docBrowserDropTarget: '',

    // scopes
    scopes: [],
    scopePickerQuery: '',
    showScopePicker: false,
    scopePickerTarget: null, // 'task' or record family being scoped
    newScopeTitle: '',
    newScopeDescription: '',
    newScopeLevel: 'product',
    newScopeParentId: null,
    showNewScopeForm: false,
    editingScopeId: null,
    editingScopeTitle: '',
    editingScopeDescription: '',
    currentFolderId: null,
    docFilter: '',
    docEditorTitle: '',
    docEditorContent: '',
    docEditorShares: [],
    docShareQuery: '',
    docEditorMode: 'preview',
    docEditorSharesDirty: false,
    docShareTargetType: '',
    docShareTargetId: '',
    docEditorBlocks: [],
    docEditingBlockIndex: -1,
    docBlockBuffer: '',
    docEditingTitle: false,
    docComments: [],
    docCommentsVisible: true,
    showDocCommentModal: false,
    docCommentAnchorLine: null,
    docCommentAnchorBlockId: null,
    docCommentConnector: { visible: false, path: '' },
    newDocCommentBody: '',
    docCommentAudioDrafts: [],
    newDocCommentReplyBody: '',
    docCommentReplyAudioDrafts: [],
    docAutosaveTimer: null,
    docAutosaveState: 'saved',
    showDocShareModal: false,
    newDocModalType: null,
    newDocModalTitle: '',
    newDocModalSubmitting: false,
    showNewGroupModal: false,
    newGroupName: '',
    newGroupMemberQuery: '',
    newGroupMembers: [],
    showEditGroupModal: false,
    editGroupId: '',
    editGroupName: '',
    editGroupMemberQuery: '',
    editGroupMembers: [],
    groupCreatePending: false,
    groupEditPending: false,
    groupDeletePendingId: null,
    showNewChannelModal: false,
    newChannelMode: 'dm',
    newChannelDmNpub: '',
    newChannelName: '',
    newChannelDescription: '',
    newChannelGroupId: '',
    superbasedTokenInput: '',
    superbasedError: null,
    knownWorkspaces: [],
    currentWorkspaceOwnerNpub: '',
    workspaceSettingsRecordId: '',
    workspaceSettingsVersion: 0,
    workspaceSettingsGroupIds: [],
    workspaceHarnessUrl: '',
    wingmanHarnessInput: '',
    wingmanHarnessError: null,
    wingmanHarnessDirty: false,
    showWorkspaceBootstrapModal: false,
    newWorkspaceName: '',
    newWorkspaceDescription: '',
    workspaceBootstrapSubmitting: false,
    agentConnectJson: '',
    agentConfigCopied: false,
    useCvmSync: localStorage.getItem('use_cvm_sync') === 'true',
    extensionSignerAvailable: false,
    extensionSignerPollTimer: null,

    // ui
    messageInput: '',
    messageAudioDrafts: [],
    messageImageUploadCount: 0,
    syncing: false,
    isLoggingIn: false,
    error: null,
    showAudioRecorderModal: false,
    audioRecorderContext: null,
    audioRecorderState: 'idle',
    audioRecorderError: null,
    audioRecorderDurationSeconds: 0,
    audioRecorderPreviewUrl: '',
    audioRecorderTitle: 'Voice note',
    audioRecorderStatusLabel: '',
    loginError: null,
    storageImageUrlCache: {},
    storageImageLoadPromises: {},
    _storageImageHydrateScheduled: false,

    get isLoggedIn() {
      return Boolean(this.session?.npub);
    },

    get displayName() {
      const ownProfile = this.chatProfiles[this.session?.npub];
      return ownProfile?.name || this.session?.npub || 'Anonymous';
    },

    get avatarUrl() {
      const ownProfile = this.chatProfiles[this.session?.npub];
      return ownProfile?.picture || null;
    },

    get avatarFallback() {
      const source = this.displayName || this.session?.npub || 'cw';
      return this.getInitials(source);
    },

    get superbasedConnectionConfig() {
      if (!this.superbasedTokenInput) return null;
      const parsed = parseSuperBasedToken(this.superbasedTokenInput);
      return parsed.isValid ? parsed : null;
    },

    get workspaceOwnerNpub() {
      return this.currentWorkspaceOwnerNpub
        || this.superbasedConnectionConfig?.workspaceOwnerNpub
        || this.ownerNpub
        || this.session?.npub
        || '';
    },

    get currentWorkspace() {
      return this.knownWorkspaces.find((workspace) => workspace.workspaceOwnerNpub === this.workspaceOwnerNpub) || null;
    },

    get currentWorkspaceGroups() {
      return this.groups.filter((group) => group.owner_npub === this.workspaceOwnerNpub);
    },

    get memberPrivateGroup() {
      const memberNpub = this.session?.npub;
      if (!memberNpub) return null;
      return this.currentWorkspaceGroups.find((group) =>
        group.group_kind === 'private' && group.private_member_npub === memberNpub
      ) || null;
    },

    get memberPrivateGroupNpub() {
      return this.memberPrivateGroup?.group_npub || this.currentWorkspace?.privateGroupNpub || null;
    },

    get superbasedTransportLabel() {
      if (this.useCvmSync && this.superbasedConnectionConfig?.relayUrl) return 'CVM relay';
      return this.backendUrl || 'Not configured';
    },

    get hasHarnessLink() {
      return Boolean(this.workspaceHarnessUrl);
    },

    get mainFeedMessages() {
      return this.messages.filter(msg => !msg.parent_message_id);
    },

    get threadMessages() {
      if (!this.activeThreadId) return [];
      return this.messages.filter(msg => msg.parent_message_id === this.activeThreadId);
    },

    get selectedDocument() {
      if (this.selectedDocType !== 'document' || !this.selectedDocId) return null;
      return this.documents.find((item) => item.record_id === this.selectedDocId) ?? null;
    },

    get docsEditorOpen() {
      return this.selectedDocType === 'document' && Boolean(this.selectedDocument);
    },

    get selectedDocComment() {
      if (!this.selectedDocCommentId) return null;
      return this.docComments.find((comment) => comment.record_id === this.selectedDocCommentId) ?? null;
    },

    get selectedDocCommentReplies() {
      const rootId = this.selectedDocComment?.record_id;
      if (!rootId) return [];
      return this.docComments
        .filter((comment) => comment.parent_comment_id === rootId && comment.record_state !== 'deleted')
        .sort((a, b) => String(a.updated_at || '').localeCompare(String(b.updated_at || '')));
    },

    get hasDocCommentConnector() {
      return Boolean(this.docCommentConnector?.visible && this.docCommentsVisible && this.selectedDocComment);
    },

    get selectedDirectory() {
      if (this.selectedDocType !== 'directory' || !this.selectedDocId) return null;
      return this.directories.find((item) => item.record_id === this.selectedDocId) ?? null;
    },

    get currentFolder() {
      if (!this.currentFolderId) return null;
      return this.directories.find((item) => item.record_id === this.currentFolderId) ?? null;
    },

    get currentFolderParentId() {
      return this.currentFolder?.parent_directory_id ?? null;
    },

    get currentFolderParentLabel() {
      if (!this.currentFolder) return '';
      const parent = this.directories.find((item) => item.record_id === this.currentFolderParentId);
      return parent?.title || 'Docs';
    },

    get selectedDocItem() {
      return this.selectedDocument ?? this.selectedDirectory ?? null;
    },

    get activeDocShareTarget() {
      if (this.docShareTargetType === 'document') return this.selectedDocument;
      if (this.docShareTargetType === 'directory') {
        return this.directories.find((item) => item.record_id === this.docShareTargetId) ?? null;
      }
      return this.selectedDocument ?? this.currentFolder ?? null;
    },

    get activeDocShareTargetTypeLabel() {
      return this.docShareTargetType === 'directory' ? 'Folder' : 'Document';
    },

    get activeDocShareTargetName() {
      const target = this.activeDocShareTarget;
      if (!target) return '';
      return target.title || (this.docShareTargetType === 'directory' ? 'Untitled folder' : 'Untitled document');
    },

    get isDirectoryShareTarget() {
      return this.docShareTargetType === 'directory';
    },

    get currentFolderBreadcrumbs() {
      const breadcrumbs = [];
      let folderId = this.currentFolderId;
      while (folderId) {
        const folder = this.directories.find((item) => item.record_id === folderId && item.record_state !== 'deleted');
        if (!folder) break;
        breadcrumbs.unshift(folder);
        folderId = folder.parent_directory_id || null;
      }
      return breadcrumbs;
    },

    get currentFolderContents() {
      const folderId = this.currentFolderId ?? null;
      const directories = this.directories
        .filter((item) => item.record_state !== 'deleted' && (item.parent_directory_id ?? null) === folderId)
        .map((item) => ({ type: 'directory', item }))
        .sort((a, b) => String(a.item.title || '').localeCompare(String(b.item.title || '')));
      const documents = this.documents
        .filter((item) => item.record_state !== 'deleted' && (item.parent_directory_id ?? null) === folderId)
        .map((item) => ({ type: 'document', item }))
        .sort((a, b) => String(a.item.title || '').localeCompare(String(b.item.title || '')));
      return [...directories, ...documents];
    },

    get filteredDocBrowserItems() {
      const query = String(this.docFilter || '').trim().toLowerCase();
      if (!query) return this.currentFolderContents;

      const activeDirectories = this.directories.filter((item) => item.record_state !== 'deleted');
      const activeDocuments = this.documents.filter((item) => item.record_state !== 'deleted');
      const childDirsByParent = new Map();
      const childDocsByParent = new Map();

      for (const directory of activeDirectories) {
        const key = directory.parent_directory_id ?? '__root__';
        const list = childDirsByParent.get(key) ?? [];
        list.push(directory);
        childDirsByParent.set(key, list);
      }
      for (const document of activeDocuments) {
        const key = document.parent_directory_id ?? '__root__';
        const list = childDocsByParent.get(key) ?? [];
        list.push(document);
        childDocsByParent.set(key, list);
      }

      const matchesDirectory = (directory) =>
        String(directory.title || '').toLowerCase().includes(query);
      const matchesDocument = (document) =>
        String(document.title || '').toLowerCase().includes(query)
        || String(document.content || '').toLowerCase().includes(query);

      const directoryHasMatch = (directoryId) => {
        const childDirs = childDirsByParent.get(directoryId) ?? [];
        const childDocs = childDocsByParent.get(directoryId) ?? [];
        return childDirs.some((dir) => matchesDirectory(dir) || directoryHasMatch(dir.record_id))
          || childDocs.some((doc) => matchesDocument(doc));
      };

      const rows = [];
      const walk = (parentId = null) => {
        const dirKey = parentId ?? '__root__';
        const directories = (childDirsByParent.get(dirKey) ?? [])
          .slice()
          .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
        const documents = (childDocsByParent.get(dirKey) ?? [])
          .slice()
          .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));

        for (const directory of directories) {
          if (!matchesDirectory(directory) && !directoryHasMatch(directory.record_id)) continue;
          rows.push({ type: 'directory', item: directory });
          walk(directory.record_id);
        }
        for (const document of documents) {
          if (!matchesDocument(document)) continue;
          rows.push({ type: 'document', item: document });
        }
      };

      walk(this.currentFolderId ?? null);
      return rows;
    },

    // --- task board computed ---

    isParentTask(taskId) {
      return this.tasks.some(t => t.parent_task_id === taskId && t.record_state !== 'deleted');
    },

    getSubtasks(parentId) {
      return this.tasks.filter(t => t.parent_task_id === parentId && t.record_state !== 'deleted');
    },

    computedParentState(parentId) {
      return computeParentState(this.getSubtasks(parentId));
    },

    stateColor(state) {
      return stateColor(state);
    },

    formatState(state) {
      return formatStateLabel(state);
    },

    get taskBoards() {
      const boards = [];
      if (this.memberPrivateGroupNpub) {
        boards.push({ id: this.memberPrivateGroupNpub, label: 'Private' });
      }
      for (const group of this.currentWorkspaceGroups) {
        if ((group.group_npub || group.group_id) === this.memberPrivateGroupNpub) continue;
        boards.push({
          id: group.group_npub || group.group_id,
          label: group.name || group.group_npub || group.group_id,
        });
      }
      return boards;
    },

    get selectedBoardLabel() {
      if (!this.selectedBoardId) return 'Board';
      const board = this.taskBoards.find(b => b.id === this.selectedBoardId);
      return board ? board.label : 'Board';
    },

    get filteredTaskBoards() {
      const query = String(this.boardPickerQuery || '').trim().toLowerCase();
      if (!query) return this.taskBoards;
      return this.taskBoards.filter((board) => String(board.label || '').toLowerCase().includes(query));
    },

    toggleBoardPicker() {
      this.showBoardPicker = !this.showBoardPicker;
      if (!this.showBoardPicker) this.boardPickerQuery = '';
    },

    closeBoardPicker() {
      this.showBoardPicker = false;
      this.boardPickerQuery = '';
    },

    selectBoard(boardId) {
      this.selectedBoardId = boardId;
      this.persistSelectedBoardId(boardId);
      this.normalizeTaskFilterTags();
      this.closeBoardPicker();
      if (this.showTaskDetail) this.closeTaskDetail();
      else this.syncRoute();
    },

    readStoredTaskBoardId() {
      if (typeof window === 'undefined') return null;
      return window.localStorage.getItem(TASK_BOARD_STORAGE_KEY) || null;
    },

    persistSelectedBoardId(boardId) {
      if (typeof window === 'undefined') return;
      if (boardId) window.localStorage.setItem(TASK_BOARD_STORAGE_KEY, boardId);
      else window.localStorage.removeItem(TASK_BOARD_STORAGE_KEY);
    },

    validateSelectedBoardId() {
      if (!this.selectedBoardId && this.memberPrivateGroupNpub) {
        this.selectedBoardId = this.memberPrivateGroupNpub;
        this.persistSelectedBoardId(this.selectedBoardId);
        return;
      }
      if (!this.selectedBoardId) return;
      const exists = this.taskBoards.some((board) => board.id === this.selectedBoardId);
      if (!exists) {
        this.selectedBoardId = this.memberPrivateGroupNpub || null;
        this.persistSelectedBoardId(this.selectedBoardId);
      }
    },

    normalizeTaskFilterTags() {
      const availableTags = new Set(this.allTaskTags);
      this.taskFilterTags = this.taskFilterTags.filter((tag) => availableTags.has(tag));
    },

    get boardScopedTasks() {
      const tasks = this.tasks.filter((task) => task.record_state !== 'deleted');
      return tasks.filter((task) => task.board_group_id === this.selectedBoardId);
    },

    get filteredTasks() {
      let tasks = this.boardScopedTasks;

      const query = String(this.taskFilter || '').trim().toLowerCase();
      if (query) {
        tasks = tasks.filter(t =>
          String(t.title || '').toLowerCase().includes(query)
          || String(t.description || '').toLowerCase().includes(query)
          || String(t.tags || '').toLowerCase().includes(query)
        );
      }
      if (this.taskFilterTags.length > 0) {
        tasks = tasks.filter(t => {
          const tags = parseTaskTags(t.tags);
          return this.taskFilterTags.some(ft => tags.includes(ft.toLowerCase()));
        });
      }
      return tasks;
    },

    get activeTasks() {
      return this.filteredTasks.filter(t =>
        t.state !== 'done' && t.state !== 'archive' && !this.isParentTask(t.record_id)
      );
    },

    get doneTasks() {
      return this.filteredTasks.filter(t =>
        t.state === 'done' && !this.isParentTask(t.record_id)
      );
    },

    get summaryTasks() {
      return this.filteredTasks.filter(t =>
        t.state !== 'archive' && this.isParentTask(t.record_id)
      );
    },

    get boardColumns() {
      const cols = [];
      const summary = this.summaryTasks;
      if (summary.length > 0) {
        cols.push({ state: 'summary', label: 'Summary', tasks: summary });
      }
      const states = ['new', 'ready', 'in_progress', 'review', 'done'];
      const labels = { new: 'New', ready: 'Ready', in_progress: 'In Progress', review: 'Review', done: 'Done' };
      for (const state of states) {
        const tasks = state === 'done'
          ? this.doneTasks
          : this.activeTasks.filter(t => t.state === state);
        cols.push({ state, label: labels[state], tasks });
      }
      return cols;
    },

    get allTaskTags() {
      const tagSet = new Set();
      for (const task of this.boardScopedTasks) {
        for (const tag of parseTaskTags(task.tags)) {
          tagSet.add(tag);
        }
      }
      return [...tagSet].sort();
    },

    getTaskTags(task) {
      return parseTaskTags(task?.tags);
    },

    getTaskBoardLabel(boardGroupId) {
      if (boardGroupId && boardGroupId === this.memberPrivateGroupNpub) return 'Private board';
      return this.taskBoards.find((board) => board.id === boardGroupId)?.label || 'Group board';
    },

    getPreferredChannelWriteGroup(channel) {
      const groups = Array.isArray(channel?.group_ids)
        ? channel.group_ids.map((value) => String(value || '').trim()).filter(Boolean)
        : [];
      return groups[0] || null;
    },

    get activeTaskDetail() {
      if (!this.activeTaskId) return null;
      return this.tasks.find(t => t.record_id === this.activeTaskId) ?? null;
    },

    get renderedDocPreview() {
      return this.renderMarkdown(this.docEditorContent || '');
    },

    get docEditorHasBlocks() {
      return this.docEditorBlocks.length > 0;
    },

    get docSyncStatusClass() {
      if (this.docAutosaveState === 'error') return 'doc-sync-dot-unsynced';
      if (this.docAutosaveState === 'pending') return 'doc-sync-dot-unsynced';
      if (this.docAutosaveState === 'saving') return 'doc-sync-dot-syncing';
      return 'doc-sync-dot-synced';
    },

    get docSyncStatusLabel() {
      if (this.docAutosaveState === 'error') return 'Autosave failed';
      if (this.docAutosaveState === 'pending') return 'Autosave pending';
      if (this.docAutosaveState === 'saving') return 'Saving';
      return 'Saved';
    },

    get docShareSuggestions() {
      const needle = String(this.docShareQuery || '').trim().toLowerCase();
      if (!needle) return [];

      const sharedPeople = new Set(
        this.docEditorShares
          .filter((share) => share.type === 'person')
          .map((share) => share.person_npub)
      );
      const sharedGroups = new Set(
        this.docEditorShares
          .filter((share) => share.type === 'group')
          .map((share) => share.group_npub)
      );

      const people = this.addressBookPeople
        .filter((person) => !sharedPeople.has(person.npub))
        .filter((person) =>
          String(person.npub || '').toLowerCase().includes(needle)
          || String(this.getSenderName(person.npub) || '').toLowerCase().includes(needle)
          || String(person.label || '').toLowerCase().includes(needle)
        )
        .slice(0, 6)
        .map((person) => ({
          type: 'person',
          key: `person:${person.npub}`,
          npub: person.npub,
          label: this.getSenderName(person.npub),
          subtitle: person.npub,
          avatarUrl: this.getSenderAvatar(person.npub),
        }));

      const groups = this.groups
        .filter((group) => !sharedGroups.has(group.group_npub || group.group_id))
        .filter((group) =>
          String(group.name || '').toLowerCase().includes(needle)
          || (group.member_npubs || []).some((member) => member.toLowerCase().includes(needle))
        )
        .slice(0, 6)
        .map((group) => ({
          type: 'group',
          key: `group:${group.group_npub || group.group_id}`,
          group_npub: group.group_npub || group.group_id,
          label: group.name,
          subtitle: `${(group.member_npubs || []).length} members`,
        }));

      return [...people, ...groups];
    },

    get groupMemberSuggestions() {
      return this.findGroupMemberSuggestions(this.newGroupMemberQuery, this.newGroupMembers);
    },

    get editGroupMemberSuggestions() {
      return this.findGroupMemberSuggestions(this.editGroupMemberQuery, this.editGroupMembers);
    },

    get groupActionsLocked() {
      return this.groupCreatePending || this.groupEditPending || !!this.groupDeletePendingId;
    },

    findGroupMemberSuggestions(query, selectedMembers = []) {
      const needle = String(query || '').trim().toLowerCase();
      if (!needle) return [];

      const existing = new Set((selectedMembers || []).map((member) => member.npub));
      return this.addressBookPeople
        .filter((person) => !existing.has(person.npub))
        .filter((person) =>
          String(person.npub || '').toLowerCase().includes(needle)
          || String(this.getSenderName(person.npub) || '').toLowerCase().includes(needle)
          || String(person.label || '').toLowerCase().includes(needle)
        )
        .slice(0, 8)
        .map((person) => ({
          npub: person.npub,
          label: this.getSenderName(person.npub),
          avatarUrl: this.getSenderAvatar(person.npub),
        }));
    },

    mapGroupDraftMembers(memberNpubs = []) {
      return [...new Set((memberNpubs || []).map((value) => String(value || '').trim()).filter(Boolean))]
        .map((npub) => {
          this.resolveChatProfile(npub);
          return {
            npub,
            label: this.getSenderName(npub),
            avatarUrl: this.getSenderAvatar(npub),
          };
        });
    },

    consumeGroupMemberQuery(query, currentMembers = []) {
      const raw = String(query || '').trim();
      if (!raw) {
        return {
          added: false,
          members: [...currentMembers],
        };
      }

      const parts = raw.split(',').map((value) => value.trim()).filter(Boolean);
      const nextMembers = [...currentMembers];
      const existing = new Set(nextMembers.map((member) => member.npub));
      let added = false;

      for (const part of parts) {
        if (part.startsWith('npub1') && part.length >= 60 && !existing.has(part)) {
          this.resolveChatProfile(part);
          nextMembers.push({
            npub: part,
            label: this.getSenderName(part),
            avatarUrl: this.getSenderAvatar(part),
          });
          existing.add(part);
          added = true;
        }
      }

      if (added) {
        return {
          added: true,
          members: nextMembers,
        };
      }

      const suggestions = this.findGroupMemberSuggestions(raw, currentMembers);
      if (suggestions.length > 0) {
        return {
          added: true,
          members: [...currentMembers, suggestions[0]],
        };
      }

      return {
        added: false,
        members: [...currentMembers],
      };
    },

    get filteredDocRows() {
      const activeDirectories = this.directories.filter((item) => item.record_state !== 'deleted');
      const activeDocuments = this.documents.filter((item) => item.record_state !== 'deleted');
      const query = String(this.docFilter || '').trim().toLowerCase();

      const childDirsByParent = new Map();
      const childDocsByParent = new Map();
      for (const directory of activeDirectories) {
        const key = directory.parent_directory_id ?? '__root__';
        const list = childDirsByParent.get(key) ?? [];
        list.push(directory);
        childDirsByParent.set(key, list);
      }
      for (const document of activeDocuments) {
        const key = document.parent_directory_id ?? '__root__';
        const list = childDocsByParent.get(key) ?? [];
        list.push(document);
        childDocsByParent.set(key, list);
      }

      const matchesDirectory = (directory) =>
        !query || String(directory.title || '').toLowerCase().includes(query);
      const matchesDocument = (document) =>
        !query
        || String(document.title || '').toLowerCase().includes(query)
        || String(document.content || '').toLowerCase().includes(query);

      const directoryHasMatch = (directoryId) => {
        const childDirs = childDirsByParent.get(directoryId) ?? [];
        const childDocs = childDocsByParent.get(directoryId) ?? [];
        return childDirs.some((dir) => matchesDirectory(dir) || directoryHasMatch(dir.record_id))
          || childDocs.some((doc) => matchesDocument(doc));
      };

      const rows = [];
      const walk = (parentId = null, depth = 0) => {
        const dirKey = parentId ?? '__root__';
        const directories = (childDirsByParent.get(dirKey) ?? [])
          .slice()
          .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
        const documents = (childDocsByParent.get(dirKey) ?? [])
          .slice()
          .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));

        for (const directory of directories) {
          if (query && !matchesDirectory(directory) && !directoryHasMatch(directory.record_id)) continue;
          rows.push({ type: 'directory', depth, item: directory });
          walk(directory.record_id, depth + 1);
        }
        for (const document of documents) {
          if (!matchesDocument(document)) continue;
          rows.push({ type: 'document', depth, item: document });
        }
      };

      walk(null, 0);
      return rows;
    },

    mergeKnownWorkspaces(entries = []) {
      this.knownWorkspaces = mergeWorkspaceEntries(this.knownWorkspaces, entries);
    },

    applyWorkspaceSettingsRow(row, options = {}) {
      const overwriteInput = options.overwriteInput !== false;
      this.workspaceSettingsRecordId = row?.record_id || '';
      this.workspaceSettingsVersion = Number(row?.version || 0);
      this.workspaceSettingsGroupIds = Array.isArray(row?.group_ids) ? [...row.group_ids] : [];
      this.workspaceHarnessUrl = String(row?.wingman_harness_url || '').trim();
      if (overwriteInput || !this.wingmanHarnessDirty) {
        this.wingmanHarnessInput = this.workspaceHarnessUrl;
        this.wingmanHarnessDirty = false;
      }
    },

    async refreshWorkspaceSettings(options = {}) {
      const workspaceOwnerNpub = this.workspaceOwnerNpub;
      if (!workspaceOwnerNpub) {
        this.applyWorkspaceSettingsRow(null);
        return null;
      }

      const row = await getWorkspaceSettings(workspaceOwnerNpub);
      this.applyWorkspaceSettingsRow(row, options);
      return row;
    },

    getWorkspaceSettingsGroupNpub() {
      return this.currentWorkspace?.defaultGroupNpub || this.memberPrivateGroupNpub || null;
    },

    handleHarnessInput(value) {
      this.wingmanHarnessInput = value;
      this.wingmanHarnessDirty = true;
      this.wingmanHarnessError = null;
    },

    async persistWorkspaceSettings() {
      await saveSettings({
        ...((await getSettings()) || {}),
        backendUrl: this.backendUrl,
        ownerNpub: this.ownerNpub,
        botNpub: this.botNpub,
        connectionToken: this.superbasedTokenInput,
        useCvmSync: this.useCvmSync,
        knownWorkspaces: this.knownWorkspaces,
        currentWorkspaceOwnerNpub: this.currentWorkspaceOwnerNpub || '',
      });
    },

    async selectWorkspace(workspaceOwnerNpub, options = {}) {
      const workspace = this.knownWorkspaces.find((entry) => entry.workspaceOwnerNpub === workspaceOwnerNpub);
      if (!workspace) return;

      const previousWorkspace = this.currentWorkspaceOwnerNpub;
      this.currentWorkspaceOwnerNpub = workspace.workspaceOwnerNpub;
      this.showWorkspaceBootstrapModal = false;
      this.superbasedTokenInput = workspace.connectionToken || this.superbasedTokenInput;
      this.backendUrl = normalizeBackendUrl(workspace.directHttpsUrl || this.backendUrl || guessDefaultBackendUrl());
      this.ownerNpub = workspace.workspaceOwnerNpub;
      setBaseUrl(this.backendUrl);

      if (previousWorkspace && previousWorkspace !== workspace.workspaceOwnerNpub) {
        await clearRuntimeData();
        this.channels = [];
        this.messages = [];
        this.groups = [];
        this.documents = [];
        this.directories = [];
        this.tasks = [];
        this.audioNotes = [];
        this.taskComments = [];
        this.hasForcedInitialBackfill = false;
      }

      this.selectedBoardId = this.readStoredTaskBoardId() || workspace.privateGroupNpub || null;
      this.validateSelectedBoardId();
      await this.persistWorkspaceSettings();
      await this.refreshWorkspaceSettings();

      if (options.refresh !== false && this.session?.npub) {
        await this.refreshGroups();
        await this.refreshChannels();
        await this.refreshAudioNotes();
        await this.refreshDirectories();
        await this.refreshDocuments();
        await this.refreshTasks();
        await this.refreshScopes();
        await this.refreshStatusRecentChanges();
      }
    },

    async loadRemoteWorkspaces() {
      if (!this.session?.npub || !this.backendUrl) return;
      try {
        const serviceNpub = await this.fetchBackendServiceNpub();
        const result = await getWorkspaces(this.session.npub);
        const workspaces = (result.workspaces || []).map((entry) => normalizeWorkspaceEntry({
          ...entry,
          serviceNpub,
          appNpub: this.superbasedConnectionConfig?.appNpub || null,
        })).filter(Boolean);
        this.mergeKnownWorkspaces(workspaces);
      } catch (error) {
        console.debug('loadRemoteWorkspaces failed:', error?.message || error);
      }
    },

    updateWorkspaceBootstrapPrompt() {
      const shouldPrompt = Boolean(this.session?.npub) && !this.currentWorkspaceOwnerNpub && this.knownWorkspaces.length === 0;
      this.showWorkspaceBootstrapModal = shouldPrompt;
      return shouldPrompt;
    },

    async fetchBackendServiceNpub() {
      const known = this.superbasedConnectionConfig?.serviceNpub || this.currentWorkspace?.serviceNpub || null;
      if (known) return known;
      if (!this.backendUrl) return null;
      try {
        const response = await fetch(`${this.backendUrl.replace(/\/+$/, '')}/health`);
        if (!response.ok) return null;
        const payload = await response.json();
        return String(payload?.service_npub || '').trim() || null;
      } catch {
        return null;
      }
    },

    openWorkspaceBootstrapModal() {
      this.newWorkspaceName = '';
      this.newWorkspaceDescription = '';
      this.showWorkspaceBootstrapModal = true;
      this.showSuperBasedModal = false;
    },

    closeWorkspaceBootstrapModal() {
      if (this.workspaceBootstrapSubmitting) return;
      this.showWorkspaceBootstrapModal = false;
    },

    async createWorkspaceBootstrap() {
      const memberNpub = this.session?.npub;
      if (!memberNpub) {
        this.error = 'Sign in first';
        return;
      }
      const name = String(this.newWorkspaceName || '').trim();
      if (!name) {
        this.error = 'Workspace name is required';
        return;
      }

      this.workspaceBootstrapSubmitting = true;
      this.error = null;
      try {
        const workspaceIdentity = createGroupIdentity();
        const defaultGroupIdentity = createGroupIdentity();
        const privateGroupIdentity = createGroupIdentity();
        const serviceNpub = await this.fetchBackendServiceNpub();
        const wrappedWorkspaceNsec = await personalEncryptForNpub(memberNpub, workspaceIdentity.nsec);
        const defaultGroupMemberKeys = await buildWrappedMemberKeys(defaultGroupIdentity, [memberNpub], memberNpub);
        const privateGroupMemberKeys = await buildWrappedMemberKeys(privateGroupIdentity, [memberNpub], memberNpub);

        const response = await createWorkspace({
          workspace_owner_npub: workspaceIdentity.npub,
          name,
          description: String(this.newWorkspaceDescription || '').trim(),
          wrapped_workspace_nsec: wrappedWorkspaceNsec,
          wrapped_by_npub: memberNpub,
          default_group_npub: defaultGroupIdentity.npub,
          default_group_name: `${name} Shared`,
          default_group_member_keys: defaultGroupMemberKeys,
          private_group_npub: privateGroupIdentity.npub,
          private_group_name: 'Private',
          private_group_member_keys: privateGroupMemberKeys,
        });

        const workspace = normalizeWorkspaceEntry({
          ...response,
          serviceNpub,
          appNpub: this.superbasedConnectionConfig?.appNpub || null,
          connectionToken: buildSuperBasedConnectionToken({
            directHttpsUrl: response.direct_https_url || this.backendUrl || guessDefaultBackendUrl(),
            serviceNpub,
            workspaceOwnerNpub: response.workspace_owner_npub,
            appNpub: this.superbasedConnectionConfig?.appNpub || null,
          }),
        });
        this.mergeKnownWorkspaces([workspace]);
        await this.selectWorkspace(workspace.workspaceOwnerNpub);
        this.showWorkspaceBootstrapModal = false;
      } catch (error) {
        this.error = error?.message || 'Failed to create workspace';
      } finally {
        this.workspaceBootstrapSubmitting = false;
      }
    },

    // --- lifecycle ---

    async init() {
      this.startExtensionSignerWatch();
      this.initRouteSync();
      this.initDocCommentConnector();
      const settings = await getSettings();
      if (settings) {
        this.backendUrl = normalizeBackendUrl(settings.backendUrl ?? '');
        this.ownerNpub = settings.ownerNpub ?? '';
        this.botNpub = settings.botNpub ?? '';
        this.superbasedTokenInput = settings.connectionToken ?? '';
        this.useCvmSync = settings.useCvmSync ?? this.useCvmSync;
        this.currentWorkspaceOwnerNpub = settings.currentWorkspaceOwnerNpub ?? '';
        this.knownWorkspaces = mergeWorkspaceEntries([], settings.knownWorkspaces ?? []);
      }
      if (this.superbasedTokenInput) {
        const config = parseSuperBasedToken(this.superbasedTokenInput);
        if (config.isValid && config.directHttpsUrl) {
          this.backendUrl = normalizeBackendUrl(config.directHttpsUrl);
          const tokenWorkspace = workspaceFromToken(this.superbasedTokenInput);
          if (tokenWorkspace) this.mergeKnownWorkspaces([tokenWorkspace]);
          if (config.workspaceOwnerNpub) {
            this.currentWorkspaceOwnerNpub = this.currentWorkspaceOwnerNpub || config.workspaceOwnerNpub;
            this.ownerNpub = config.workspaceOwnerNpub;
          }
        }
      }
      if (!this.backendUrl) this.backendUrl = guessDefaultBackendUrl();
      if (this.backendUrl) setBaseUrl(this.backendUrl);
      this.ensureBackgroundSync();
      await this.maybeAutoLogin();
      this.updateWorkspaceBootstrapPrompt();
      await this.loadRemoteWorkspaces();
      if (!this.currentWorkspaceOwnerNpub && this.knownWorkspaces.length > 0) {
        this.currentWorkspaceOwnerNpub = this.knownWorkspaces[0].workspaceOwnerNpub;
      }
      if (this.currentWorkspaceOwnerNpub) {
        await this.selectWorkspace(this.currentWorkspaceOwnerNpub, { refresh: false });
      } else {
        await this.refreshWorkspaceSettings();
      }
      this.updateWorkspaceBootstrapPrompt();
      await this.refreshGroups();
      this.selectedBoardId = this.readStoredTaskBoardId();
      this.validateSelectedBoardId();
      await this.refreshAddressBook();
      await this.refreshChannels();
      await this.refreshAudioNotes();
      await this.refreshDirectories();
      await this.refreshDocuments();
      await this.refreshTasks();
      await this.applyRouteFromLocation();
      await this.refreshSyncStatus();
      await this.refreshStatusRecentChanges();
    },

    initRouteSync() {
      if (typeof window === 'undefined' || this.popstateHandler) return;
      this.popstateHandler = () => {
        this.applyRouteFromLocation();
      };
      window.addEventListener('popstate', this.popstateHandler);
    },

    initDocCommentConnector() {
      if (typeof window === 'undefined' || this.docConnectorScrollHandler || this.docConnectorResizeHandler) return;
      this.docConnectorScrollHandler = () => this.scheduleDocCommentConnectorUpdate();
      this.docConnectorResizeHandler = () => this.scheduleDocCommentConnectorUpdate();
      window.addEventListener('scroll', this.docConnectorScrollHandler, { passive: true });
      window.addEventListener('resize', this.docConnectorResizeHandler, { passive: true });
    },

    clearDocCommentConnector() {
      this.docCommentConnector = { visible: false, path: '' };
    },

    scheduleDocCommentConnectorUpdate() {
      if (typeof window === 'undefined') return;
      if (this.docConnectorFrame) window.cancelAnimationFrame(this.docConnectorFrame);
      this.docConnectorFrame = window.requestAnimationFrame(() => {
        this.docConnectorFrame = null;
        this.updateDocCommentConnector();
      });
    },

    updateDocCommentConnector() {
      if (typeof document === 'undefined') {
        this.clearDocCommentConnector();
        return;
      }
      if (!this.docCommentsVisible || !this.selectedDocComment) {
        this.clearDocCommentConnector();
        return;
      }

      const layout = document.querySelector('[data-doc-content-layout]');
      const panel = document.querySelector('[data-doc-thread-panel]');
      const anchorLine = this.selectedDocComment?.anchor_line_number || 1;
      const marker = document.querySelector(`[data-doc-anchor-line="${anchorLine}"]`);

      if (!layout || !panel || !marker) {
        this.clearDocCommentConnector();
        return;
      }

      const layoutRect = layout.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const markerRect = marker.getBoundingClientRect();

      const markerX = markerRect.left + (markerRect.width / 2) - layoutRect.left;
      const markerY = markerRect.top + (markerRect.height / 2) - layoutRect.top;
      const panelX = panelRect.left - layoutRect.left;
      const panelY = panelRect.top + 56 - layoutRect.top;
      const elbowX = Math.max(markerX + 24, panelX - 28);

      this.docCommentConnector = {
        visible: true,
        path: `M ${panelX} ${panelY} H ${elbowX} V ${markerY} H ${markerX}`,
      };
    },

    getRoutePath(section = this.navSection) {
      switch (section) {
        case 'status':
          return '/notifications';
        case 'tasks':
          return '/tasks';
        case 'chat':
          return '/chat';
        case 'docs':
          return '/docs';
        case 'people':
          return '/people';
        case 'scopes':
          return '/scopes';
        case 'settings':
          return '/settings';
        default:
          return '/chat';
      }
    },

    buildRouteUrl() {
      if (typeof window === 'undefined') return '';
      const url = new URL(window.location.href);
      url.pathname = this.getRoutePath();
      url.search = '';

      if (this.navSection === 'chat') {
        if (this.selectedChannelId) url.searchParams.set('channelid', this.selectedChannelId);
        if (this.activeThreadId) url.searchParams.set('threadid', this.activeThreadId);
      } else if (this.navSection === 'docs') {
        if (this.currentFolderId) url.searchParams.set('folderid', this.currentFolderId);
        if (this.selectedDocType === 'document' && this.selectedDocId) {
          url.searchParams.set('docid', this.selectedDocId);
        }
        if (this.selectedDocCommentId) url.searchParams.set('commentid', this.selectedDocCommentId);
      } else if (this.navSection === 'tasks') {
        if (this.selectedBoardId) url.searchParams.set('groups', this.selectedBoardId);
        if (this.activeTaskId) url.searchParams.set('taskid', this.activeTaskId);
      }

      return `${url.pathname}${url.search}`;
    },

    syncRoute(replace = false) {
      if (this.routeSyncPaused || typeof window === 'undefined') return;
      const nextUrl = this.buildRouteUrl();
      const currentUrl = `${window.location.pathname}${window.location.search}`;
      if (nextUrl === currentUrl) return;
      const state = { section: this.navSection };
      if (replace) window.history.replaceState(state, '', nextUrl);
      else window.history.pushState(state, '', nextUrl);
    },

    async applyRouteFromLocation() {
      const route = parseRouteLocation();
      this.routeSyncPaused = true;
      try {
        this.navSection = route.section;
        this.mobileNavOpen = false;

        if (route.section === 'chat') {
          const channelId = route.params.channelid || this.selectedChannelId || this.channels[0]?.record_id || null;
          if (channelId) {
            await this.selectChannel(channelId, { syncRoute: false });
            if (route.params.threadid) this.openThread(route.params.threadid, { syncRoute: false });
            else this.closeThread({ syncRoute: false });
          } else {
            this.selectedChannelId = null;
            this.closeThread({ syncRoute: false });
          }
        } else if (route.section === 'docs') {
          this.selectedDocCommentId = route.params.commentid || null;
          if (route.params.docid) {
            this.openDoc(route.params.docid, { syncRoute: false, commentId: route.params.commentid || null });
          } else if (route.params.folderid) {
            this.navigateToFolder(route.params.folderid, { syncRoute: false });
          } else {
            this.selectedDocType = null;
            this.selectedDocId = null;
            this.currentFolderId = null;
            this.loadDocEditorFromSelection();
          }
        } else if (route.section === 'tasks') {
          this.selectedBoardId = route.params.groupid ?? this.readStoredTaskBoardId() ?? this.memberPrivateGroupNpub;
          this.validateSelectedBoardId();
          this.normalizeTaskFilterTags();
          this.persistSelectedBoardId(this.selectedBoardId);
          if (route.params.taskid) {
            this.openTaskDetail(route.params.taskid);
          } else {
            this.closeTaskDetail();
          }
        }
      } finally {
        this.routeSyncPaused = false;
      }
      this.syncRoute(true);
    },

    startExtensionSignerWatch() {
      this.refreshExtensionSignerAvailability();
      if (typeof window === 'undefined' || typeof document === 'undefined') return;
      if (this.extensionSignerPollTimer) clearInterval(this.extensionSignerPollTimer);
      this.extensionSignerPollTimer = window.setInterval(() => {
        this.refreshExtensionSignerAvailability();
      }, 1000);
      window.setTimeout(() => {
        if (this.extensionSignerPollTimer) {
          clearInterval(this.extensionSignerPollTimer);
          this.extensionSignerPollTimer = null;
        }
      }, 15000);

      const refresh = () => this.refreshExtensionSignerAvailability();
      window.addEventListener('focus', refresh, { passive: true });
      window.addEventListener('pageshow', refresh, { passive: true });
      document.addEventListener('visibilitychange', refresh, { passive: true });
    },

    async refreshExtensionSignerAvailability() {
      this.extensionSignerAvailable = hasExtensionSigner();
      if (!this.extensionSignerAvailable) {
        this.extensionSignerAvailable = await waitForExtensionSigner(900, 120);
      }
      return this.extensionSignerAvailable;
    },

    async maybeAutoLogin() {
      try {
        const storedAuth = await tryAutoLoginFromStorage();
        if (!storedAuth) return;

        if (storedAuth.needsReconnect && storedAuth.method === 'bunker') {
          await this.login('bunker', storedAuth.bunkerUri);
          return;
        }

        const npub = await pubkeyToNpub(storedAuth.pubkey);
        this.session = {
          pubkey: storedAuth.pubkey,
          npub,
          method: storedAuth.method,
        };
        setActiveSessionNpub(npub);
        this.ownerNpub = this.currentWorkspaceOwnerNpub || this.superbasedConnectionConfig?.workspaceOwnerNpub || npub;
        this.resolveChatProfile(npub);
        await this.rememberPeople([npub], 'self');
        await this.loadRemoteWorkspaces();
        if (!this.currentWorkspaceOwnerNpub && this.knownWorkspaces.length > 0) {
          this.currentWorkspaceOwnerNpub = this.knownWorkspaces[0].workspaceOwnerNpub;
        }
        if (this.currentWorkspaceOwnerNpub) {
          await this.selectWorkspace(this.currentWorkspaceOwnerNpub, { refresh: false });
        }
        await this.refreshGroups();
        await this.refreshChannels();
        await this.refreshSyncStatus();
        this.updateWorkspaceBootstrapPrompt();
        this.ensureBackgroundSync(true);
      } catch (error) {
        this.loginError = error.message;
      }
    },

    // --- auth ---

    async login(method, supplemental = null) {
      this.isLoggingIn = true;
      this.loginError = null;
      try {
        const signedEvent = await signLoginEvent(method, supplemental);
        const pubkey = getPubkeyFromEvent(signedEvent);
        const npub = await pubkeyToNpub(pubkey);

        this.session = { pubkey, npub, method };
        setActiveSessionNpub(npub);
        this.ownerNpub = this.currentWorkspaceOwnerNpub || this.superbasedConnectionConfig?.workspaceOwnerNpub || npub;
        setAutoLogin(method, pubkey);
        this.resolveChatProfile(npub);
        await this.rememberPeople([npub], 'self');
        this.updateWorkspaceBootstrapPrompt();

        await this.loadRemoteWorkspaces();
        if (!this.currentWorkspaceOwnerNpub && this.knownWorkspaces.length > 0) {
          this.currentWorkspaceOwnerNpub = this.knownWorkspaces[0].workspaceOwnerNpub;
        }
        if (this.currentWorkspaceOwnerNpub) {
          await this.selectWorkspace(this.currentWorkspaceOwnerNpub, { refresh: false });
        }

        await this.persistWorkspaceSettings();

        await this.refreshGroups();
        await this.refreshChannels();
        await this.refreshSyncStatus();
        this.updateWorkspaceBootstrapPrompt();
        this.ensureBackgroundSync(true);
      } catch (error) {
        console.error('Login failed:', error);
        this.loginError = error.message || 'Login failed.';
      } finally {
        this.isLoggingIn = false;
      }
    },

    async logout() {
      this.stopBackgroundSync();
      this.clearDocCommentConnector();
      this.revokeStorageImageObjectUrls();
      await clearAutoLogin();
      await clearRuntimeData();
      clearCryptoContext();
      this.session = null;
      this.ownerNpub = '';
      this.channels = [];
      this.messages = [];
      this.groups = [];
      this.documents = [];
      this.directories = [];
      this.addressBookPeople = [];
      this.selectedChannelId = null;
      this.activeThreadId = null;
      this.selectedDocId = null;
      this.selectedDocType = null;
      this.messageInput = '';
      this.threadInput = '';
      this.docEditorTitle = '';
      this.docEditorContent = '';
      this.docEditorShares = [];
      this.docShareQuery = '';
      this.newGroupName = '';
      this.newGroupMemberQuery = '';
      this.newGroupMembers = [];
      this.chatProfiles = {};
      this.workspaceSettingsRecordId = '';
      this.workspaceSettingsVersion = 0;
      this.workspaceSettingsGroupIds = [];
      this.workspaceHarnessUrl = '';
      this.wingmanHarnessInput = '';
      this.wingmanHarnessError = null;
      this.wingmanHarnessDirty = false;
      this.hasForcedInitialBackfill = false;
      this.loginError = null;
      this.error = null;
      this.showAvatarMenu = false;
      this.syncRoute(true);
      await this.refreshSyncStatus();
    },

    hasExtensionSigner() {
      return this.extensionSignerAvailable;
    },

    // --- settings ---

    async saveSettings() {
      setBaseUrl(this.backendUrl);
      await this.persistWorkspaceSettings();
      this.ensureBackgroundSync();
    },

    openHarnessLink() {
      if (!this.workspaceHarnessUrl || typeof window === 'undefined') return;
      window.open(this.workspaceHarnessUrl, '_blank', 'noopener,noreferrer');
    },

    async saveHarnessSettings() {
      this.wingmanHarnessError = null;
      if (!this.session?.npub) {
        this.wingmanHarnessError = 'Sign in first';
        return;
      }

      const workspaceOwnerNpub = this.workspaceOwnerNpub;
      if (!workspaceOwnerNpub) {
        this.wingmanHarnessError = 'Select a workspace first';
        return;
      }

      const rawInput = String(this.wingmanHarnessInput || '').trim();
      const normalizedUrl = rawInput ? normalizeHarnessUrl(rawInput) : '';
      if (rawInput && !normalizedUrl) {
        this.wingmanHarnessError = 'Enter a valid harness hostname or URL';
        return;
      }

      const now = new Date().toISOString();
      const writeGroupNpub = this.getWorkspaceSettingsGroupNpub();
      const groupIds = writeGroupNpub ? [writeGroupNpub] : [...(this.workspaceSettingsGroupIds || [])];
      const nextVersion = Math.max(1, Number(this.workspaceSettingsVersion || 0) + 1);
      const recordId = this.workspaceSettingsRecordId || workspaceSettingsRecordId(workspaceOwnerNpub);
      const localRow = {
        workspace_owner_npub: workspaceOwnerNpub,
        record_id: recordId,
        owner_npub: workspaceOwnerNpub,
        wingman_harness_url: normalizedUrl,
        group_ids: groupIds,
        sync_status: 'pending',
        record_state: 'active',
        version: nextVersion,
        updated_at: now,
      };

      await upsertWorkspaceSettings(localRow);
      this.applyWorkspaceSettingsRow(localRow);

      const envelope = await outboundWorkspaceSettings({
        record_id: recordId,
        owner_npub: workspaceOwnerNpub,
        workspace_owner_npub: workspaceOwnerNpub,
        wingman_harness_url: normalizedUrl,
        group_ids: groupIds,
        version: nextVersion,
        previous_version: Math.max(0, nextVersion - 1),
        signature_npub: this.session.npub,
        write_group_npub: writeGroupNpub,
      });
      await addPendingWrite({
        record_id: recordId,
        record_family_hash: envelope.record_family_hash,
        envelope,
      });
      await this.refreshSyncStatus();
      this.ensureBackgroundSync(true);
    },

    async saveConnectionSettings() {
      this.superbasedError = null;
      const token = String(this.superbasedTokenInput || '').trim();
      if (token) {
        const config = parseSuperBasedToken(token);
        if (!config.isValid || !config.directHttpsUrl) {
          this.superbasedError = 'Connection key must include a direct HTTPS URL';
          return;
        }
        this.superbasedTokenInput = token;
        this.backendUrl = normalizeBackendUrl(config.directHttpsUrl);
        const workspace = workspaceFromToken(token, { name: 'Imported workspace' });
        if (workspace) {
          this.mergeKnownWorkspaces([workspace]);
          this.currentWorkspaceOwnerNpub = workspace.workspaceOwnerNpub;
          this.ownerNpub = workspace.workspaceOwnerNpub;
        } else {
          this.ownerNpub = config.workspaceOwnerNpub || this.session?.npub || this.ownerNpub;
        }
      } else if (this.session?.npub) {
        this.ownerNpub = this.session.npub;
      }
      if (!this.backendUrl) {
        this.superbasedError = 'Connection key or backend URL required';
        return;
      }
      localStorage.setItem('use_cvm_sync', this.useCvmSync ? 'true' : 'false');
      await this.saveSettings();
      this.showSuperBasedModal = false;
      this.showAvatarMenu = false;
      if (this.currentWorkspaceOwnerNpub) {
        await this.selectWorkspace(this.currentWorkspaceOwnerNpub);
      }
    },

    openSuperBasedSettings() {
      this.showAvatarMenu = false;
      this.superbasedError = null;
      this.showSuperBasedModal = true;
    },

    closeSuperBasedSettings() {
      this.showSuperBasedModal = false;
      this.superbasedError = null;
    },

    toggleCvmSync() {
      this.useCvmSync = !this.useCvmSync;
      localStorage.setItem('use_cvm_sync', this.useCvmSync ? 'true' : 'false');
    },

    async copyId() {
      if (!this.session?.npub) return;
      try {
        await navigator.clipboard.writeText(this.session.npub);
      } catch {
        this.error = 'Failed to copy ID';
      }
      this.showAvatarMenu = false;
    },

    showAgentConnect() {
      this.showAvatarMenu = false;
      this.agentConfigCopied = false;
      this.agentConnectJson = JSON.stringify(buildAgentConnectPackage({
        windowOrigin: typeof window === 'undefined' ? '' : window.location.origin,
        backendUrl: this.backendUrl || DEFAULT_SUPERBASED_URL,
        session: this.session,
        token: this.superbasedTokenInput,
      }), null, 2);
      this.showAgentConnectModal = true;
    },

    closeAgentConnect() {
      this.showAgentConnectModal = false;
    },

    async copyAgentConfig() {
      if (!this.agentConnectJson) return;
      try {
        await navigator.clipboard.writeText(this.agentConnectJson);
        this.agentConfigCopied = true;
        setTimeout(() => {
          this.agentConfigCopied = false;
        }, 2000);
      } catch {
        this.error = 'Failed to copy agent package';
      }
    },

    togglePrimaryNav() {
      if (typeof window !== 'undefined' && window.innerWidth <= 768) {
        this.mobileNavOpen = !this.mobileNavOpen;
        return;
      }
      this.navCollapsed = !this.navCollapsed;
    },

    openChannelSettings() {
      if (!this.selectedChannel) return;
      this.showChannelSettingsModal = true;
    },

    closeChannelSettings() {
      this.showChannelSettingsModal = false;
    },

    navigateTo(section, options = {}) {
      this.navSection = section;
      this.mobileNavOpen = false;
      if (section !== 'docs') {
        this.selectedDocCommentId = null;
      }
      if (section === 'chat' && !this.selectedChannelId && this.channels.length > 0) {
        this.selectChannel(this.channels[0].record_id);
      }
      if (section === 'status') {
        this.refreshStatusRecentChanges();
      }
      if (options.syncRoute !== false) this.syncRoute();
      this.ensureBackgroundSync(true);
    },

    getSyncCadenceMs() {
      if (!this.session?.npub || !this.backendUrl) return null;
      if (typeof document !== 'undefined' && document.hidden) return null;
      if (this.navSection === 'chat' && this.selectedChannelId) return this.FAST_SYNC_MS;
      if (this.navSection === 'docs') return this.FAST_SYNC_MS;
      if (this.navSection === 'tasks') return this.FAST_SYNC_MS;
      if (this.navSection === 'scopes') return this.FAST_SYNC_MS;
      return this.IDLE_SYNC_MS;
    },

    stopBackgroundSync() {
      if (this.backgroundSyncTimer) {
        clearTimeout(this.backgroundSyncTimer);
        this.backgroundSyncTimer = null;
      }
      if (this.visibilityHandler && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', this.visibilityHandler);
        this.visibilityHandler = null;
      }
    },

    scheduleBackgroundSync(delayMs = null) {
      if (this.backgroundSyncTimer) clearTimeout(this.backgroundSyncTimer);
      const cadence = delayMs ?? this.getSyncCadenceMs();
      if (!cadence) {
        this.backgroundSyncTimer = null;
        return;
      }
      this.backgroundSyncTimer = setTimeout(() => {
        this.backgroundSyncTimer = null;
        this.backgroundSyncTick();
      }, cadence);
    },

    ensureBackgroundSync(runSoon = false) {
      if (!this.visibilityHandler && typeof document !== 'undefined') {
        this.visibilityHandler = () => this.ensureBackgroundSync(true);
        document.addEventListener('visibilitychange', this.visibilityHandler);
      }
      this.scheduleBackgroundSync(runSoon ? 50 : null);
    },

    async backgroundSyncTick() {
      const cadence = this.getSyncCadenceMs();
      if (!cadence) return;

      if (this.backgroundSyncInFlight) {
        this.scheduleBackgroundSync(cadence);
        return;
      }

      this.backgroundSyncInFlight = true;
      try {
        await this.performSync({ silent: true });
      } catch (error) {
        console.debug('background sync failed:', error?.message || error);
      } finally {
        this.backgroundSyncInFlight = false;
        this.scheduleBackgroundSync();
      }
    },

    async performSync({ silent = false, showBusy = !silent } = {}) {
      if (!this.session?.npub || !this.backendUrl) {
        if (!silent) this.error = 'Configure settings first';
        return { pushed: 0, pulled: 0 };
      }

      if (!silent) this.error = null;
      if (showBusy) this.syncing = true;
      try {
        await this.refreshGroups();
        if (
          !this.hasForcedInitialBackfill
          && this.groups.length > 0
          && this.channels.length === 0
          && this.messages.length === 0
          && this.documents.length === 0
          && this.directories.length === 0
          && this.tasks.length === 0
          && this.taskComments.length === 0
        ) {
          await clearSyncState();
          this.hasForcedInitialBackfill = true;
        }
        const result = await runSync(this.workspaceOwnerNpub, this.session.npub);
        await this.refreshGroups();
        await this.refreshWorkspaceSettings({ overwriteInput: !this.wingmanHarnessDirty });
        await this.refreshAddressBook();
        await this.refreshChannels();
        await this.refreshMessages();
        await this.refreshAudioNotes();
        await this.refreshDirectories();
        await this.refreshDocuments();
        await this.refreshTasks();
        await this.refreshScopes();
        if (this.docsEditorOpen && this.selectedDocId) {
          await this.loadDocComments(this.selectedDocId);
        }
        await this.refreshSyncStatus();
        await this.refreshStatusRecentChanges();
        return result;
      } catch (error) {
        if (!silent) this.error = error.message;
        throw error;
      } finally {
        if (showBusy) this.syncing = false;
        await this.refreshSyncStatus();
      }
    },

    async refreshSyncStatus() {
      if (this.syncing) {
        this.syncStatus = 'syncing';
        return;
      }
      const pending = await getPendingWrites();
      this.syncStatus = pending.length > 0 ? 'unsynced' : 'synced';
    },

    // --- channels ---

    async refreshChannels() {
      const ownerNpub = this.workspaceOwnerNpub;
      if (!ownerNpub) return;
      this.channels = await getChannelsByOwner(ownerNpub);
      for (const channel of this.channels) {
        await this.rememberPeople(this.getChannelParticipants(channel), 'chat');
      }
      if (!this.selectedChannelId && this.channels.length > 0) {
        this.selectedChannelId = this.channels[0].record_id;
        await this.refreshMessages();
      }
    },

    async refreshGroups() {
      const viewerNpub = this.session?.npub;
      if (!viewerNpub || !this.backendUrl) return;
      try {
        const [result, keyResult] = await Promise.all([
          getGroups(viewerNpub),
          getGroupKeys(viewerNpub),
        ]);
        const groups = result.groups ?? [];
        const mappedGroups = groups.map((group) => ({
          group_id: group.id ?? group.group_id,
          group_npub: group.group_npub ?? group.group_id ?? group.id,
          owner_npub: group.owner_npub,
          name: group.name,
          group_kind: group.group_kind || 'shared',
          private_member_npub: group.private_member_npub ?? null,
          member_npubs: [...(group.members ?? group.member_npubs ?? [])].map(String),
        })).filter((group) => !this.workspaceOwnerNpub || group.owner_npub === this.workspaceOwnerNpub);
        await bootstrapWrappedGroupKeys(keyResult.keys ?? []);
        this.groups = mappedGroups;
        for (const group of mappedGroups) {
          await upsertGroup({
            ...group,
            member_npubs: [...(group.member_npubs ?? [])],
          });
          await this.rememberPeople(group.member_npubs ?? [], 'group');
        }
        this.validateSelectedBoardId();
        this.normalizeTaskFilterTags();
      } catch (error) {
        console.debug('refreshGroups failed:', error?.message || error);
      }
    },

    async createEncryptedGroup(name, memberNpubs = []) {
      const wrappedByNpub = this.session?.npub;
      const ownerNpub = this.workspaceOwnerNpub;
      if (!wrappedByNpub || !ownerNpub) throw new Error('Sign in first');

      const uniqueMembers = [...new Set([wrappedByNpub, ...(memberNpubs || []).map((value) => String(value || '').trim()).filter(Boolean)])];
      const groupIdentity = createGroupIdentity();
      const memberKeys = await buildWrappedMemberKeys(groupIdentity, uniqueMembers, wrappedByNpub);
      const response = await createGroup({
        owner_npub: ownerNpub,
        name,
        group_npub: groupIdentity.npub,
        member_keys: memberKeys,
      });

      const groupNpub = response.group_npub ?? response.group_id ?? response.id;
      const group = {
        group_id: response.group_id ?? response.id ?? groupNpub,
        group_npub: groupNpub,
        owner_npub: ownerNpub,
        name: response.name ?? name,
        group_kind: response.group_kind || 'shared',
        private_member_npub: response.private_member_npub ?? null,
        member_npubs: (response.members ?? []).map((member) => member.member_npub ?? member).filter(Boolean),
      };

      await upsertGroup(group);
      await this.refreshGroups();
      await this.rememberPeople(uniqueMembers, 'group');
      return group;
    },

    async addEncryptedGroupMember(groupId, memberNpub, options = {}) {
      const ownerNpub = this.session?.npub;
      if (!ownerNpub) throw new Error('Sign in first');

      const group = this.groups.find((item) => item.group_id === groupId || item.group_npub === groupId);
      if (!group?.group_npub) throw new Error('Group not found');

      await addGroupMember(group.group_id || groupId, await wrapKnownGroupKeyForMember(group.group_npub, memberNpub, ownerNpub));
      await this.rememberPeople([memberNpub], 'group');
      if (options.refresh !== false) {
        await this.refreshGroups();
      }
    },

    async removeEncryptedGroupMember(groupId, memberNpub, options = {}) {
      const group = this.groups.find((item) => item.group_id === groupId || item.group_npub === groupId);
      if (!group?.group_id) throw new Error('Group not found');

      await deleteGroupMember(group.group_id, memberNpub);
      if (options.refresh !== false) {
        await this.refreshGroups();
      }
    },

    async updateSharingGroupName(groupId, newName, options = {}) {
      const group = this.groups.find((item) => item.group_id === groupId || item.group_npub === groupId);
      if (!group) throw new Error('Group not found');

      const trimmed = String(newName || '').trim();
      if (!trimmed) throw new Error('Group name is required');
      if (trimmed === group.name) return group;

      const response = await updateGroup(group.group_id || groupId, { name: trimmed });
      group.name = response?.name || trimmed;
      await upsertGroup({ ...toRaw(group) });
      if (options.refresh !== false) {
        await this.refreshGroups();
      }
      return group;
    },

    async refreshAddressBook() {
      this.addressBookPeople = await getAddressBookPeople();
    },

    async selectChannel(recordId, options = {}) {
      this.selectedChannelId = recordId;
      this.closeThread({ syncRoute: false });
      await this.refreshMessages();
      if (options.syncRoute !== false) this.syncRoute();
      this.ensureBackgroundSync(true);
    },

    get selectedChannel() {
      return this.channels.find(c => c.record_id === this.selectedChannelId) ?? null;
    },

    get audioNotesById() {
      return new Map(this.audioNotes.map((note) => [note.record_id, note]));
    },

    getAudioNote(recordId) {
      return this.audioNotesById.get(recordId) || null;
    },

    getAudioAttachmentNote(attachment) {
      const recordId = String(attachment?.audio_note_record_id || '').trim();
      if (!recordId) return null;
      return this.getAudioNote(recordId);
    },

    getAudioAttachmentPreview(attachment) {
      const note = this.getAudioAttachmentNote(attachment);
      if (note?.transcript_preview) return note.transcript_preview;
      if (note?.summary) return note.summary;
      if (note?.title) return note.title;
      return attachment?.title || 'Voice note';
    },

    formatAudioDuration(seconds) {
      const total = Math.max(0, Math.round(Number(seconds) || 0));
      const mins = Math.floor(total / 60);
      const secs = total % 60;
      return `${mins}:${String(secs).padStart(2, '0')}`;
    },

    getAudioRecorderKindLabel(context = this.audioRecorderContext) {
      return context === 'chat' || context === 'thread' ? 'Chat' : 'Comment';
    },

    getAudioRecorderDefaultTitle(context = this.audioRecorderContext) {
      const label = this.getAudioRecorderKindLabel(context);
      const now = new Date();
      const date = now.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
      const time = now.toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
      });
      return `${label} Voice: ${date} - ${time}`;
    },

    getAudioDraftsForContext(context) {
      if (context === 'chat') return this.messageAudioDrafts;
      if (context === 'thread') return this.threadAudioDrafts;
      if (context === 'task-comment') return this.taskCommentAudioDrafts;
      if (context === 'doc-comment') return this.docCommentAudioDrafts;
      if (context === 'doc-reply') return this.docCommentReplyAudioDrafts;
      return [];
    },

    setAudioDraftsForContext(context, drafts) {
      if (context === 'chat') this.messageAudioDrafts = drafts;
      else if (context === 'thread') this.threadAudioDrafts = drafts;
      else if (context === 'task-comment') this.taskCommentAudioDrafts = drafts;
      else if (context === 'doc-comment') this.docCommentAudioDrafts = drafts;
      else if (context === 'doc-reply') this.docCommentReplyAudioDrafts = drafts;
    },

    async openAudioRecorder(context) {
      this.audioRecorderContext = context;
      this.audioRecorderState = 'idle';
      this.audioRecorderError = null;
      this.audioRecorderDurationSeconds = 0;
      this.audioRecorderStatusLabel = '';
      this.audioRecorderTitle = this.getAudioRecorderDefaultTitle(context);
      this.clearAudioRecorderPreview();
      this.showAudioRecorderModal = true;
      await Promise.resolve();
      await this.startAudioRecording();
    },

    async startAudioRecording() {
      this.audioRecorderError = null;
      this.audioRecorderStatusLabel = '';
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm';
        this._audioRecorderChunks = [];
        this._audioRecorderStream = stream;
        this._audioRecorder = new MediaRecorder(stream, { mimeType });
        this._audioRecorderStartedAt = Date.now();
        this._audioRecorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) this._audioRecorderChunks.push(event.data);
        };
        this._audioRecorder.onerror = () => {
          this.audioRecorderError = 'Recording failed.';
          this.audioRecorderState = 'idle';
        };
        this._audioRecorder.start();
        this.audioRecorderState = 'recording';
        this.audioRecorderStatusLabel = 'Recording…';
      } catch (error) {
        this.audioRecorderError = error?.message || 'Could not access microphone.';
      }
    },

    async stopAudioRecording() {
      if (!this._audioRecorder || this.audioRecorderState !== 'recording') return;

      const recorder = this._audioRecorder;
      const stream = this._audioRecorderStream;

      this.audioRecorderState = 'processing';
      this.audioRecorderStatusLabel = 'Preparing recording…';

      await new Promise((resolve) => {
        recorder.onstop = resolve;
        recorder.stop();
      });
      stream?.getTracks?.().forEach((track) => track.stop());

      const mimeType = recorder.mimeType || 'audio/webm;codecs=opus';
      const blob = new Blob(this._audioRecorderChunks || [], { type: mimeType });
      this._audioRecorder = null;
      this._audioRecorderStream = null;
      this._audioRecorderChunks = [];

      const durationFromClock = Math.max(1, Math.round((Date.now() - (this._audioRecorderStartedAt || Date.now())) / 1000));
      const measured = await measureAudioDuration(blob);
      this.clearAudioRecorderPreview();
      this._audioRecorderBlob = blob;
      this.audioRecorderDurationSeconds = measured || durationFromClock;
      this.audioRecorderPreviewUrl = URL.createObjectURL(blob);
      await this.attachRecordedAudioDraft();
    },

    clearAudioRecorderPreview() {
      if (this.audioRecorderPreviewUrl) {
        URL.revokeObjectURL(this.audioRecorderPreviewUrl);
      }
      this.audioRecorderPreviewUrl = '';
      this._audioRecorderBlob = null;
    },

    closeAudioRecorder() {
      if (this._audioRecorder && this.audioRecorderState === 'recording') {
        try {
          this._audioRecorder.stop();
        } catch {}
      }
      this._audioRecorderStream?.getTracks?.().forEach((track) => track.stop());
      this._audioRecorder = null;
      this._audioRecorderStream = null;
      this._audioRecorderChunks = [];
      this.audioRecorderContext = null;
      this.audioRecorderState = 'idle';
      this.audioRecorderStatusLabel = '';
      this.audioRecorderError = null;
      this.audioRecorderDurationSeconds = 0;
      this.audioRecorderTitle = '';
      this.clearAudioRecorderPreview();
      this.showAudioRecorderModal = false;
    },

    async attachRecordedAudioDraft() {
      if (!this._audioRecorderBlob || !this.audioRecorderContext || !this.workspaceOwnerNpub) return;
      this.audioRecorderError = null;
      this.audioRecorderState = 'uploading';
      this.audioRecorderStatusLabel = 'Encrypting and uploading…';

      try {
        const encrypted = await encryptAudioBlob(this._audioRecorderBlob);
        const prepared = await prepareStorageObject({
          owner_npub: this.workspaceOwnerNpub,
          content_type: this._audioRecorderBlob.type || 'audio/webm;codecs=opus',
          size_bytes: encrypted.encryptedBytes.byteLength,
          file_name: `${(this.audioRecorderTitle || this.getAudioRecorderDefaultTitle()).replace(/[^a-zA-Z0-9._-]/g, '_')}.webm`,
        });
        await uploadStorageObject(
          prepared,
          encrypted.encryptedBytes,
          this._audioRecorderBlob.type || 'audio/webm;codecs=opus',
        );
        await completeStorageObject(prepared.object_id, {
          size_bytes: encrypted.encryptedBytes.byteLength,
        });

        const draft = {
          draft_id: crypto.randomUUID(),
          kind: 'audio',
          title: this.audioRecorderTitle || 'Voice note',
          storage_object_id: prepared.object_id,
          mime_type: this._audioRecorderBlob.type || 'audio/webm;codecs=opus',
          duration_seconds: this.audioRecorderDurationSeconds || null,
          size_bytes: encrypted.encryptedBytes.byteLength,
          media_encryption: encrypted.mediaEncryption,
          transcript_status: 'pending',
          transcript_preview: null,
        };
        const nextDrafts = [...this.getAudioDraftsForContext(this.audioRecorderContext), draft];
        this.setAudioDraftsForContext(this.audioRecorderContext, nextDrafts);
        this.closeAudioRecorder();
      } catch (error) {
        this.audioRecorderError = error?.message || 'Failed to upload voice note.';
        this.audioRecorderState = 'ready';
        this.audioRecorderStatusLabel = 'Upload failed. Retry upload when ready.';
      }
    },

    removeAudioDraft(context, draftId) {
      this.setAudioDraftsForContext(
        context,
        this.getAudioDraftsForContext(context).filter((draft) => draft.draft_id !== draftId),
      );
    },

    async materializeAudioDrafts({ drafts = [], target_record_id = null, target_record_family_hash = null, target_group_ids = [], write_group_npub = null }) {
      const audioNotes = [];
      const attachments = [];

      for (const draft of drafts) {
        const recordId = crypto.randomUUID();
        const now = new Date().toISOString();
        const localRow = {
          record_id: recordId,
          owner_npub: this.workspaceOwnerNpub,
          target_record_id,
          target_record_family_hash,
          title: draft.title || 'Voice note',
          storage_object_id: draft.storage_object_id,
          mime_type: draft.mime_type || 'audio/webm;codecs=opus',
          duration_seconds: draft.duration_seconds ?? null,
          size_bytes: draft.size_bytes ?? 0,
          media_encryption: draft.media_encryption,
          waveform_preview: draft.waveform_preview || [],
          transcript_status: draft.transcript_status || 'pending',
          transcript_preview: draft.transcript_preview || null,
          transcript: null,
          summary: null,
          sender_npub: this.session?.npub,
          group_ids: [...target_group_ids],
          sync_status: 'pending',
          record_state: 'active',
          version: 1,
          created_at: now,
          updated_at: now,
        };
        await upsertAudioNote(localRow);
        audioNotes.push(localRow);
        attachments.push({
          kind: 'audio',
          audio_note_record_id: recordId,
          title: localRow.title,
          duration_seconds: localRow.duration_seconds,
        });

        const envelope = await outboundAudioNote({
          ...localRow,
          target_group_ids,
          signature_npub: this.session?.npub,
          write_group_npub,
        });
        await addPendingWrite({
          record_id: recordId,
          record_family_hash: envelope.record_family_hash,
          envelope,
        });
      }

      if (audioNotes.length > 0) {
        this.audioNotes = [...this.audioNotes, ...audioNotes]
          .sort((a, b) => String(a.updated_at || '').localeCompare(String(b.updated_at || '')));
      }

      return { audioNotes, attachments };
    },

    async playAudioAttachment(attachment) {
      const note = this.getAudioAttachmentNote(attachment);
      if (!note?.storage_object_id || !note?.media_encryption) return;
      try {
        const encryptedBytes = await downloadStorageObject(note.storage_object_id);
        const blob = await decryptAudioBytes(encryptedBytes, note.media_encryption, note.mime_type);
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.onended = () => URL.revokeObjectURL(url);
        audio.onerror = () => URL.revokeObjectURL(url);
        await audio.play();
      } catch (error) {
        this.error = error?.message || 'Could not play voice note.';
      }
    },

    // --- messages ---

    async refreshMessages() {
      if (!this.selectedChannelId) {
        this.messages = [];
        this.activeThreadId = null;
        return;
      }
      this.messages = await getMessagesByChannel(this.selectedChannelId);
      for (const message of this.messages) {
        await this.rememberPeople([message.sender_npub], 'chat');
      }
      if (
        this.activeThreadId
        && !this.messages.some(msg => msg.record_id === this.activeThreadId || msg.parent_message_id === this.activeThreadId)
      ) {
        this.closeThread();
      }
      this.scheduleStorageImageHydration();
    },

    async refreshAudioNotes() {
      const ownerNpub = this.workspaceOwnerNpub;
      if (!ownerNpub) return;
      this.audioNotes = await getAudioNotesByOwner(ownerNpub);
      for (const note of this.audioNotes) {
        await this.rememberPeople([note.sender_npub], 'audio-note');
      }
    },

    patchMessageLocal(nextMessage) {
      const index = this.messages.findIndex((item) => item.record_id === nextMessage.record_id);
      if (index >= 0) {
        this.messages.splice(index, 1, { ...this.messages[index], ...nextMessage });
        this.scheduleStorageImageHydration();
        return;
      }
      this.messages = [...this.messages, nextMessage]
        .sort((a, b) => String(a.updated_at || '').localeCompare(String(b.updated_at || '')));
      this.scheduleStorageImageHydration();
    },

    async setMessageSyncStatus(recordId, syncStatus) {
      const message = this.messages.find((item) => item.record_id === recordId)
        ?? await getMessageById(recordId);
      if (!message) return;
      const updated = {
        ...message,
        sync_status: syncStatus,
      };
      await upsertMessage(updated);
      this.patchMessageLocal(updated);
    },

    async refreshDirectories() {
      const ownerNpub = this.workspaceOwnerNpub;
      if (!ownerNpub) return;
      this.directories = await getDirectoriesByOwner(ownerNpub);
    },

    async refreshDocuments() {
      const ownerNpub = this.workspaceOwnerNpub;
      if (!ownerNpub) return;
      this.documents = await getDocumentsByOwner(ownerNpub);
      this.refreshOpenDocFromLatestDocument({ force: false });
    },

    patchDirectoryLocal(nextDirectory) {
      const index = this.directories.findIndex((item) => item.record_id === nextDirectory.record_id);
      if (index >= 0) {
        this.directories.splice(index, 1, { ...this.directories[index], ...nextDirectory });
      } else {
        this.directories = [...this.directories, nextDirectory];
      }
    },

    patchDocumentLocal(nextDocument) {
      const index = this.documents.findIndex((item) => item.record_id === nextDocument.record_id);
      if (index >= 0) {
        this.documents.splice(index, 1, { ...this.documents[index], ...nextDocument });
      } else {
        this.documents = [...this.documents, nextDocument];
      }
      this.refreshOpenDocFromLatestDocument({ force: false });
    },

    canRefreshOpenDocFromLatestDocument() {
      if (!this.docsEditorOpen || this.selectedDocType !== 'document' || !this.selectedDocId) return false;
      if (this.docEditorMode !== 'preview') return false;
      if (this.docEditingTitle || this.docEditingBlockIndex >= 0) return false;
      if (this.docAutosaveState === 'pending' || this.docAutosaveState === 'saving') return false;
      return true;
    },

    refreshOpenDocFromLatestDocument(options = {}) {
      const force = options.force === true;
      if (!force && !this.canRefreshOpenDocFromLatestDocument()) return;
      const item = this.selectedDocument;
      if (!item) return;
      this.docEditorTitle = item.title ?? '';
      this.docEditorContent = item.content ?? '';
      this.docEditorShares = this.getEffectiveDocShares(item)
        .map((share) => ({ ...share }));
      this.docEditorSharesDirty = false;
      this.docEditorBlocks = parseMarkdownBlocks(this.docEditorContent);
      this.docEditingBlockIndex = -1;
      this.docBlockBuffer = '';
      this.docEditingTitle = false;
      this.docAutosaveState = 'saved';
      this.scheduleDocCommentConnectorUpdate();
      this.scheduleStorageImageHydration();
    },

    openThread(recordId, options = {}) {
      this.activeThreadId = recordId;
      this.threadInput = '';
      if (options.syncRoute !== false) this.syncRoute();
    },

    cycleThreadSize() {
      this.threadSize =
        this.threadSize === 'default'
          ? 'wide'
          : this.threadSize === 'wide'
            ? 'full'
            : 'default';
    },

    closeThread(options = {}) {
      this.activeThreadId = null;
      this.threadInput = '';
      this.threadSize = 'default';
      if (options.syncRoute !== false) this.syncRoute();
    },

    getThreadParentMessage() {
      if (!this.activeThreadId) return null;
      return this.messages.find(msg => msg.record_id === this.activeThreadId) ?? null;
    },

    getThreadReplyCount(recordId) {
      return this.messages.filter(msg => msg.parent_message_id === recordId).length;
    },

    getStatusRangeMs() {
      switch (this.statusTimeRange) {
        case '2h':
          return 2 * 60 * 60 * 1000;
        case '4h':
          return 4 * 60 * 60 * 1000;
        case '24h':
          return 24 * 60 * 60 * 1000;
        case '1h':
        default:
          return 60 * 60 * 1000;
      }
    },

    async refreshStatusRecentChanges() {
      const sinceIso = new Date(Date.now() - this.getStatusRangeMs()).toISOString();
      const messages = await getRecentChatMessagesSince(sinceIso);
      const documents = await getRecentDocumentChangesSince(sinceIso);
      const directories = await getRecentDirectoryChangesSince(sinceIso);
      const tasks = await getRecentTaskChangesSince(sinceIso);
      const comments = await getRecentCommentsSince(sinceIso);
      const items = [];

      for (const message of messages) {
        const channel = await getChannelById(message.channel_id);
        if (!channel || channel.record_state === 'deleted') continue;

        this.resolveChatProfile(message.sender_npub);

        items.push({
          id: message.record_id,
          section: 'chat',
          recordType: message.parent_message_id ? 'Thread' : 'Chat',
          title: message.body?.trim() || '(empty message)',
          subtitle: `${this.getSenderName(message.sender_npub)} in ${this.getChannelLabel(channel)}`,
          updatedAt: message.updated_at,
          updatedTs: Date.parse(message.updated_at) || 0,
          channelId: message.channel_id,
          threadId: message.parent_message_id || null,
          recordId: message.record_id,
          focusRecordId: message.record_id,
        });
      }

      for (const directory of directories) {
        items.push({
          id: `directory:${directory.record_id}`,
          section: 'docs',
          recordType: 'Folder',
          title: directory.title?.trim() || 'Untitled folder',
          subtitle: directory.parent_directory_id
            ? `Updated in ${this.getDocItemLocationLabel(directory)}`
            : 'Updated in Root',
          updatedAt: directory.updated_at,
          updatedTs: Date.parse(directory.updated_at) || 0,
          recordId: directory.record_id,
          docType: 'directory',
        });
      }

      for (const document of documents) {
        items.push({
          id: `document:${document.record_id}`,
          section: 'docs',
          recordType: 'Doc',
          title: document.title?.trim() || 'Untitled document',
          subtitle: document.parent_directory_id
            ? `Updated in ${this.getDocItemLocationLabel(document)}`
            : 'Updated in Root',
          updatedAt: document.updated_at,
          updatedTs: Date.parse(document.updated_at) || 0,
          recordId: document.record_id,
          docType: 'document',
        });
      }

      for (const task of tasks) {
        items.push({
          id: `task:${task.record_id}:${task.version ?? 1}`,
          section: 'tasks',
          recordType: 'Task',
          title: task.title?.trim() || 'Untitled task',
          subtitle: task.board_group_id
            ? `Updated on ${this.getTaskBoardLabel(task.board_group_id)}`
            : 'Updated on board',
          updatedAt: task.updated_at,
          updatedTs: Date.parse(task.updated_at) || 0,
          recordId: task.record_id,
          boardGroupId: task.board_group_id ?? null,
        });
      }

      for (const comment of comments) {
        if (!String(comment.target_record_family_hash || '').endsWith(':task')) continue;
        const task = await getTaskById(comment.target_record_id);
        if (!task || task.record_state === 'deleted') continue;

        this.resolveChatProfile(comment.sender_npub);

        items.push({
          id: `task-comment:${comment.record_id}`,
          section: 'tasks',
          recordType: 'Task note',
          title: comment.body?.trim() || '(empty note)',
          subtitle: `${this.getSenderName(comment.sender_npub)} on ${task.title?.trim() || 'Untitled task'}`,
          updatedAt: comment.updated_at,
          updatedTs: Date.parse(comment.updated_at) || 0,
          recordId: task.record_id,
          focusRecordId: comment.record_id,
          boardGroupId: task.board_group_id ?? null,
        });
      }

      this.statusRecentChanges = items.sort((a, b) => b.updatedTs - a.updatedTs);
    },

    formatRelativeTime(iso) {
      if (!iso) return '';
      const ts = Date.parse(iso);
      if (!Number.isFinite(ts)) return '';
      const diffSec = Math.max(1, Math.floor((Date.now() - ts) / 1000));
      if (diffSec < 60) return `${diffSec}s ago`;
      if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
      if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
      return `${Math.floor(diffSec / 86400)}d ago`;
    },

    async openStatusChange(item) {
      if (!item) return;
      if (item.section === 'docs') {
        this.navSection = 'docs';
        this.mobileNavOpen = false;
        if (item.docType === 'directory') {
          this.navigateToFolder(item.recordId);
        } else if (item.recordId) {
          this.openDoc(item.recordId);
        }
        return;
      }
      if (item.section === 'tasks') {
        this.navSection = 'tasks';
        this.mobileNavOpen = false;
        this.selectedBoardId = item.boardGroupId ?? null;
        this.persistSelectedBoardId(this.selectedBoardId);
        this.normalizeTaskFilterTags();
        if (item.recordId) {
          this.openTaskDetail(item.recordId);
        } else {
          this.syncRoute();
        }
        return;
      }
      if (item.section !== 'chat') return;
      this.focusMessageId = item.focusRecordId ?? item.recordId ?? null;
      this.navSection = 'chat';
      this.mobileNavOpen = false;
      if (item.channelId) {
        await this.selectChannel(item.channelId);
      }
      if (item.threadId) {
        this.openThread(item.threadId);
      } else {
        this.closeThread();
      }
    },

    isFocusedMessage(recordId) {
      return this.focusMessageId === recordId;
    },

    getCachedPerson(npub) {
      if (!npub) return null;
      return this.addressBookPeople.find((person) => person.npub === npub) ?? null;
    },

    getSenderName(npub) {
      if (!npub) return 'Unknown';
      const cached = this.getCachedPerson(npub);
      return this.chatProfiles[npub]?.name || cached?.label || this.getShortNpub(npub);
    },

    getShortNpub(npub) {
      const value = String(npub || '');
      if (value.length <= 13) return value;
      return `${value.slice(0, 7)}...${value.slice(-6)}`;
    },

    getSenderIdentity(npub) {
      if (!npub) return '';
      const cached = this.getCachedPerson(npub);
      if (this.chatProfiles[npub]?.nip05) return this.chatProfiles[npub].nip05;
      if (this.chatProfiles[npub]?.name || cached?.label) return this.getShortNpub(npub);
      return '';
    },

    getSenderAvatar(npub) {
      if (!npub) return null;
      const cached = this.getCachedPerson(npub);
      return this.chatProfiles[npub]?.picture || cached?.avatar_url || null;
    },

    getInitials(label) {
      const cleaned = String(label || '').trim();
      if (!cleaned) return '?';
      const parts = cleaned.split(/\s+/).filter(Boolean);
      if (parts.length >= 2) {
        return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
      }
      return cleaned.slice(0, 2).toUpperCase();
    },

    getChannelLabel(channel) {
      if (!channel) return '';
      const participants = this.getChannelParticipants(channel);
      const others = participants.filter((npub) => npub !== this.session?.npub);
      if (others.length === 1) return this.getSenderName(others[0]);
      if (others.length > 1) {
        return others.map((npub) => this.getSenderName(npub)).join(', ');
      }
      return channel.title || channel.record_id.slice(0, 8);
    },

    getChannelParticipants(channel) {
      if (!channel) return [];
      const direct = Array.isArray(channel.participant_npubs)
        ? channel.participant_npubs.filter(Boolean)
        : [];
      if (direct.length > 1) return [...new Set(direct)];

      const derived = new Set(direct);
      for (const groupId of channel.group_ids ?? []) {
        const group = this.groups.find((candidate) =>
          candidate.group_npub === groupId || candidate.group_id === groupId
        );
        for (const member of group?.member_npubs ?? []) {
          derived.add(member);
        }
      }
      return [...derived];
    },

    async rememberPeople(npubs = [], source = 'unknown') {
      for (const npub of [...new Set(npubs.filter(Boolean))]) {
        await upsertAddressBookPerson({
          npub,
          label: this.chatProfiles[npub]?.name ?? null,
          avatar_url: this.chatProfiles[npub]?.picture ?? null,
          source,
          last_used_at: new Date().toISOString(),
        });
        this.resolveChatProfile(npub);
      }
      this.addressBookPeople = await getAddressBookPeople();
    },

    resolveChatProfile(npub) {
      if (!npub || this.chatProfiles[npub]?.loading) return;
      if (this.chatProfiles[npub]?.name || this.chatProfiles[npub]?.picture) return;

      this.chatProfiles = {
        ...this.chatProfiles,
        [npub]: {
          name: null,
          picture: null,
          nip05: null,
          loading: true,
        },
      };

      fetchProfileByNpub(npub)
        .then((profile) => {
          this.chatProfiles = {
            ...this.chatProfiles,
            [npub]: {
              name: profile?.display_name || profile?.name || null,
              picture: profile?.picture || null,
              nip05: profile?.nip05 || null,
              loading: false,
            },
          };
          upsertAddressBookPerson({
            npub,
            label: profile?.display_name || profile?.name || null,
            avatar_url: profile?.picture || null,
            source: 'profile',
            last_used_at: new Date().toISOString(),
          }).then(() => this.refreshAddressBook());
        })
        .catch(() => {
          this.chatProfiles = {
            ...this.chatProfiles,
            [npub]: {
              name: null,
              picture: null,
              nip05: null,
              loading: false,
            },
          };
        });
    },

    // --- tasks ---

    async refreshTasks() {
      const ownerNpub = this.workspaceOwnerNpub;
      if (!ownerNpub) return;
      this.tasks = await getTasksByOwner(ownerNpub);
      this.normalizeTaskFilterTags();
    },

    async addTask() {
      const title = String(this.newTaskTitle || '').trim();
      if (!title || !this.session?.npub) return;
      const now = new Date().toISOString();
      const recordId = crypto.randomUUID();
      const ownerNpub = this.workspaceOwnerNpub;
      const boardId = this.selectedBoardId || this.memberPrivateGroupNpub || null;

      const localRow = {
        record_id: recordId,
        owner_npub: ownerNpub,
        title,
        description: '',
        state: 'new',
        priority: 'sand',
        parent_task_id: null,
        board_group_id: boardId,
        scheduled_for: null,
        tags: '',
        shares: boardId ? [boardId] : [],
        group_ids: boardId ? [boardId] : [],
        sync_status: 'pending',
        record_state: 'active',
        version: 1,
        created_at: now,
        updated_at: now,
      };

      await upsertTask(localRow);
      this.tasks = [...this.tasks, localRow];
      this.newTaskTitle = '';

      const envelope = await outboundTask({
        ...localRow,
        signature_npub: this.session.npub,
        write_group_npub: boardId,
      });
      await addPendingWrite({
        record_id: recordId,
        record_family_hash: envelope.record_family_hash,
        envelope,
      });
      await this.performSync({ silent: false });
      await this.refreshTasks();
    },

    async addSubtask(parentId) {
      const title = String(this.newSubtaskTitle || '').trim();
      if (!title || !this.session?.npub) return;

      const parent = this.tasks.find(t => t.record_id === parentId);
      if (parent && parent.parent_task_id) {
        this.error = 'Cannot nest subtasks more than one level deep.';
        return;
      }

      const now = new Date().toISOString();
      const recordId = crypto.randomUUID();
      const ownerNpub = this.workspaceOwnerNpub;

      const localRow = {
        record_id: recordId,
        owner_npub: ownerNpub,
        title,
        description: '',
        state: 'new',
        priority: 'sand',
        parent_task_id: parentId,
        board_group_id: parent?.board_group_id ?? null,
        scheduled_for: null,
        tags: '',
        shares: toRaw(parent?.shares ?? []),
        group_ids: toRaw(parent?.group_ids ?? []),
        sync_status: 'pending',
        record_state: 'active',
        version: 1,
        created_at: now,
        updated_at: now,
      };

      await upsertTask(localRow);
      this.tasks = [...this.tasks, localRow];
      this.newSubtaskTitle = '';

      const envelope = await outboundTask({
        ...localRow,
        signature_npub: this.session.npub,
        write_group_npub: localRow.board_group_id || localRow.group_ids?.[0] || null,
      });
      await addPendingWrite({
        record_id: recordId,
        record_family_hash: envelope.record_family_hash,
        envelope,
      });
      await this.performSync({ silent: false });
      await this.refreshTasks();
    },

    async updateTaskField(taskId, field, value) {
      const task = this.tasks.find(t => t.record_id === taskId);
      if (!task || !this.session?.npub) return;

      const nextVersion = (task.version ?? 1) + 1;
      const updated = toRaw({
        ...task,
        [field]: value,
        version: nextVersion,
        sync_status: 'pending',
        updated_at: new Date().toISOString(),
      });

      await upsertTask(updated);
      this.tasks = this.tasks.map(t => t.record_id === taskId ? updated : t);

      if (this.editingTask?.record_id === taskId) {
        this.editingTask = { ...updated };
      }

      const envelope = await outboundTask({
        ...updated,
        previous_version: task.version ?? 1,
        signature_npub: this.session.npub,
        write_group_npub: updated.board_group_id || updated.group_ids?.[0] || null,
      });
      await addPendingWrite({
        record_id: taskId,
        record_family_hash: envelope.record_family_hash,
        envelope,
      });
      await this.performSync({ silent: true });
    },

    async saveEditingTask() {
      if (!this.editingTask || !this.session?.npub) return;
      if (this.containsInlineImageUploadToken(this.editingTask.description)) {
        this.error = 'Wait for image upload to finish.';
        return;
      }
      const task = this.tasks.find(t => t.record_id === this.editingTask.record_id);
      if (!task) return;

      const nextVersion = (task.version ?? 1) + 1;
      const updated = toRaw({
        ...task,
        title: this.editingTask.title,
        description: this.editingTask.description,
        state: this.editingTask.state,
        priority: this.editingTask.priority,
        scheduled_for: this.editingTask.scheduled_for,
        tags: this.editingTask.tags,
        scope_id: this.editingTask.scope_id ?? null,
        scope_product_id: this.editingTask.scope_product_id ?? null,
        scope_project_id: this.editingTask.scope_project_id ?? null,
        scope_deliverable_id: this.editingTask.scope_deliverable_id ?? null,
        version: nextVersion,
        sync_status: 'pending',
        updated_at: new Date().toISOString(),
      });

      await upsertTask(updated);
      this.tasks = this.tasks.map(t => t.record_id === updated.record_id ? updated : t);
      if (this.activeTaskId === updated.record_id) this.scheduleStorageImageHydration();

      const envelope = await outboundTask({
        ...updated,
        previous_version: task.version ?? 1,
        signature_npub: this.session.npub,
        write_group_npub: updated.board_group_id || updated.group_ids?.[0] || null,
      });
      await addPendingWrite({
        record_id: updated.record_id,
        record_family_hash: envelope.record_family_hash,
        envelope,
      });
      await this.performSync({ silent: true });
      await this.refreshTasks();
    },

    async deleteTask(taskId) {
      const task = this.tasks.find(t => t.record_id === taskId);
      if (!task || !this.session?.npub) return;

      const nextVersion = (task.version ?? 1) + 1;
      const updated = toRaw({
        ...task,
        record_state: 'deleted',
        version: nextVersion,
        sync_status: 'pending',
        updated_at: new Date().toISOString(),
      });

      await upsertTask(updated);
      this.tasks = this.tasks.filter(t => t.record_id !== taskId);

      if (this.activeTaskId === taskId) {
        this.closeTaskDetail();
      }

      const envelope = await outboundTask({
        ...updated,
        previous_version: task.version ?? 1,
        signature_npub: this.session.npub,
        record_state: 'deleted',
        write_group_npub: updated.board_group_id || updated.group_ids?.[0] || null,
      });
      await addPendingWrite({
        record_id: taskId,
        record_family_hash: envelope.record_family_hash,
        envelope,
      });
      await this.performSync({ silent: false });
    },

    openTaskDetail(taskId) {
      this.activeTaskId = taskId;
      const task = this.tasks.find(t => t.record_id === taskId);
      this.editingTask = task ? toRaw(task) : null;
      this.showTaskDetail = true;
      this.newSubtaskTitle = '';
      this.newTaskCommentBody = '';
      this.loadTaskComments(taskId);
      this.scheduleStorageImageHydration();
      this.syncRoute();
    },

    closeTaskDetail() {
      this.activeTaskId = null;
      this.editingTask = null;
      this.showTaskDetail = false;
      this.taskComments = [];
      this.syncRoute();
    },

    buildTaskUrl(taskId) {
      if (typeof window === 'undefined') return '';
      const url = new URL(window.location.href);
      url.pathname = '/tasks';
      url.search = '';
      const task = this.tasks.find((item) => item.record_id === taskId);
      const groupId = task?.board_group_id ?? this.selectedBoardId ?? null;
      if (groupId) url.searchParams.set('groups', groupId);
      if (taskId) url.searchParams.set('taskid', taskId);
      return url.toString();
    },

    async copyTaskLink(taskId) {
      if (!taskId || typeof window === 'undefined') return;
      const url = this.buildTaskUrl(taskId);
      try {
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(url);
        } else {
          const input = document.createElement('input');
          input.value = url;
          document.body.appendChild(input);
          input.select();
          document.execCommand('copy');
          input.remove();
        }
        this.copiedTaskLinkId = taskId;
        window.setTimeout(() => {
          if (this.copiedTaskLinkId === taskId) this.copiedTaskLinkId = null;
        }, 1800);
      } catch {
        this.error = 'Could not copy task link.';
      }
    },

    async loadTaskComments(taskId) {
      if (!taskId) { this.taskComments = []; return; }
      this.taskComments = await getCommentsByTarget(taskId);
      this.scheduleStorageImageHydration();
    },

    async addTaskComment(taskId) {
      const body = String(this.newTaskCommentBody || '').trim();
      const drafts = [...this.taskCommentAudioDrafts];
      if (this.containsInlineImageUploadToken(body)) {
        this.error = 'Wait for image upload to finish.';
        return;
      }
      if ((!body && drafts.length === 0) || !taskId || !this.session?.npub) return;

      const task = this.tasks.find(t => t.record_id === taskId);
      const now = new Date().toISOString();
      const recordId = crypto.randomUUID();
      const ownerNpub = this.workspaceOwnerNpub;
      const { attachments } = await this.materializeAudioDrafts({
        drafts,
        target_record_id: recordId,
        target_record_family_hash: recordFamilyHash('comment'),
        target_group_ids: toRaw(task?.group_ids ?? []),
        write_group_npub: task?.board_group_id || task?.group_ids?.[0] || null,
      });

      const localRow = {
        record_id: recordId,
        owner_npub: ownerNpub,
        target_record_id: taskId,
        target_record_family_hash: taskFamilyHash('task'),
        parent_comment_id: null,
        body,
        attachments,
        sender_npub: this.session.npub,
        record_state: 'active',
        version: 1,
        created_at: now,
        updated_at: now,
      };

      await upsertComment(localRow);
      this.taskComments = [...this.taskComments, localRow];
      this.newTaskCommentBody = '';
      this.taskCommentAudioDrafts = [];
      this.scheduleStorageImageHydration();

      const envelope = await outboundComment({
        ...localRow,
        target_group_ids: toRaw(task?.group_ids ?? []),
        signature_npub: this.session.npub,
        write_group_npub: task?.board_group_id || task?.group_ids?.[0] || null,
      });
      await addPendingWrite({
        record_id: recordId,
        record_family_hash: envelope.record_family_hash,
        envelope,
      });
      await this.performSync({ silent: true });
    },

    // --- scopes ---

    async refreshScopes() {
      const ownerNpub = this.workspaceOwnerNpub;
      if (!ownerNpub) return;
      this.scopes = await getScopesByOwner(ownerNpub);
    },

    get scopesMap() {
      const m = new Map();
      for (const s of this.scopes) m.set(s.record_id, s);
      return m;
    },

    get scopeTree() {
      const products = this.scopes.filter(s => s.level === 'product' && s.record_state !== 'deleted');
      return products.map(p => ({
        ...p,
        projects: this.scopes
          .filter(s => s.level === 'project' && s.parent_id === p.record_id && s.record_state !== 'deleted')
          .map(proj => ({
            ...proj,
            deliverables: this.scopes.filter(s => s.level === 'deliverable' && s.parent_id === proj.record_id && s.record_state !== 'deleted'),
          })),
      }));
    },

    get scopePickerResults() {
      return searchScopes(this.scopePickerQuery, this.scopes, this.scopesMap);
    },

    scopeLevelLabel(level) {
      return levelLabel(level);
    },

    getScopeBreadcrumb(scopeId) {
      return scopeBreadcrumb(scopeId, this.scopesMap);
    },

    getScopeLabel(scopeId) {
      const scope = this.scopesMap.get(scopeId);
      return scope ? scope.title : '';
    },

    openScopePicker() {
      this.scopePickerQuery = '';
      this.showScopePicker = true;
      this.showNewScopeForm = false;
    },

    closeScopePicker() {
      this.showScopePicker = false;
      this.scopePickerQuery = '';
      this.showNewScopeForm = false;
    },

    async selectScopeForTask(scopeId) {
      if (!this.editingTask || !this.session?.npub) return;
      const chain = resolveScopeChain(scopeId, this.scopesMap);
      this.editingTask.scope_id = scopeId;
      this.editingTask.scope_product_id = chain.scope_product_id;
      this.editingTask.scope_project_id = chain.scope_project_id;
      this.editingTask.scope_deliverable_id = chain.scope_deliverable_id;
      this.closeScopePicker();
      await this.saveEditingTask();
    },

    async clearTaskScope() {
      if (!this.editingTask || !this.session?.npub) return;
      this.editingTask.scope_id = null;
      this.editingTask.scope_product_id = null;
      this.editingTask.scope_project_id = null;
      this.editingTask.scope_deliverable_id = null;
      this.closeScopePicker();
      await this.saveEditingTask();
    },

    async selectScopeForDoc(scopeId) {
      const doc = this.selectedDocument;
      if (!doc || !this.session?.npub) return;
      const chain = resolveScopeChain(scopeId, this.scopesMap);
      const updated = {
        ...doc,
        scope_id: scopeId,
        scope_product_id: chain.scope_product_id,
        scope_project_id: chain.scope_project_id,
        scope_deliverable_id: chain.scope_deliverable_id,
      };
      this.patchDocumentLocal(updated);
      await upsertDocument(updated);
      this.closeScopePicker();
      await this._pushDocScopeUpdate(updated);
    },

    async clearDocScope() {
      const doc = this.selectedDocument;
      if (!doc || !this.session?.npub) return;
      const updated = {
        ...doc,
        scope_id: null,
        scope_product_id: null,
        scope_project_id: null,
        scope_deliverable_id: null,
      };
      this.patchDocumentLocal(updated);
      await upsertDocument(updated);
      this.closeScopePicker();
      await this._pushDocScopeUpdate(updated);
    },

    async _pushDocScopeUpdate(doc) {
      const ownerNpub = this.workspaceOwnerNpub;
      const nextVersion = (doc.version ?? 1) + 1;
      const updated = toRaw({
        ...doc,
        version: nextVersion,
        sync_status: 'pending',
        updated_at: new Date().toISOString(),
      });
      await upsertDocument(updated);
      this.patchDocumentLocal(updated);
      const envelope = await outboundDocument({
        ...updated,
        previous_version: doc.version ?? 1,
        signature_npub: this.session.npub,
        write_group_npub: updated.group_ids?.[0] || null,
      });
      await addPendingWrite({
        record_id: updated.record_id,
        record_family_hash: envelope.record_family_hash,
        envelope,
      });
      await this.performSync({ silent: true });
    },

    async selectScopeForChannel(scopeId) {
      const ch = this.selectedChannel;
      if (!ch || !this.session?.npub) return;
      const chain = resolveScopeChain(scopeId, this.scopesMap);
      const updated = toRaw({
        ...ch,
        scope_id: scopeId,
        scope_product_id: chain.scope_product_id,
        scope_project_id: chain.scope_project_id,
        scope_deliverable_id: chain.scope_deliverable_id,
      });
      await upsertChannel(updated);
      this.channels = this.channels.map(c => c.record_id === updated.record_id ? updated : c);
      this.closeScopePicker();
      await this._pushChannelScopeUpdate(updated);
    },

    async clearChannelScope() {
      const ch = this.selectedChannel;
      if (!ch || !this.session?.npub) return;
      const updated = toRaw({
        ...ch,
        scope_id: null,
        scope_product_id: null,
        scope_project_id: null,
        scope_deliverable_id: null,
      });
      await upsertChannel(updated);
      this.channels = this.channels.map(c => c.record_id === updated.record_id ? updated : c);
      this.closeScopePicker();
      await this._pushChannelScopeUpdate(updated);
    },

    async _pushChannelScopeUpdate(ch) {
      const nextVersion = (ch.version ?? 1) + 1;
      const updated = toRaw({
        ...ch,
        version: nextVersion,
        sync_status: 'pending',
        updated_at: new Date().toISOString(),
      });
      await upsertChannel(updated);
      this.channels = this.channels.map(c => c.record_id === updated.record_id ? updated : c);
      const envelope = await outboundChannel({
        ...updated,
        previous_version: ch.version ?? 1,
        signature_npub: this.session.npub,
        write_group_npub: updated.group_ids?.[0] || null,
      });
      await addPendingWrite({
        record_id: updated.record_id,
        record_family_hash: envelope.record_family_hash,
        envelope,
      });
      await this.performSync({ silent: true });
    },

    async addScope() {
      const title = String(this.newScopeTitle || '').trim();
      if (!title || !this.session?.npub) return;

      const now = new Date().toISOString();
      const recordId = crypto.randomUUID();
      const ownerNpub = this.workspaceOwnerNpub;
      const level = this.newScopeLevel;
      const parentId = this.newScopeParentId || null;

      let productId = null;
      let projectId = null;

      if (level === 'project' && parentId) {
        productId = parentId;
      } else if (level === 'deliverable' && parentId) {
        const parentScope = this.scopesMap.get(parentId);
        projectId = parentId;
        productId = parentScope?.product_id || parentScope?.parent_id || null;
      }

      const groupNpub = this.memberPrivateGroupNpub || null;
      const groupIds = groupNpub ? [groupNpub] : [];

      const localRow = {
        record_id: recordId,
        owner_npub: ownerNpub,
        title,
        description: this.newScopeDescription || '',
        level,
        parent_id: parentId,
        product_id: productId,
        project_id: projectId,
        group_ids: groupIds,
        sync_status: 'pending',
        record_state: 'active',
        version: 1,
        created_at: now,
        updated_at: now,
      };

      await upsertScope(localRow);
      this.scopes = [...this.scopes, localRow];
      this.newScopeTitle = '';
      this.newScopeDescription = '';
      this.newScopeLevel = 'product';
      this.newScopeParentId = null;
      this.showNewScopeForm = false;

      const envelope = await outboundScope({
        ...localRow,
        signature_npub: this.session.npub,
        write_group_npub: groupNpub,
      });
      await addPendingWrite({
        record_id: recordId,
        record_family_hash: envelope.record_family_hash,
        envelope,
      });
      await this.performSync({ silent: false });
      await this.refreshScopes();
    },

    startNewScope(level = 'product', parentId = null) {
      this.newScopeLevel = level;
      this.newScopeParentId = parentId;
      this.newScopeTitle = '';
      this.newScopeDescription = '';
      this.showNewScopeForm = true;
    },

    cancelNewScope() {
      this.showNewScopeForm = false;
      this.newScopeTitle = '';
      this.newScopeDescription = '';
    },

    startEditScope(scopeId) {
      const scope = this.scopesMap.get(scopeId);
      if (!scope) return;
      this.editingScopeId = scopeId;
      this.editingScopeTitle = scope.title;
      this.editingScopeDescription = scope.description || '';
    },

    cancelEditScope() {
      this.editingScopeId = null;
      this.editingScopeTitle = '';
      this.editingScopeDescription = '';
    },

    async saveEditScope() {
      if (!this.editingScopeId || !this.session?.npub) return;
      const scope = this.scopes.find(s => s.record_id === this.editingScopeId);
      if (!scope) return;

      const nextVersion = (scope.version ?? 1) + 1;
      const updated = toRaw({
        ...scope,
        title: this.editingScopeTitle,
        description: this.editingScopeDescription,
        version: nextVersion,
        sync_status: 'pending',
        updated_at: new Date().toISOString(),
      });

      await upsertScope(updated);
      this.scopes = this.scopes.map(s => s.record_id === updated.record_id ? updated : s);
      this.editingScopeId = null;
      this.editingScopeTitle = '';
      this.editingScopeDescription = '';

      const envelope = await outboundScope({
        ...updated,
        previous_version: scope.version ?? 1,
        signature_npub: this.session.npub,
        write_group_npub: updated.group_ids?.[0] || null,
      });
      await addPendingWrite({
        record_id: updated.record_id,
        record_family_hash: envelope.record_family_hash,
        envelope,
      });
      await this.performSync({ silent: true });
    },

    async deleteScope(scopeId) {
      const scope = this.scopes.find(s => s.record_id === scopeId);
      if (!scope || !this.session?.npub) return;

      const nextVersion = (scope.version ?? 1) + 1;
      const updated = toRaw({
        ...scope,
        record_state: 'deleted',
        version: nextVersion,
        sync_status: 'pending',
        updated_at: new Date().toISOString(),
      });

      await upsertScope(updated);
      this.scopes = this.scopes.filter(s => s.record_id !== scopeId);

      const envelope = await outboundScope({
        ...updated,
        previous_version: scope.version ?? 1,
        signature_npub: this.session.npub,
        record_state: 'deleted',
        write_group_npub: updated.group_ids?.[0] || null,
      });
      await addPendingWrite({
        record_id: scopeId,
        record_family_hash: envelope.record_family_hash,
        envelope,
      });
      await this.performSync({ silent: false });
    },

    getAvailableParents(level) {
      if (level === 'product') return [];
      if (level === 'project') return this.scopes.filter(s => s.level === 'product' && s.record_state !== 'deleted');
      if (level === 'deliverable') return this.scopes.filter(s => s.level === 'project' && s.record_state !== 'deleted');
      return [];
    },

    // task board drag-drop

    handleTaskDragStart(e, taskId) {
      if (this.isParentTask(taskId)) {
        e.preventDefault();
        return;
      }
      this._dragTaskId = taskId;
      this._taskWasDragged = true;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', taskId);
      e.target.classList.add('dragging');
    },

    handleTaskDragEnd(e) {
      this._dragTaskId = null;
      e.target.classList.remove('dragging');
      document.querySelectorAll('.kanban-column-body.drag-over').forEach(el => el.classList.remove('drag-over'));
    },

    handleTaskDragOver(e, targetState) {
      e.dataTransfer.dropEffect = 'move';
      e.currentTarget.classList.add('drag-over');
    },

    handleTaskDragLeave(e) {
      if (!e.currentTarget.contains(e.relatedTarget)) {
        e.currentTarget.classList.remove('drag-over');
      }
    },

    async handleTaskDrop(e, targetState) {
      e.currentTarget.classList.remove('drag-over');
      if (targetState === 'summary') return;
      const taskId = e.dataTransfer.getData('text/plain');
      if (!taskId) return;
      const task = this.tasks.find(t => t.record_id === taskId);
      if (!task || task.state === targetState) return;
      if (this.isParentTask(taskId)) return;
      await this.updateTaskField(taskId, 'state', targetState);
    },

    handleTaskCardClick(taskId) {
      if (this._taskWasDragged) {
        this._taskWasDragged = false;
        return;
      }
      this.openTaskDetail(taskId);
    },

    toggleTaskFilterTag(tag) {
      const idx = this.taskFilterTags.indexOf(tag);
      if (idx >= 0) {
        this.taskFilterTags = this.taskFilterTags.filter((_, i) => i !== idx);
      } else {
        this.taskFilterTags = [...this.taskFilterTags, tag];
      }
    },

    clearTaskFilters() {
      this.taskFilter = '';
      this.taskFilterTags = [];
    },

    async moveTaskToBoard(taskId, boardGroupId) {
      const task = this.tasks.find(t => t.record_id === taskId);
      if (!task || !this.session?.npub) return;

      const newBoardId = boardGroupId || this.memberPrivateGroupNpub || null;
      const newShares = newBoardId ? [newBoardId] : [];
      const newGroupIds = newBoardId ? [newBoardId] : [];
      const nextVersion = (task.version ?? 1) + 1;

      const updated = toRaw({
        ...task,
        board_group_id: newBoardId,
        shares: newShares,
        group_ids: newGroupIds,
        version: nextVersion,
        sync_status: 'pending',
        updated_at: new Date().toISOString(),
      });

      await upsertTask(updated);
      this.tasks = this.tasks.map(t => t.record_id === taskId ? updated : t);

      if (this.editingTask?.record_id === taskId) {
        this.editingTask = { ...updated };
      }

      // Move subtasks along with parent
      const subtasks = this.tasks.filter(t => t.parent_task_id === taskId && t.record_state !== 'deleted');
      for (const sub of subtasks) {
        const subVersion = (sub.version ?? 1) + 1;
        const subUpdated = toRaw({
          ...sub,
          board_group_id: newBoardId,
          shares: newShares,
          group_ids: newGroupIds,
          version: subVersion,
          sync_status: 'pending',
          updated_at: new Date().toISOString(),
        });
        await upsertTask(subUpdated);
        this.tasks = this.tasks.map(t => t.record_id === sub.record_id ? subUpdated : t);

        const subEnvelope = await outboundTask({
          ...subUpdated,
          previous_version: sub.version ?? 1,
          signature_npub: this.session.npub,
          write_group_npub: newBoardId,
        });
        await addPendingWrite({
          record_id: sub.record_id,
          record_family_hash: subEnvelope.record_family_hash,
          envelope: subEnvelope,
        });
      }

      const envelope = await outboundTask({
        ...updated,
        previous_version: task.version ?? 1,
        signature_npub: this.session.npub,
        write_group_npub: newBoardId,
      });
      await addPendingWrite({
        record_id: taskId,
        record_family_hash: envelope.record_family_hash,
        envelope,
      });
      await this.performSync({ silent: true });
      await this.refreshTasks();
    },

    // docs browser drag-drop

    handleDocBrowserRowClick(type, recordId) {
      if (this._docBrowserWasDragged) {
        this._docBrowserWasDragged = false;
        return;
      }
      this.selectDocItem(type, recordId);
    },

    handleDocItemDragStart(event, type, recordId) {
      this._dragDocBrowserItem = {
        type,
        recordId,
        sourceParentId: type === 'directory'
          ? (this.directories.find((item) => item.record_id === recordId)?.parent_directory_id ?? null)
          : (this.documents.find((item) => item.record_id === recordId)?.parent_directory_id ?? null),
      };
      this._docBrowserWasDragged = true;
      this.docBrowserDropTarget = '';
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', `${type}:${recordId}`);
      event.currentTarget.classList.add('dragging');
    },

    handleDocItemDragEnd(event) {
      this._dragDocBrowserItem = null;
      this.docBrowserDropTarget = '';
      event.currentTarget.classList.remove('dragging');
      setTimeout(() => {
        this._docBrowserWasDragged = false;
      }, 0);
    },

    canMoveDocItemToFolder(dragItem, targetFolderId) {
      if (!dragItem?.recordId || (dragItem.type !== 'document' && dragItem.type !== 'directory')) return false;
      if ((dragItem.sourceParentId ?? null) === (targetFolderId ?? null)) return false;
      if (dragItem.type !== 'directory') return true;
      if (dragItem.recordId === targetFolderId) return false;

      let cursor = targetFolderId;
      while (cursor) {
        if (cursor === dragItem.recordId) return false;
        const folder = this.directories.find((item) => item.record_id === cursor);
        cursor = folder?.parent_directory_id || null;
      }
      return true;
    },

    handleDocItemDragOver(event, targetFolderId, targetKey = '') {
      if (!this.canMoveDocItemToFolder(this._dragDocBrowserItem, targetFolderId)) return;
      event.dataTransfer.dropEffect = 'move';
      this.docBrowserDropTarget = targetKey;
    },

    handleDocItemDragLeave(event, targetKey = '') {
      if (event.currentTarget.contains(event.relatedTarget)) return;
      if (this.docBrowserDropTarget === targetKey) {
        this.docBrowserDropTarget = '';
      }
    },

    async handleDocItemDrop(event, targetFolderId, targetKey = '') {
      if (this.docBrowserDropTarget === targetKey) {
        this.docBrowserDropTarget = '';
      }
      const dragItem = this._dragDocBrowserItem;
      if (!this.canMoveDocItemToFolder(dragItem, targetFolderId)) return;
      await this.moveDocItemToFolder(dragItem.type, dragItem.recordId, targetFolderId);
    },

    async moveDocItemToFolder(type, recordId, targetFolderId = null) {
      const ownerNpub = this.workspaceOwnerNpub;
      if (!ownerNpub || !this.session?.npub) {
        this.error = 'Sign in first';
        return;
      }

      const isDirectory = type === 'directory';
      const item = isDirectory
        ? this.directories.find((entry) => entry.record_id === recordId)
        : this.documents.find((entry) => entry.record_id === recordId);
      if (!item) return;

      const explicitShares = this.getExplicitDocShares(item);
      const inheritedShares = targetFolderId ? this.getInheritedDirectoryShares(targetFolderId) : [];
      let shares = this.mergeDocShareLists(explicitShares, inheritedShares);
      if (shares.length === 0) shares = this.getDefaultPrivateShares();
      const groupIds = this.getShareGroupIds(shares);
      const nextVersion = (item.version ?? 1) + 1;
      const updated = {
        ...item,
        parent_directory_id: targetFolderId,
        shares,
        group_ids: groupIds,
        sync_status: 'pending',
        version: nextVersion,
        updated_at: new Date().toISOString(),
      };

      if (isDirectory) {
        await upsertDirectory(updated);
        this.patchDirectoryLocal(updated);
      } else {
        await upsertDocument(updated);
        this.patchDocumentLocal(updated);
      }

      const envelope = isDirectory
        ? await outboundDirectory({
          record_id: updated.record_id,
          owner_npub: ownerNpub,
          title: updated.title,
          parent_directory_id: updated.parent_directory_id,
          shares: updated.shares,
          version: nextVersion,
          previous_version: item.version ?? 1,
          signature_npub: this.session.npub,
          write_group_npub: updated.group_ids?.[0] || null,
        })
        : await outboundDocument({
          record_id: updated.record_id,
          owner_npub: ownerNpub,
          title: updated.title,
          content: updated.content,
          parent_directory_id: updated.parent_directory_id,
          scope_id: updated.scope_id ?? null,
          scope_product_id: updated.scope_product_id ?? null,
          scope_project_id: updated.scope_project_id ?? null,
          scope_deliverable_id: updated.scope_deliverable_id ?? null,
          shares: updated.shares,
          version: nextVersion,
          previous_version: item.version ?? 1,
          signature_npub: this.session.npub,
          write_group_npub: updated.group_ids?.[0] || null,
        });

      await addPendingWrite({
        record_id: updated.record_id,
        record_family_hash: envelope.record_family_hash,
        envelope,
      });

      await this.performSync({ silent: false });
      await this.refreshDirectories();
      await this.refreshDocuments();
    },

    // --- docs ---

    selectDocItem(type, recordId) {
      if (type === 'directory') {
        this.navigateToFolder(recordId);
        return;
      }
      this.openDoc(recordId);
    },

    navigateToFolder(folderId = null, options = {}) {
      this.currentFolderId = folderId || null;
      this.selectedDocType = null;
      this.selectedDocId = null;
      this.selectedDocCommentId = null;
      this.navSection = 'docs';
      this.mobileNavOpen = false;
      this.loadDocEditorFromSelection();
      if (options.syncRoute !== false) this.syncRoute();
    },

    navigateUpFolder() {
      if (!this.currentFolderId) return;
      const currentFolder = this.directories.find((item) => item.record_id === this.currentFolderId);
      this.navigateToFolder(currentFolder?.parent_directory_id || null);
    },

    openDoc(recordId, options = {}) {
      this.selectedDocType = 'document';
      this.selectedDocId = recordId;
      if (Object.prototype.hasOwnProperty.call(options, 'commentId')) {
        this.selectedDocCommentId = options.commentId || null;
      } else {
        this.selectedDocCommentId = null;
      }
      this.navSection = 'docs';
      this.mobileNavOpen = false;
      const document = this.documents.find((item) => item.record_id === recordId);
      this.currentFolderId = document?.parent_directory_id || null;
      this.loadDocEditorFromSelection();
      this.loadDocComments(recordId);
      if (options.syncRoute !== false) this.syncRoute();
      this.ensureBackgroundSync(true);
    },

    closeDocEditor(options = {}) {
      this.selectedDocType = null;
      this.selectedDocId = null;
      this.selectedDocCommentId = null;
      this.docComments = [];
      this.docCommentsVisible = true;
      this.showDocCommentModal = false;
      this.docCommentAnchorLine = null;
      this.docCommentAnchorBlockId = null;
      this.newDocCommentBody = '';
      this.newDocCommentReplyBody = '';
      this.showDocShareModal = false;
      this.clearDocCommentConnector();
      this.loadDocEditorFromSelection();
      if (options.syncRoute !== false) this.syncRoute();
    },

    loadDocEditorFromSelection() {
      const item = this.selectedDocument;
      this.docShareQuery = '';
      if (!item) {
        this.docEditorTitle = '';
        this.docEditorContent = '';
        this.docEditorShares = [];
        this.docEditorMode = 'preview';
        this.docEditorSharesDirty = false;
        this.docEditorBlocks = [];
        this.docEditingBlockIndex = -1;
        this.docBlockBuffer = '';
        this.docEditingTitle = false;
        this.docComments = [];
        this.docCommentsVisible = true;
        this.showDocCommentModal = false;
        this.docCommentAnchorLine = null;
        this.docCommentAnchorBlockId = null;
        this.newDocCommentBody = '';
        this.newDocCommentReplyBody = '';
        this.docAutosaveState = 'saved';
        this.showDocShareModal = false;
        this.docShareTargetType = '';
        this.docShareTargetId = '';
        return;
      }

      this.docEditorTitle = item.title ?? '';
      this.docEditorContent = this.selectedDocType === 'document' ? (item.content ?? '') : '';
      this.docEditorShares = this.getEffectiveDocShares(item)
        .map((share) => ({ ...share }));
      this.docEditorMode = 'preview';
      this.docEditorSharesDirty = false;
      this.docEditorBlocks = parseMarkdownBlocks(this.docEditorContent);
      this.docEditingBlockIndex = -1;
      this.docBlockBuffer = '';
      this.docEditingTitle = false;
      this.showDocCommentModal = false;
      this.docCommentAnchorLine = null;
      this.docCommentAnchorBlockId = null;
      this.newDocCommentBody = '';
      this.newDocCommentReplyBody = '';
      this.docAutosaveState = 'saved';
      this.showDocShareModal = false;
      this.docShareTargetType = '';
      this.docShareTargetId = '';
      this.scheduleDocCommentConnectorUpdate();
      this.scheduleStorageImageHydration();
    },

    async loadDocComments(docId) {
      if (!docId) {
        this.docComments = [];
        return;
      }
      const documentFamilyHash = recordFamilyHash('document');
      const comments = (await getCommentsByTarget(docId))
        .filter((comment) => comment.target_record_family_hash === documentFamilyHash);
      this.docComments = comments;
      for (const comment of comments) {
        await this.rememberPeople([comment.sender_npub], 'doc-comment');
      }
      if (this.selectedDocCommentId) {
        const rootId = this.getDocCommentThreadId(this.selectedDocCommentId);
        this.selectedDocCommentId = comments.some((comment) => comment.record_id === rootId) ? rootId : null;
      }
      this.scheduleDocCommentConnectorUpdate();
      this.scheduleStorageImageHydration();
    },

    getDocCommentById(commentId) {
      if (!commentId) return null;
      return this.docComments.find((comment) => comment.record_id === commentId) ?? null;
    },

    getDocCommentThreadId(commentId) {
      let current = this.getDocCommentById(commentId);
      while (current?.parent_comment_id) {
        const parent = this.getDocCommentById(current.parent_comment_id);
        if (!parent) break;
        current = parent;
      }
      return current?.record_id || commentId || null;
    },

    getDocCommentsForBlock(block) {
      const startLine = Number(block?.start_line);
      if (!Number.isFinite(startLine)) return [];
      return this.docComments.filter((comment) =>
        !comment.parent_comment_id && Number(comment.anchor_line_number) === startLine && comment.record_state !== 'deleted'
      ).sort((a, b) => String(a.updated_at || '').localeCompare(String(b.updated_at || '')));
    },

    blockHasSelectedDocComment(block) {
      return this.getDocCommentsForBlock(block)
        .some((comment) => comment.record_id === this.selectedDocCommentId);
    },

    getDocBlockCommentState(block) {
      const comments = this.getDocCommentsForBlock(block);
      if (comments.length === 0) return 'none';
      if (comments.some((comment) => comment.comment_status !== 'resolved')) return 'open';
      return 'resolved';
    },

    getDocBlockCommentCount(block) {
      return this.getDocCommentsForBlock(block).reduce((count, comment) => {
        const replies = this.docComments.filter((candidate) => candidate.parent_comment_id === comment.record_id).length;
        return count + 1 + replies;
      }, 0);
    },

    selectDocCommentThread(commentId, options = {}) {
      const rootId = this.getDocCommentThreadId(commentId);
      if (!rootId) return;
      this.docCommentsVisible = true;
      this.selectedDocCommentId = rootId;
      this.showDocCommentModal = false;
      this.newDocCommentReplyBody = '';
      if (options.syncRoute !== false) this.syncRoute();
      this.scheduleDocCommentConnectorUpdate();
    },

    closeDocCommentThread(options = {}) {
      this.selectedDocCommentId = null;
      this.newDocCommentReplyBody = '';
      if (options.syncRoute !== false) this.syncRoute();
      this.clearDocCommentConnector();
    },

    openDocCommentModal(block) {
      if (!this.selectedDocId || !block) return;
      this.docCommentsVisible = true;
      this.docCommentAnchorLine = Number(block.start_line) || 1;
      this.docCommentAnchorBlockId = block.id || null;
      this.newDocCommentBody = '';
      this.showDocCommentModal = true;
      this.scheduleDocCommentConnectorUpdate();
    },

    closeDocCommentModal() {
      this.showDocCommentModal = false;
      this.docCommentAnchorLine = null;
      this.docCommentAnchorBlockId = null;
      this.newDocCommentBody = '';
      this.scheduleDocCommentConnectorUpdate();
    },

    toggleDocCommentsVisible() {
      this.docCommentsVisible = !this.docCommentsVisible;
      if (!this.docCommentsVisible) {
        this.showDocCommentModal = false;
        this.closeDocCommentThread({ syncRoute: false });
        this.clearDocCommentConnector();
        return;
      }
      this.scheduleDocCommentConnectorUpdate();
    },

    async addDocComment() {
      const body = String(this.newDocCommentBody || '').trim();
      const doc = this.selectedDocument;
      const drafts = [...this.docCommentAudioDrafts];
      if (this.containsInlineImageUploadToken(body)) {
        this.error = 'Wait for image upload to finish.';
        return;
      }
      if ((!body && drafts.length === 0) || !doc || !this.session?.npub) return;

      const now = new Date().toISOString();
      const recordId = crypto.randomUUID();
      const { attachments } = await this.materializeAudioDrafts({
        drafts,
        target_record_id: recordId,
        target_record_family_hash: recordFamilyHash('comment'),
        target_group_ids: toRaw(doc?.group_ids ?? []),
        write_group_npub: doc?.group_ids?.[0] || null,
      });
      const localRow = {
        record_id: recordId,
        owner_npub: this.workspaceOwnerNpub,
        target_record_id: doc.record_id,
        target_record_family_hash: recordFamilyHash('document'),
        parent_comment_id: null,
        anchor_line_number: this.docCommentAnchorLine || 1,
        comment_status: 'open',
        body,
        attachments,
        sender_npub: this.session.npub,
        record_state: 'active',
        version: 1,
        created_at: now,
        updated_at: now,
      };

      await upsertComment(localRow);
      this.docComments = [...this.docComments, localRow]
        .sort((a, b) => String(a.updated_at || '').localeCompare(String(b.updated_at || '')));
      this.scheduleStorageImageHydration();
      this.selectDocCommentThread(recordId, { syncRoute: false });
      this.docCommentAudioDrafts = [];
      this.closeDocCommentModal();
      this.syncRoute();

      const envelope = await outboundComment({
        ...localRow,
        target_group_ids: toRaw(doc?.group_ids ?? []),
        signature_npub: this.session.npub,
        write_group_npub: doc?.group_ids?.[0] || null,
      });
      await addPendingWrite({
        record_id: recordId,
        record_family_hash: envelope.record_family_hash,
        envelope,
      });
      await this.performSync({ silent: true });
    },

    async addDocCommentReply() {
      const body = String(this.newDocCommentReplyBody || '').trim();
      const doc = this.selectedDocument;
      const root = this.selectedDocComment;
      const drafts = [...this.docCommentReplyAudioDrafts];
      if (this.containsInlineImageUploadToken(body)) {
        this.error = 'Wait for image upload to finish.';
        return;
      }
      if ((!body && drafts.length === 0) || !doc || !root || !this.session?.npub) return;

      const now = new Date().toISOString();
      const recordId = crypto.randomUUID();
      const { attachments } = await this.materializeAudioDrafts({
        drafts,
        target_record_id: recordId,
        target_record_family_hash: recordFamilyHash('comment'),
        target_group_ids: toRaw(doc?.group_ids ?? []),
        write_group_npub: doc?.group_ids?.[0] || null,
      });
      const localRow = {
        record_id: recordId,
        owner_npub: this.workspaceOwnerNpub,
        target_record_id: doc.record_id,
        target_record_family_hash: recordFamilyHash('document'),
        parent_comment_id: root.record_id,
        anchor_line_number: root.anchor_line_number || 1,
        comment_status: 'open',
        body,
        attachments,
        sender_npub: this.session.npub,
        record_state: 'active',
        version: 1,
        created_at: now,
        updated_at: now,
      };

      await upsertComment(localRow);
      this.docComments = [...this.docComments, localRow]
        .sort((a, b) => String(a.updated_at || '').localeCompare(String(b.updated_at || '')));
      this.scheduleStorageImageHydration();
      this.newDocCommentReplyBody = '';
      this.docCommentReplyAudioDrafts = [];
      this.scheduleDocCommentConnectorUpdate();

      const envelope = await outboundComment({
        ...localRow,
        target_group_ids: toRaw(doc?.group_ids ?? []),
        signature_npub: this.session.npub,
        write_group_npub: doc?.group_ids?.[0] || null,
      });
      await addPendingWrite({
        record_id: recordId,
        record_family_hash: envelope.record_family_hash,
        envelope,
      });
      await this.performSync({ silent: true });
    },

    async setDocCommentStatus(commentId, nextStatus) {
      const comment = this.getDocCommentById(commentId);
      const doc = this.selectedDocument;
      if (!comment || !doc || !this.session?.npub) return;
      const status = nextStatus === 'resolved' ? 'resolved' : 'open';
      if ((comment.comment_status || 'open') === status) return;

      const updated = {
        ...comment,
        comment_status: status,
        version: (comment.version ?? 1) + 1,
        updated_at: new Date().toISOString(),
      };
      await upsertComment(updated);
      this.docComments = this.docComments.map((candidate) =>
        candidate.record_id === comment.record_id ? updated : candidate
      );
      if (status === 'resolved' && this.selectedDocCommentId === comment.record_id) {
        this.selectedDocCommentId = null;
        this.newDocCommentReplyBody = '';
        this.showDocCommentModal = false;
        this.clearDocCommentConnector();
      }
      this.syncRoute();
      this.scheduleDocCommentConnectorUpdate();

      const envelope = await outboundComment({
        ...updated,
        previous_version: comment.version ?? 1,
        target_group_ids: toRaw(doc?.group_ids ?? []),
        signature_npub: this.session.npub,
        write_group_npub: doc?.group_ids?.[0] || null,
      });
      await addPendingWrite({
        record_id: updated.record_id,
        record_family_hash: envelope.record_family_hash,
        envelope,
      });
      await this.performSync({ silent: true });
      if (status === 'resolved') {
        this.selectedDocCommentId = null;
        this.newDocCommentReplyBody = '';
        this.clearDocCommentConnector();
        this.syncRoute();
      }
    },

    getDocCommentSummary(comment) {
      const words = String(comment?.body || '').trim().split(/\s+/).filter(Boolean);
      if (words.length <= 7) return words.join(' ');
      return `${words.slice(0, 7).join(' ')}…`;
    },

    setDocEditorMode(mode) {
      const nextMode = mode === 'source' ? 'source' : mode === 'block' ? 'block' : 'preview';
      if (nextMode === 'source' && this.docEditingBlockIndex >= 0) {
        this.commitDocBlockEdit();
      }
      if (nextMode === 'preview' && this.docEditingBlockIndex >= 0) {
        this.cancelDocBlockEdit();
      }
      this.docEditorMode = nextMode;
    },

    toggleDocEditorMode() {
      if (this.docEditorMode === 'preview') {
        this.setDocEditorMode('block');
        return;
      }
      if (this.docEditorMode === 'block') {
        this.setDocEditorMode('source');
        return;
      }
      this.setDocEditorMode('preview');
    },

    resolveDocShareTarget(target = null) {
      if (target === 'current-folder') {
        return this.currentFolder
          ? { type: 'directory', item: this.currentFolder }
          : { type: null, item: null };
      }
      if (target?.type === 'document' || target?.type === 'directory') {
        return { type: target.type, item: target.item || null };
      }
      if (this.selectedDocument) {
        return { type: 'document', item: this.selectedDocument };
      }
      if (this.selectedDirectory) {
        return { type: 'directory', item: this.selectedDirectory };
      }
      if (this.currentFolder) {
        return { type: 'directory', item: this.currentFolder };
      }
      return { type: null, item: null };
    },

    openDocShareModal(target = null) {
      const resolved = this.resolveDocShareTarget(target);
      if (!resolved.item) {
        this.error = 'Select a document or folder first';
        return;
      }
      this.docShareTargetType = resolved.type;
      this.docShareTargetId = resolved.item.record_id;
      this.docEditorShares = this.getEffectiveDocShares(resolved.item).map((share) => ({ ...share }));
      this.docEditorSharesDirty = false;
      this.docShareQuery = '';
      this.showDocShareModal = true;
    },

    closeDocShareModal() {
      this.showDocShareModal = false;
      this.docShareQuery = '';
      this.docShareTargetType = '';
      this.docShareTargetId = '';
    },

    startDocTitleEdit() {
      if (this.docEditorMode === 'preview') return;
      this.docEditingTitle = true;
    },

    finishDocTitleEdit() {
      this.docEditingTitle = false;
      this.scheduleDocAutosave();
    },

    syncDocBlocksFromContent() {
      this.docEditorBlocks = parseMarkdownBlocks(this.docEditorContent);
    },

    handleDocSourceInput(value) {
      this.docEditorContent = value;
      this.syncDocBlocksFromContent();
      this.scheduleDocAutosave();
      this.scheduleStorageImageHydration();
    },

    startDocBlockEdit(index) {
      if (this.docEditorMode !== 'block') return;
      if (this.docEditingBlockIndex >= 0 && this.docEditingBlockIndex !== index) {
        this.commitDocBlockEdit();
      }
      if (!this.docEditorBlocks[index]) {
        this.docEditorBlocks = [...this.docEditorBlocks, { id: `block-${Date.now()}`, raw: '' }];
      }
      this.docEditingBlockIndex = index;
      this.docBlockBuffer = this.docEditorBlocks[index]?.raw ?? '';
    },

    appendDocBlock() {
      if (this.docEditorMode !== 'block') return;
      const index = this.docEditorBlocks.length;
      this.docEditorBlocks = [...this.docEditorBlocks, { id: `block-${Date.now()}`, raw: '' }];
      this.startDocBlockEdit(index);
    },

    updateDocBlockBuffer(value) {
      this.docBlockBuffer = value;
      this.scheduleStorageImageHydration();
    },

    commitDocBlockEdit() {
      if (this.docEditingBlockIndex < 0) return;
      const blocks = [...this.docEditorBlocks];
      const raw = String(this.docBlockBuffer || '').trimEnd();
      if (raw) {
        blocks[this.docEditingBlockIndex] = {
          ...(blocks[this.docEditingBlockIndex] || { id: `block-${Date.now()}` }),
          raw,
        };
      } else {
        blocks.splice(this.docEditingBlockIndex, 1);
      }
      this.docEditorBlocks = blocks;
      this.docEditorContent = assembleMarkdownBlocks(blocks);
      this.docEditingBlockIndex = -1;
      this.docBlockBuffer = '';
      this.scheduleDocAutosave();
      this.scheduleStorageImageHydration();
    },

    cancelDocBlockEdit() {
      this.docEditingBlockIndex = -1;
      this.docBlockBuffer = '';
    },

    scheduleDocAutosave() {
      if (!this.docsEditorOpen) return;
      if (this.docEditorMode === 'preview') return;
      this.docAutosaveState = 'pending';
      if (this.docAutosaveTimer) clearTimeout(this.docAutosaveTimer);
      this.docAutosaveTimer = setTimeout(async () => {
        this.docAutosaveTimer = null;
        try {
          await this.saveSelectedDocItem({ autosave: true });
        } catch {
          // saveSelectedDocItem already updates error/autosave state
        }
      }, 900);
    },

    cancelDocAutosave() {
      if (this.docAutosaveTimer) clearTimeout(this.docAutosaveTimer);
      this.docAutosaveTimer = null;
    },

    serializeDocShares(shares) {
      return JSON.stringify((shares || [])
        .map((share) => ({
          type: share.type,
          key: share.key,
          access: share.access,
          person_npub: share.person_npub || null,
          group_npub: share.group_npub || null,
          via_group_npub: share.via_group_npub || null,
          inherited: share.inherited === true,
          inherited_from_directory_id: share.inherited_from_directory_id || null,
        }))
        .sort((a, b) => String(a.key || '').localeCompare(String(b.key || ''))));
    },

    normalizeDocShare(share, inheritedFromDirectoryId = null) {
      if (!share) return null;
      const type = share.type === 'person' ? 'person' : 'group';
      const personNpub = share.person_npub || null;
      const groupNpub = share.group_npub || null;
      const viaGroupNpub = share.via_group_npub || null;
      const key = share.key || (type === 'person'
        ? `person:${personNpub}`
        : `group:${groupNpub || viaGroupNpub}`);
      if (!key) return null;

      const sourceDirectoryId = inheritedFromDirectoryId || share.inherited_from_directory_id || null;
      return {
        ...share,
        type,
        key,
        access: share.access === 'write' ? 'write' : 'read',
        person_npub: personNpub,
        group_npub: groupNpub,
        via_group_npub: viaGroupNpub,
        inherited: Boolean(sourceDirectoryId || share.inherited),
        inherited_from_directory_id: sourceDirectoryId,
      };
    },

    mergeDocShareLists(primaryShares = [], inheritedShares = []) {
      const merged = new Map();
      for (const share of primaryShares) {
        const normalized = this.normalizeDocShare(share);
        if (!normalized?.key) continue;
        merged.set(normalized.key, normalized);
      }

      for (const share of inheritedShares) {
        const normalized = this.normalizeDocShare(
          share,
          share.inherited_from_directory_id || share.source_directory_id || null,
        );
        if (!normalized?.key) continue;
        const existing = merged.get(normalized.key);
        if (!existing) {
          merged.set(normalized.key, normalized);
          continue;
        }
        merged.set(normalized.key, {
          ...existing,
          access: existing.access === 'write' || normalized.access === 'write' ? 'write' : 'read',
          inherited: existing.inherited || normalized.inherited,
          inherited_from_directory_id: existing.inherited_from_directory_id || normalized.inherited_from_directory_id || null,
        });
      }

      return [...merged.values()].sort((a, b) => String(a.key || '').localeCompare(String(b.key || '')));
    },

    getStoredDocShares(item) {
      return Array.isArray(item?.shares)
        ? item.shares.map((share) => this.normalizeDocShare(share)).filter(Boolean)
        : [];
    },

    getExplicitDocShares(item) {
      return this.getStoredDocShares(item).filter((share) => !share.inherited && !share.inherited_from_directory_id);
    },

    getEffectiveDirectoryShares(directoryOrId, seen = new Set()) {
      const directory = typeof directoryOrId === 'string'
        ? this.directories.find((item) => item.record_id === directoryOrId)
        : directoryOrId;
      if (!directory?.record_id || seen.has(directory.record_id)) return [];

      const nextSeen = new Set(seen);
      nextSeen.add(directory.record_id);
      const explicit = this.getExplicitDocShares(directory);
      const inherited = directory.parent_directory_id
        ? this.getInheritedDirectoryShares(directory.parent_directory_id, nextSeen)
        : [];
      return this.mergeDocShareLists(explicit, inherited);
    },

    getInheritedDirectoryShares(directoryOrId, seen = new Set()) {
      const directory = typeof directoryOrId === 'string'
        ? this.directories.find((item) => item.record_id === directoryOrId)
        : directoryOrId;
      if (!directory?.record_id) return [];
      return this.getEffectiveDirectoryShares(directory, seen)
        .map((share) => this.normalizeDocShare({ ...share }, directory.record_id))
        .filter(Boolean);
    },

    getEffectiveDocShares(item) {
      if (!item) return [];
      const explicit = this.getExplicitDocShares(item);
      const inherited = item.parent_directory_id
        ? this.getInheritedDirectoryShares(item.parent_directory_id)
        : [];
      return this.mergeDocShareLists(explicit, inherited);
    },

    getDocShareSubtitle(share) {
      if (!share) return '';
      const shortBase = this.getShortNpub(
        share.type === 'person'
          ? share.person_npub
          : (share.group_npub || share.via_group_npub || '')
      );
      const viaGroup = share.type === 'person' && share.via_group_npub
        ? this.getDocShareTitle({ type: 'group', label: '', group_npub: share.via_group_npub })
        : '';
      const base = viaGroup ? `${shortBase} · via ${viaGroup}` : shortBase;
      if (!this.isInheritedDocShare(share)) return base;
      const directory = this.directories.find((item) => item.record_id === share.inherited_from_directory_id);
      return directory?.title
        ? `${base} · inherited from ${directory.title}`
        : `${base} · inherited`;
    },

    getDocShareTitle(share) {
      if (!share) return '';
      if (share.type === 'person') return this.getSenderName(share.person_npub);
      const groupNpub = share.group_npub || share.via_group_npub || '';
      const knownGroup = this.groups.find((group) => group.group_npub === groupNpub);
      return share.label || knownGroup?.name || 'Group';
    },

    getDocShareAvatar(share) {
      if (!share || share.type !== 'person') return null;
      return this.getSenderAvatar(share.person_npub);
    },

    isInheritedDocShare(shareOrKey) {
      const share = typeof shareOrKey === 'string'
        ? this.docEditorShares.find((item) => item.key === shareOrKey)
        : shareOrKey;
      return Boolean(share?.inherited || share?.inherited_from_directory_id);
    },

    openNewDocModal(type) {
      this.newDocModalType = type;
      this.newDocModalTitle = '';
      this.newDocModalSubmitting = false;
    },

    closeNewDocModal() {
      this.newDocModalType = null;
      this.newDocModalTitle = '';
      this.newDocModalSubmitting = false;
    },

    async confirmNewDocModal() {
      const title = this.newDocModalTitle.trim();
      const modalType = this.newDocModalType;
      if (!title || !modalType || this.newDocModalSubmitting) return;
      this.newDocModalSubmitting = true;
      this.closeNewDocModal();
      try {
        if (modalType === 'folder') {
          await this.createDirectory(title);
        } else {
          await this.createDocument(title);
        }
      } finally {
        this.newDocModalSubmitting = false;
      }
    },

    getSelectedDirectoryChildren() {
      if (!this.selectedDirectory) return [];
      return [
        ...this.directories
          .filter((item) => item.parent_directory_id === this.selectedDirectory.record_id && item.record_state !== 'deleted')
          .map((item) => ({ type: 'directory', item })),
        ...this.documents
          .filter((item) => item.parent_directory_id === this.selectedDirectory.record_id && item.record_state !== 'deleted')
          .map((item) => ({ type: 'document', item })),
      ].sort((a, b) => String(a.item.title || '').localeCompare(String(b.item.title || '')));
    },

    getDocItemLocationLabel(item) {
      if (!item?.parent_directory_id) return 'Root';
      const parent = this.directories.find((directory) => directory.record_id === item.parent_directory_id);
      return parent?.title || 'Root';
    },

    getDocItemShareSummary(item) {
      if (!item) return 'Private';
      const shares = this.getEffectiveDocShares(item);
      if (shares.length === 0) return 'Private';
      return shares
        .map((share) => (share.type === 'person'
          ? this.getSenderName(share.person_npub)
          : (share.label || 'Group')))
        .join(', ');
    },

    addDocShareFromSuggestion(suggestion) {
      if (!suggestion) return;

      const nextShare = suggestion.type === 'person'
        ? {
          type: 'person',
          key: `person:${suggestion.npub}`,
          access: 'read',
          label: suggestion.label,
          person_npub: suggestion.npub,
          group_npub: null,
          via_group_npub: null,
        }
        : {
          type: 'group',
          key: `group:${suggestion.group_npub}`,
          access: 'read',
          label: suggestion.label,
          person_npub: null,
          group_npub: suggestion.group_npub,
          via_group_npub: null,
        };

      this.docEditorShares = this.mergeDocShareLists(this.docEditorShares, [nextShare]);
      this.docEditorSharesDirty = true;
      this.docShareQuery = '';
    },

    updateDocShareAccess(shareKey, access) {
      if (this.isInheritedDocShare(shareKey)) return;
      this.docEditorShares = this.docEditorShares.map((share) =>
        share.key === shareKey
          ? { ...share, access: access === 'write' ? 'write' : 'read' }
          : share
      );
      this.docEditorSharesDirty = true;
    },

    removeDocShare(shareKey) {
      if (this.isInheritedDocShare(shareKey)) return;
      this.docEditorShares = this.docEditorShares.filter((share) => share.key !== shareKey);
      this.docEditorSharesDirty = true;
    },

    async ensureDirectShareGroup(personNpub) {
      const ownerNpub = this.session?.npub;
      if (!ownerNpub) throw new Error('Sign in first');

      const existing = this.groups.find((group) => {
        const members = [...new Set(group.member_npubs ?? [])].sort();
        return members.length === 2
          && members[0] === [ownerNpub, personNpub].sort()[0]
          && members[1] === [ownerNpub, personNpub].sort()[1];
      });
      if (existing) {
        return existing.group_npub || existing.group_id;
      }

      const group = await this.createEncryptedGroup(
        `Direct: ${this.getSenderName(personNpub)}`,
        [personNpub],
      );
      await this.rememberPeople([personNpub], 'share');
      return group.group_npub;
    },

    async materializeDocSharesForSync() {
      const shares = [];

      for (const share of this.docEditorShares) {
        if (share.type === 'person' && share.person_npub) {
          const viaGroup = share.via_group_npub || await this.ensureDirectShareGroup(share.person_npub);
          shares.push({
            ...share,
            via_group_npub: viaGroup,
          });
        } else if (share.type === 'group' && share.group_npub) {
          shares.push({ ...share });
        }
      }

      return shares;
    },

    async saveDocShareTarget() {
      const target = this.activeDocShareTarget;
      if (!target) {
        this.error = 'Select a document or folder first';
        return;
      }
      if (!this.docEditorSharesDirty) {
        this.closeDocShareModal();
        return;
      }

      if (this.docShareTargetType === 'directory') {
        await this.saveSelectedDirectoryItem();
      } else {
        await this.saveSelectedDocItem({ autosave: false });
      }
      this.closeDocShareModal();
    },

    getDefaultParentDirectoryId() {
      if (this.currentFolderId) return this.currentFolderId;
      if (this.selectedDocument?.parent_directory_id) return this.selectedDocument.parent_directory_id;
      return null;
    },

    getDefaultPrivateShares() {
      const groupNpub = this.memberPrivateGroupNpub;
      if (!groupNpub) return [];
      return [{
        type: 'group',
        key: groupNpub,
        access: 'write',
        label: this.memberPrivateGroup?.name || 'Private',
        person_npub: null,
        group_npub: groupNpub,
        via_group_npub: null,
        inherited: false,
        inherited_from_directory_id: null,
      }];
    },

    getShareGroupIds(shares = []) {
      return [...new Set((shares || []).map((share) => share.type === 'person'
        ? (share.via_group_npub || share.group_npub)
        : share.group_npub).filter(Boolean))];
    },

    async createDirectory(title = 'New directory') {
      const ownerNpub = this.workspaceOwnerNpub;
      if (!ownerNpub) {
        this.error = 'Sign in first';
        return;
      }

      const recordId = crypto.randomUUID();
      const now = new Date().toISOString();
      const row = {
        record_id: recordId,
        owner_npub: ownerNpub,
        title,
        parent_directory_id: this.getDefaultParentDirectoryId(),
        shares: this.getInheritedDirectoryShares(this.getDefaultParentDirectoryId()),
        group_ids: [],
        sync_status: 'pending',
        record_state: 'active',
        version: 1,
        updated_at: now,
      };
      if (row.shares.length === 0) row.shares = this.getDefaultPrivateShares();
      row.group_ids = this.getShareGroupIds(row.shares);

      await upsertDirectory(row);
      this.patchDirectoryLocal(row);
      await addPendingWrite({
        record_id: recordId,
        record_family_hash: recordFamilyHash('directory'),
        envelope: await outboundDirectory({
          record_id: recordId,
          owner_npub: ownerNpub,
          title: row.title,
          parent_directory_id: row.parent_directory_id,
          shares: row.shares,
          signature_npub: this.session?.npub,
          write_group_npub: row.group_ids?.[0] || null,
        }),
      });

      await this.refreshDirectories();
      this.navigateToFolder(recordId);
      await this.performSync({ silent: false });
    },

    async createDocument(title = 'Untitled document') {
      const ownerNpub = this.workspaceOwnerNpub;
      if (!ownerNpub) {
        this.error = 'Sign in first';
        return;
      }

      const recordId = crypto.randomUUID();
      const now = new Date().toISOString();
      const row = {
        record_id: recordId,
        owner_npub: ownerNpub,
        title,
        content: '',
        parent_directory_id: this.getDefaultParentDirectoryId(),
        shares: this.getInheritedDirectoryShares(this.getDefaultParentDirectoryId()),
        group_ids: [],
        sync_status: 'pending',
        record_state: 'active',
        version: 1,
        updated_at: now,
      };
      if (row.shares.length === 0) row.shares = this.getDefaultPrivateShares();
      row.group_ids = this.getShareGroupIds(row.shares);

      await upsertDocument(row);
      this.patchDocumentLocal(row);
      await addPendingWrite({
        record_id: recordId,
        record_family_hash: recordFamilyHash('document'),
        envelope: await outboundDocument({
          record_id: recordId,
          owner_npub: ownerNpub,
          title: row.title,
          content: row.content,
          parent_directory_id: row.parent_directory_id,
          shares: row.shares,
          signature_npub: this.session?.npub,
          write_group_npub: row.group_ids?.[0] || null,
        }),
      });

      await this.refreshDocuments();
      this.openDoc(recordId);
      await this.performSync({ silent: false });
    },

    async saveSelectedDirectoryItem() {
      this.error = null;
      const item = this.activeDocShareTarget;
      const ownerNpub = this.workspaceOwnerNpub;
      if (!item || this.docShareTargetType !== 'directory' || !ownerNpub) {
        this.error = 'Select a folder first';
        return;
      }

      const currentSharesSerialized = this.serializeDocShares(this.getEffectiveDocShares(item));
      const editorSharesSerialized = this.serializeDocShares(this.docEditorShares || []);
      if (currentSharesSerialized === editorSharesSerialized) {
        this.docEditorSharesDirty = false;
        return item;
      }

      const shares = this.docEditorSharesDirty
        ? await this.materializeDocSharesForSync()
        : this.getStoredDocShares(item);
      const now = new Date().toISOString();
      const nextVersion = (item.version ?? 1) + 1;
      const updated = {
        ...item,
        shares,
        group_ids: this.getShareGroupIds(shares),
        sync_status: 'pending',
        version: nextVersion,
        updated_at: now,
      };

      await upsertDirectory(updated);
      this.patchDirectoryLocal(updated);
      await addPendingWrite({
        record_id: item.record_id,
        record_family_hash: recordFamilyHash('directory'),
        envelope: await outboundDirectory({
          record_id: item.record_id,
          owner_npub: ownerNpub,
          title: updated.title,
          parent_directory_id: updated.parent_directory_id,
          shares,
          version: nextVersion,
          previous_version: item.version ?? 1,
          signature_npub: this.session?.npub,
          write_group_npub: updated.group_ids?.[0] || null,
        }),
      });

      await this.performSync({ silent: false });
      await this.refreshDirectories();
      await this.refreshDocuments();
      this.docEditorSharesDirty = false;
      return updated;
    },

    async saveSelectedDocItem(options = {}) {
      const autosave = options.autosave === true;
      this.error = null;
      const item = this.selectedDocument;
      const ownerNpub = this.workspaceOwnerNpub;
      if (!item || !ownerNpub) {
        if (!autosave) this.error = 'Select a document first';
        return;
      }

      const nextTitle = this.docEditorTitle.trim() || 'Untitled document';
      const currentSharesSerialized = this.serializeDocShares(this.getEffectiveDocShares(item));
      const editorSharesSerialized = this.serializeDocShares(this.docEditorShares || []);
      const hasChanges = nextTitle !== (item.title ?? 'Untitled document')
        || (this.docEditorContent || '') !== (item.content || '')
        || currentSharesSerialized !== editorSharesSerialized;
      if (!hasChanges) {
        this.docAutosaveState = 'saved';
        return;
      }

      const shares = this.docEditorSharesDirty
        ? await this.materializeDocSharesForSync()
        : this.getStoredDocShares(item);
      const now = new Date().toISOString();
      const nextVersion = (item.version ?? 1) + 1;
      this.docAutosaveState = autosave ? 'saving' : this.docAutosaveState;
      try {
        const updated = {
          ...item,
          title: nextTitle,
          content: this.docEditorContent,
          shares,
          group_ids: this.getShareGroupIds(shares),
          sync_status: 'pending',
          version: nextVersion,
          updated_at: now,
        };
        await upsertDocument(updated);
        this.patchDocumentLocal(updated);
        await addPendingWrite({
          record_id: item.record_id,
          record_family_hash: recordFamilyHash('document'),
          envelope: await outboundDocument({
            record_id: item.record_id,
            owner_npub: ownerNpub,
            title: updated.title,
            content: updated.content,
            parent_directory_id: updated.parent_directory_id,
            scope_id: updated.scope_id ?? null,
            scope_product_id: updated.scope_product_id ?? null,
            scope_project_id: updated.scope_project_id ?? null,
            scope_deliverable_id: updated.scope_deliverable_id ?? null,
            shares,
            version: nextVersion,
            previous_version: item.version ?? 1,
            signature_npub: this.session?.npub,
            write_group_npub: updated.group_ids?.[0] || null,
          }),
        });

        await this.performSync({ silent: autosave, showBusy: !autosave });
        await this.refreshDirectories();
        await this.refreshDocuments();
        this.docEditorSharesDirty = false;
        this.docAutosaveState = 'saved';
        this.ensureBackgroundSync(true);
        return updated;
      } catch (error) {
        this.docAutosaveState = 'error';
        throw error;
      }
    },

    async deleteSelectedDocItem() {
      this.cancelDocAutosave();
      this.error = null;
      const item = this.selectedDocument;
      const ownerNpub = this.workspaceOwnerNpub;
      if (!item || !ownerNpub) {
        this.error = 'Select a document first';
        return;
      }

      if (typeof window !== 'undefined') {
        const confirmed = window.confirm('Delete this document?');
        if (!confirmed) return;
      }

      const shares = this.getEffectiveDocShares(item);
      const now = new Date().toISOString();
      const nextVersion = (item.version ?? 1) + 1;

      await upsertDocument({
        ...item,
        record_state: 'deleted',
        sync_status: 'pending',
        version: nextVersion,
        updated_at: now,
      });
      this.patchDocumentLocal({
        ...item,
        record_state: 'deleted',
        sync_status: 'pending',
        version: nextVersion,
        updated_at: now,
      });
      await addPendingWrite({
        record_id: item.record_id,
        record_family_hash: recordFamilyHash('document'),
        envelope: await outboundDocument({
          record_id: item.record_id,
          owner_npub: ownerNpub,
          title: item.title,
          content: item.content,
          parent_directory_id: item.parent_directory_id,
          shares,
          version: nextVersion,
          previous_version: item.version ?? 1,
          record_state: 'deleted',
          signature_npub: this.session?.npub,
          write_group_npub: item.group_ids?.[0] || null,
        }),
      });

      this.selectedDocId = null;
      this.selectedDocType = null;
      await this.performSync({ silent: false });
      await this.refreshDirectories();
      await this.refreshDocuments();
      const [first] = this.filteredDocRows;
      if (first) this.selectDocItem(first.type, first.item.record_id);
    },

    getInlineUploadCount(context) {
      return context === 'thread' ? this.threadImageUploadCount : this.messageImageUploadCount;
    },

    setInlineUploadCount(context, nextValue) {
      const normalized = Math.max(0, Number(nextValue) || 0);
      if (context === 'thread') this.threadImageUploadCount = normalized;
      else this.messageImageUploadCount = normalized;
    },

    incrementInlineUploadCount(context) {
      this.setInlineUploadCount(context, this.getInlineUploadCount(context) + 1);
    },

    decrementInlineUploadCount(context) {
      this.setInlineUploadCount(context, this.getInlineUploadCount(context) - 1);
    },

    defaultPastedImageName(file, context = 'chat') {
      const now = new Date();
      const stamp = now.toISOString().replace(/[:]/g, '-').replace(/\..+$/, '');
      const mime = String(file?.type || '').toLowerCase();
      const ext = mime.includes('png')
        ? 'png'
        : mime.includes('jpeg') || mime.includes('jpg')
          ? 'jpg'
          : mime.includes('gif')
            ? 'gif'
            : mime.includes('webp')
              ? 'webp'
              : 'bin';
      return `${context}-image-${stamp}.${ext}`;
    },

    createStorageMarkdown(objectId, altText = 'Image') {
      const safeAlt = String(altText || 'Image').replace(/[\[\]]/g, '').trim() || 'Image';
      return `![${safeAlt}](storage://${objectId})`;
    },

    containsInlineImageUploadToken(value) {
      return String(value || '').includes('[ Uploading image... ]');
    },

    getModelValue(modelPath) {
      const parts = String(modelPath || '').split('.').filter(Boolean);
      return parts.reduce((acc, key) => (acc == null ? acc : acc[key]), this);
    },

    setModelValue(modelPath, value) {
      const parts = String(modelPath || '').split('.').filter(Boolean);
      if (parts.length === 0) return;
      if (parts.length === 1) {
        this[parts[0]] = value;
        return;
      }
      const parent = parts.slice(0, -1).reduce((acc, key) => (acc == null ? acc : acc[key]), this);
      if (parent && typeof parent === 'object') {
        parent[parts[parts.length - 1]] = value;
      }
    },

    insertTextIntoModel(modelKey, textarea, text) {
      const current = String(this.getModelValue(modelKey) || '');
      const start = typeof textarea?.selectionStart === 'number' ? textarea.selectionStart : current.length;
      const end = typeof textarea?.selectionEnd === 'number' ? textarea.selectionEnd : current.length;
      const next = `${current.slice(0, start)}${text}${current.slice(end)}`;
      this.setModelValue(modelKey, next);
      const caret = start + text.length;
      if (textarea) {
        textarea.value = next;
        textarea.selectionStart = caret;
        textarea.selectionEnd = caret;
      }
      return { start, end, insertedText: text };
    },

    replaceTokenInModel(modelKey, token, replacement) {
      const current = String(this.getModelValue(modelKey) || '');
      const index = current.indexOf(token);
      if (index === -1) return false;
      this.setModelValue(modelKey, `${current.slice(0, index)}${replacement}${current.slice(index + token.length)}`);
      return true;
    },

    async sha256HexForBytes(bytes) {
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
    },

    scheduleStorageImageHydration() {
      if (this._storageImageHydrateScheduled || typeof window === 'undefined') return;
      this._storageImageHydrateScheduled = true;
      window.requestAnimationFrame(() => {
        this._storageImageHydrateScheduled = false;
        this.hydrateStorageImages();
      });
    },

    revokeStorageImageObjectUrls() {
      for (const url of Object.values(this.storageImageUrlCache || {})) {
        if (typeof url === 'string' && url.startsWith('blob:')) URL.revokeObjectURL(url);
      }
      this.storageImageUrlCache = {};
      this.storageImageLoadPromises = {};
    },

    rememberStorageImageUrl(objectId, url) {
      const previous = this.storageImageUrlCache?.[objectId];
      if (previous && previous !== url && previous.startsWith('blob:')) {
        URL.revokeObjectURL(previous);
      }
      this.storageImageUrlCache = {
        ...(this.storageImageUrlCache || {}),
        [objectId]: url,
      };
      return url;
    },

    async resolveStorageImageUrl(objectId) {
      const existing = this.storageImageUrlCache?.[objectId];
      if (existing) return existing;

      const pending = this.storageImageLoadPromises?.[objectId];
      if (pending) return pending;

      const loadPromise = (async () => {
        const cached = await getCachedStorageImage(objectId);
        if (cached?.blob instanceof Blob && cached.blob.size > 0) {
          return this.rememberStorageImageUrl(objectId, URL.createObjectURL(cached.blob));
        }

        const blob = await downloadStorageObjectBlob(objectId);
        if (!(blob instanceof Blob) || blob.size === 0) {
          throw new Error(`No image data returned for ${objectId}`);
        }
        await cacheStorageImage({
          object_id: objectId,
          blob,
          content_type: blob.type || 'application/octet-stream',
        });
        return this.rememberStorageImageUrl(objectId, URL.createObjectURL(blob));
      })();

      this.storageImageLoadPromises = {
        ...(this.storageImageLoadPromises || {}),
        [objectId]: loadPromise,
      };

      try {
        return await loadPromise;
      } finally {
        const next = { ...(this.storageImageLoadPromises || {}) };
        delete next[objectId];
        this.storageImageLoadPromises = next;
      }
    },

    hydrateStorageImages() {
      if (typeof document === 'undefined') return;
      const images = [...document.querySelectorAll('img[data-storage-object-id]')];
      for (const image of images) {
        const objectId = String(image.dataset.storageObjectId || '').trim();
        if (!objectId || image.dataset.storageResolved === 'true') continue;
        image.dataset.storageResolved = 'pending';
        this.resolveStorageImageUrl(objectId)
          .then((url) => {
            image.src = url;
            image.dataset.storageResolved = 'true';
            image.classList.remove('md-storage-image-pending');
          })
          .catch(() => {
            image.dataset.storageResolved = 'error';
            image.classList.add('md-storage-image-error');
          });
      }
    },

    async handleInlineImagePaste(event, options = {}) {
      const clipboardItems = [...(event?.clipboardData?.items || [])];
      const imageItem = clipboardItems.find((item) => String(item?.type || '').startsWith('image/'));
      if (!imageItem) return false;

      event.preventDefault();

      const file = imageItem.getAsFile?.();
      if (!file) {
        this.error = 'Could not read pasted image.';
        return true;
      }

      const modelKey = String(options.modelKey || '').trim();
      if (!modelKey) return true;
      const ownerNpub = String(options.ownerNpub || '').trim();
      if (!ownerNpub) {
        this.error = 'Missing storage owner for pasted image.';
        return true;
      }

      const token = '[ Uploading image... ]';
      this.insertTextIntoModel(modelKey, event.target, token);
      if (options.uploadCounterContext) this.incrementInlineUploadCount(options.uploadCounterContext);

      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const fileName = this.defaultPastedImageName(file, options.fileLabel || 'inline');
        const prepared = await prepareStorageObject({
          owner_npub: ownerNpub,
          content_type: file.type || 'image/png',
          size_bytes: file.size || bytes.byteLength,
          file_name: fileName,
          access_group_npubs: options.accessGroupNpubs ?? [],
        });
        await uploadStorageObject(prepared, bytes, file.type || 'image/png');
        await completeStorageObject(prepared.object_id, {
          size_bytes: bytes.byteLength,
          sha256_hex: await this.sha256HexForBytes(bytes),
        });
        this.replaceTokenInModel(modelKey, token, this.createStorageMarkdown(prepared.object_id, fileName));
        this.scheduleStorageImageHydration();
      } catch (error) {
        this.replaceTokenInModel(modelKey, token, '[ Upload failed ]');
        this.error = error?.message || 'Could not upload pasted image.';
      } finally {
        if (options.uploadCounterContext) this.decrementInlineUploadCount(options.uploadCounterContext);
      }
      return true;
    },

    async handleChatPaste(event, context = 'message') {
      const channel = this.selectedChannel;
      if (!channel) {
        this.error = 'Select a channel first';
        return;
      }

      await this.handleInlineImagePaste(event, {
        modelKey: context === 'thread' ? 'threadInput' : 'messageInput',
        ownerNpub: channel.owner_npub || this.workspaceOwnerNpub || this.session?.npub,
        accessGroupNpubs: channel.group_ids ?? [],
        fileLabel: context === 'thread' ? 'thread' : 'chat',
        uploadCounterContext: context,
      });
    },

    async handleTaskDescriptionPaste(event) {
      if (!this.editingTask) return;
      await this.handleInlineImagePaste(event, {
        modelKey: 'editingTask.description',
        ownerNpub: this.editingTask.owner_npub || this.workspaceOwnerNpub || this.session?.npub,
        accessGroupNpubs: this.editingTask.group_ids ?? [],
        fileLabel: 'task',
      });
    },

    async handleTaskCommentPaste(event) {
      if (!this.editingTask) return;
      await this.handleInlineImagePaste(event, {
        modelKey: 'newTaskCommentBody',
        ownerNpub: this.editingTask.owner_npub || this.workspaceOwnerNpub || this.session?.npub,
        accessGroupNpubs: this.editingTask.group_ids ?? [],
        fileLabel: 'task-comment',
      });
    },

    async handleDocSourcePaste(event) {
      const doc = this.selectedDocument;
      if (!doc) return;
      const handled = await this.handleInlineImagePaste(event, {
        modelKey: 'docEditorContent',
        ownerNpub: doc.owner_npub || this.workspaceOwnerNpub || this.session?.npub,
        accessGroupNpubs: doc.group_ids ?? [],
        fileLabel: 'doc',
      });
      if (handled) this.handleDocSourceInput(this.docEditorContent);
    },

    async handleDocBlockPaste(event) {
      const doc = this.selectedDocument;
      if (!doc) return;
      const handled = await this.handleInlineImagePaste(event, {
        modelKey: 'docBlockBuffer',
        ownerNpub: doc.owner_npub || this.workspaceOwnerNpub || this.session?.npub,
        accessGroupNpubs: doc.group_ids ?? [],
        fileLabel: 'doc-block',
      });
      if (handled) this.updateDocBlockBuffer(this.docBlockBuffer);
    },

    async handleDocCommentPaste(event) {
      const doc = this.selectedDocument;
      if (!doc) return;
      await this.handleInlineImagePaste(event, {
        modelKey: 'newDocCommentBody',
        ownerNpub: doc.owner_npub || this.workspaceOwnerNpub || this.session?.npub,
        accessGroupNpubs: doc.group_ids ?? [],
        fileLabel: 'doc-comment',
      });
    },

    async handleDocCommentReplyPaste(event) {
      const doc = this.selectedDocument;
      if (!doc) return;
      await this.handleInlineImagePaste(event, {
        modelKey: 'newDocCommentReplyBody',
        ownerNpub: doc.owner_npub || this.workspaceOwnerNpub || this.session?.npub,
        accessGroupNpubs: doc.group_ids ?? [],
        fileLabel: 'doc-reply',
      });
    },

    renderMarkdown(md) {
      const source = String(md || '');
      if (!source) return '';

      const escapeHtml = (value) => value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      const inline = (value) => escapeHtml(value)
        .replace(/!\[([^\]]*)\]\(storage:\/\/([^)]+)\)/g, '<span class="md-storage-image-wrap"><img class="md-storage-image md-storage-image-pending" data-storage-object-id="$2" alt="$1" loading="lazy" /><span class="md-storage-image-label">$1</span></span>')
        .replace(/!\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g, '<span class="md-storage-image-wrap"><img class="md-storage-image" src="$2" alt="$1" loading="lazy" /><span class="md-storage-image-label">$1</span></span>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

      const lines = source.replace(/\r\n?/g, '\n').split('\n');
      const out = [];
      let inList = false;
      let inCode = false;
      let codeLines = [];

      const flushList = () => {
        if (inList) {
          out.push('</ul>');
          inList = false;
        }
      };

      const flushCode = () => {
        if (inCode) {
          out.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
          inCode = false;
          codeLines = [];
        }
      };

      for (const rawLine of lines) {
        const line = rawLine ?? '';
        if (line.trim().startsWith('```')) {
          flushList();
          if (inCode) flushCode();
          else inCode = true;
          continue;
        }
        if (inCode) {
          codeLines.push(line);
          continue;
        }
        const checkboxMatch = line.match(/^[-*]\s+\[([ xX])\]\s+(.*)$/);
        if (checkboxMatch) {
          if (!inList) {
            out.push('<ul>');
            inList = true;
          }
          const checked = checkboxMatch[1].toLowerCase() === 'x';
          out.push(`<li><label class="md-checkbox"><input type="checkbox" disabled ${checked ? 'checked' : ''} /><span>${inline(checkboxMatch[2])}</span></label></li>`);
          continue;
        }
        const listMatch = line.match(/^[-*]\s+(.*)$/);
        if (listMatch) {
          if (!inList) {
            out.push('<ul>');
            inList = true;
          }
          out.push(`<li>${inline(listMatch[1])}</li>`);
          continue;
        }
        flushList();
        if (!line.trim()) {
          out.push('');
          continue;
        }
        const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
        if (headingMatch) {
          const level = headingMatch[1].length;
          out.push(`<h${level}>${inline(headingMatch[2])}</h${level}>`);
          continue;
        }
        if (/^>\s?/.test(line)) {
          out.push(`<blockquote><p>${inline(line.replace(/^>\s?/, ''))}</p></blockquote>`);
          continue;
        }
        out.push(`<p>${inline(line)}</p>`);
      }

      flushList();
      flushCode();

      return out.join('\n');
    },

    resetNewGroupDraft() {
      this.newGroupName = '';
      this.newGroupMemberQuery = '';
      this.newGroupMembers = [];
    },

    resetEditGroupDraft() {
      this.editGroupId = '';
      this.editGroupName = '';
      this.editGroupMemberQuery = '';
      this.editGroupMembers = [];
    },

    openNewGroupModal() {
      if (this.groupActionsLocked) return;
      this.resetNewGroupDraft();
      this.error = null;
      this.showNewGroupModal = true;
    },

    closeNewGroupModal() {
      if (this.groupCreatePending) return;
      this.showNewGroupModal = false;
      this.resetNewGroupDraft();
    },

    openEditGroupModal(groupId) {
      if (this.groupActionsLocked) return;
      const group = this.groups.find((item) => item.group_id === groupId || item.group_npub === groupId);
      if (!group) return;

      this.error = null;
      this.editGroupId = group.group_id || group.group_npub;
      this.editGroupName = group.name || '';
      this.editGroupMemberQuery = '';
      this.editGroupMembers = this.mapGroupDraftMembers(group.member_npubs ?? []);
      this.showEditGroupModal = true;
    },

    closeEditGroupModal() {
      if (this.groupEditPending) return;
      this.showEditGroupModal = false;
      this.resetEditGroupDraft();
    },

    isGroupDeletePending(groupId) {
      return this.groupDeletePendingId === groupId;
    },

    canRemoveEditGroupMember(memberNpub) {
      const activeGroup = this.groups.find((item) => item.group_id === this.editGroupId || item.group_npub === this.editGroupId);
      return memberNpub !== this.session?.npub && memberNpub !== activeGroup?.owner_npub;
    },

    openNewChannelModal() {
      this.newChannelMode = 'dm';
      this.newChannelDmNpub = '';
      this.newChannelName = '';
      this.newChannelDescription = '';
      this.newChannelGroupId = '';
      this.showNewChannelModal = true;
    },

    closeNewChannelModal() {
      this.showNewChannelModal = false;
    },

    async createDmChannel() {
      const ownerNpub = this.workspaceOwnerNpub;
      const memberNpub = this.session?.npub;
      const targetNpub = this.newChannelDmNpub.trim();
      if (!ownerNpub || !memberNpub || !targetNpub) return;

      try {
        const profileName = this.chatProfiles[targetNpub]?.name || targetNpub.slice(0, 12) + '…';
        const name = `DM: ${profileName}`;
        const group = await this.createEncryptedGroup(name, [targetNpub]);
        const groupId = group.group_id;
        const groupNpub = group.group_npub;
        await this.rememberPeople([ownerNpub, targetNpub], 'chat');

        const channelId = crypto.randomUUID();
        const now = new Date().toISOString();
        const channelRow = {
          record_id: channelId,
          owner_npub: ownerNpub,
          title: name,
          group_ids: [groupNpub],
          participant_npubs: [memberNpub, targetNpub],
          record_state: 'active',
          version: 1,
          updated_at: now,
        };

        await upsertChannel(channelRow);

        const envelope = await outboundChannel({
          record_id: channelId,
          owner_npub: ownerNpub,
          title: name,
          group_ids: [groupNpub],
          participant_npubs: [memberNpub, targetNpub],
          record_state: 'active',
          signature_npub: this.session?.npub,
          write_group_npub: groupNpub,
        });

        await addPendingWrite({
          record_id: channelId,
          record_family_hash: recordFamilyHash('channel'),
          envelope,
        });

        await this.performSync({ silent: false });
        this.selectedChannelId = channelId;
        await this.refreshMessages();
        this.ensureBackgroundSync(true);
        this.closeNewChannelModal();
      } catch (e) {
        this.error = e.message;
      }
    },

    async createNamedChannel() {
      const ownerNpub = this.workspaceOwnerNpub;
      const title = this.newChannelName.trim();
      const groupNpub = this.newChannelGroupId;
      if (!ownerNpub || !title || !groupNpub) return;

      try {
        const group = this.groups.find(g => (g.group_npub || g.group_id) === groupNpub);
        const participants = group?.member_npubs ?? [ownerNpub];

        const channelId = crypto.randomUUID();
        const now = new Date().toISOString();
        const channelRow = {
          record_id: channelId,
          owner_npub: ownerNpub,
          title,
          group_ids: [groupNpub],
          participant_npubs: [...new Set(participants)],
          record_state: 'active',
          version: 1,
          updated_at: now,
        };

        await upsertChannel(channelRow);

        const envelope = await outboundChannel({
          record_id: channelId,
          owner_npub: ownerNpub,
          title,
          group_ids: [groupNpub],
          participant_npubs: [...new Set(participants)],
          record_state: 'active',
          signature_npub: this.session?.npub,
          write_group_npub: groupNpub,
        });

        await addPendingWrite({
          record_id: channelId,
          record_family_hash: recordFamilyHash('channel'),
          envelope,
        });

        await this.performSync({ silent: false });
        this.selectedChannelId = channelId;
        await this.refreshMessages();
        this.ensureBackgroundSync(true);
        this.closeNewChannelModal();
      } catch (e) {
        this.error = e.message;
      }
    },

    addPendingGroupMember(suggestion) {
      if (!suggestion || this.groupCreatePending) return;
      if (this.newGroupMembers.some((member) => member.npub === suggestion.npub)) return;
      this.newGroupMembers = [...this.newGroupMembers, suggestion];
      this.newGroupMemberQuery = '';
    },

    addGroupMemberFromQuery() {
      if (this.groupCreatePending) return;
      const { added, members } = this.consumeGroupMemberQuery(this.newGroupMemberQuery, this.newGroupMembers);
      if (added) {
        this.newGroupMembers = members;
        this.newGroupMemberQuery = '';
      }
    },

    removePendingGroupMember(npub) {
      if (this.groupCreatePending) return;
      this.newGroupMembers = this.newGroupMembers.filter((member) => member.npub !== npub);
    },

    addPendingEditGroupMember(suggestion) {
      if (!suggestion || this.groupEditPending) return;
      if (this.editGroupMembers.some((member) => member.npub === suggestion.npub)) return;
      this.editGroupMembers = [...this.editGroupMembers, suggestion];
      this.editGroupMemberQuery = '';
    },

    addEditGroupMemberFromQuery() {
      if (this.groupEditPending) return;
      const { added, members } = this.consumeGroupMemberQuery(this.editGroupMemberQuery, this.editGroupMembers);
      if (added) {
        this.editGroupMembers = members;
        this.editGroupMemberQuery = '';
      }
    },

    removePendingEditGroupMember(npub) {
      if (this.groupEditPending || !this.canRemoveEditGroupMember(npub)) return;
      this.editGroupMembers = this.editGroupMembers.filter((member) => member.npub !== npub);
    },

    async createSharingGroup() {
      if (this.groupCreatePending) return;
      this.error = null;
      const ownerNpub = this.session?.npub;
      if (!ownerNpub) {
        this.error = 'Sign in first';
        return;
      }
      if (!this.newGroupName.trim()) {
        this.error = 'Group name is required';
        return;
      }

      const { members } = this.consumeGroupMemberQuery(this.newGroupMemberQuery, this.newGroupMembers);
      this.newGroupMembers = members;
      this.newGroupMemberQuery = '';

      const memberNpubs = [...new Set([ownerNpub, ...members.map((member) => member.npub)])];
      this.groupCreatePending = true;

      try {
        await this.createEncryptedGroup(this.newGroupName.trim(), memberNpubs);
        await this.rememberPeople(members.map((member) => member.npub), 'group');
        this.showNewGroupModal = false;
        this.resetNewGroupDraft();
      } catch (error) {
        this.error = error?.message || 'Failed to create group';
      } finally {
        this.groupCreatePending = false;
      }
    },

    async renameSharingGroup(groupId, newName) {
      this.error = null;
      try {
        await this.updateSharingGroupName(groupId, newName);
      } catch (error) {
        this.error = error?.message || 'Failed to rename group';
      }
    },

    async saveGroupEdits() {
      if (this.groupEditPending) return;
      this.error = null;

      const group = this.groups.find((item) => item.group_id === this.editGroupId || item.group_npub === this.editGroupId);
      if (!group?.group_id) {
        this.error = 'Group not found';
        return;
      }

      const trimmedName = String(this.editGroupName || '').trim();
      if (!trimmedName) {
        this.error = 'Group name is required';
        return;
      }

      const { members } = this.consumeGroupMemberQuery(this.editGroupMemberQuery, this.editGroupMembers);
      this.editGroupMembers = members;
      this.editGroupMemberQuery = '';

      const desiredMembers = [...new Set(members.map((member) => String(member.npub || '').trim()).filter(Boolean))];
      if (desiredMembers.length === 0) {
        this.error = 'Group must have at least one member';
        return;
      }

      const existingMembers = [...new Set((group.member_npubs ?? []).map((member) => String(member || '').trim()).filter(Boolean))];
      const membersToAdd = desiredMembers.filter((memberNpub) => !existingMembers.includes(memberNpub));
      const membersToRemove = existingMembers.filter((memberNpub) => !desiredMembers.includes(memberNpub));

      if (trimmedName === group.name && membersToAdd.length === 0 && membersToRemove.length === 0) {
        this.closeEditGroupModal();
        return;
      }

      this.groupEditPending = true;

      try {
        if (trimmedName !== group.name) {
          await this.updateSharingGroupName(group.group_id, trimmedName, { refresh: false });
        }
        for (const memberNpub of membersToAdd) {
          await this.addEncryptedGroupMember(group.group_id, memberNpub, { refresh: false });
        }
        for (const memberNpub of membersToRemove) {
          await this.removeEncryptedGroupMember(group.group_id, memberNpub, { refresh: false });
        }

        await this.rememberPeople(desiredMembers, 'group');
        await this.refreshGroups();
        this.showEditGroupModal = false;
        this.resetEditGroupDraft();
      } catch (error) {
        this.error = error?.message || 'Failed to update group';
      } finally {
        this.groupEditPending = false;
      }
    },

    async deleteSharingGroup(groupId) {
      if (this.groupDeletePendingId || this.groupCreatePending || this.groupEditPending) return;
      const ownerNpub = this.session?.npub || this.ownerNpub;
      if (!ownerNpub || !groupId) {
        this.error = 'Select a group first';
        return;
      }

      const group = this.groups.find((item) => item.group_id === groupId || item.group_npub === groupId);
      if (typeof window !== 'undefined') {
        const confirmed = window.confirm(`Delete group "${group?.name || 'Untitled group'}"?`);
        if (!confirmed) return;
      }

      this.error = null;
      this.groupDeletePendingId = groupId;
      try {
        await deleteGroup(groupId);
        await deleteGroupById(groupId);
        this.groups = this.groups.filter((item) => item.group_id !== groupId && item.group_npub !== groupId);
        if (this.editGroupId === groupId) {
          this.showEditGroupModal = false;
          this.resetEditGroupDraft();
        }
      } catch (error) {
        this.error = error?.message || 'Failed to delete group';
      } finally {
        this.groupDeletePendingId = null;
      }
    },

    // --- actions ---

    async createBotDm() {
      this.error = null;
      const ownerNpub = this.workspaceOwnerNpub;
      const memberNpub = this.session?.npub;
      if (!ownerNpub || !memberNpub || !this.botNpub) {
        this.error = 'Sign in and set bot npub first';
        return;
      }
      if (!this.backendUrl) {
        this.error = 'Set backend URL first';
        return;
      }

      try {
        const name = `DM: ${memberNpub.slice(0, 12)}… + bot`;
        const group = await this.createEncryptedGroup(name, [this.botNpub]);
        const groupId = group.group_id;
        const groupNpub = group.group_npub;
        await this.rememberPeople([memberNpub, this.botNpub], 'chat');

        const channelId = crypto.randomUUID();
        const channelRow = {
          record_id: channelId,
          owner_npub: ownerNpub,
          title: name,
          group_ids: [groupNpub],
          participant_npubs: [memberNpub, this.botNpub],
          record_state: 'active',
          version: 1,
          updated_at: new Date().toISOString(),
        };

        await upsertChannel(channelRow);

        const envelope = await outboundChannel({
          record_id: channelId,
          owner_npub: ownerNpub,
          title: name,
          group_ids: [groupNpub],
          participant_npubs: [memberNpub, this.botNpub],
          record_state: 'active',
          signature_npub: this.session?.npub,
          write_group_npub: groupNpub,
        });

        await addPendingWrite({
          record_id: channelId,
          record_family_hash: recordFamilyHash('channel'),
          envelope,
        });

        await this.performSync({ silent: false });
        this.selectedChannelId = channelId;
        await this.refreshMessages();
        this.ensureBackgroundSync(true);
      } catch (e) {
        this.error = e.message;
      }
    },

    async deleteSelectedChannel() {
      this.error = null;
      const channel = this.selectedChannel;
      if (!channel) {
        this.error = 'Select a channel first';
        return;
      }

      if (typeof window !== 'undefined') {
        const confirmed = window.confirm(`Delete channel "${this.getChannelLabel(channel)}"?`);
        if (!confirmed) return;
      }

      try {
        const now = new Date().toISOString();
        const nextVersion = (channel.version ?? 1) + 1;
        const fallbackNextChannelId = this.channels.find((item) => item.record_id !== channel.record_id)?.record_id ?? null;
        this.showChannelSettingsModal = false;

        await upsertChannel({
          ...channel,
          record_state: 'deleted',
          version: nextVersion,
          updated_at: now,
        });

        this.channels = this.channels.filter((item) => item.record_id !== channel.record_id);
        this.selectedChannelId = fallbackNextChannelId;
        this.closeThread();
        await this.refreshMessages();

        const envelope = await outboundChannel({
          record_id: channel.record_id,
          owner_npub: channel.owner_npub,
          title: channel.title,
          group_ids: channel.group_ids ?? [],
          participant_npubs: channel.participant_npubs ?? [],
          version: nextVersion,
          previous_version: channel.version ?? 1,
          record_state: 'deleted',
          signature_npub: this.session?.npub,
          write_group_npub: this.getPreferredChannelWriteGroup(channel),
        });

        await addPendingWrite({
          record_id: channel.record_id,
          record_family_hash: recordFamilyHash('channel'),
          envelope,
        });

        await this.performSync({ silent: false });
        await this.refreshChannels();
        this.selectedChannelId = this.selectedChannelId ?? this.channels[0]?.record_id ?? null;
        await this.refreshMessages();
        this.ensureBackgroundSync(true);
      } catch (error) {
        this.error = error?.message || 'Failed to delete channel';
      }
    },

    async sendMessage() {
      this.error = null;
      const drafts = [...this.messageAudioDrafts];
      if (this.messageImageUploadCount > 0 || this.containsInlineImageUploadToken(this.messageInput)) {
        this.error = 'Wait for image upload to finish.';
        return;
      }
      if (!this.messageInput.trim() && drafts.length === 0) return;
      if (!this.selectedChannelId) {
        this.error = 'Select a channel first';
        return;
      }

      const channel = this.selectedChannel;
      if (!channel) {
        this.error = 'Channel not found';
        return;
      }

      const msgId = crypto.randomUUID();
      const now = new Date().toISOString();
      const body = this.messageInput.trim();
      const { attachments } = await this.materializeAudioDrafts({
        drafts,
        target_record_id: msgId,
        target_record_family_hash: recordFamilyHash('chat_message'),
        target_group_ids: channel.group_ids ?? [],
        write_group_npub: this.getPreferredChannelWriteGroup(channel),
      });

      const localRow = {
        record_id: msgId,
        channel_id: this.selectedChannelId,
        parent_message_id: null,
        body,
        attachments,
        sender_npub: this.session?.npub,
        sync_status: 'pending',
        record_state: 'active',
        version: 1,
        updated_at: now,
      };

      await upsertMessage(localRow);
      this.patchMessageLocal(localRow);
      this.messageInput = '';
      this.messageAudioDrafts = [];

      const envelope = await outboundChatMessage({
        record_id: msgId,
        owner_npub: channel.owner_npub || this.workspaceOwnerNpub || this.session?.npub,
        channel_id: this.selectedChannelId,
        parent_message_id: null,
        body,
        attachments,
        channel_group_ids: channel.group_ids ?? [],
        write_group_npub: this.getPreferredChannelWriteGroup(channel),
        signature_npub: this.session?.npub,
      });

      await addPendingWrite({
        record_id: msgId,
        record_family_hash: recordFamilyHash('chat_message'),
        envelope,
      });

      try {
        await this.performSync({ silent: false });
      } catch (error) {
        await this.setMessageSyncStatus(msgId, 'failed');
        this.error = error?.message || 'Failed to sync message';
      } finally {
        this.ensureBackgroundSync(true);
      }
    },

    async sendThreadReply() {
      this.error = null;
      const drafts = [...this.threadAudioDrafts];
      if (this.threadImageUploadCount > 0 || this.containsInlineImageUploadToken(this.threadInput)) {
        this.error = 'Wait for image upload to finish.';
        return;
      }
      if (!this.threadInput.trim() && drafts.length === 0) return;
      if (!this.activeThreadId || !this.selectedChannelId) {
        this.error = 'Open a thread first';
        return;
      }

      const channel = this.selectedChannel;
      if (!channel) {
        this.error = 'Channel not found';
        return;
      }

      const msgId = crypto.randomUUID();
      const now = new Date().toISOString();
      const body = this.threadInput.trim();
      const { attachments } = await this.materializeAudioDrafts({
        drafts,
        target_record_id: msgId,
        target_record_family_hash: recordFamilyHash('chat_message'),
        target_group_ids: channel.group_ids ?? [],
        write_group_npub: this.getPreferredChannelWriteGroup(channel),
      });

      const localRow = {
        record_id: msgId,
        channel_id: this.selectedChannelId,
        parent_message_id: this.activeThreadId,
        body,
        attachments,
        sender_npub: this.session?.npub,
        sync_status: 'pending',
        record_state: 'active',
        version: 1,
        updated_at: now,
      };
      await upsertMessage(localRow);
      this.patchMessageLocal(localRow);
      this.threadInput = '';
      this.threadAudioDrafts = [];

      const envelope = await outboundChatMessage({
        record_id: msgId,
        owner_npub: channel.owner_npub || this.workspaceOwnerNpub || this.session?.npub,
        channel_id: this.selectedChannelId,
        parent_message_id: this.activeThreadId,
        body,
        attachments,
        channel_group_ids: channel.group_ids ?? [],
        write_group_npub: this.getPreferredChannelWriteGroup(channel),
        signature_npub: this.session?.npub,
      });

      await addPendingWrite({
        record_id: msgId,
        record_family_hash: recordFamilyHash('chat_message'),
        envelope,
      });

      try {
        await this.performSync({ silent: false });
      } catch (error) {
        await this.setMessageSyncStatus(msgId, 'failed');
        this.error = error?.message || 'Failed to sync reply';
      } finally {
        this.ensureBackgroundSync(true);
      }
    },

    async deleteActiveThread() {
      this.error = null;
      const parent = this.getThreadParentMessage();
      if (!parent || !this.selectedChannelId) {
        this.error = 'Open a thread first';
        return;
      }

      if (typeof window !== 'undefined') {
        const confirmed = window.confirm('Delete this thread and its replies?');
        if (!confirmed) return;
      }

      const channel = this.selectedChannel;
      const threadMessages = [parent, ...this.threadMessages];

      for (const message of threadMessages) {
        const nextVersion = (message.version ?? 1) + 1;
        await upsertMessage({
          ...message,
          record_state: 'deleted',
          sync_status: 'pending',
          version: nextVersion,
          updated_at: new Date().toISOString(),
        });

        const envelope = await outboundChatMessage({
          record_id: message.record_id,
          owner_npub: channel?.owner_npub || this.workspaceOwnerNpub || message.sender_npub,
          channel_id: message.channel_id,
          parent_message_id: message.parent_message_id,
          body: message.body,
          channel_group_ids: channel?.group_ids ?? [],
          write_group_npub: this.getPreferredChannelWriteGroup(channel),
          version: nextVersion,
          previous_version: message.version ?? 1,
          signature_npub: this.session?.npub,
          record_state: 'deleted',
        });

        await addPendingWrite({
          record_id: message.record_id,
          record_family_hash: recordFamilyHash('chat_message'),
          envelope,
        });
      }

      await this.performSync({ silent: false });
      this.closeThread();
      await this.refreshMessages();
      this.ensureBackgroundSync(true);
    },

    async syncNow() {
      try {
        await this.performSync({ silent: false });
      } catch (e) {
        // performSync already surfaced the error state
      }
      this.ensureBackgroundSync();
    },
  });

  Alpine.start();
}
