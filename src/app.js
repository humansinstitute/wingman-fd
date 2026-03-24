/**
 * Alpine.js app store — the single source of reactive UI state.
 * All data comes from Dexie; network goes through the sync worker.
 */

import Alpine from 'alpinejs';
import { liveQuery } from 'dexie';
import { commentBelongsToDocBlock } from './doc-comment-anchors.js';
import { docsManagerMixin } from './docs-manager.js';
import { scopesManagerMixin } from './scopes-manager.js';
import { channelsManagerMixin } from './channels-manager.js';
import { audioRecordingManagerMixin } from './audio-recording-manager.js';
import { storageImageManagerMixin } from './storage-image-manager.js';
import { triggersManagerMixin } from './triggers-manager.js';
import { workspaceManagerMixin, guessDefaultBackendUrl } from './workspace-manager.js';
import { chatMessageManagerMixin } from './chat-message-manager.js';
import { syncManagerMixin } from './sync-manager.js';
import { peopleProfilesManagerMixin } from './people-profiles-manager.js';
import { connectSettingsManagerMixin } from './connect-settings-manager.js';
import {
  taskBoardStateMixin,
  UNSCOPED_TASK_BOARD_ID,
  WEEKDAY_OPTIONS,
} from './task-board-state.js';
import { renderMarkdownToHtml } from './markdown.js';
import { resolveChannelLabel } from './channel-labels.js';
import { buildFlightDeckDocumentTitle } from './page-title.js';
import { getRunningBuildId } from './version-check.js';
import {
  CALENDAR_VIEWS,
  buildTaskCalendar,
  getTodayDateKey,
  shiftCalendarDate,
} from './task-calendar.js';

import {
  toRaw,
  normalizeBackendUrl,
  workspaceSettingsRecordId,
  storageObjectIdFromRef,
  storageImageCacheKey,
  defaultRecordSignature,
  sameListBySignature,
  parseMarkdownBlocks,
  assembleMarkdownBlocks,
} from './utils/state-helpers.js';
import { getShortNpub, getInitials } from './utils/naming.js';
import {
  hasWorkspaceDb,
  migrateFromLegacyDb,
  getSettings,
  saveSettings,
  getWorkspaceSettings,
  upsertWorkspaceSettings,
  getCachedStorageImage,
  cacheStorageImage,
  getChannelsByOwner,
  getMessagesByChannel,
  getRecentChatMessagesSince,
  getRecentDocumentChangesSince,
  getRecentDirectoryChangesSince,
  getRecentTaskChangesSince,
  getRecentScheduleChangesSince,
  getRecentCommentsSince,
  upsertChannel,
  getAudioNotesByOwner,
  getDocumentsByOwner,
  upsertDocument,
  getDocumentById,
  getDirectoriesByOwner,
  upsertDirectory,
  getDirectoryById,
  getTasksByOwner,
  upsertTask,
  getTaskById,
  getSchedulesByOwner,
  upsertSchedule,
  getScheduleById,
  getCommentsByTarget,
  upsertComment,
  getScopesByOwner,
  addPendingWrite,
  getChannelById,
  getAddressBookPeople,
  clearRuntimeData,
} from './db.js';
import {
  setBaseUrl,
  prepareStorageObject,
  uploadStorageObject,
  completeStorageObject,
} from './api.js';
import {
  outboundChannel,
  recordFamilyHash,
} from './translators/chat.js';
import {
  outboundDocument,
  outboundDirectory,
} from './translators/docs.js';
import {
  outboundTask,
} from './translators/tasks.js';
import { outboundSchedule } from './translators/schedules.js';
import { outboundComment } from './translators/comments.js';
import { recordFamilyHash as taskFamilyHash } from './translators/tasks.js';
import {
  isTaskUnscoped,
} from './task-board-scopes.js';
import {
  buildCascadedSubtaskUpdate,
  taskScopeAssignmentChanged,
} from './task-scope-cascade.js';
import { parseSuperBasedToken } from './superbased-token.js';
import {
  signLoginEvent,
  getPubkeyFromEvent,
  pubkeyToNpub,
  tryAutoLoginFromStorage,
  clearAutoLogin,
  setAutoLogin,
  hasExtensionSigner,
  waitForExtensionSigner,
} from './auth/nostr.js';
import {
  bootstrapWrappedGroupKeys,
  clearCryptoContext,
  setActiveSessionNpub,
  wrapKnownGroupKeyForMember,
} from './crypto/group-keys.js';
import { mergeWorkspaceEntries, workspaceFromToken, findWorkspaceBySlug } from './workspaces.js';
import { parseRouteLocation } from './route-helpers.js';
import {
  buildStoragePrepareBody,
} from './storage-payloads.js';

// Constants UNSCOPED_TASK_BOARD_ID, WEEKDAY_OPTIONS imported from task-board-state.js


/**
 * Merge mixin objects into a target, preserving getters/setters as accessors
 * instead of evaluating them (which plain object spread does).
 */
function applyMixins(target, ...mixins) {
  for (const mixin of mixins) {
    const descriptors = Object.getOwnPropertyDescriptors(mixin);
    Object.defineProperties(target, descriptors);
  }
  return target;
}

export function initApp() {
  const storeObj = {
    FAST_SYNC_MS: 1000,
    IDLE_SYNC_MS: 10000,
    MESSAGE_PREVIEW_MAX_LINES: 15,
    COMPOSER_MAX_LINES: 12,
    THREAD_REPLY_PAGE_SIZE: 6,

    // settings
    appBuildId: getRunningBuildId(),
    backendUrl: '',
    ownerNpub: '',
    botNpub: '',
    session: null,
    settingsTab: 'workspace',
    navSection: 'chat',
    calendarViews: CALENDAR_VIEWS,
    calendarView: 'month',
    calendarAnchorDate: getTodayDateKey(),
    navCollapsed: false,
    mobileNavOpen: false,
    routeSyncPaused: false,
    popstateHandler: null,
    showAvatarMenu: false,
    showChannelSettingsModal: false,
    presetConnecting: false,
    // Connect modal (two-step)
    showConnectModal: false,
    connectStep: 1,
    connectHostUrl: '',
    connectHostLabel: '',
    connectHostServiceNpub: '',
    connectHostError: null,
    connectHostBusy: false,
    connectManualUrl: '',
    connectWorkspaces: [],
    connectWorkspacesBusy: false,
    connectWorkspacesError: null,
    connectNewWorkspaceName: '',
    connectNewWorkspaceDescription: '',
    connectCreatingWorkspace: false,
    connectTokenInput: '',
    connectShowTokenFallback: false,
    knownHosts: [],
    showAgentConnectModal: false,
    syncStatus: 'synced',
    syncSession: {
      state: 'synced',
      phase: 'idle',
      startedAt: null,
      finishedAt: null,
      lastSuccessAt: null,
      currentFamily: null,
      completedFamilies: 0,
      totalFamilies: 0,
      pushed: 0,
      pushTotal: 0,
      pulled: 0,
      error: null,
    },
    hasForcedInitialBackfill: false,
    hasForcedTaskFamilyBackfill: false,
    backgroundSyncTimer: null,
    backgroundSyncInFlight: false,
    syncBackoffMs: 0,
    visibilityHandler: null,
    docConnectorFrame: null,
    docConnectorScrollHandler: null,
    docConnectorResizeHandler: null,
    chatFeedScrollFrame: null,
    threadRepliesScrollFrame: null,
    chatPreviewMeasureFrame: null,
    sharedLiveSubscriptions: [],
    workspaceLiveSubscriptions: [],
    channelLiveSubscription: null,
    taskCommentsLiveSubscription: null,
    docCommentsLiveSubscription: null,
    docCommentBackfillAttemptsByDocId: {},
    pendingChatScrollToLatest: false,
    pendingThreadScrollToLatest: false,

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
    threadVisibleReplyCount: 6,
    threadSize: 'default',
    focusMessageId: null,
    expandedChatMessageIds: [],
    truncatedChatMessageIds: [],
    chatProfiles: {},
    statusTimeRange: '1h',
    statusRecentChanges: [],
    selectedDocType: null,
    selectedDocId: null,
    selectedDocCommentId: null,
    docVersioningOpen: false,
    docVersionHistory: [],
    docVersioningLoading: false,
    docVersioningError: null,
    docVersioningSelectedIndex: -1,
    docVersioningPreviewHtml: '',
    activeTaskId: null,
    tasks: [],
    schedules: [],
    taskComments: [],
    taskCommentAudioDrafts: [],
    taskFilter: '',
    taskFilterTags: [],
    selectedTaskIds: [],
    bulkTaskBusy: false,
    selectedBoardId: null,
    showBoardPicker: false,
    boardPickerQuery: '',
    showBoardDescendantTasks: false,
    taskViewMode: 'kanban',
    taskBoardScopeSetupInFlight: false,
    newTaskTitle: '',
    newSubtaskTitle: '',
    newTaskCommentBody: '',
    copiedTaskLinkId: null,
    editingTask: null,
    taskAssigneeQuery: '',
    taskScopeCascadePending: false,
    taskScopeCascadeMessage: '',
    showNewScheduleModal: false,
    newScheduleTitle: '',
    newScheduleDescription: '',
    newScheduleStart: '09:00',
    newScheduleEnd: '10:00',
    newScheduleDays: ['mon', 'tue', 'wed', 'thu', 'fri'],
    newScheduleTimezone: 'Australia/Perth',
    newScheduleRepeat: 'daily',
    newScheduleAssignedGroupId: null,
    newScheduleGroupQuery: '',
    editingScheduleId: null,
    editingScheduleDraft: null,
    editingScheduleGroupQuery: '',
    showTaskDetail: false,
    taskDescriptionEditing: false,
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
    newScopeAssignedGroupIds: [],
    newScopeGroupQuery: '',
    showNewScopeForm: false,
    scopeNavFocus: null,
    editingScopeId: null,
    editingScopeTitle: '',
    editingScopeDescription: '',
    editingScopeAssignedGroupIds: [],
    editingScopeGroupQuery: '',
    // @mentions
    mentionActive: false,
    mentionQuery: '',
    mentionResults: [],
    mentionSelectedIndex: 0,
    _mentionTargetEl: null,
    _mentionStartPos: -1,

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
    shareInviteNpub: '',
    shareInviteGroupId: '',
    shareInviteUrl: '',
    shareInvitePending: false,
    shareInviteError: null,
    shareInviteCopied: false,
    showNewChannelModal: false,
    newChannelMode: 'dm',
    newChannelDmNpub: '',
    newChannelName: '',
    newChannelDescription: '',
    newChannelGroupId: '',
    superbasedTokenInput: '',
    superbasedError: null,
    knownWorkspaces: [],
    workspaceProfileRowsByOwner: {},
    currentWorkspaceOwnerNpub: '',
    showWorkspaceSwitcherMenu: false,
    workspaceSwitchPendingNpub: '',
    removingWorkspace: false,
    workspaceSettingsRecordId: '',
    workspaceSettingsVersion: 0,
    workspaceSettingsGroupIds: [],
    workspaceHarnessUrl: '',
    workspaceProfileNameInput: '',
    workspaceProfileSlugInput: '',
    workspaceProfileDescriptionInput: '',
    workspaceProfileAvatarInput: '',
    workspaceProfileAvatarPreviewUrl: '',
    workspaceProfilePendingAvatarFile: null,
    workspaceProfilePendingAvatarObjectUrl: '',
    workspaceProfileDirty: false,
    workspaceProfileSaving: false,
    workspaceProfileError: null,
    defaultAgentNpub: '',
    defaultAgentQuery: '',
    wingmanHarnessInput: '',
    wingmanHarnessError: null,
    wingmanHarnessDirty: false,
    repairSelectedFamilyIds: ['comment', 'audio_note'],
    repairBusy: false,
    repairError: null,
    repairNotice: '',
    syncQuarantine: [],
    syncQuarantineBusy: false,
    syncQuarantineError: null,
    syncQuarantineNotice: '',

    // triggers
    workspaceTriggers: [],
    newTriggerType: 'manual',
    newTriggerName: '',
    newTriggerId: '',
    newTriggerBotNpub: '',
    newTriggerBotQuery: '',
    triggerMessage: {},
    triggerFiring: {},
    triggerError: null,
    triggerSuccess: null,
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
    workspaceProfileHydrationPromises: {},
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

    // workspace computed getters applied via workspaceManagerMixin (applyMixins)

    get superbasedTransportLabel() {
      if (this.useCvmSync && this.superbasedConnectionConfig?.relayUrl) return 'CVM relay';
      return this.backendUrl || 'Not configured';
    },

    get hasHarnessLink() {
      return Boolean(this.workspaceHarnessUrl);
    },

    // chat message getters applied via chatMessageManagerMixin (applyMixins)

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

    get currentFolderTitleLabel() {
      if (this.currentFolderBreadcrumbs.length === 0) return '';
      return this.currentFolderBreadcrumbs
        .map((folder) => folder.title || 'Untitled folder')
        .join(' / ');
    },

    get currentDocumentTitle() {
      return buildFlightDeckDocumentTitle({
        section: this.navSection,
        channelLabel: this.navSection === 'chat' && this.selectedChannel
          ? this.getChannelLabel(this.selectedChannel)
          : '',
        folderLabel: this.navSection === 'docs' ? this.currentFolderTitleLabel : '',
        docTitle: this.navSection === 'docs'
          ? (this.selectedDocument?.title || this.selectedDirectory?.title || '')
          : '',
      });
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

    // --- task board computed (extracted to task-board-state.js) ---
    // taskBoardStateMixin applied via applyMixins (has getters)

    // workspaceManagerMixin applied via applyMixins (display, switcher, settings)

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

    // peopleProfilesManagerMixin applied via applyMixins (suggestions, profile resolution)

    get groupActionsLocked() {
      return this.groupCreatePending || this.groupEditPending || !!this.groupDeletePendingId;
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

    // workspace list, profile editing, settings, CRUD — extracted to workspace-manager.js

    // syncManagerMixin applied via applyMixins (repair UI, quarantine, sync lifecycle)
    // connectSettingsManagerMixin applied via applyMixins (connection, settings, agent connect)

    // --- lifecycle ---

    async init() {
      this.startExtensionSignerWatch();
      this.initRouteSync();
      this.initDocCommentConnector();
      await migrateFromLegacyDb();
      this.startSharedLiveQueries();
      const settings = await getSettings();
      if (settings) {
        this.backendUrl = normalizeBackendUrl(settings.backendUrl ?? '');
        this.ownerNpub = settings.ownerNpub ?? '';
        this.botNpub = settings.botNpub ?? '';
        this.defaultAgentNpub = settings.defaultAgentNpub ?? '';
        this.superbasedTokenInput = settings.connectionToken ?? '';
        this.useCvmSync = settings.useCvmSync ?? this.useCvmSync;
        this.currentWorkspaceOwnerNpub = settings.currentWorkspaceOwnerNpub ?? '';
        this.knownWorkspaces = mergeWorkspaceEntries([], settings.knownWorkspaces ?? []);
        this.knownHosts = Array.isArray(settings.knownHosts) ? settings.knownHosts : [];
      }
      // Extract ?token= from URL (e.g. share link) and use it to bootstrap workspace
      if (typeof window !== 'undefined') {
        const urlParams = new URLSearchParams(window.location.search);
        const urlToken = urlParams.get('token');
        if (urlToken) {
          const urlConfig = parseSuperBasedToken(urlToken);
          if (urlConfig.isValid) {
            this.superbasedTokenInput = urlToken;
          }
          // Clean token from URL so it doesn't persist in browser history
          urlParams.delete('token');
          const cleanSearch = urlParams.toString();
          const cleanUrl = window.location.pathname + (cleanSearch ? '?' + cleanSearch : '') + window.location.hash;
          window.history.replaceState(null, '', cleanUrl);
        }
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
      await this.hydrateKnownWorkspaceProfiles();
      this.ensureBackgroundSync();
      await this.maybeAutoLogin();
      this.updateWorkspaceBootstrapPrompt();
      await this.loadRemoteWorkspaces();
      if (this.knownWorkspaces.length === 0 && this.superbasedConnectionConfig?.workspaceOwnerNpub && this.session?.npub) {
        await this.tryRecoverWorkspace();
      }
      if (!this.currentWorkspaceOwnerNpub && this.knownWorkspaces.length > 0) {
        this.currentWorkspaceOwnerNpub = this.knownWorkspaces[0].workspaceOwnerNpub;
      }
      if (this.currentWorkspaceOwnerNpub) {
        await this.selectWorkspace(this.currentWorkspaceOwnerNpub, { refresh: false });
      }
      this.updateWorkspaceBootstrapPrompt();
      if (this.session?.npub && (!this.backendUrl || !this.currentWorkspaceOwnerNpub)) {
        this.openConnectModal();
      }
      if (this.currentWorkspaceOwnerNpub) {
        await this.refreshGroups();
        this.selectedBoardId = this.readStoredTaskBoardId();
        this.validateSelectedBoardId();
        await this.refreshAddressBook();
        await this.refreshChannels();
        await this.refreshAudioNotes();
        await this.refreshDirectories();
        await this.refreshDocuments();
        await this.refreshScopes();
        await this.refreshTasks();
        await this.refreshSchedules();
        await this.ensureTaskBoardScopeSetup();
        await this.applyRouteFromLocation();
        if (this.navSection === 'chat' && this.selectedChannelId) {
          this.scheduleChatFeedScrollToBottom();
        }
        await this.refreshSyncStatus();
        await this.refreshStatusRecentChanges();
        if (this.defaultAgentNpub) this.resolveChatProfile(this.defaultAgentNpub);
      }
    },

    createLiveSubscription(query, onNext) {
      return liveQuery(query).subscribe({
        next: (value) => {
          Promise.resolve(onNext(value)).catch((error) => {
            console.error('Live query update failed:', error?.message || error);
          });
        },
        error: (error) => {
          console.error('Live query failed:', error?.message || error);
        },
      });
    },

    stopLiveSubscription(subscription) {
      if (!subscription) return;
      try {
        subscription.unsubscribe();
      } catch {
        /* ignore */
      }
    },

    stopSharedLiveQueries() {
      for (const subscription of this.sharedLiveSubscriptions) {
        this.stopLiveSubscription(subscription);
      }
      this.sharedLiveSubscriptions = [];
    },

    stopWorkspaceLiveQueries() {
      for (const subscription of this.workspaceLiveSubscriptions) {
        this.stopLiveSubscription(subscription);
      }
      this.workspaceLiveSubscriptions = [];
      this.stopSelectedChannelLiveQuery();
      this.stopTaskCommentsLiveQuery();
      this.stopDocCommentsLiveQuery();
    },

    stopSelectedChannelLiveQuery() {
      this.stopLiveSubscription(this.channelLiveSubscription);
      this.channelLiveSubscription = null;
    },

    stopTaskCommentsLiveQuery() {
      this.stopLiveSubscription(this.taskCommentsLiveSubscription);
      this.taskCommentsLiveSubscription = null;
    },

    stopDocCommentsLiveQuery() {
      this.stopLiveSubscription(this.docCommentsLiveSubscription);
      this.docCommentsLiveSubscription = null;
    },

    stopAllLiveQueries() {
      this.stopSharedLiveQueries();
      this.stopWorkspaceLiveQueries();
    },

    startSharedLiveQueries() {
      if (this.sharedLiveSubscriptions.length > 0) return;
      this.sharedLiveSubscriptions = [
        this.createLiveSubscription(
          () => getAddressBookPeople(),
          (people) => this.applyAddressBookPeople(people),
        ),
      ];
    },

    startWorkspaceLiveQueries() {
      this.stopWorkspaceLiveQueries();
      const ownerNpub = this.workspaceOwnerNpub;
      if (!ownerNpub) return;

      this.workspaceLiveSubscriptions = [
        this.createLiveSubscription(
          () => getChannelsByOwner(ownerNpub),
          (channels) => this.applyChannels(channels),
        ),
        this.createLiveSubscription(
          () => getAudioNotesByOwner(ownerNpub),
          (audioNotes) => this.applyAudioNotes(audioNotes),
        ),
        this.createLiveSubscription(
          () => getDirectoriesByOwner(ownerNpub),
          (directories) => this.applyDirectories(directories),
        ),
        this.createLiveSubscription(
          () => getDocumentsByOwner(ownerNpub),
          (documents) => this.applyDocuments(documents),
        ),
        this.createLiveSubscription(
          () => getTasksByOwner(ownerNpub),
          (tasks) => this.applyTasks(tasks),
        ),
        this.createLiveSubscription(
          () => getSchedulesByOwner(ownerNpub),
          (schedules) => this.applySchedules(schedules),
        ),
        this.createLiveSubscription(
          () => getScopesByOwner(ownerNpub),
          (scopes) => this.applyScopes(scopes),
        ),
      ];

      this.startSelectedChannelLiveQuery();
    },

    startSelectedChannelLiveQuery() {
      this.stopSelectedChannelLiveQuery();

      const workspaceOwnerNpub = this.workspaceOwnerNpub;
      const channelId = this.selectedChannelId;

      if (!workspaceOwnerNpub || !channelId) {
        this.applyMessages([], { scrollToLatest: false });
        return;
      }

      this.channelLiveSubscription = this.createLiveSubscription(
        () => getMessagesByChannel(channelId),
        (messages) => {
          if (this.workspaceOwnerNpub !== workspaceOwnerNpub || this.selectedChannelId !== channelId) return;
          return this.applyMessages(messages);
        },
      );
    },

    startTaskCommentsLiveQuery() {
      this.stopTaskCommentsLiveQuery();

      const workspaceOwnerNpub = this.workspaceOwnerNpub;
      const taskId = this.activeTaskId;

      if (!workspaceOwnerNpub || !taskId) {
        this.applyTaskComments([]);
        return;
      }

      this.taskCommentsLiveSubscription = this.createLiveSubscription(
        () => getCommentsByTarget(taskId),
        (comments) => {
          if (this.workspaceOwnerNpub !== workspaceOwnerNpub || this.activeTaskId !== taskId) return;
          return this.applyTaskComments(comments);
        },
      );
    },

    startDocCommentsLiveQuery(docId = this.selectedDocId) {
      this.stopDocCommentsLiveQuery();

      const workspaceOwnerNpub = this.workspaceOwnerNpub;
      const targetDocId = String(docId || '').trim();
      const documentFamilyHash = recordFamilyHash('document');

      if (!workspaceOwnerNpub || !targetDocId || this.selectedDocType !== 'document') {
        this.applyDocComments([]);
        return;
      }

      this.docCommentsLiveSubscription = this.createLiveSubscription(
        async () => {
          const comments = await getCommentsByTarget(targetDocId);
          return comments.filter((comment) => comment.target_record_family_hash === documentFamilyHash);
        },
        (comments) => {
          if (
            this.workspaceOwnerNpub !== workspaceOwnerNpub
            || this.selectedDocType !== 'document'
            || this.selectedDocId !== targetDocId
          ) return;
          return this.applyDocComments(comments, { docId: targetDocId, allowBackfill: true });
        },
      );
    },

    initRouteSync() {
      if (typeof window === 'undefined' || this.popstateHandler) return;
      this.popstateHandler = () => {
        this.applyRouteFromLocation();
      };
      window.addEventListener('popstate', this.popstateHandler);
    },

    updatePageTitle() {
      if (typeof document === 'undefined') return;
      document.title = this.currentDocumentTitle;
    },

    initDocCommentConnector() {
      if (typeof window === 'undefined' || this.docConnectorScrollHandler || this.docConnectorResizeHandler) return;
      this.docConnectorScrollHandler = () => this.scheduleDocCommentConnectorUpdate();
      this.docConnectorResizeHandler = () => this.scheduleDocCommentConnectorUpdate();
      window.addEventListener('scroll', this.docConnectorScrollHandler, { passive: true });
      window.addEventListener('resize', this.docConnectorResizeHandler, { passive: true });

      document.addEventListener('click', (e) => {
        const link = e.target.closest('.mention-link');
        if (!link) return;
        e.preventDefault();
        const type = link.dataset.mentionType;
        const id = link.dataset.mentionId;
        if (type && id) this.handleMentionNavigate(type, id);
      });
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

    // currentWorkspaceSlug getter in workspaceManagerMixin

    getRoutePath(section = this.navSection) {
      const slug = this.currentWorkspaceSlug;
      const page = (() => {
        switch (section) {
          case 'status': return 'notifications';
          case 'tasks': return 'tasks';
          case 'calendar': return 'calendar';
          case 'schedules': return 'schedules';
          case 'chat': return 'chat';
          case 'docs': return 'docs';
          case 'people': return 'people';
          case 'scopes': return 'scopes';
          case 'settings': return 'settings';
          default: return 'chat';
        }
      })();
      return `/${slug}/${page}`;
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
        if (this.docVersioningOpen) url.searchParams.set('versioning', '1');
        if (this.selectedDocCommentId) url.searchParams.set('commentid', this.selectedDocCommentId);
      } else if (this.navSection === 'tasks' || this.navSection === 'calendar') {
        if (this.selectedBoardId) url.searchParams.set('scopeid', this.selectedBoardId);
        if (this.showBoardDescendantTasks) url.searchParams.set('descendants', '1');
        if (this.navSection === 'tasks' && this.activeTaskId) url.searchParams.set('taskid', this.activeTaskId);
        if (this.navSection === 'tasks' && this.taskViewMode === 'list') url.searchParams.set('view', 'list');
      }

      return `${url.pathname}${url.search}`;
    },

    syncRoute(replace = false) {
      this.updatePageTitle();
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
        // Handle workspace slug from URL
        if (route.workspaceSlug) {
          const target = findWorkspaceBySlug(this.knownWorkspaces, route.workspaceSlug);
          if (target && target.workspaceOwnerNpub !== this.currentWorkspaceOwnerNpub) {
            // Different workspace slug — switch workspace
            this.routeSyncPaused = false;
            await this.handleWorkspaceSwitcherSelect(target.workspaceOwnerNpub);
            return;
          }
        } else if (!route.workspaceSlug && this.currentWorkspaceOwnerNpub) {
          // Bare /<page> URL (no slug) — redirect to /<slug>/<page>
          // This is handled by syncRoute(true) at the bottom
        }

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
            if (route.params.versioning) this.openDocVersioning();
          } else if (route.params.folderid) {
            this.navigateToFolder(route.params.folderid, { syncRoute: false });
          } else {
            this.selectedDocType = null;
            this.selectedDocId = null;
            this.currentFolderId = null;
            this.loadDocEditorFromSelection();
          }
        } else if (route.section === 'tasks' || route.section === 'calendar') {
          this.selectedBoardId = route.params.scopeid
            || route.params.groupid
            || this.readStoredTaskBoardId()
            || this.preferredTaskBoardId;
          this.showBoardDescendantTasks = route.params.descendants === '1';
          if (route.params.view === 'list') this.taskViewMode = 'list';
          else this.taskViewMode = 'kanban';
          this.validateSelectedBoardId();
          this.normalizeTaskFilterTags();
          this.persistSelectedBoardId(this.selectedBoardId);
          if (route.section === 'tasks' && route.params.taskid) {
            this.openTaskDetail(route.params.taskid);
          } else {
            this.closeTaskDetail({ syncRoute: false });
          }
        } else if (route.section === 'schedules') {
          this.cancelEditSchedule();
        }
      } finally {
        this.routeSyncPaused = false;
      }
      this.syncRoute(true);
    },

    startExtensionSignerWatch() {
      // Remove any previously registered listeners to avoid duplicates
      this.stopExtensionSignerWatch();

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
      this._extensionSignerRefresh = refresh;
      window.addEventListener('focus', refresh, { passive: true });
      window.addEventListener('pageshow', refresh, { passive: true });
      document.addEventListener('visibilitychange', refresh, { passive: true });
    },

    stopExtensionSignerWatch() {
      if (this.extensionSignerPollTimer) {
        clearInterval(this.extensionSignerPollTimer);
        this.extensionSignerPollTimer = null;
      }
      if (this._extensionSignerRefresh) {
        window.removeEventListener('focus', this._extensionSignerRefresh);
        window.removeEventListener('pageshow', this._extensionSignerRefresh);
        document.removeEventListener('visibilitychange', this._extensionSignerRefresh);
        this._extensionSignerRefresh = null;
      }
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
          await this.refreshGroups();
          await this.refreshChannels();
          await this.refreshSyncStatus();
        }
        this.updateWorkspaceBootstrapPrompt();
        if (!this.backendUrl || !this.currentWorkspaceOwnerNpub) {
          this.openConnectModal();
        }
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

        if (this.currentWorkspaceOwnerNpub) {
          await this.refreshGroups();
          await this.refreshChannels();
          await this.refreshSyncStatus();
        }
        this.updateWorkspaceBootstrapPrompt();
        if (!this.backendUrl || !this.currentWorkspaceOwnerNpub) {
          this.openConnectModal();
        }
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
      this.stopAllLiveQueries();
      this.stopExtensionSignerWatch();
      this.clearDocCommentConnector();
      this.revokeStorageImageObjectUrls();
      await clearAutoLogin();
      if (hasWorkspaceDb()) await clearRuntimeData();
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
      this.workspaceProfileRowsByOwner = {};
      this.workspaceSettingsRecordId = '';
      this.workspaceSettingsVersion = 0;
      this.workspaceSettingsGroupIds = [];
      this.workspaceHarnessUrl = '';
      this.revokeWorkspaceAvatarPreviewObjectUrl();
      this.workspaceProfileNameInput = '';
      this.workspaceProfileSlugInput = '';
      this.workspaceProfileDescriptionInput = '';
      this.workspaceProfileAvatarInput = '';
      this.workspaceProfileAvatarPreviewUrl = '';
      this.workspaceProfilePendingAvatarFile = null;
      this.workspaceProfileDirty = false;
      this.workspaceProfileSaving = false;
      this.workspaceProfileError = null;
      this.defaultAgentQuery = '';
      this.hasForcedTaskFamilyBackfill = false;
      this.wingmanHarnessInput = '';
      this.wingmanHarnessError = null;
      this.wingmanHarnessDirty = false;
      this.hasForcedInitialBackfill = false;
      this.docCommentBackfillAttemptsByDocId = {};
      this.loginError = null;
      this.error = null;
      this.showAvatarMenu = false;
      this.syncRoute(true);
      await this.refreshSyncStatus();
    },

    hasExtensionSigner() {
      return this.extensionSignerAvailable;
    },

    // uploadWorkspaceAvatarFile, saveWorkspaceProfile, saveHarnessSettings — in workspaceManagerMixin

    openHarnessLink() {
      if (!this.workspaceHarnessUrl || typeof window === 'undefined') return;
      window.open(this.workspaceHarnessUrl, '_blank', 'noopener,noreferrer');
    },

    // --- Triggers (extracted to triggers-manager.js) ---
    // triggersManagerMixin applied via applyMixins (has getters)

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
      this.showWorkspaceSwitcherMenu = false;
      if (section === 'tasks' || section === 'calendar') {
        this.validateSelectedBoardId();
        this.normalizeTaskFilterTags();
      }
      if (section !== 'schedules') {
        this.showNewScheduleModal = false;
        this.cancelEditSchedule();
      }
      if (section !== 'docs') {
        this.selectedDocCommentId = null;
      }
      if (section === 'chat') {
        if (!this.selectedChannelId && this.channels.length > 0) {
          this.selectChannel(this.channels[0].record_id);
        } else if (this.selectedChannelId) {
          this.scheduleChatFeedScrollToBottom();
        }
      }
      if (section === 'status') {
        this.refreshStatusRecentChanges();
      }
      if (options.syncRoute !== false) this.syncRoute();
      this.ensureBackgroundSync(true);
    },

    // channelsManagerMixin applied via applyMixins

    // chatMessageManagerMixin applied via applyMixins (scroll, composer, messages, threads)

    // audioRecordingManagerMixin applied via applyMixins (has getters)
    // storageImageManagerMixin applied via applyMixins

    applyDirectories(directories = []) {
      const nextDirectories = Array.isArray(directories) ? directories : [];
      if (!sameListBySignature(this.directories, nextDirectories)) {
        this.directories = nextDirectories;
      }
      this.updatePageTitle();
    },

    async refreshDirectories() {
      const ownerNpub = this.workspaceOwnerNpub;
      if (!ownerNpub) return;
      this.applyDirectories(await getDirectoriesByOwner(ownerNpub));
    },

    applyDocuments(documents = []) {
      const nextDocuments = Array.isArray(documents) ? documents : [];
      if (!sameListBySignature(this.documents, nextDocuments)) {
        this.documents = nextDocuments;
      }
      this.refreshOpenDocFromLatestDocument({ force: false });
      this.updatePageTitle();
    },

    async refreshDocuments() {
      const ownerNpub = this.workspaceOwnerNpub;
      if (!ownerNpub) return;
      this.applyDocuments(await getDocumentsByOwner(ownerNpub));
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
      const schedules = await getRecentScheduleChangesSince(sinceIso);
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
          subtitle: task.scope_id
            ? `Updated on ${this.getTaskBoardLabel(task)}`
            : 'Updated with no scope',
          updatedAt: task.updated_at,
          updatedTs: Date.parse(task.updated_at) || 0,
          recordId: task.record_id,
          boardScopeId: task.scope_id ?? task.scope_deliverable_id ?? task.scope_project_id ?? task.scope_product_id ?? null,
        });
      }

      for (const schedule of schedules) {
        items.push({
          id: `schedule:${schedule.record_id}:${schedule.version ?? 1}`,
          section: 'schedules',
          recordType: 'Schedule',
          title: schedule.title?.trim() || 'Untitled schedule',
          subtitle: `${this.formatScheduleDays(schedule.days)} ${schedule.time_start || '??:??'}-${schedule.time_end || '??:??'}`,
          updatedAt: schedule.updated_at,
          updatedTs: Date.parse(schedule.updated_at) || 0,
          recordId: schedule.record_id,
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
          boardScopeId: task.scope_id ?? task.scope_deliverable_id ?? task.scope_project_id ?? task.scope_product_id ?? null,
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
        this.selectedBoardId = item.boardScopeId ?? this.preferredTaskBoardId;
        this.persistSelectedBoardId(this.selectedBoardId);
        this.validateSelectedBoardId();
        this.normalizeTaskFilterTags();
        if (item.recordId) {
          this.openTaskDetail(item.recordId);
        } else {
          this.syncRoute();
        }
        return;
      }
      if (item.section === 'schedules') {
        this.navSection = 'schedules';
        this.mobileNavOpen = false;
        if (item.recordId) this.startEditSchedule(item.recordId);
        else this.syncRoute();
        return;
      }
      if (item.section !== 'chat') return;
      this.focusMessageId = item.focusRecordId ?? item.recordId ?? null;
      this.navSection = 'chat';
      this.mobileNavOpen = false;
      if (item.channelId) {
        await this.selectChannel(item.channelId, { scrollToLatest: false });
      }
      if (item.threadId) {
        this.openThread(item.threadId, { scrollToLatest: false });
      } else {
        this.closeThread();
      }
    },

    isFocusedMessage(recordId) {
      return this.focusMessageId === recordId;
    },

    // getCachedPerson, getSenderName, getSenderIdentity, getSenderAvatar — in peopleProfilesManagerMixin

    getShortNpub(npub) {
      return getShortNpub(npub);
    },

    getInitials(label) {
      return getInitials(label);
    },

    getChannelLabel(channel) {
      return resolveChannelLabel(channel, {
        sessionNpub: this.session?.npub || null,
        getParticipants: (candidate) => this.getChannelParticipants(candidate),
        getSenderName: (npub) => this.getSenderName(npub),
      });
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

    // rememberPeople, resolveChatProfile — in peopleProfilesManagerMixin

    // --- tasks ---

    async applyTasks(tasks = []) {
      const normalizedTasks = [];
      for (const task of (Array.isArray(tasks) ? tasks : [])) {
        const normalizedGroups = this.normalizeTaskRowGroupRefs(task);
        const normalized = this.normalizeTaskRowScopeRefs(normalizedGroups);
        normalizedTasks.push(normalized);
        if (normalized !== task) {
          await upsertTask(normalized);
        }
      }
      if (!sameListBySignature(this.tasks, normalizedTasks, (task) => [
        String(task?.record_id || ''),
        String(task?.updated_at || ''),
        String(task?.version ?? ''),
        String(task?.record_state || ''),
        String(task?.state || ''),
      ].join('|'))) {
        this.tasks = normalizedTasks;
      }
      const assignedNpubs = [...new Set(normalizedTasks.map((task) => task.assigned_to_npub).filter(Boolean))];
      if (assignedNpubs.length > 0) {
        await this.rememberPeople(assignedNpubs, 'task-assignee');
      }
      this.selectedTaskIds = this.selectedTaskIds.filter((taskId) =>
        normalizedTasks.some((task) => task.record_id === taskId && task.record_state !== 'deleted' && !this.isParentTask(taskId))
      );
      this.normalizeTaskFilterTags();
      this.updatePageTitle();
    },

    async refreshTasks() {
      const ownerNpub = this.workspaceOwnerNpub;
      if (!ownerNpub) return;
      await this.applyTasks(await getTasksByOwner(ownerNpub));
    },

    formatScheduleDays(days = []) {
      const list = Array.isArray(days) ? days : [];
      if (list.length === 0 || list.length === 7) return 'Every day';
      return list.join(', ');
    },

    toggleNewScheduleDay(day) {
      if (this.newScheduleDays.includes(day)) {
        this.newScheduleDays = this.newScheduleDays.filter((value) => value !== day);
      } else {
        this.newScheduleDays = [...this.newScheduleDays, day];
      }
    },

    toggleEditingScheduleDay(day) {
      if (!this.editingScheduleDraft) return;
      const days = Array.isArray(this.editingScheduleDraft.days) ? this.editingScheduleDraft.days : [];
      this.editingScheduleDraft.days = days.includes(day)
        ? days.filter((value) => value !== day)
        : [...days, day];
    },

    resetNewScheduleForm() {
      this.newScheduleTitle = '';
      this.newScheduleDescription = '';
      this.newScheduleStart = '09:00';
      this.newScheduleEnd = '10:00';
      this.newScheduleDays = ['mon', 'tue', 'wed', 'thu', 'fri'];
      this.newScheduleTimezone = 'Australia/Perth';
      this.newScheduleRepeat = 'daily';
      this.newScheduleAssignedGroupId = this.selectedBoardWriteGroup || this.scheduleAssignableGroups[0]?.groupId || null;
      this.newScheduleGroupQuery = '';
    },

    openNewScheduleModal() {
      this.resetNewScheduleForm();
      this.showNewScheduleModal = true;
    },

    closeNewScheduleModal() {
      this.showNewScheduleModal = false;
      this.resetNewScheduleForm();
    },

    handleNewScheduleGroupInput(value) {
      this.newScheduleGroupQuery = value;
    },

    assignNewScheduleGroup(groupId) {
      const nextGroupId = this.resolveGroupId(groupId);
      this.newScheduleAssignedGroupId = nextGroupId || null;
      this.newScheduleGroupQuery = '';
    },

    clearNewScheduleGroup() {
      this.newScheduleAssignedGroupId = null;
      this.newScheduleGroupQuery = '';
    },

    handleEditingScheduleGroupInput(value) {
      this.editingScheduleGroupQuery = value;
    },

    assignEditingScheduleGroup(groupId) {
      if (!this.editingScheduleDraft) return;
      const nextGroupId = this.resolveGroupId(groupId);
      this.editingScheduleDraft.assigned_group_id = nextGroupId || null;
      this.editingScheduleGroupQuery = '';
    },

    clearEditingScheduleGroup() {
      if (!this.editingScheduleDraft) return;
      this.editingScheduleDraft.assigned_group_id = null;
      this.editingScheduleGroupQuery = '';
    },

    async applySchedules(schedules = []) {
      const normalizedSchedules = [];
      for (const schedule of (Array.isArray(schedules) ? schedules : [])) {
        const normalized = this.normalizeScheduleRowGroupRefs(schedule);
        normalizedSchedules.push(normalized);
        if (normalized !== schedule) {
          await upsertSchedule(normalized);
        }
      }
      if (!sameListBySignature(this.schedules, normalizedSchedules)) {
        this.schedules = normalizedSchedules;
      }
      this.updatePageTitle();
    },

    async refreshSchedules() {
      const ownerNpub = this.workspaceOwnerNpub;
      if (!ownerNpub) return;
      await this.applySchedules(await getSchedulesByOwner(ownerNpub));
    },

    setCalendarView(view) {
      if (!CALENDAR_VIEWS.includes(view)) return;
      this.calendarView = view;
    },

    shiftCalendar(step = 1) {
      this.calendarAnchorDate = shiftCalendarDate(this.calendarAnchorDate, this.calendarView, step);
    },

    jumpCalendarToToday() {
      this.calendarAnchorDate = getTodayDateKey();
    },

    async addSchedule() {
      const title = String(this.newScheduleTitle || '').trim();
      if (!title || !this.session?.npub) return;
      this.error = null;
      const ownerNpub = this.workspaceOwnerNpub;
      const groupId = this.resolveGroupId(this.newScheduleAssignedGroupId || this.selectedBoardWriteGroup || this.groups[0]?.group_id || this.groups[0]?.group_npub);
      if (!groupId) {
        this.error = 'Select a group for the schedule.';
        return;
      }
      const now = new Date().toISOString();
      const localRow = {
        record_id: crypto.randomUUID(),
        owner_npub: ownerNpub,
        title,
        description: String(this.newScheduleDescription || '').trim(),
        time_start: this.newScheduleStart,
        time_end: this.newScheduleEnd,
        days: [...this.newScheduleDays],
        timezone: this.newScheduleTimezone || 'Australia/Perth',
        assigned_group_id: groupId,
        active: true,
        last_run: null,
        repeat: this.newScheduleRepeat || 'daily',
        shares: groupId ? [groupId] : [],
        group_ids: groupId ? [groupId] : [],
        sync_status: 'pending',
        record_state: 'active',
        version: 1,
        created_at: now,
        updated_at: now,
      };

      await upsertSchedule(localRow);
      this.schedules = [localRow, ...this.schedules];
      this.resetNewScheduleForm();

      const envelope = await outboundSchedule({
        ...localRow,
        signature_npub: this.session.npub,
        write_group_npub: groupId,
      });
      await addPendingWrite({
        record_id: localRow.record_id,
        record_family_hash: envelope.record_family_hash,
        envelope,
      });
      await this.performSync({ silent: false });
      await this.refreshSchedules();
      this.showNewScheduleModal = false;
    },

    async startEditSchedule(scheduleId) {
      const schedule = this.schedules.find((item) => item.record_id === scheduleId);
      if (!schedule) return;
      this.editingScheduleId = scheduleId;
      this.editingScheduleDraft = toRaw(schedule);
      this.editingScheduleGroupQuery = '';
      this.syncRoute();
    },

    cancelEditSchedule() {
      this.editingScheduleId = null;
      this.editingScheduleDraft = null;
      this.editingScheduleGroupQuery = '';
    },

    async saveEditingSchedule() {
      if (!this.editingScheduleDraft || !this.session?.npub) return;
      this.error = null;
      const current = await getScheduleById(this.editingScheduleDraft.record_id);
      if (!current) {
        this.error = 'Schedule not found.';
        return;
      }
      const updated = toRaw({
        ...current,
        ...this.editingScheduleDraft,
        days: [...(this.editingScheduleDraft.days || [])],
        assigned_group_id: this.resolveGroupId(this.editingScheduleDraft.assigned_group_id),
        group_ids: this.resolveGroupId(this.editingScheduleDraft.assigned_group_id)
          ? [this.resolveGroupId(this.editingScheduleDraft.assigned_group_id)]
          : [...(current.group_ids || [])],
        shares: this.resolveGroupId(this.editingScheduleDraft.assigned_group_id)
          ? [this.resolveGroupId(this.editingScheduleDraft.assigned_group_id)]
          : [...(current.shares || [])],
        version: (current.version ?? 1) + 1,
        sync_status: 'pending',
        updated_at: new Date().toISOString(),
      });
      const writeGroupId = updated.assigned_group_id || updated.group_ids?.[0] || current.group_ids?.[0] || null;
      if (!writeGroupId) {
        this.error = 'Schedule is missing a writable group.';
        return;
      }
      await upsertSchedule(updated);
      this.schedules = this.schedules.map((item) => item.record_id === updated.record_id ? updated : item);
      this.editingScheduleDraft = toRaw(updated);

      const envelope = await outboundSchedule({
        ...updated,
        previous_version: current.version ?? 1,
        signature_npub: this.session.npub,
        write_group_npub: writeGroupId,
      });
      await addPendingWrite({
        record_id: updated.record_id,
        record_family_hash: envelope.record_family_hash,
        envelope,
      });
      await this.performSync({ silent: false });
      await this.refreshSchedules();
      this.cancelEditSchedule();
    },

    async toggleSchedule(scheduleId) {
      const schedule = this.schedules.find((item) => item.record_id === scheduleId);
      if (!schedule) return;
      this.editingScheduleDraft = toRaw({
        ...schedule,
        active: !schedule.active,
      });
      await this.saveEditingSchedule();
      if (this.editingScheduleId !== scheduleId) this.cancelEditSchedule();
    },

    async deleteSchedule(scheduleId) {
      const schedule = this.schedules.find((item) => item.record_id === scheduleId);
      if (!schedule || !this.session?.npub) return;
      const updated = toRaw({
        ...schedule,
        record_state: 'deleted',
        version: (schedule.version ?? 1) + 1,
        sync_status: 'pending',
        updated_at: new Date().toISOString(),
      });
      await upsertSchedule(updated);
      this.schedules = this.schedules.filter((item) => item.record_id !== scheduleId);
      if (this.editingScheduleId === scheduleId) this.cancelEditSchedule();

      const envelope = await outboundSchedule({
        ...updated,
        previous_version: schedule.version ?? 1,
        signature_npub: this.session.npub,
        write_group_npub: updated.group_ids?.[0] || null,
      });
      await addPendingWrite({
        record_id: updated.record_id,
        record_family_hash: envelope.record_family_hash,
        envelope,
      });
      await this.performSync({ silent: false });
    },

    async addTask() {
      const title = String(this.newTaskTitle || '').trim();
      if (!title || !this.session?.npub) return;
      if (!this.selectedBoardId) {
        this.error = 'Select a scope board first.';
        return;
      }
      const now = new Date().toISOString();
      const recordId = crypto.randomUUID();
      const ownerNpub = this.workspaceOwnerNpub;
      const assignment = this.buildTaskBoardAssignment(this.selectedBoardId);
      if (!assignment.scope_id) {
        this.error = 'Select a valid scope board first.';
        return;
      }

      const localRow = {
        record_id: recordId,
        owner_npub: ownerNpub,
        title,
        description: '',
        state: 'new',
        priority: 'sand',
        parent_task_id: null,
        ...assignment,
        assigned_to_npub: null,
        scheduled_for: null,
        tags: '',
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

    async queueTaskWrite(updatedTask, previousTask) {
      const envelope = await outboundTask({
        ...updatedTask,
        previous_version: previousTask?.version ?? 0,
        signature_npub: this.session?.npub,
        write_group_npub: updatedTask.board_group_id || updatedTask.group_ids?.[0] || null,
      });
      await addPendingWrite({
        record_id: updatedTask.record_id,
        record_family_hash: envelope.record_family_hash,
        envelope,
      });
    },

    async applyTaskPatch(taskId, patch = {}, options = {}) {
      const task = this.tasks.find((entry) => entry.record_id === taskId);
      if (!task || !this.session?.npub) return null;

      const nextVersion = (task.version ?? 1) + 1;
      const updated = toRaw({
        ...task,
        ...patch,
        assigned_to_npub: patch.assigned_to_npub === undefined ? (task.assigned_to_npub ?? null) : (patch.assigned_to_npub ?? null),
        version: nextVersion,
        sync_status: 'pending',
        updated_at: new Date().toISOString(),
      });

      if (updated.state === 'done' || updated.state === 'archive') {
        updated.assigned_to_npub = null;
      }

      await upsertTask(updated);
      this.tasks = this.tasks.map((entry) => entry.record_id === taskId ? updated : entry);

      if (this.editingTask?.record_id === taskId) {
        this.editingTask = { ...updated };
      }

      await this.queueTaskWrite(updated, task);

      const newAssignee = updated.assigned_to_npub;
      if (newAssignee && newAssignee !== task.assigned_to_npub) {
        await this.rememberPeople([newAssignee], 'task-assignee');
        for (const trigger of (this.workspaceTriggers || [])) {
          if (!trigger.enabled || !trigger.botNpub || trigger.triggerType !== 'chat_bot_tagged') continue;
          if (newAssignee === trigger.botNpub) {
            this._checkTriggerRules('chat_bot_tagged', trigger.botPubkeyHex,
              `Task assigned to bot: "${updated.title}" [${updated.state}]`);
          }
        }
      }

      if (options.sync !== false) {
        await this.performSync({ silent: options.silent !== false });
      }
      if (options.refresh) {
        await this.refreshTasks();
      }
      return updated;
    },

    async cascadeTaskScopeToSubtasks(parentTask, nextParentTask) {
      const subtasks = this.tasks.filter((task) =>
        task.parent_task_id === parentTask.record_id
        && task.record_state !== 'deleted'
      );
      if (subtasks.length === 0) return 0;

      const scopeRef = nextParentTask.scope_id
        ?? nextParentTask.scope_deliverable_id
        ?? nextParentTask.scope_project_id
        ?? nextParentTask.scope_product_id
        ?? null;
      const assignment = this.buildTaskBoardAssignment(scopeRef, nextParentTask);

      this.taskScopeCascadePending = true;
      this.taskScopeCascadeMessage = `Updating ${subtasks.length} subtask${subtasks.length === 1 ? '' : 's'}…`;

      const updates = new Map();
      try {
        for (const subtask of subtasks) {
          const updatedSubtask = toRaw(buildCascadedSubtaskUpdate(subtask, assignment));
          await upsertTask(updatedSubtask);
          updates.set(updatedSubtask.record_id, updatedSubtask);
          await this.queueTaskWrite(updatedSubtask, subtask);
        }
      } finally {
        this.taskScopeCascadePending = false;
      }

      if (updates.size > 0) {
        this.tasks = this.tasks.map((task) => updates.get(task.record_id) || task);
      }
      this.taskScopeCascadeMessage = `Updated ${updates.size} subtask${updates.size === 1 ? '' : 's'}.`;
      if (typeof window !== 'undefined') {
        window.setTimeout(() => {
          if (!this.taskScopeCascadePending) this.taskScopeCascadeMessage = '';
        }, 3000);
      }
      return updates.size;
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
        ...this.buildTaskBoardAssignment(parent?.scope_id ?? parent?.scope_deliverable_id ?? parent?.scope_project_id ?? parent?.scope_product_id ?? null, parent),
        assigned_to_npub: null,
        scheduled_for: null,
        tags: '',
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
      await this.applyTaskPatch(taskId, { [field]: value }, { silent: true, sync: true });
    },

    setTaskDueToday() {
      if (!this.editingTask) return;
      const today = new Date();
      this.editingTask.scheduled_for = today.toISOString().slice(0, 10);
      this.saveEditingTask();
    },

    setTaskDueThisWeek() {
      if (!this.editingTask) return;
      const today = new Date();
      const dayOfWeek = today.getDay();
      const daysUntilFriday = dayOfWeek <= 5 ? (5 - dayOfWeek) : 6;
      const friday = new Date(today);
      friday.setDate(today.getDate() + (daysUntilFriday === 0 ? 7 : daysUntilFriday));
      this.editingTask.scheduled_for = friday.toISOString().slice(0, 10);
      this.saveEditingTask();
    },

    async quickSetTaskState(state) {
      if (!this.editingTask) return;
      this.editingTask.state = state;
      this.editingTask.assigned_to_npub = null;
      await this.saveEditingTask();
      this.closeTaskDetail();
    },

    async saveEditingTask() {
      if (!this.editingTask || !this.session?.npub) return;
      if (this.containsInlineImageUploadToken(this.editingTask.description)) {
        this.error = 'Wait for image upload to finish.';
        return;
      }
      const task = this.tasks.find(t => t.record_id === this.editingTask.record_id);
      if (!task) return;

      if (this.editingTask.state === 'done' || this.editingTask.state === 'archive') {
        this.editingTask.assigned_to_npub = null;
      }

      const nextVersion = (task.version ?? 1) + 1;
      const updated = toRaw({
        ...task,
        title: this.editingTask.title,
        description: this.editingTask.description,
        state: this.editingTask.state,
        priority: this.editingTask.priority,
        scheduled_for: this.editingTask.scheduled_for,
        tags: this.editingTask.tags,
        assigned_to_npub: this.editingTask.assigned_to_npub ?? null,
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
      this.editingTask = { ...updated };
      if (this.activeTaskId === updated.record_id) this.scheduleStorageImageHydration();

      await this.queueTaskWrite(updated, task);
      if (this.isParentTask(updated.record_id) && taskScopeAssignmentChanged(task, updated)) {
        await this.cascadeTaskScopeToSubtasks(task, updated);
      }
      if (updated.description && updated.description !== task.description) {
        this._fireMentionTriggers(updated.description, `task "${updated.title}"`);
      }
      // Fire trigger when task is assigned to a bot
      const newAssignee = updated.assigned_to_npub;
      if (newAssignee && newAssignee !== task.assigned_to_npub) {
        for (const trigger of (this.workspaceTriggers || [])) {
          if (!trigger.enabled || !trigger.botNpub || trigger.triggerType !== 'chat_bot_tagged') continue;
          if (newAssignee === trigger.botNpub) {
            this._checkTriggerRules('chat_bot_tagged', trigger.botPubkeyHex,
              `Task assigned to bot: "${updated.title}" [${updated.state}]`);
          }
        }
      }
      await this.performSync({ silent: true });
      await this.refreshTasks();
    },

    async deleteTask(taskId) {
      const task = this.tasks.find(t => t.record_id === taskId);
      if (!task || !this.session?.npub) return;

      const subtasks = this.getSubtasks(taskId);
      let deleteSubtasks = false;

      if (subtasks.length > 0) {
        const answer = window.confirm(`This task has ${subtasks.length} subtask${subtasks.length === 1 ? '' : 's'}. Also delete subtasks?`);
        deleteSubtasks = answer;
      } else {
        if (!window.confirm('Delete this task?')) return;
      }

      // Delete the parent task
      await this._softDeleteTask(task);

      // Cascade to subtasks if confirmed
      if (deleteSubtasks) {
        for (const sub of subtasks) {
          await this._softDeleteTask(sub);
        }
      }

      if (this.activeTaskId === taskId) {
        this.closeTaskDetail();
      }

      await this.performSync({ silent: false });
    },

    async _softDeleteTask(task) {
      const nextVersion = (task.version ?? 1) + 1;
      const updated = toRaw({
        ...task,
        record_state: 'deleted',
        version: nextVersion,
        sync_status: 'pending',
        updated_at: new Date().toISOString(),
      });

      await upsertTask(updated);
      this.tasks = this.tasks.filter(t => t.record_id !== task.record_id);

      const envelope = await outboundTask({
        ...updated,
        previous_version: task.version ?? 1,
        signature_npub: this.session.npub,
        record_state: 'deleted',
        write_group_npub: updated.board_group_id || updated.group_ids?.[0] || null,
      });
      await addPendingWrite({
        record_id: task.record_id,
        record_family_hash: envelope.record_family_hash,
        envelope,
      });
    },

    openTaskDetail(taskId) {
      this.activeTaskId = taskId;
      const task = this.tasks.find(t => t.record_id === taskId);
      this.editingTask = task ? toRaw(task) : null;
      if (this.editingTask?.assigned_to_npub) {
        this.resolveChatProfile(this.editingTask.assigned_to_npub);
      }
      this.taskAssigneeQuery = '';
      this.showTaskDetail = true;
      this.taskDescriptionEditing = !this.editingTask?.description;
      this.newSubtaskTitle = '';
      this.newTaskCommentBody = '';
      this.loadTaskComments(taskId);
      this.scheduleStorageImageHydration();
      this.syncRoute();
    },

    closeTaskDetail(options = {}) {
      this.stopTaskCommentsLiveQuery();
      this.activeTaskId = null;
      this.editingTask = null;
      this.taskAssigneeQuery = '';
      this.taskScopeCascadePending = false;
      this.taskScopeCascadeMessage = '';
      this.showTaskDetail = false;
      this.taskComments = [];
      if (options.syncRoute !== false) this.syncRoute();
    },

    openCalendarTask(taskId) {
      const task = this.tasks.find((item) => item.record_id === taskId) || null;
      const scopeId = task?.scope_id
        ?? task?.scope_deliverable_id
        ?? task?.scope_project_id
        ?? task?.scope_product_id
        ?? (task && isTaskUnscoped(task, this.scopesMap) ? UNSCOPED_TASK_BOARD_ID : null);
      if (scopeId) {
        this.selectedBoardId = scopeId;
        this.persistSelectedBoardId(scopeId);
        this.validateSelectedBoardId();
      }
      this.navSection = 'tasks';
      this.mobileNavOpen = false;
      this.openTaskDetail(taskId);
    },

    handleTaskAssigneeInput(value) {
      this.taskAssigneeQuery = value;
      if (this.taskAssigneeQuery.startsWith('npub1') && this.taskAssigneeQuery.length >= 20) {
        this.resolveChatProfile(this.taskAssigneeQuery);
      }
    },

    async assignEditingTask(npub) {
      if (!this.editingTask || !this.session?.npub) return;
      const nextNpub = String(npub || '').trim();
      this.editingTask.assigned_to_npub = nextNpub || null;
      this.taskAssigneeQuery = '';
      if (nextNpub) {
        await this.rememberPeople([nextNpub], 'task-assignee');
      }
      await this.saveEditingTask();
    },

    async clearEditingTaskAssignee() {
      await this.assignEditingTask(null);
    },

    async doTaskWithDefaultAgent() {
      if (!this.editingTask || !this.defaultAgentNpub || !this.session?.npub) return;
      this.editingTask.assigned_to_npub = this.defaultAgentNpub;
      this.editingTask.state = 'ready';
      this.taskAssigneeQuery = '';
      await this.saveEditingTask();
      this.closeTaskDetail();
      this.rememberPeople([this.defaultAgentNpub], 'task-assignee');
    },

    buildTaskUrl(taskId) {
      if (typeof window === 'undefined') return '';
      const url = new URL(window.location.href);
      url.pathname = '/tasks';
      url.search = '';
      const task = this.tasks.find((item) => item.record_id === taskId);
      const scopeId = task?.scope_id ?? task?.scope_deliverable_id ?? task?.scope_project_id ?? task?.scope_product_id ?? this.selectedBoardId ?? null;
      if (scopeId) url.searchParams.set('scopeid', scopeId);
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
      if (!taskId) {
        this.applyTaskComments([]);
        return;
      }
      this.startTaskCommentsLiveQuery();
      await this.applyTaskComments(await getCommentsByTarget(taskId));
    },

    async applyTaskComments(comments = []) {
      const nextComments = Array.isArray(comments) ? comments : [];
      if (!sameListBySignature(this.taskComments, nextComments, (comment) => [
        String(comment?.record_id || ''),
        String(comment?.updated_at || ''),
        String(comment?.version ?? ''),
        String(comment?.record_state || ''),
      ].join('|'))) {
        this.taskComments = nextComments;
      }

      for (const comment of nextComments) {
        await this.rememberPeople([comment.sender_npub], 'task-comment');
      }
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
      this.taskComments = [localRow, ...this.taskComments];
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
      this._fireMentionTriggers(body, `task comment on "${task?.title || taskId}"`);
      await this.performSync({ silent: true });
    },

    // --- Scope management (extracted to scopes-manager.js) ---
    // scopesManagerMixin applied via applyMixins (has getters)

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

    isTaskSelected(taskId) {
      return this.selectedTaskIds.includes(taskId);
    },

    toggleTaskSelection(taskId) {
      if (!taskId || this.isParentTask(taskId)) return;
      if (this.isTaskSelected(taskId)) {
        this.selectedTaskIds = this.selectedTaskIds.filter((candidate) => candidate !== taskId);
      } else {
        this.selectedTaskIds = [...this.selectedTaskIds, taskId];
      }
    },

    selectVisibleTasks() {
      const visibleTaskIds = this.activeTasks.map((task) => task.record_id);
      this.selectedTaskIds = [...new Set([...this.selectedTaskIds, ...visibleTaskIds])];
    },

    clearSelectedTasks() {
      this.selectedTaskIds = [];
    },

    async applyBulkTaskAction(action) {
      if (this.bulkTaskBusy || this.selectedTaskIds.length === 0) return;
      const selectedIds = [...this.selectedTaskIds];
      const today = new Date().toISOString().slice(0, 10);
      const patchForAction = (taskId) => {
        switch (action) {
          case 'archive':
            return { state: 'archive', assigned_to_npub: null };
          case 'done':
            return { state: 'done', assigned_to_npub: null };
          case 'ready':
            return { state: 'ready', assigned_to_npub: this.defaultAgentNpub || null };
          case 'today':
            return { scheduled_for: today };
          default:
            return null;
        }
      };

      if (action === 'ready' && !this.defaultAgentNpub) {
        this.error = 'Set a default agent in Settings first.';
        return;
      }

      this.bulkTaskBusy = true;
      try {
        for (const taskId of selectedIds) {
          const patch = patchForAction(taskId);
          if (!patch) continue;
          await this.applyTaskPatch(taskId, patch, { sync: false });
        }
        await this.performSync({ silent: true });
        await this.refreshTasks();
        this.clearSelectedTasks();
      } finally {
        this.bulkTaskBusy = false;
      }
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

    async moveTaskToBoard(taskId, boardScopeId) {
      const task = this.tasks.find(t => t.record_id === taskId);
      if (!task || !this.session?.npub) return;

      const assignment = this.buildTaskBoardAssignment(boardScopeId, task);
      if (!assignment.scope_id) return;
      const nextVersion = (task.version ?? 1) + 1;

      const updated = toRaw({
        ...task,
        ...assignment,
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
          ...assignment,
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
          write_group_npub: subUpdated.board_group_id || subUpdated.group_ids?.[0] || null,
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
        write_group_npub: updated.board_group_id || updated.group_ids?.[0] || null,
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
          scope_id: updated.scope_id ?? null,
          scope_product_id: updated.scope_product_id ?? null,
          scope_project_id: updated.scope_project_id ?? null,
          scope_deliverable_id: updated.scope_deliverable_id ?? null,
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
      this.stopDocCommentsLiveQuery();
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

    // --- Document management (extracted to docs-manager.js) ---
    // docsManagerMixin applied via applyMixins

    // --- @mentions ---

    searchMentions(rawQuery) {
      if (!rawQuery) return [];

      // Parse type prefix: @scope:, @task:, @doc:
      let typeFilter = null;
      let query = rawQuery;
      const prefixMatch = rawQuery.match(/^(scope|task|doc|person):/i);
      if (prefixMatch) {
        typeFilter = prefixMatch[1].toLowerCase();
        query = rawQuery.slice(prefixMatch[0].length);
      }

      const needle = query.toLowerCase();
      const results = [];
      const limit = 10;

      // People from groups
      if (!typeFilter || typeFilter === 'person') {
        const seenNpubs = new Set();
        for (const group of this.currentWorkspaceGroups) {
          for (const npub of (group.member_npubs || [])) {
            if (seenNpubs.has(npub)) continue;
            seenNpubs.add(npub);
            const name = this.getSenderName(npub);
            if (!needle || name.toLowerCase().includes(needle) || npub.toLowerCase().includes(needle)) {
              results.push({ type: 'person', id: npub, label: name, sublabel: '' });
            }
          }
        }
      }

      // Documents
      if (!typeFilter || typeFilter === 'doc') {
        for (const doc of this.documents) {
          if (doc.record_state === 'deleted') continue;
          if (!needle || (doc.title || '').toLowerCase().includes(needle)) {
            results.push({ type: 'doc', id: doc.record_id, label: doc.title || 'Untitled', sublabel: 'Doc' });
          }
        }
      }

      // Tasks
      if (!typeFilter || typeFilter === 'task') {
        for (const task of this.tasks) {
          if (task.record_state === 'deleted') continue;
          if (!needle || (task.title || '').toLowerCase().includes(needle)) {
            results.push({ type: 'task', id: task.record_id, label: task.title || 'Untitled', sublabel: 'Task' });
          }
        }
      }

      // Scopes (products, projects, deliverables)
      if (!typeFilter || typeFilter === 'scope') {
        for (const scope of this.scopes) {
          if (scope.record_state === 'deleted') continue;
          if (!needle || (scope.title || '').toLowerCase().includes(needle)) {
            const levelLabel = scope.level === 'product' ? 'Product' : scope.level === 'project' ? 'Project' : 'Deliverable';
            results.push({ type: 'scope', id: scope.record_id, label: scope.title || 'Untitled', sublabel: levelLabel });
          }
        }
      }

      return results.slice(0, limit);
    },

    handleMentionInput(el) {
      const value = el.value;
      const cursorPos = el.selectionStart;

      // Find the @ that starts the current mention (allow spaces in query, break on newline)
      let atPos = -1;
      for (let i = cursorPos - 1; i >= 0; i--) {
        const ch = value[i];
        if (ch === '\n' || ch === '\r') break;
        if (ch === '@') {
          // Only trigger if @ is at start of input or preceded by whitespace
          if (i === 0 || /\s/.test(value[i - 1])) {
            atPos = i;
          }
          break;
        }
      }

      if (atPos === -1) {
        this.closeMentionPopover();
        return;
      }

      const query = value.slice(atPos + 1, cursorPos);
      if (query.length === 0) {
        // Show all results on bare @
        this.mentionActive = true;
        this._mentionTargetEl = el;
        this._mentionStartPos = atPos;
        this.mentionQuery = '';
        this.mentionResults = this.searchMentions('');
        this.mentionSelectedIndex = 0;
        // Show some default results
        const defaults = [];
        const seenNpubs = new Set();
        for (const group of this.currentWorkspaceGroups) {
          for (const npub of (group.member_npubs || [])) {
            if (seenNpubs.has(npub)) continue;
            seenNpubs.add(npub);
            defaults.push({ type: 'person', id: npub, label: this.getSenderName(npub), sublabel: '' });
          }
        }
        this.mentionResults = defaults.slice(0, 8);
        return;
      }

      this.mentionActive = true;
      this._mentionTargetEl = el;
      this._mentionStartPos = atPos;
      this.mentionQuery = query;
      this.mentionResults = this.searchMentions(query);
      this.mentionSelectedIndex = 0;
    },

    handleMentionKeydown(event) {
      if (!this.mentionActive) return;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.mentionSelectedIndex = Math.min(this.mentionSelectedIndex + 1, this.mentionResults.length - 1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.mentionSelectedIndex = Math.max(this.mentionSelectedIndex - 1, 0);
      } else if (event.key === 'Enter' && this.mentionResults.length > 0) {
        event.preventDefault();
        this.selectMention(this.mentionResults[this.mentionSelectedIndex]);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.closeMentionPopover();
      }
    },

    handleComposerKeydown(event, sendAction) {
      this.handleMentionKeydown(event);
      if (event.key === 'Enter' && !event.shiftKey && !event.defaultPrevented) {
        event.preventDefault();
        sendAction();
      }
    },

    selectMention(result) {
      const el = this._mentionTargetEl;
      if (!el || this._mentionStartPos < 0) return;

      const value = el.value;
      const cursorPos = el.selectionStart;
      const before = value.slice(0, this._mentionStartPos);
      const after = value.slice(cursorPos);
      const tag = `@[${result.label}](mention:${result.type}:${result.id}) `;
      const newValue = before + tag + after;

      // Update the textarea value through Alpine's model
      el.value = newValue;
      el.dispatchEvent(new Event('input', { bubbles: true }));

      const newCursorPos = before.length + tag.length;
      el.setSelectionRange(newCursorPos, newCursorPos);
      el.focus();

      this.closeMentionPopover();
    },

    closeMentionPopover() {
      this.mentionActive = false;
      this.mentionQuery = '';
      this.mentionResults = [];
      this.mentionSelectedIndex = 0;
      this._mentionTargetEl = null;
      this._mentionStartPos = -1;
    },

    handleMentionNavigate(type, id) {
      if (type === 'doc') {
        this.openDoc(id);
      } else if (type === 'task') {
        this.navSection = 'tasks';
        this.mobileNavOpen = false;
        this.$nextTick(() => this.openTaskDetail(id));
      } else if (type === 'scope') {
        this.navSection = 'scopes';
        this.mobileNavOpen = false;
        this.$nextTick(() => {
          this.scopeNavFocus = id;
          document.getElementById('scope-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      } else if (type === 'person') {
        this.navSection = 'people';
        this.mobileNavOpen = false;
      }
    },

    async deleteCurrentDirectory() {
      const dir = this.currentFolder;
      const ownerNpub = this.workspaceOwnerNpub;
      if (!dir || !ownerNpub || !this.session?.npub) {
        this.error = 'No folder selected';
        return;
      }

      const confirmed = window.confirm(`Delete folder "${dir.title}" and all its contents? This cannot be undone.`);
      if (!confirmed) return;

      // Collect all descendant directory IDs recursively
      const allDirIds = new Set([dir.record_id]);
      let added = true;
      while (added) {
        added = false;
        for (const d of this.directories) {
          if (d.record_state === 'deleted') continue;
          if (d.parent_directory_id && allDirIds.has(d.parent_directory_id) && !allDirIds.has(d.record_id)) {
            allDirIds.add(d.record_id);
            added = true;
          }
        }
      }

      // Soft-delete all directories in the set
      for (const dirId of allDirIds) {
        const directory = this.directories.find((d) => d.record_id === dirId);
        if (!directory || directory.record_state === 'deleted') continue;
        const nextVersion = (directory.version ?? 1) + 1;
        const now = new Date().toISOString();
        const shares = this.getEffectiveDocShares(directory);
        const updated = { ...directory, record_state: 'deleted', sync_status: 'pending', version: nextVersion, updated_at: now };

        await upsertDirectory(updated);
        this.patchDirectoryLocal(updated);
        await addPendingWrite({
          record_id: dirId,
          record_family_hash: recordFamilyHash('directory'),
          envelope: await outboundDirectory({
            ...updated,
            previous_version: directory.version ?? 1,
            signature_npub: this.session.npub,
            shares,
            write_group_npub: updated.group_ids?.[0] || null,
          }),
        });
      }

      // Soft-delete all documents inside those directories
      for (const doc of this.documents) {
        if (doc.record_state === 'deleted') continue;
        if (!allDirIds.has(doc.parent_directory_id)) continue;
        const nextVersion = (doc.version ?? 1) + 1;
        const now = new Date().toISOString();
        const shares = this.getEffectiveDocShares(doc);
        const updated = { ...doc, record_state: 'deleted', sync_status: 'pending', version: nextVersion, updated_at: now };

        await upsertDocument(updated);
        this.patchDocumentLocal(updated);
        await addPendingWrite({
          record_id: doc.record_id,
          record_family_hash: recordFamilyHash('document'),
          envelope: await outboundDocument({
            ...updated,
            previous_version: doc.version ?? 1,
            signature_npub: this.session.npub,
            shares,
            write_group_npub: updated.group_ids?.[0] || null,
          }),
        });
      }

      // Navigate up to parent
      this.navigateToFolder(dir.parent_directory_id || null);
      await this.performSync({ silent: false });
      await this.refreshDirectories();
      await this.refreshDocuments();
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
        const prepared = await prepareStorageObject(buildStoragePrepareBody({
          ownerNpub,
          ownerGroupId: options.ownerGroupId,
          accessGroupIds: options.accessGroupIds ?? options.accessGroupNpubs ?? [],
          contentType: file.type || 'image/png',
          sizeBytes: file.size || bytes.byteLength,
          fileName,
        }));
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
        accessGroupIds: channel.group_ids ?? [],
        fileLabel: context === 'thread' ? 'thread' : 'chat',
        uploadCounterContext: context,
      });
    },

    async handleTaskDescriptionPaste(event) {
      if (!this.editingTask) return;
      await this.handleInlineImagePaste(event, {
        modelKey: 'editingTask.description',
        ownerNpub: this.editingTask.owner_npub || this.workspaceOwnerNpub || this.session?.npub,
        accessGroupIds: this.editingTask.group_ids ?? [],
        fileLabel: 'task',
      });
    },

    async handleTaskCommentPaste(event) {
      if (!this.editingTask) return;
      await this.handleInlineImagePaste(event, {
        modelKey: 'newTaskCommentBody',
        ownerNpub: this.editingTask.owner_npub || this.workspaceOwnerNpub || this.session?.npub,
        accessGroupIds: this.editingTask.group_ids ?? [],
        fileLabel: 'task-comment',
      });
    },

    async handleDocSourcePaste(event) {
      const doc = this.selectedDocument;
      if (!doc) return;
      const handled = await this.handleInlineImagePaste(event, {
        modelKey: 'docEditorContent',
        ownerNpub: doc.owner_npub || this.workspaceOwnerNpub || this.session?.npub,
        accessGroupIds: doc.group_ids ?? [],
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
        accessGroupIds: doc.group_ids ?? [],
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
        accessGroupIds: doc.group_ids ?? [],
        fileLabel: 'doc-comment',
      });
    },

    async handleDocCommentReplyPaste(event) {
      const doc = this.selectedDocument;
      if (!doc) return;
      await this.handleInlineImagePaste(event, {
        modelKey: 'newDocCommentReplyBody',
        ownerNpub: doc.owner_npub || this.workspaceOwnerNpub || this.session?.npub,
        accessGroupIds: doc.group_ids ?? [],
        fileLabel: 'doc-reply',
      });
    },

    renderMarkdown(md) {
      return renderMarkdownToHtml(md);
    },

    // createBotDm, deleteSelectedChannel, sendMessage, sendThreadReply, deleteActiveThread — in chatMessageManagerMixin

    // syncNow — in syncManagerMixin
  };

  applyMixins(
    storeObj,
    taskBoardStateMixin,
    workspaceManagerMixin,
    chatMessageManagerMixin,
    syncManagerMixin,
    peopleProfilesManagerMixin,
    connectSettingsManagerMixin,
    channelsManagerMixin,
    scopesManagerMixin,
    docsManagerMixin,
    triggersManagerMixin,
    audioRecordingManagerMixin,
    storageImageManagerMixin,
  );

  Alpine.store('chat', storeObj);
  Alpine.start();
}
