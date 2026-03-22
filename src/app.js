/**
 * Alpine.js app store — the single source of reactive UI state.
 * All data comes from Dexie; network goes through the sync worker.
 */

import Alpine from 'alpinejs';
import { liveQuery } from 'dexie';
import { commentBelongsToDocBlock } from './doc-comment-anchors.js';
import {
  rankMainFeedMessages,
  rankThreadReplies,
  resolveVisibleThreadReplyCount,
  sortMessagesByUpdatedAt,
  visibleThreadReplies,
} from './chat-order.js';
import { renderMarkdownToHtml } from './markdown.js';
import { resolveChannelLabel } from './channel-labels.js';
import { buildFlightDeckDocumentTitle } from './page-title.js';
import { getRunningBuildId } from './version-check.js';
import { signAndPublishTrigger, npubToHex } from './nostr-trigger.js';
import {
  CALENDAR_VIEWS,
  buildTaskCalendar,
  getTodayDateKey,
  shiftCalendarDate,
} from './task-calendar.js';

/** Strip Alpine proxy wrappers so objects survive IndexedDB structured clone. */
function toRaw(obj) {
  if (obj == null || typeof obj !== 'object') return obj;
  return JSON.parse(JSON.stringify(obj));
}
import {
  openWorkspaceDb,
  hasWorkspaceDb,
  migrateFromLegacyDb,
  getSettings,
  saveSettings,
  getWorkspaceSettings,
  getWorkspaceSettingsSnapshot,
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
  getRecentScheduleChangesSince,
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
  getSchedulesByOwner,
  upsertSchedule,
  getScheduleById,
  getCommentsByTarget,
  upsertComment,
  upsertAudioNote,
  getScopesByOwner,
  upsertScope,
  getScopeById,
  deleteGroupById,
  addPendingWrite,
  getPendingWrites,
  getPendingWritesByFamilies,
  upsertGroup,
  getChannelById,
  getAddressBookPeople,
  upsertAddressBookPerson,
  clearRuntimeData,
  clearSyncState,
  clearRuntimeFamilies,
  clearSyncStateForFamilies,
  getSyncQuarantineEntries,
  deleteSyncQuarantineEntry,
  clearSyncQuarantineForFamilies,
  deleteRuntimeRecordByFamily,
  deleteWorkspaceDb,
} from './db.js';
import {
  setBaseUrl,
  createGroup,
  addGroupMember,
  rotateGroup,
  deleteGroupMember,
  updateGroup,
  getGroups,
  getGroupKeys,
  deleteGroup,
  createWorkspace,
  getWorkspaces,
  recoverWorkspace,
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
import { outboundSchedule } from './translators/schedules.js';
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
import {
  buildScopeLineage,
  buildScopeShares,
  buildScopeTags,
  defaultScopeGroupIds,
  deriveScopeHierarchy,
  findActiveDirectoryByScopeId,
  findActiveRootDirectoryByTitle,
  normalizeGroupIds,
} from './scope-delivery.js';
import {
  getTaskBoardScopeLabel,
  inferTaskScopeLevel,
  isTaskUnscoped,
  matchesTaskBoardScope,
  sortTaskBoardScopes,
} from './task-board-scopes.js';
import {
  buildCascadedSubtaskUpdate,
  taskScopeAssignmentChanged,
} from './task-scope-cascade.js';
import { outboundWorkspaceSettings, normalizeHarnessUrl } from './translators/settings.js';
import { flightDeckLog } from './logging.js';
import { runSync, pullRecordsForFamilies, checkStaleness } from './worker/sync-worker.js';
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
import { APP_NPUB, DEFAULT_SUPERBASED_URL } from './app-identity.js';
import { mergeWorkspaceEntries, normalizeWorkspaceEntry, workspaceFromToken } from './workspaces.js';
import {
  getPrivateGroupNpub as resolvePrivateGroupNpub,
  getPrivateGroupRef as resolvePrivateGroupRef,
  getWorkspaceSettingsGroupNpub as resolveWorkspaceSettingsGroupNpub,
  getWorkspaceSettingsGroupRef as resolveWorkspaceSettingsGroupRef,
} from './workspace-group-refs.js';
import {
  buildStoragePrepareBody,
  normalizeStorageGroupIds as normalizeStorageAccessGroupIds,
} from './storage-payloads.js';
import { buildSuperBasedConnectionToken } from './superbased-token.js';
import { decryptAudioBytes, encryptAudioBlob, measureAudioDuration } from './audio-notes.js';
import { SYNC_FAMILY_OPTIONS, getSyncFamily, getSyncFamilyHashes } from './sync-families.js';

const TASK_BOARD_STORAGE_KEY = 'coworker:last-task-board-id';
const UNSCOPED_TASK_BOARD_ID = '__unscoped__';
const WEEKDAY_OPTIONS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function guessDefaultBackendUrl() {
  return DEFAULT_SUPERBASED_URL || '';
}

const DEFAULT_KNOWN_HOSTS = [
  { url: 'https://sb4.otherstuff.ai', label: 'The Other Stuff — SuperBased', serviceNpub: '' },
];

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

function storageObjectIdFromRef(value) {
  const match = String(value || '').trim().match(/^storage:\/\/([A-Za-z0-9-]+)$/);
  return match?.[1] || '';
}

function storageImageCacheKey(objectId, backendUrl = '') {
  const normalizedObjectId = String(objectId || '').trim();
  const normalizedBackendUrl = String(backendUrl || '').trim().replace(/\/+$/, '');
  if (!normalizedObjectId) return '';
  return normalizedBackendUrl ? `${normalizedBackendUrl}::${normalizedObjectId}` : normalizedObjectId;
}

function defaultRecordSignature(record) {
  return [
    String(record?.record_id || ''),
    String(record?.updated_at || ''),
    String(record?.version ?? ''),
    String(record?.record_state || ''),
    String(record?.sync_status || ''),
  ].join('|');
}

function sameListBySignature(current = [], next = [], signatureFor = defaultRecordSignature) {
  if (current === next) return true;
  if (!Array.isArray(current) || !Array.isArray(next) || current.length !== next.length) return false;
  for (let index = 0; index < current.length; index += 1) {
    if (signatureFor(current[index]) !== signatureFor(next[index])) return false;
  }
  return true;
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
  else if (path === '/calendar') section = 'calendar';
  else if (path === '/schedules') section = 'schedules';
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
      scopeid: url.searchParams.get('scopeid') || null,
      descendants: url.searchParams.get('descendants') || null,
      groupid: url.searchParams.get('groups') || url.searchParams.get('groupid') || null,
      taskid: url.searchParams.get('taskid') || null,
    },
  };
}

export function initApp() {
  Alpine.store('chat', {
    FAST_SYNC_MS: 1000,
    IDLE_SYNC_MS: 5000,
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

    get activeWorkspaceOwnerNpub() {
      return this.currentWorkspace?.workspaceOwnerNpub || this.currentWorkspaceOwnerNpub || '';
    },

    get isWorkspaceSwitching() {
      return Boolean(this.workspaceSwitchPendingNpub);
    },

    get currentWorkspaceName() {
      if (this.currentWorkspace?.name) return this.currentWorkspace.name;
      if (this.activeWorkspaceOwnerNpub) return 'Workspace';
      return 'No workspace selected';
    },

    get currentWorkspaceMeta() {
      if (this.isWorkspaceSwitching) {
        const pendingWorkspace = this.getWorkspaceByOwner(this.workspaceSwitchPendingNpub);
        return `Switching to ${pendingWorkspace?.name || this.getShortNpub(this.workspaceSwitchPendingNpub) || 'workspace'}...`;
      }
      if (this.currentWorkspace?.description) return this.currentWorkspace.description;
      if (this.activeWorkspaceOwnerNpub) return this.activeWorkspaceOwnerNpub;
      return 'Choose or create a workspace';
    },

    get currentWorkspaceBackendUrl() {
      return String(
        this.currentWorkspace?.directHttpsUrl
        || this.superbasedConnectionConfig?.directHttpsUrl
        || this.backendUrl
        || ''
      ).trim();
    },

    get currentWorkspaceBackendName() {
      const backendUrl = this.currentWorkspaceBackendUrl;
      if (!backendUrl) return 'Self Hosted';
      const cleanUrl = normalizeBackendUrl(backendUrl);
      const host = this.mergedHostsList.find((entry) => normalizeBackendUrl(entry.url) === cleanUrl);
      const label = String(host?.label || '').trim();
      if (!label || label === cleanUrl || label === host?.url) return 'Self Hosted';
      return label;
    },

    get currentWorkspaceAvatarUrl() {
      return this.getWorkspaceAvatar(this.currentWorkspace || this.activeWorkspaceOwnerNpub);
    },

    get currentWorkspaceInitials() {
      return this.getInitials(this.currentWorkspace?.name || this.activeWorkspaceOwnerNpub || 'WS');
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
      return resolvePrivateGroupNpub({
        memberPrivateGroup: this.memberPrivateGroup,
        currentWorkspace: this.currentWorkspace,
      });
    },

    get memberPrivateGroupRef() {
      return resolvePrivateGroupRef({
        memberPrivateGroup: this.memberPrivateGroup,
        currentWorkspace: this.currentWorkspace,
      });
    },

    get superbasedTransportLabel() {
      if (this.useCvmSync && this.superbasedConnectionConfig?.relayUrl) return 'CVM relay';
      return this.backendUrl || 'Not configured';
    },

    get hasHarnessLink() {
      return Boolean(this.workspaceHarnessUrl);
    },

    get mainFeedMessages() {
      return rankMainFeedMessages(this.messages);
    },

    get threadMessages() {
      if (!this.activeThreadId) return [];
      return rankThreadReplies(this.messages, this.activeThreadId);
    },

    get resolvedThreadVisibleReplyCount() {
      return resolveVisibleThreadReplyCount(this.threadMessages, this.threadVisibleReplyCount, this.focusMessageId);
    },

    get visibleThreadMessages() {
      return visibleThreadReplies(this.messages, this.activeThreadId, this.threadVisibleReplyCount, this.focusMessageId);
    },

    get hiddenThreadReplyCount() {
      return Math.max(0, this.threadMessages.length - this.resolvedThreadVisibleReplyCount);
    },

    get hasMoreThreadMessages() {
      return this.hiddenThreadReplyCount > 0;
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
      const boards = sortTaskBoardScopes(
        this.scopes.filter((scope) => scope.record_state !== 'deleted'),
        this.scopesMap,
      ).map((scope) => ({
        id: scope.record_id,
        level: scope.level,
        label: this.formatTaskBoardScopeDisplay(scope),
        breadcrumb: this.getScopeAncestorPath(scope.record_id),
        description: scope.description || '',
      }));
      const hasUnscopedTasks = this.tasks.some((task) => task.record_state !== 'deleted' && isTaskUnscoped(task, this.scopesMap));
      if (hasUnscopedTasks) {
        boards.unshift({
          id: UNSCOPED_TASK_BOARD_ID,
          level: 'system',
          label: 'Unscoped',
          breadcrumb: 'Unscoped',
          description: 'Tasks with no scope assignment',
        });
      }
      return boards;
    },

    get selectedBoardScope() {
      if (!this.selectedBoardId || this.selectedBoardId === UNSCOPED_TASK_BOARD_ID) return null;
      return this.scopesMap.get(this.selectedBoardId) || null;
    },

    get selectedBoardIsUnscoped() {
      return this.selectedBoardId === UNSCOPED_TASK_BOARD_ID;
    },

    get selectedBoardLabel() {
      if (this.selectedBoardIsUnscoped) return 'Unscoped';
      if (!this.selectedBoardScope) return 'Scope board';
      return this.formatTaskBoardScopeDisplay(this.selectedBoardScope);
    },

    get canToggleBoardDescendants() {
      return this.selectedBoardScope?.level === 'product' || this.selectedBoardScope?.level === 'project';
    },

    get boardDescendantToggleTitle() {
      if (!this.canToggleBoardDescendants) return '';
      return this.showBoardDescendantTasks ? 'Hide deliverables' : 'Show deliverables';
    },

    get preferredTaskBoardId() {
      const activeTasks = this.tasks.filter((task) => task.record_state !== 'deleted');
      const boards = this.taskBoards.filter((b) => b.id !== UNSCOPED_TASK_BOARD_ID);
      if (boards.length > 0) {
        let bestBoard = boards[0];
        let bestCount = 0;
        for (const board of boards) {
          const scope = this.scopesMap.get(board.id);
          if (!scope) continue;
          const count = activeTasks.filter((task) => matchesTaskBoardScope(task, scope, this.scopesMap, { includeDescendants: true })).length;
          if (count > bestCount) {
            bestCount = count;
            bestBoard = board;
          }
        }
        return bestBoard.id;
      }
      if (activeTasks.some((task) => isTaskUnscoped(task, this.scopesMap))) {
        return UNSCOPED_TASK_BOARD_ID;
      }
      return this.taskBoards[0]?.id || null;
    },

    toggleBoardDescendantTasks() {
      this.showBoardDescendantTasks = !this.showBoardDescendantTasks;
      this.normalizeTaskFilterTags();
      if (this.showTaskDetail) this.closeTaskDetail();
      else this.syncRoute();
    },

    getWorkspaceByOwner(workspaceOwnerNpub) {
      if (!workspaceOwnerNpub) return null;
      return this.knownWorkspaces.find((entry) => entry.workspaceOwnerNpub === workspaceOwnerNpub) || null;
    },

    getWorkspaceDisplayEntry(workspace) {
      const workspaceOwnerNpub = typeof workspace === 'string' ? workspace : workspace?.workspaceOwnerNpub;
      if (!workspaceOwnerNpub) return typeof workspace === 'object' ? workspace : null;
      const known = this.getWorkspaceByOwner(workspaceOwnerNpub) || (typeof workspace === 'object' ? workspace : null) || {};
      const profile = this.workspaceProfileRowsByOwner?.[workspaceOwnerNpub] || {};
      return {
        ...known,
        ...profile,
        workspaceOwnerNpub,
      };
    },

    getWorkspaceName(workspace) {
      const entry = this.getWorkspaceDisplayEntry(workspace);
      return String(entry?.name || '').trim() || 'Untitled workspace';
    },

    getWorkspaceMeta(workspace) {
      const entry = this.getWorkspaceDisplayEntry(workspace);
      return String(entry?.description || '').trim() || entry?.workspaceOwnerNpub || '';
    },

    getWorkspaceStorageBackendUrl(workspace) {
      const entry = this.getWorkspaceDisplayEntry(workspace);
      const workspaceOwnerNpub = entry?.workspaceOwnerNpub || '';
      if (entry?.directHttpsUrl) return String(entry.directHttpsUrl).trim();
      if (workspaceOwnerNpub && workspaceOwnerNpub === this.currentWorkspaceOwnerNpub) {
        return this.currentWorkspaceBackendUrl;
      }
      return '';
    },

    getWorkspaceAvatar(workspace) {
      const entry = this.getWorkspaceDisplayEntry(workspace);
      const workspaceOwnerNpub = entry?.workspaceOwnerNpub || '';
      const storedAvatar = String(entry?.avatarUrl || entry?.avatar_url || '').trim();
      const storedObjectId = storageObjectIdFromRef(storedAvatar);
      if (storedObjectId) {
        const backendUrl = this.getWorkspaceStorageBackendUrl(entry || workspaceOwnerNpub);
        const cacheKey = storageImageCacheKey(storedObjectId, backendUrl);
        const resolved = this.storageImageUrlCache?.[cacheKey];
        if (resolved) return resolved;
        this.resolveStorageImageUrl(storedObjectId, { backendUrl }).catch(() => {});
      } else if (storedAvatar) {
        return storedAvatar;
      }
      if (workspaceOwnerNpub) {
        void this.ensureWorkspaceProfileHydrated(workspaceOwnerNpub);
      }
      return workspaceOwnerNpub ? this.getSenderAvatar(workspaceOwnerNpub) : null;
    },

    getWorkspaceInitials(workspace) {
      if (!workspace) return this.getInitials('WS');
      if (typeof workspace === 'string') return this.getInitials(workspace);
      return this.getInitials(this.getWorkspaceName(workspace) || workspace.workspaceOwnerNpub || 'WS');
    },

    toggleWorkspaceSwitcherMenu() {
      if (this.isWorkspaceSwitching) return;
      this.showWorkspaceSwitcherMenu = !this.showWorkspaceSwitcherMenu;
      if (this.showWorkspaceSwitcherMenu) {
        void this.hydrateKnownWorkspaceProfiles();
      }
    },

    closeWorkspaceSwitcherMenu() {
      this.showWorkspaceSwitcherMenu = false;
    },

    async handleWorkspaceSwitcherSelect(workspaceOwnerNpub) {
      if (!workspaceOwnerNpub || this.isWorkspaceSwitching) return;
      if (workspaceOwnerNpub === this.currentWorkspaceOwnerNpub) {
        this.closeWorkspaceSwitcherMenu();
        return;
      }
      // Keep the switcher visible during the switch so the user sees progress.
      this.workspaceSwitchPendingNpub = workspaceOwnerNpub;
      this.mobileNavOpen = false;

      // Persist the new workspace selection, then hard-reload so no stale
      // in-memory state from the previous workspace leaks through.
      const workspace = this.knownWorkspaces.find((w) => w.workspaceOwnerNpub === workspaceOwnerNpub);
      if (!workspace) return;
      this.currentWorkspaceOwnerNpub = workspace.workspaceOwnerNpub;
      this.superbasedTokenInput = workspace.connectionToken || this.superbasedTokenInput;
      this.backendUrl = normalizeBackendUrl(workspace.directHttpsUrl || this.backendUrl || guessDefaultBackendUrl());
      this.ownerNpub = workspace.workspaceOwnerNpub;
      setBaseUrl(this.backendUrl);
      await this.persistWorkspaceSettings();
      window.location.reload();
    },

    getTaskBoardOptionLabel(scopeId) {
      if (scopeId === UNSCOPED_TASK_BOARD_ID) return 'Unscoped';
      const scope = this.scopesMap.get(scopeId);
      if (!scope) return 'Scope board';
      return this.formatTaskBoardScopeDisplay(scope);
    },

    getTaskBoardSearchText(scopeId) {
      if (scopeId === UNSCOPED_TASK_BOARD_ID) return 'unscoped no scope unsorted';
      const scope = this.scopesMap.get(scopeId);
      if (!scope) return '';
      return [
        scope.title,
        scope.description,
        scope.level,
        getTaskBoardScopeLabel(scope, this.scopesMap),
        this.getScopeAncestorPath(scope.record_id),
      ].filter(Boolean).join(' ').toLowerCase();
    },

    getScopeAncestorPath(scopeId) {
      const parts = [];
      let current = scopeId ? this.scopesMap.get(scopeId) || null : null;
      current = current?.parent_id ? this.scopesMap.get(current.parent_id) || null : null;
      while (current) {
        parts.unshift(current.title);
        current = current.parent_id ? this.scopesMap.get(current.parent_id) || null : null;
      }
      return parts.length > 0 ? `${parts.join(' > ')} >` : '';
    },

    formatTaskBoardScopeDisplay(scope) {
      if (!scope?.record_id) return '';
      const title = String(scope.title || '').trim() || 'Untitled scope';
      const level = this.scopeLevelLabel(scope.level) || 'Scope';
      const ancestorPath = this.getScopeAncestorPath(scope.record_id);
      return ancestorPath ? `${title} (${level}): ${ancestorPath}` : `${title} (${level})`;
    },

    getTaskBoardWriteGroup(scopeId) {
      if (scopeId === UNSCOPED_TASK_BOARD_ID) return this.getWorkspaceSettingsGroupRef();
      const scope = this.scopesMap.get(scopeId);
      if (!scope) return null;
      return this.getScopeShareGroupIds(scope)[0] || null;
    },

    buildTaskBoardAssignment(scopeId, fallbackTask = null) {
      if (scopeId === UNSCOPED_TASK_BOARD_ID) {
        const groupId = this.getWorkspaceSettingsGroupRef();
        const shares = groupId ? this.buildScopeDefaultShares([groupId]) : this.getDefaultPrivateShares();
        return {
          scope_id: null,
          scope_product_id: null,
          scope_project_id: null,
          scope_deliverable_id: null,
          board_group_id: groupId || fallbackTask?.board_group_id || null,
          group_ids: this.getShareGroupIds(shares),
          shares: toRaw(shares),
        };
      }
      const scope = this.scopesMap.get(scopeId) || null;
      if (!scope) {
        return {
          scope_id: fallbackTask?.scope_id ?? null,
          scope_product_id: fallbackTask?.scope_product_id ?? null,
          scope_project_id: fallbackTask?.scope_project_id ?? null,
          scope_deliverable_id: fallbackTask?.scope_deliverable_id ?? null,
          board_group_id: fallbackTask?.board_group_id ?? null,
          group_ids: toRaw(fallbackTask?.group_ids ?? []),
          shares: toRaw(fallbackTask?.shares ?? []),
        };
      }

      const groupIds = this.getScopeShareGroupIds(scope);
      return {
        ...buildScopeTags(scope),
        board_group_id: groupIds[0] || null,
        group_ids: groupIds,
        shares: this.buildScopeDefaultShares(groupIds),
      };
    },

    getTaskBoardScopeFromTask(task) {
      if (!task) return null;
      if (task.scope_id && this.scopesMap.has(task.scope_id)) return this.scopesMap.get(task.scope_id) || null;
      if (task.scope_deliverable_id && this.scopesMap.has(task.scope_deliverable_id)) return this.scopesMap.get(task.scope_deliverable_id) || null;
      if (task.scope_project_id && this.scopesMap.has(task.scope_project_id)) return this.scopesMap.get(task.scope_project_id) || null;
      if (task.scope_product_id && this.scopesMap.has(task.scope_product_id)) return this.scopesMap.get(task.scope_product_id) || null;
      return null;
    },

    get filteredTaskBoards() {
      const query = String(this.boardPickerQuery || '').trim().toLowerCase();
      if (!query) return this.taskBoards;
      return this.taskBoards.filter((board) => this.getTaskBoardSearchText(board.id).includes(query));
    },

    get weekdayOptions() {
      return WEEKDAY_OPTIONS;
    },

    resolveGroupId(groupRef) {
      const value = String(groupRef || '').trim();
      if (!value) return null;
      const group = this.groups.find((item) => item.group_id === value || item.group_npub === value);
      return group?.group_id || group?.group_npub || value;
    },

    normalizeTaskRowGroupRefs(task) {
      if (!task || typeof task !== 'object') return task;

      const nextBoardId = this.resolveGroupId(task.board_group_id);
      const nextGroupIds = [...new Set((task.group_ids || [])
        .map((value) => this.resolveGroupId(value))
        .filter(Boolean))];
      const nextShares = Array.isArray(task.shares)
        ? task.shares.map((share) => ({
            ...share,
            group_npub: this.resolveGroupId(share?.group_npub),
            via_group_npub: this.resolveGroupId(share?.via_group_npub),
          }))
        : task.shares;

      const changed = nextBoardId !== (task.board_group_id ?? null)
        || JSON.stringify(nextGroupIds) !== JSON.stringify(task.group_ids || [])
        || JSON.stringify(nextShares) !== JSON.stringify(task.shares || []);

      if (!changed) return task;

      return {
        ...task,
        board_group_id: nextBoardId,
        group_ids: nextGroupIds,
        shares: nextShares,
      };
    },

    normalizeTaskRowScopeRefs(task) {
      if (!task || typeof task !== 'object') return task;
      if (!task.scope_id || !this.scopesMap.has(task.scope_id)) return task;

      const chain = resolveScopeChain(task.scope_id, this.scopesMap);
      const changed = (task.scope_product_id ?? null) !== (chain.scope_product_id ?? null)
        || (task.scope_project_id ?? null) !== (chain.scope_project_id ?? null)
        || (task.scope_deliverable_id ?? null) !== (chain.scope_deliverable_id ?? null);

      if (!changed) return task;

      return {
        ...task,
        scope_product_id: chain.scope_product_id,
        scope_project_id: chain.scope_project_id,
        scope_deliverable_id: chain.scope_deliverable_id,
      };
    },

    normalizeScheduleRowGroupRefs(schedule) {
      if (!schedule || typeof schedule !== 'object') return schedule;

      const nextAssignedGroupId = this.resolveGroupId(schedule.assigned_group_id);
      const nextGroupIds = [...new Set((schedule.group_ids || [])
        .map((value) => this.resolveGroupId(value))
        .filter(Boolean))];
      const nextShares = Array.isArray(schedule.shares)
        ? schedule.shares.map((share) => {
            if (typeof share === 'string') return this.resolveGroupId(share);
            return {
              ...share,
              group_npub: this.resolveGroupId(share?.group_npub),
              via_group_npub: this.resolveGroupId(share?.via_group_npub),
            };
          })
        : schedule.shares;

      const changed = nextAssignedGroupId !== (schedule.assigned_group_id ?? null)
        || JSON.stringify(nextGroupIds) !== JSON.stringify(schedule.group_ids || [])
        || JSON.stringify(nextShares) !== JSON.stringify(schedule.shares || []);

      if (!changed) return schedule;

      return {
        ...schedule,
        assigned_group_id: nextAssignedGroupId,
        group_ids: nextGroupIds,
        shares: nextShares,
      };
    },

    normalizeScopeRowGroupRefs(scope) {
      if (!scope || typeof scope !== 'object') return scope;

      const nextGroupIds = normalizeGroupIds((scope.group_ids || [])
        .map((value) => this.resolveGroupId(value))
        .filter(Boolean));

      const changed = JSON.stringify(nextGroupIds) !== JSON.stringify(scope.group_ids || []);
      if (!changed) return scope;

      return {
        ...scope,
        group_ids: nextGroupIds,
      };
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
      this.showBoardDescendantTasks = false;
      this.clearSelectedTasks();
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
      if (!this.selectedBoardId) {
        this.selectedBoardId = this.preferredTaskBoardId;
        this.persistSelectedBoardId(this.selectedBoardId);
        return;
      }
      const exists = this.taskBoards.some((board) => board.id === this.selectedBoardId);
      if (!exists) {
        this.selectedBoardId = this.preferredTaskBoardId;
        this.persistSelectedBoardId(this.selectedBoardId);
      }
    },

    normalizeTaskFilterTags() {
      const availableTags = new Set(this.allTaskTags);
      this.taskFilterTags = this.taskFilterTags.filter((tag) => availableTags.has(tag));
    },

    get boardScopedTasks() {
      const tasks = this.tasks.filter((task) => task.record_state !== 'deleted');
      if (this.selectedBoardIsUnscoped) {
        return tasks.filter((task) => isTaskUnscoped(task, this.scopesMap));
      }
      if (!this.selectedBoardScope) return tasks;
      return tasks.filter((task) => matchesTaskBoardScope(task, this.selectedBoardScope, this.scopesMap, {
        includeDescendants: this.showBoardDescendantTasks,
      }));
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

    get selectedTasks() {
      return this.tasks.filter((task) => this.selectedTaskIds.includes(task.record_id));
    },

    get selectedTaskCount() {
      return this.selectedTasks.length;
    },

    get canBulkAssignToDefaultAgent() {
      return Boolean(this.defaultAgentNpub && this.selectedTaskCount > 0 && !this.bulkTaskBusy);
    },

    get boardColumns() {
      const cols = [];
      const summary = this.summaryTasks;
      if (summary.length > 0) {
        cols.push({ state: 'summary', label: 'Summary', tasks: summary });
      }
      const states = ['new', 'ready', 'definition', 'in_progress', 'review', 'done'];
      const labels = {
        new: 'New',
        ready: 'Ready',
        definition: 'Definition',
        in_progress: 'In Progress',
        review: 'Review',
        done: 'Done',
      };
      for (const state of states) {
        const tasks = state === 'done'
          ? this.doneTasks
          : this.activeTasks.filter(t => t.state === state);
        cols.push({ state, label: labels[state], tasks });
      }
      return cols;
    },

    get calendarScheduledTasks() {
      return this.filteredTasks.filter((task) =>
        task.record_state !== 'deleted'
        && task.state !== 'archive'
        && !this.isParentTask(task.record_id)
        && Boolean(task.scheduled_for)
      );
    },

    get taskCalendar() {
      return buildTaskCalendar(this.calendarScheduledTasks, {
        view: this.calendarView,
        anchorDateKey: this.calendarAnchorDate,
      });
    },

    get visibleBoardTasks() {
      let tasks = this.boardScopedTasks.filter((t) => t.state !== 'archive');
      const query = String(this.taskFilter || '').trim().toLowerCase();
      if (query) {
        tasks = tasks.filter((t) =>
          String(t.title || '').toLowerCase().includes(query)
          || String(t.description || '').toLowerCase().includes(query)
          || String(t.tags || '').toLowerCase().includes(query)
        );
      }
      return tasks;
    },

    get allTaskTags() {
      const tagSet = new Set();
      for (const task of this.visibleBoardTasks) {
        for (const tag of parseTaskTags(task.tags)) {
          tagSet.add(tag);
        }
      }
      return [...tagSet].sort();
    },

    getTaskTags(task) {
      return parseTaskTags(task?.tags);
    },

    getTaskBoardLabel(taskOrScopeRef) {
      if (!taskOrScopeRef) return 'Scope board';
      if (typeof taskOrScopeRef !== 'string' && isTaskUnscoped(taskOrScopeRef, this.scopesMap)) return 'Unscoped';
      if (taskOrScopeRef === UNSCOPED_TASK_BOARD_ID) return 'Unscoped';
      const scope = typeof taskOrScopeRef === 'string'
        ? this.scopesMap.get(taskOrScopeRef) || null
        : this.getTaskBoardScopeFromTask(taskOrScopeRef);
      if (!scope) return 'Scope board';
      return this.getTaskBoardOptionLabel(scope.record_id);
    },

    get selectedBoardWriteGroup() {
      return this.getTaskBoardWriteGroup(this.selectedBoardId)
        || this.getWorkspaceSettingsGroupRef()
        || null;
    },

    async ensureTaskBoardScopeSetup() {
      if (this.taskBoardScopeSetupInFlight) return;
      this.taskBoardScopeSetupInFlight = true;
      try {
        this.validateSelectedBoardId();
      } finally {
        this.taskBoardScopeSetupInFlight = false;
      }
    },

    getScheduleAssignedGroupLabel(groupId) {
      const resolvedGroupId = this.resolveGroupId(groupId);
      if (!resolvedGroupId) return 'Unassigned';
      if (resolvedGroupId === this.memberPrivateGroupRef) return 'Private group';
      return this.scheduleAssignableGroups.find((group) => group.groupId === resolvedGroupId)?.label || resolvedGroupId;
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
        .filter((group) => !sharedGroups.has(group.group_id || group.group_npub))
        .filter((group) =>
          String(group.name || '').toLowerCase().includes(needle)
          || (group.member_npubs || []).some((member) => member.toLowerCase().includes(needle))
        )
        .slice(0, 6)
        .map((group) => ({
          type: 'group',
          key: `group:${group.group_id || group.group_npub}`,
          group_npub: group.group_id || group.group_npub,
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

    get taskAssigneeSuggestions() {
      return this.findPeopleSuggestions(this.taskAssigneeQuery, [this.editingTask?.assigned_to_npub]);
    },

    get scheduleAssignableGroups() {
      return this.taskBoards.map((board) => ({
        groupId: board.id,
        label: board.label,
        subtitle: board.id === this.memberPrivateGroupRef ? 'Private group' : board.id,
      }));
    },

    get scopeAssignableGroups() {
      return this.currentWorkspaceGroups.map((group) => ({
        groupId: group.group_id || group.group_npub,
        label: group.name || 'Group',
        subtitle: group.group_kind === 'private'
          ? 'Private group'
          : `${(group.member_npubs || []).length} members`,
      }));
    },

    get newScheduleGroupSuggestions() {
      return this.findScheduleGroupSuggestions(
        this.newScheduleGroupQuery,
        [this.newScheduleAssignedGroupId],
      );
    },

    get editingScheduleGroupSuggestions() {
      return this.findScheduleGroupSuggestions(
        this.editingScheduleGroupQuery,
        [this.editingScheduleDraft?.assigned_group_id],
      );
    },

    get newScopeGroupSuggestions() {
      return this.findScopeGroupSuggestions(
        this.newScopeGroupQuery,
        this.newScopeAssignedGroupIds,
      );
    },

    get editingScopeGroupSuggestions() {
      return this.findScopeGroupSuggestions(
        this.editingScopeGroupQuery,
        this.editingScopeAssignedGroupIds,
      );
    },

    get defaultAgentSuggestions() {
      return this.findPeopleSuggestions(this.defaultAgentQuery, [this.defaultAgentNpub]);
    },

    get defaultAgentLabel() {
      return this.defaultAgentNpub ? this.getSenderName(this.defaultAgentNpub) : '';
    },

    get canDoTaskWithDefaultAgent() {
      return Boolean(this.defaultAgentNpub && this.editingTask);
    },

    get groupActionsLocked() {
      return this.groupCreatePending || this.groupEditPending || !!this.groupDeletePendingId;
    },

    findPeopleSuggestions(query, excludeNpubs = [], candidateNpubs = null) {
      const needle = String(query || '').trim().toLowerCase();
      if (!needle) return [];

      const existing = new Set((excludeNpubs || []).map((value) => String(value || '').trim()).filter(Boolean));
      const allowed = candidateNpubs?.length
        ? new Set(candidateNpubs.map((value) => String(value || '').trim()).filter(Boolean))
        : null;
      return this.addressBookPeople
        .filter((person) => !allowed || allowed.has(person.npub))
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
          subtitle: person.npub,
          avatarUrl: this.getSenderAvatar(person.npub),
        }));
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

    findScheduleGroupSuggestions(query, excludeGroupIds = []) {
      const needle = String(query || '').trim().toLowerCase();
      if (!needle) return [];

      const existing = new Set((excludeGroupIds || []).map((value) => this.resolveGroupId(value)).filter(Boolean));
      return this.scheduleAssignableGroups
        .filter((group) => !existing.has(group.groupId))
        .filter((group) =>
          String(group.label || '').toLowerCase().includes(needle)
          || String(group.groupId || '').toLowerCase().includes(needle)
          || String(group.subtitle || '').toLowerCase().includes(needle)
        )
        .slice(0, 8);
    },

    findScopeGroupSuggestions(query, excludeGroupIds = []) {
      const needle = String(query || '').trim().toLowerCase();
      if (!needle) return [];

      const existing = new Set((excludeGroupIds || []).map((value) => this.resolveGroupId(value)).filter(Boolean));
      return this.scopeAssignableGroups
        .filter((group) => !existing.has(group.groupId))
        .filter((group) =>
          String(group.label || '').toLowerCase().includes(needle)
          || String(group.groupId || '').toLowerCase().includes(needle)
          || String(group.subtitle || '').toLowerCase().includes(needle)
        )
        .slice(0, 8);
    },

    getScopeAssignedGroupLabel(groupId) {
      const resolvedGroupId = this.resolveGroupId(groupId);
      if (!resolvedGroupId) return 'Group';
      return this.scopeAssignableGroups.find((group) => group.groupId === resolvedGroupId)?.label || resolvedGroupId;
    },

    getScopeAssignedGroupSubtitle(groupId) {
      const resolvedGroupId = this.resolveGroupId(groupId);
      if (!resolvedGroupId) return '';
      return this.scopeAssignableGroups.find((group) => group.groupId === resolvedGroupId)?.subtitle || resolvedGroupId;
    },

    getScopeGroupSummary(scope) {
      const groupIds = normalizeGroupIds(scope?.group_ids).map((groupId) => this.resolveGroupId(groupId)).filter(Boolean);
      if (groupIds.length === 0) return 'No groups';
      return groupIds.map((groupId) => this.getScopeAssignedGroupLabel(groupId)).join(', ');
    },

    get editingScope() {
      if (!this.editingScopeId) return null;
      return this.scopesMap.get(this.editingScopeId) || null;
    },

    get editingScopeLevelLabel() {
      return this.scopeLevelLabel(this.editingScope?.level || '');
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
      this.syncWorkspaceProfileDraft();
    },

    async hydrateKnownWorkspaceProfiles() {
      if (!Array.isArray(this.knownWorkspaces) || this.knownWorkspaces.length === 0) return;

      const patches = [];
      const overlay = { ...(this.workspaceProfileRowsByOwner || {}) };
      for (const workspace of this.knownWorkspaces) {
        const workspaceOwnerNpub = String(workspace?.workspaceOwnerNpub || '').trim();
        if (!workspaceOwnerNpub) continue;
        const row = await getWorkspaceSettingsSnapshot(workspaceOwnerNpub);
        if (!row?.workspace_owner_npub) continue;
        const patch = {
          workspaceOwnerNpub: row.workspace_owner_npub,
        };
        if (Object.prototype.hasOwnProperty.call(row, 'workspace_name')) patch.name = row.workspace_name;
        if (Object.prototype.hasOwnProperty.call(row, 'workspace_description')) patch.description = row.workspace_description;
        if (Object.prototype.hasOwnProperty.call(row, 'workspace_avatar_url')) patch.avatarUrl = row.workspace_avatar_url;
        patches.push(patch);
        overlay[workspaceOwnerNpub] = {
          ...(overlay[workspaceOwnerNpub] || {}),
          ...patch,
        };
      }

      if (patches.length === 0) return;
      this.workspaceProfileRowsByOwner = overlay;
      const before = JSON.stringify(this.knownWorkspaces);
      this.mergeKnownWorkspaces(patches);
      if (JSON.stringify(this.knownWorkspaces) !== before) {
        await this.persistWorkspaceSettings();
      }
    },

    async ensureWorkspaceProfileHydrated(workspaceOwnerNpub) {
      const owner = String(workspaceOwnerNpub || '').trim();
      if (!owner) return;

      const existing = this.getWorkspaceByOwner(owner);
      if (String(existing?.avatarUrl || '').trim()) return;

      const pending = this.workspaceProfileHydrationPromises?.[owner];
      if (pending) return pending;

      const loadPromise = (async () => {
        const row = await getWorkspaceSettingsSnapshot(owner);
        if (!row?.workspace_owner_npub) return;

        const patch = {
          workspaceOwnerNpub: row.workspace_owner_npub,
        };
        if (Object.prototype.hasOwnProperty.call(row, 'workspace_name')) patch.name = row.workspace_name;
        if (Object.prototype.hasOwnProperty.call(row, 'workspace_description')) patch.description = row.workspace_description;
        if (Object.prototype.hasOwnProperty.call(row, 'workspace_avatar_url')) patch.avatarUrl = row.workspace_avatar_url;

        this.workspaceProfileRowsByOwner = {
          ...(this.workspaceProfileRowsByOwner || {}),
          [owner]: {
            ...(this.workspaceProfileRowsByOwner?.[owner] || {}),
            ...patch,
          },
        };

        const before = JSON.stringify(this.getWorkspaceByOwner(owner) || {});
        this.mergeKnownWorkspaces([patch]);
        const after = JSON.stringify(this.getWorkspaceByOwner(owner) || {});
        if (after !== before) {
          await this.persistWorkspaceSettings();
        }
      })();

      this.workspaceProfileHydrationPromises = {
        ...(this.workspaceProfileHydrationPromises || {}),
        [owner]: loadPromise,
      };

      try {
        await loadPromise;
      } finally {
        const next = { ...(this.workspaceProfileHydrationPromises || {}) };
        delete next[owner];
        this.workspaceProfileHydrationPromises = next;
      }
    },

    revokeWorkspaceAvatarPreviewObjectUrl() {
      if (this.workspaceProfilePendingAvatarObjectUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(this.workspaceProfilePendingAvatarObjectUrl);
      }
      this.workspaceProfilePendingAvatarObjectUrl = '';
    },

    setWorkspaceAvatarPreview(url = '') {
      this.workspaceProfileAvatarPreviewUrl = String(url || '').trim();
    },

    syncWorkspaceProfileDraft(options = {}) {
      if (this.workspaceProfileDirty && !options.force) return;
      const workspace = this.currentWorkspace;
      const storedAvatar = String(workspace?.avatarUrl || '').trim();
      const storedObjectId = storageObjectIdFromRef(storedAvatar);
      const backendUrl = this.getWorkspaceStorageBackendUrl(workspace);
      this.revokeWorkspaceAvatarPreviewObjectUrl();
      this.workspaceProfilePendingAvatarFile = null;
      this.workspaceProfileNameInput = String(workspace?.name || '').trim();
      this.workspaceProfileDescriptionInput = String(workspace?.description || '').trim();
      this.workspaceProfileAvatarInput = storedAvatar;
      this.setWorkspaceAvatarPreview(storedObjectId ? '' : (this.getWorkspaceAvatar(workspace) || ''));
      if (storedObjectId) {
        this.resolveStorageImageUrl(storedObjectId, { backendUrl })
          .then((url) => {
            if (this.workspaceProfileDirty) return;
            if (this.workspaceProfileAvatarInput !== storedAvatar) return;
            this.setWorkspaceAvatarPreview(url);
          })
          .catch(() => {});
      }
      this.workspaceProfileDirty = false;
      this.workspaceProfileError = null;
    },

    markWorkspaceProfileDirty() {
      this.workspaceProfileDirty = true;
      this.workspaceProfileError = null;
    },

    handleWorkspaceProfileField(field, value) {
      if (field === 'name') this.workspaceProfileNameInput = value;
      if (field === 'description') this.workspaceProfileDescriptionInput = value;
      this.markWorkspaceProfileDirty();
    },

    async handleWorkspaceAvatarSelection(event) {
      const [file] = [...(event?.target?.files || [])];
      if (!file) return;
      if (!String(file.type || '').startsWith('image/')) {
        this.workspaceProfileError = 'Choose an image file for the workspace avatar.';
        event.target.value = '';
        return;
      }
      this.revokeWorkspaceAvatarPreviewObjectUrl();
      const objectUrl = URL.createObjectURL(file);
      this.workspaceProfilePendingAvatarFile = file;
      this.workspaceProfilePendingAvatarObjectUrl = objectUrl;
      this.workspaceProfileAvatarInput = '';
      this.setWorkspaceAvatarPreview(objectUrl);
      this.markWorkspaceProfileDirty();
      event.target.value = '';
    },

    clearWorkspaceAvatarDraft() {
      this.revokeWorkspaceAvatarPreviewObjectUrl();
      this.workspaceProfilePendingAvatarFile = null;
      this.workspaceProfileAvatarInput = '';
      this.setWorkspaceAvatarPreview('');
      this.markWorkspaceProfileDirty();
    },

    resetWorkspaceProfileDraft() {
      if (this.workspaceProfileSaving) return;
      this.syncWorkspaceProfileDraft({ force: true });
    },

    applyWorkspaceSettingsRow(row, options = {}) {
      const overwriteInput = options.overwriteInput !== false;
      this.workspaceSettingsRecordId = row?.record_id || '';
      this.workspaceSettingsVersion = Number(row?.version || 0);
      this.workspaceSettingsGroupIds = Array.isArray(row?.group_ids) ? [...row.group_ids] : [];
      this.workspaceHarnessUrl = String(row?.wingman_harness_url || '').trim();
      this.workspaceTriggers = Array.isArray(row?.triggers) ? [...row.triggers] : [];
      if (row?.workspace_owner_npub) {
        const workspacePatch = {
          workspaceOwnerNpub: row.workspace_owner_npub,
        };
        if (Object.prototype.hasOwnProperty.call(row, 'workspace_name')) {
          workspacePatch.name = row.workspace_name;
        }
        if (Object.prototype.hasOwnProperty.call(row, 'workspace_description')) {
          workspacePatch.description = row.workspace_description;
        }
        if (Object.prototype.hasOwnProperty.call(row, 'workspace_avatar_url')) {
          workspacePatch.avatarUrl = row.workspace_avatar_url;
        }
        this.workspaceProfileRowsByOwner = {
          ...(this.workspaceProfileRowsByOwner || {}),
          [row.workspace_owner_npub]: {
            ...(this.workspaceProfileRowsByOwner?.[row.workspace_owner_npub] || {}),
            ...workspacePatch,
          },
        };
        this.mergeKnownWorkspaces([workspacePatch]);
      }
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
      return resolveWorkspaceSettingsGroupNpub({
        memberPrivateGroup: this.memberPrivateGroup,
        currentWorkspace: this.currentWorkspace,
      });
    },

    getWorkspaceSettingsGroupRef() {
      return resolveWorkspaceSettingsGroupRef({
        memberPrivateGroup: this.memberPrivateGroup,
        currentWorkspace: this.currentWorkspace,
      });
    },

    getAudioRecorderStorageGroupIds(context = this.audioRecorderContext) {
      if (context === 'chat' || context === 'thread') {
        return normalizeStorageAccessGroupIds(this.selectedChannel?.group_ids ?? []);
      }
      if (context === 'task-comment') {
        return normalizeStorageAccessGroupIds(this.editingTask?.group_ids ?? []);
      }
      if (context === 'doc-comment' || context === 'doc-reply') {
        return normalizeStorageAccessGroupIds(this.selectedDocument?.group_ids ?? []);
      }
      return [];
    },

    get repairFamilyOptions() {
      return SYNC_FAMILY_OPTIONS;
    },

    isRepairFamilySelected(familyId) {
      return this.repairSelectedFamilyIds.includes(familyId);
    },

    toggleRepairFamily(familyId) {
      this.repairError = null;
      this.repairNotice = '';
      if (this.isRepairFamilySelected(familyId)) {
        this.repairSelectedFamilyIds = this.repairSelectedFamilyIds.filter((candidate) => candidate !== familyId);
        return;
      }
      this.repairSelectedFamilyIds = [...this.repairSelectedFamilyIds, familyId];
    },

    selectAllRepairFamilies() {
      this.repairError = null;
      this.repairNotice = '';
      this.repairSelectedFamilyIds = SYNC_FAMILY_OPTIONS.map((family) => family.id);
    },

    clearRepairFamilies() {
      this.repairError = null;
      this.repairNotice = '';
      this.repairSelectedFamilyIds = [];
    },

    get hasSyncQuarantine() {
      return this.syncQuarantine.length > 0;
    },

    syncQuarantineFamilyLabel(entry) {
      return getSyncFamily(entry?.family_id || entry?.family_hash)?.label || entry?.family_id || entry?.family_hash || 'Unknown family';
    },

    syncQuarantineRecordLabel(entry) {
      const recordId = String(entry?.record_id || '').trim();
      if (!recordId) return 'Unknown record';
      return recordId.length > 16 ? `${recordId.slice(0, 8)}…${recordId.slice(-4)}` : recordId;
    },

    formatSyncQuarantineTimestamp(value) {
      if (!value) return '';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return String(value);
      return date.toLocaleString();
    },

    async refreshSyncQuarantine() {
      this.syncQuarantine = await getSyncQuarantineEntries();
      return this.syncQuarantine;
    },

    handleHarnessInput(value) {
      this.wingmanHarnessInput = value;
      this.wingmanHarnessDirty = true;
      this.wingmanHarnessError = null;
    },

    handleDefaultAgentInput(value) {
      this.defaultAgentQuery = value;
      if (this.defaultAgentQuery.startsWith('npub1') && this.defaultAgentQuery.length >= 20) {
        this.resolveChatProfile(this.defaultAgentQuery);
      }
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
        knownHosts: this.knownHosts,
        currentWorkspaceOwnerNpub: this.currentWorkspaceOwnerNpub || '',
        defaultAgentNpub: this.defaultAgentNpub || '',
      });
    },

    async selectWorkspace(workspaceOwnerNpub, options = {}) {
      const workspace = this.knownWorkspaces.find((entry) => entry.workspaceOwnerNpub === workspaceOwnerNpub);
      if (!workspace) return;

      const previousWorkspace = this.currentWorkspaceOwnerNpub;
      this.workspaceSwitchPendingNpub = workspace.workspaceOwnerNpub;
      this.showWorkspaceSwitcherMenu = false;
      try {
        this.startSharedLiveQueries();
        this.stopWorkspaceLiveQueries();
        this.currentWorkspaceOwnerNpub = workspace.workspaceOwnerNpub;
        openWorkspaceDb(workspace.workspaceOwnerNpub);
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
          this.schedules = [];
          this.audioNotes = [];
          this.taskComments = [];
          this.showNewScheduleModal = false;
          this.cancelEditSchedule();
          this.hasForcedInitialBackfill = false;
          this.hasForcedTaskFamilyBackfill = false;
          this.docCommentBackfillAttemptsByDocId = {};
        }

        this.startWorkspaceLiveQueries();
        this.selectedBoardId = this.readStoredTaskBoardId() || null;
        this.validateSelectedBoardId();
        await this.persistWorkspaceSettings();
        await this.refreshWorkspaceSettings();
        this.syncWorkspaceProfileDraft({ force: true });

        if (this.session?.npub) {
          await this.refreshGroups();
          await this.refreshChannels();
          await this.refreshAudioNotes();
          await this.refreshDirectories();
          await this.refreshDocuments();
          await this.refreshScopes();
          await this.refreshTasks();
          await this.refreshSchedules();
          await this.ensureTaskBoardScopeSetup();
          await this.refreshStatusRecentChanges();
        }
      } finally {
        if (this.workspaceSwitchPendingNpub === workspace.workspaceOwnerNpub) {
          this.workspaceSwitchPendingNpub = '';
        }
      }
    },

    async removeWorkspace(workspaceOwnerNpub) {
      if (!workspaceOwnerNpub || this.removingWorkspace) return;
      const workspace = this.knownWorkspaces.find((w) => w.workspaceOwnerNpub === workspaceOwnerNpub);
      const label = workspace?.name || workspaceOwnerNpub;
      if (!confirm(`Remove workspace "${label}"?\n\nThis will delete all local data for this workspace. The workspace will remain on SuperBased and can be re-added later.`)) {
        return;
      }

      this.removingWorkspace = true;
      this.stopBackgroundSync();

      const isCurrentWorkspace = this.currentWorkspaceOwnerNpub === workspaceOwnerNpub;
      if (isCurrentWorkspace) this.stopWorkspaceLiveQueries();

      // Remove from known workspaces list
      this.knownWorkspaces = this.knownWorkspaces.filter((w) => w.workspaceOwnerNpub !== workspaceOwnerNpub);

      // Delete the local IndexedDB for this workspace
      try {
        await deleteWorkspaceDb(workspaceOwnerNpub);
      } catch (error) {
        console.warn('Failed to delete workspace database:', error?.message || error);
      }

      if (isCurrentWorkspace) {
        // Clear runtime state
        this.channels = [];
        this.messages = [];
        this.groups = [];
        this.documents = [];
        this.directories = [];
        this.tasks = [];
        this.schedules = [];
        this.audioNotes = [];
        this.taskComments = [];
        this.showNewScheduleModal = false;
        this.hasForcedInitialBackfill = false;
        this.hasForcedTaskFamilyBackfill = false;
        this.currentWorkspaceOwnerNpub = '';

        if (this.knownWorkspaces.length > 0) {
          // Switch to next available workspace and land on home
          await this.selectWorkspace(this.knownWorkspaces[0].workspaceOwnerNpub);
          await this.persistWorkspaceSettings();
          this.navigateTo('status');
          this.ensureBackgroundSync(true);
        } else {
          // No workspaces left — go back to workspace bootstrap
          this.ownerNpub = '';
          this.showWorkspaceBootstrapModal = true;
          this.navigateTo('status');
          await this.persistWorkspaceSettings();
        }
      } else {
        await this.persistWorkspaceSettings();
        this.ensureBackgroundSync();
      }

      this.removingWorkspace = false;
    },

    async loadRemoteWorkspaces() {
      if (!this.session?.npub || !this.backendUrl) return;
      try {
        const serviceNpub = await this.fetchBackendServiceNpub();
        const backendUrl = normalizeBackendUrl(this.backendUrl);
        const result = await getWorkspaces(this.session.npub);
        const workspaces = (result.workspaces || []).map((entry) => ({
          ...entry,
          directHttpsUrl: entry.direct_https_url || entry.directHttpsUrl || backendUrl,
          serviceNpub,
          appNpub: this.superbasedConnectionConfig?.appNpub || null,
        }));
        this.mergeKnownWorkspaces(workspaces);
        await this.hydrateKnownWorkspaceProfiles();
      } catch (error) {
        console.debug('loadRemoteWorkspaces failed:', error?.message || error);
      }
    },

    async tryRecoverWorkspace() {
      const ownerNpub = this.superbasedConnectionConfig?.workspaceOwnerNpub;
      const memberNpub = this.session?.npub;
      if (!ownerNpub || !memberNpub) return;
      try {
        const workspaceIdentity = createGroupIdentity();
        const wrappedNsec = await personalEncryptForNpub(memberNpub, workspaceIdentity.nsec);
        const response = await recoverWorkspace({
          workspace_owner_npub: ownerNpub,
          name: 'Recovered Workspace',
          wrapped_workspace_nsec: wrappedNsec,
          wrapped_by_npub: memberNpub,
        });
        const serviceNpub = await this.fetchBackendServiceNpub();
        const workspace = normalizeWorkspaceEntry({
          ...response,
          serviceNpub,
          appNpub: this.superbasedConnectionConfig?.appNpub || null,
          connectionToken: this.superbasedTokenInput,
        });
        this.mergeKnownWorkspaces([workspace]);
        console.debug('Workspace recovered:', ownerNpub);
      } catch (error) {
        console.debug('Workspace recovery skipped:', error?.message || error);
      }
    },

    updateWorkspaceBootstrapPrompt() {
      const shouldPrompt = Boolean(this.session?.npub) && Boolean(this.backendUrl) && !this.currentWorkspaceOwnerNpub && this.knownWorkspaces.length === 0;
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
      this.showWorkspaceSwitcherMenu = false;
      this.mobileNavOpen = false;
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

    getRoutePath(section = this.navSection) {
      switch (section) {
        case 'status':
          return '/notifications';
        case 'tasks':
          return '/tasks';
        case 'calendar':
          return '/calendar';
        case 'schedules':
          return '/schedules';
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
      } else if (this.navSection === 'tasks' || this.navSection === 'calendar') {
        if (this.selectedBoardId) url.searchParams.set('scopeid', this.selectedBoardId);
        if (this.showBoardDescendantTasks) url.searchParams.set('descendants', '1');
        if (this.navSection === 'tasks' && this.activeTaskId) url.searchParams.set('taskid', this.activeTaskId);
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
        } else if (route.section === 'tasks' || route.section === 'calendar') {
          this.selectedBoardId = route.params.scopeid
            || route.params.groupid
            || this.readStoredTaskBoardId()
            || this.preferredTaskBoardId;
          this.showBoardDescendantTasks = route.params.descendants === '1';
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

    // --- settings ---

    async saveSettings() {
      setBaseUrl(this.backendUrl);
      await this.persistWorkspaceSettings();
      this.ensureBackgroundSync();
    },

    async uploadWorkspaceAvatarFile(file) {
      const workspaceOwnerNpub = this.workspaceOwnerNpub;
      if (!workspaceOwnerNpub) {
        throw new Error('Select a workspace first');
      }
      if (!file || !String(file.type || '').startsWith('image/')) {
        throw new Error('Choose an image file for the workspace avatar.');
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      const settingsGroupId = this.getWorkspaceSettingsGroupRef();
      try {
        const prepared = await prepareStorageObject(buildStoragePrepareBody({
          ownerNpub: workspaceOwnerNpub,
          ownerGroupId: settingsGroupId,
          accessGroupIds: settingsGroupId ? [settingsGroupId] : [],
          contentType: file.type || 'image/png',
          sizeBytes: file.size || bytes.byteLength,
          fileName: this.defaultPastedImageName(file, 'workspace-avatar'),
        }));
        await uploadStorageObject(prepared, bytes, file.type || 'image/png');
        await completeStorageObject(prepared.object_id, {
          size_bytes: bytes.byteLength,
          sha256_hex: await this.sha256HexForBytes(bytes),
        });
        const backendUrl = this.getWorkspaceStorageBackendUrl(this.currentWorkspace);
        const cacheKey = storageImageCacheKey(prepared.object_id, backendUrl);
        const blob = new Blob([bytes], { type: file.type || 'image/png' });
        await cacheStorageImage({
          object_id: cacheKey,
          blob,
          content_type: blob.type || 'application/octet-stream',
        });
        this.rememberStorageImageUrl(cacheKey, URL.createObjectURL(blob));
        return `storage://${prepared.object_id}`;
      } catch (error) {
        const message = String(error?.message || error);
        flightDeckLog('error', 'storage', 'workspace avatar upload failed', {
          backendUrl: this.backendUrl || null,
          workspaceOwnerNpub,
          requestUrl: error?.requestUrl || null,
          method: error?.method || null,
          status: Number.isFinite(Number(error?.status)) ? Number(error.status) : null,
          message,
        });
        if (
          Number(error?.status) === 404
          && String(error?.requestUrl || '').endsWith('/api/v4/storage/prepare')
        ) {
          throw new Error(
            `Workspace avatar upload requires SuperBased storage on ${this.backendUrl || 'the workspace backend'}, `
            + 'but POST /api/v4/storage/prepare returned 404 there.',
          );
        }
        throw error;
      }
    },

    async saveWorkspaceProfile() {
      const workspace = this.currentWorkspace;
      if (!workspace) {
        this.workspaceProfileError = 'Select a workspace first';
        return;
      }

      const name = String(this.workspaceProfileNameInput || '').trim();
      if (!name) {
        this.workspaceProfileError = 'Workspace name is required';
        return;
      }

      this.workspaceProfileSaving = true;
      this.workspaceProfileError = null;
      try {
        let avatarUrl = String(this.workspaceProfileAvatarInput || '').trim() || null;
        if (this.workspaceProfilePendingAvatarFile) {
          avatarUrl = await this.uploadWorkspaceAvatarFile(this.workspaceProfilePendingAvatarFile);
        }
        const workspaceOwnerNpub = workspace.workspaceOwnerNpub;
        const now = new Date().toISOString();
        const writeGroupRef = this.getWorkspaceSettingsGroupRef();
        const groupIds = writeGroupRef ? [writeGroupRef] : [...(this.workspaceSettingsGroupIds || [])];
        const nextVersion = Math.max(1, Number(this.workspaceSettingsVersion || 0) + 1);
        const recordId = this.workspaceSettingsRecordId || workspaceSettingsRecordId(workspaceOwnerNpub);
        const description = String(this.workspaceProfileDescriptionInput || '').trim();
        const localRow = {
          workspace_owner_npub: workspaceOwnerNpub,
          record_id: recordId,
          owner_npub: workspaceOwnerNpub,
          workspace_name: name,
          workspace_description: description,
          workspace_avatar_url: avatarUrl,
          wingman_harness_url: this.workspaceHarnessUrl,
          triggers: toRaw(this.workspaceTriggers || []),
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
          workspace_name: name,
          workspace_description: description,
          workspace_avatar_url: avatarUrl,
          wingman_harness_url: this.workspaceHarnessUrl,
          triggers: toRaw(this.workspaceTriggers || []),
          group_ids: groupIds,
          version: nextVersion,
          previous_version: Math.max(0, nextVersion - 1),
          signature_npub: this.session?.npub || workspaceOwnerNpub,
          write_group_npub: writeGroupRef,
        });
        await addPendingWrite({
          record_id: recordId,
          record_family_hash: envelope.record_family_hash,
          envelope,
        });
        await this.refreshSyncStatus();
        this.ensureBackgroundSync(true);
        await this.persistWorkspaceSettings();
        this.syncWorkspaceProfileDraft({ force: true });
      } catch (error) {
        this.workspaceProfileError = error?.message || 'Failed to save workspace settings';
      } finally {
        this.workspaceProfileSaving = false;
      }
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
      const writeGroupRef = this.getWorkspaceSettingsGroupRef();
      const groupIds = writeGroupRef ? [writeGroupRef] : [...(this.workspaceSettingsGroupIds || [])];
      const nextVersion = Math.max(1, Number(this.workspaceSettingsVersion || 0) + 1);
      const recordId = this.workspaceSettingsRecordId || workspaceSettingsRecordId(workspaceOwnerNpub);
      const localRow = {
        workspace_owner_npub: workspaceOwnerNpub,
        record_id: recordId,
        owner_npub: workspaceOwnerNpub,
        wingman_harness_url: normalizedUrl,
        triggers: toRaw(this.workspaceTriggers || []),
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
        triggers: toRaw(this.workspaceTriggers || []),
        group_ids: groupIds,
        version: nextVersion,
        previous_version: Math.max(0, nextVersion - 1),
        signature_npub: this.session.npub,
        write_group_npub: writeGroupRef,
      });
      await addPendingWrite({
        record_id: recordId,
        record_family_hash: envelope.record_family_hash,
        envelope,
      });
      await this.refreshSyncStatus();
      this.ensureBackgroundSync(true);
    },

    async selectDefaultAgent(npub) {
      const nextNpub = String(npub || '').trim();
      this.defaultAgentNpub = nextNpub;
      this.defaultAgentQuery = '';
      if (nextNpub) {
        await this.rememberPeople([nextNpub], 'default-agent');
      }
      await this.persistWorkspaceSettings();
    },

    async clearDefaultAgent() {
      this.defaultAgentNpub = '';
      this.defaultAgentQuery = '';
      await this.persistWorkspaceSettings();
    },

    // --- Triggers ---

    get triggerBotSuggestions() {
      return this.findPeopleSuggestions(this.newTriggerBotQuery, []);
    },

    triggerTypeLabel(type) {
      const labels = {
        manual: 'Manual',
        chat_bot_tagged: 'Bot @tagged anywhere',
        chat_channel_message: 'Chat: Any message in channel',
      };
      return labels[type] || type;
    },

    selectTriggerBot(npub) {
      this.newTriggerBotNpub = npub;
      this.newTriggerBotQuery = '';
    },

    clearTriggerBot() {
      this.newTriggerBotNpub = '';
      this.newTriggerBotQuery = '';
    },

    async addTrigger() {
      this.triggerError = null;
      const name = this.newTriggerName.trim();
      const triggerId = this.newTriggerId.trim();
      const botNpub = this.newTriggerBotNpub.trim();
      const triggerType = this.newTriggerType;

      if (!name || !triggerId || !botNpub) {
        this.triggerError = 'Name, Trigger ID, and Bot are all required.';
        return;
      }

      let botPubkeyHex;
      try {
        botPubkeyHex = npubToHex(botNpub);
      } catch {
        this.triggerError = 'Invalid bot npub.';
        return;
      }

      const trigger = {
        id: crypto.randomUUID(),
        name,
        triggerType,
        trigger_id: triggerId,
        botNpub,
        botPubkeyHex,
        enabled: true,
        created_at: new Date().toISOString(),
      };

      this.workspaceTriggers = [...this.workspaceTriggers, trigger];
      await this.saveHarnessSettings();

      this.newTriggerType = 'manual';
      this.newTriggerName = '';
      this.newTriggerId = '';
      this.newTriggerBotNpub = '';
      this.newTriggerBotQuery = '';
      this.triggerSuccess = `Trigger "${name}" added.`;
      setTimeout(() => (this.triggerSuccess = null), 3000);
    },

    async removeTrigger(id) {
      this.workspaceTriggers = this.workspaceTriggers.filter((t) => t.id !== id);
      await this.saveHarnessSettings();
    },

    async toggleTrigger(id) {
      const trigger = this.workspaceTriggers.find((t) => t.id === id);
      if (!trigger) return;
      trigger.enabled = !trigger.enabled;
      this.workspaceTriggers = [...this.workspaceTriggers];
      await this.saveHarnessSettings();
    },

    async fireTrigger(id) {
      const trigger = this.workspaceTriggers.find((t) => t.id === id);
      if (!trigger) return;

      this.triggerFiring = { ...this.triggerFiring, [id]: true };
      this.triggerError = null;

      try {
        const message = (this.triggerMessage[id] || '').trim();
        const result = await signAndPublishTrigger(
          trigger.trigger_id,
          trigger.botPubkeyHex,
          message,
        );

        if (result.relayResults.ok.length === 0) {
          this.triggerError = 'Failed to publish to any relay.';
        } else {
          this.triggerSuccess = `Trigger "${trigger.name}" fired to ${result.relayResults.ok.length} relay(s).`;
          this.triggerMessage = { ...this.triggerMessage, [id]: '' };
          setTimeout(() => (this.triggerSuccess = null), 3000);
        }
      } catch (err) {
        this.triggerError = `Fire failed: ${err.message}`;
      } finally {
        this.triggerFiring = { ...this.triggerFiring, [id]: false };
      }
    },

    async _checkTriggerRules(eventType, botPubkeyHex, contextMessage) {
      const triggers = (this.workspaceTriggers || []).filter(
        (t) => t.enabled && t.triggerType === eventType && t.botPubkeyHex === botPubkeyHex,
      );

      for (const trigger of triggers) {
        try {
          console.log(`[trigger] Auto-firing "${trigger.name}" (${eventType}) trigger_id=${trigger.trigger_id}`);
          const result = await signAndPublishTrigger(
            trigger.trigger_id,
            trigger.botPubkeyHex,
            contextMessage,
          );
          if (result.relayResults.ok.length > 0) {
            console.log(`[trigger] Published to ${result.relayResults.ok.length} relay(s)`);
          }
        } catch (err) {
          console.error(`[trigger] Auto-fire failed for "${trigger.name}":`, err.message);
        }
      }
    },

    _fireMentionTriggers(content, context) {
      const mentionRegex = /@\[.*?\]\(mention:person:([^\)]+)\)/g;
      const mentionedNpubs = [];
      let match;
      while ((match = mentionRegex.exec(content)) !== null) {
        mentionedNpubs.push(match[1]);
      }

      for (const trigger of (this.workspaceTriggers || [])) {
        if (!trigger.enabled || !trigger.botPubkeyHex || !trigger.botNpub) continue;

        // bot_tagged: bot was @mentioned anywhere
        if (trigger.triggerType === 'chat_bot_tagged' && mentionedNpubs.includes(trigger.botNpub)) {
          this._checkTriggerRules('chat_bot_tagged', trigger.botPubkeyHex,
            `Bot tagged in ${context}: ${content.slice(0, 200)}`);
        }

        // chat_channel_message: any message in a channel (only for chat context)
        if (trigger.triggerType === 'chat_channel_message' && context.startsWith('chat #')) {
          this._checkTriggerRules('chat_channel_message', trigger.botPubkeyHex,
            `New message in ${context}: ${content.slice(0, 200)}`);
        }
      }
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
      this.showAvatarMenu = false;
      if (this.currentWorkspaceOwnerNpub) {
        await this.selectWorkspace(this.currentWorkspaceOwnerNpub);
      }
    },

    async connectToPreset(presetUrl) {
      this.presetConnecting = true;
      this.superbasedError = null;
      try {
        const healthRes = await fetch(`${presetUrl.replace(/\/+$/, '')}/health`);
        if (!healthRes.ok) throw new Error(`Server returned ${healthRes.status}`);
        const health = await healthRes.json();
        if (health.status !== 'ok' || !health.service_npub) throw new Error('Invalid health response');
        const token = buildSuperBasedConnectionToken({
          directHttpsUrl: presetUrl,
          serviceNpub: health.service_npub,
          appNpub: APP_NPUB,
        });
        this.superbasedTokenInput = token;
        await this.saveConnectionSettings();
        await this.loadRemoteWorkspaces();
        if (this.knownWorkspaces.length === 0 && this.session?.npub) {
          await this.tryRecoverWorkspace();
        }
        if (this.knownWorkspaces.length === 0) {
          this.updateWorkspaceBootstrapPrompt();
        }
      } catch (error) {
        this.superbasedError = `Failed to connect: ${error?.message || error}`;
      } finally {
        this.presetConnecting = false;
      }
    },

    // --- Connect modal (two-step) ---

    openConnectModal() {
      this.showConnectModal = true;
      this.connectStep = 1;
      this.connectHostUrl = '';
      this.connectHostLabel = '';
      this.connectHostServiceNpub = '';
      this.connectHostError = null;
      this.connectHostBusy = false;
      this.connectManualUrl = '';
      this.connectWorkspaces = [];
      this.connectWorkspacesBusy = false;
      this.connectWorkspacesError = null;
      this.connectNewWorkspaceName = '';
      this.connectNewWorkspaceDescription = '';
      this.connectCreatingWorkspace = false;
      this.connectTokenInput = '';
      this.connectShowTokenFallback = false;
      this.showWorkspaceSwitcherMenu = false;
      this.mobileNavOpen = false;
    },

    closeConnectModal() {
      if (this.connectHostBusy || this.connectWorkspacesBusy || this.connectCreatingWorkspace) return;
      this.showConnectModal = false;
    },

    async connectToHost(hostUrl, hostLabel) {
      this.connectHostError = null;
      this.connectHostBusy = true;
      try {
        const cleanUrl = String(hostUrl || '').trim().replace(/\/+$/, '');
        if (!cleanUrl) throw new Error('URL is required');
        const healthRes = await fetch(`${cleanUrl}/health`);
        if (!healthRes.ok) throw new Error(`Server returned ${healthRes.status}`);
        const health = await healthRes.json();
        if (health.status !== 'ok') throw new Error('Server health check failed');
        const serviceNpub = String(health.service_npub || '').trim();
        this.connectHostUrl = cleanUrl;
        this.connectHostLabel = hostLabel || cleanUrl;
        this.connectHostServiceNpub = serviceNpub;
        this.addKnownHost({ url: cleanUrl, label: hostLabel || cleanUrl, serviceNpub });
        this.backendUrl = normalizeBackendUrl(cleanUrl);
        setBaseUrl(this.backendUrl);
        const token = buildSuperBasedConnectionToken({ directHttpsUrl: cleanUrl, serviceNpub, appNpub: APP_NPUB });
        this.superbasedTokenInput = token;
        await this.saveSettings();
        this.connectStep = 2;
        await this.loadConnectWorkspaces();
      } catch (error) {
        this.connectHostError = `Failed to connect: ${error?.message || error}`;
      } finally {
        this.connectHostBusy = false;
      }
    },

    async connectManualHost() {
      await this.connectToHost(this.connectManualUrl, '');
    },

    async connectByo() {
      const input = String(this.connectManualUrl || '').trim();
      if (!input) return;
      // If it looks like a URL, treat as host URL
      if (/^https?:\/\//i.test(input)) {
        return this.connectToHost(input, '');
      }
      // Otherwise try to parse as a connection token
      const parsed = parseSuperBasedToken(input);
      if (parsed.isValid && parsed.directHttpsUrl) {
        this.superbasedTokenInput = input;
        await this.saveConnectionSettings();
        this.showConnectModal = false;
        return;
      }
      this.connectHostError = 'Enter a URL (https://...) or paste a connection token';
    },

    async loadConnectWorkspaces() {
      if (!this.session?.npub) { this.connectWorkspacesError = 'Sign in first'; return; }
      this.connectWorkspacesBusy = true;
      this.connectWorkspacesError = null;
      try {
        const result = await getWorkspaces(this.session.npub);
        this.connectWorkspaces = (result.workspaces || []).map((entry) => ({
          ...entry,
          directHttpsUrl: entry.direct_https_url || entry.directHttpsUrl || this.connectHostUrl,
          serviceNpub: this.connectHostServiceNpub,
          appNpub: APP_NPUB,
        }));
      } catch (error) {
        this.connectWorkspacesError = `Failed to load workspaces: ${error?.message || error}`;
        this.connectWorkspaces = [];
      } finally {
        this.connectWorkspacesBusy = false;
      }
    },

    async connectSelectWorkspace(workspaceEntry) {
      const workspace = normalizeWorkspaceEntry({
        ...workspaceEntry,
        directHttpsUrl: this.connectHostUrl,
        serviceNpub: this.connectHostServiceNpub,
        appNpub: APP_NPUB,
        connectionToken: buildSuperBasedConnectionToken({
          directHttpsUrl: this.connectHostUrl, serviceNpub: this.connectHostServiceNpub,
          workspaceOwnerNpub: workspaceEntry.workspace_owner_npub || workspaceEntry.workspaceOwnerNpub,
          appNpub: APP_NPUB,
        }),
      });
      if (!workspace) return;
      this.mergeKnownWorkspaces([workspace]);
      this.showConnectModal = false;
      await this.selectWorkspace(workspace.workspaceOwnerNpub);
    },

    async connectCreateWorkspace() {
      const memberNpub = this.session?.npub;
      if (!memberNpub) { this.connectWorkspacesError = 'Sign in first'; return; }
      const name = String(this.connectNewWorkspaceName || '').trim();
      if (!name) { this.connectWorkspacesError = 'Workspace name is required'; return; }
      this.connectCreatingWorkspace = true;
      this.connectWorkspacesError = null;
      try {
        const workspaceIdentity = createGroupIdentity();
        const defaultGroupIdentity = createGroupIdentity();
        const privateGroupIdentity = createGroupIdentity();
        const wrappedWorkspaceNsec = await personalEncryptForNpub(memberNpub, workspaceIdentity.nsec);
        const defaultGroupMemberKeys = await buildWrappedMemberKeys(defaultGroupIdentity, [memberNpub], memberNpub);
        const privateGroupMemberKeys = await buildWrappedMemberKeys(privateGroupIdentity, [memberNpub], memberNpub);
        const response = await createWorkspace({
          workspace_owner_npub: workspaceIdentity.npub, name,
          description: String(this.connectNewWorkspaceDescription || '').trim(),
          wrapped_workspace_nsec: wrappedWorkspaceNsec, wrapped_by_npub: memberNpub,
          default_group_npub: defaultGroupIdentity.npub, default_group_name: `${name} Shared`,
          default_group_member_keys: defaultGroupMemberKeys,
          private_group_npub: privateGroupIdentity.npub, private_group_name: 'Private',
          private_group_member_keys: privateGroupMemberKeys,
        });
        const workspace = normalizeWorkspaceEntry({
          ...response, serviceNpub: this.connectHostServiceNpub, appNpub: APP_NPUB,
          connectionToken: buildSuperBasedConnectionToken({
            directHttpsUrl: this.connectHostUrl, serviceNpub: this.connectHostServiceNpub,
            workspaceOwnerNpub: response.workspace_owner_npub, appNpub: APP_NPUB,
          }),
        });
        this.mergeKnownWorkspaces([workspace]);
        this.showConnectModal = false;
        await this.selectWorkspace(workspace.workspaceOwnerNpub);
      } catch (error) {
        this.connectWorkspacesError = error?.message || 'Failed to create workspace';
      } finally {
        this.connectCreatingWorkspace = false;
      }
    },

    async connectWithToken() {
      const token = String(this.connectTokenInput || '').trim();
      if (!token) return;
      this.superbasedTokenInput = token;
      await this.saveConnectionSettings();
      this.showConnectModal = false;
    },

    connectGoBack() {
      this.connectStep = 1;
      this.connectWorkspaces = [];
      this.connectWorkspacesError = null;
      this.connectNewWorkspaceName = '';
      this.connectNewWorkspaceDescription = '';
    },

    addKnownHost({ url, label, serviceNpub }) {
      const cleanUrl = String(url || '').trim().replace(/\/+$/, '');
      if (!cleanUrl) return;
      const existing = this.knownHosts.findIndex((h) => h.url === cleanUrl);
      const entry = { url: cleanUrl, label: String(label || '').trim() || cleanUrl, serviceNpub: String(serviceNpub || '').trim() };
      if (existing >= 0) { this.knownHosts[existing] = entry; } else { this.knownHosts.push(entry); }
    },

    get mergedHostsList() {
      const seen = new Set();
      const merged = [];
      for (const host of [...DEFAULT_KNOWN_HOSTS, ...this.knownHosts]) {
        const cleanUrl = String(host.url || '').trim().replace(/\/+$/, '');
        if (!cleanUrl || seen.has(cleanUrl)) continue;
        seen.add(cleanUrl);
        merged.push({ ...host, url: cleanUrl });
      }
      return merged;
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
      if (this.navSection === 'calendar') return this.FAST_SYNC_MS;
      if (this.navSection === 'schedules') return this.FAST_SYNC_MS;
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
        await this.checkForStaleness();
      } catch (error) {
        flightDeckLog('error', 'sync', 'background sync failed', {
          backendUrl: this.backendUrl || null,
          ownerNpub: this.workspaceOwnerNpub || null,
          error: error?.message || String(error),
        });
      } finally {
        this.backgroundSyncInFlight = false;
        this.scheduleBackgroundSync();
      }
    },

    updateSyncSession(updates) {
      Object.assign(this.syncSession, updates);
    },

    syncProgressLabel() {
      const s = this.syncSession;
      if (s.phase === 'idle' || s.phase === 'done') return '';
      if (s.phase === 'checking') return 'Checking...';
      if (s.phase === 'pushing') return `Pushing ${s.pushed} / ${s.pushTotal}`;
      if (s.phase === 'pulling') {
        const familyPart = s.currentFamily ? `Fetching ${s.currentFamily}` : 'Pulling';
        return `${familyPart} (${s.completedFamilies} / ${s.totalFamilies} collections)`;
      }
      if (s.phase === 'applying') return 'Applying...';
      if (s.phase === 'error') return 'Sync error';
      return '';
    },

    syncProgressPercent() {
      const s = this.syncSession;
      if (s.phase === 'pushing' && s.pushTotal > 0) return Math.round((s.pushed / s.pushTotal) * 50);
      if (s.phase === 'pulling' && s.totalFamilies > 0) return 50 + Math.round((s.completedFamilies / s.totalFamilies) * 45);
      if (s.phase === 'applying' || s.phase === 'done') return 100;
      if (s.phase === 'checking') return 5;
      return 0;
    },

    lastSyncTimeLabel() {
      const t = this.syncSession.lastSuccessAt;
      if (!t) return 'Never';
      const diff = Date.now() - t;
      if (diff < 60000) return 'Just now';
      if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
      return new Date(t).toLocaleTimeString();
    },

    async performSync({ silent = false, showBusy = !silent } = {}) {
      if (!this.session?.npub || !this.backendUrl) {
        if (!silent) this.error = 'Configure settings first';
        return { pushed: 0, pulled: 0 };
      }

      if (!silent) this.error = null;
      if (showBusy) this.syncing = true;
      this.updateSyncSession({ state: 'syncing', phase: 'checking', startedAt: Date.now(), error: null, pushed: 0, pushTotal: 0, pulled: 0, completedFamilies: 0, totalFamilies: 0, currentFamily: null });
      flightDeckLog('info', 'sync', 'sync started', {
        silent,
        showBusy,
        backendUrl: this.backendUrl,
        ownerNpub: this.workspaceOwnerNpub || null,
        viewerNpub: this.session?.npub || null,
      });

      const onProgress = (update) => {
        this.updateSyncSession(update);
      };

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
        const result = await runSync(this.workspaceOwnerNpub, this.session.npub, onProgress);
        this.updateSyncSession({ phase: 'applying' });
        await this.refreshGroups();
        await this.refreshWorkspaceSettings({ overwriteInput: !this.wingmanHarnessDirty });
        await this.ensureTaskFamilyBackfill();
        await this.ensureTaskBoardScopeSetup();
        if (this.docsEditorOpen && this.selectedDocId) {
          await this.loadDocComments(this.selectedDocId);
        }
        this.updateSyncSession({ phase: 'done', finishedAt: Date.now(), lastSuccessAt: Date.now(), state: 'synced' });
        await this.refreshSyncStatus();
        await this.refreshStatusRecentChanges();
        flightDeckLog('info', 'sync', 'sync completed', {
          backendUrl: this.backendUrl,
          ownerNpub: this.workspaceOwnerNpub || null,
          pushed: result?.pushed ?? 0,
          pulled: result?.pulled ?? 0,
          syncStatus: this.syncStatus,
        });
        return result;
      } catch (error) {
        if (!silent) this.error = error.message;
        this.updateSyncSession({ phase: 'error', state: 'error', error: error.message, finishedAt: Date.now() });
        flightDeckLog('error', 'sync', 'sync failed', {
          backendUrl: this.backendUrl,
          ownerNpub: this.workspaceOwnerNpub || null,
          error: error?.message || String(error),
        });
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
      const quarantine = await this.refreshSyncQuarantine();
      if (pending.length > 0) {
        this.syncStatus = 'unsynced';
      } else if (quarantine.length > 0) {
        this.syncStatus = 'quarantined';
      } else if (this.syncSession.state === 'error') {
        this.syncStatus = 'error';
      } else {
        this.syncStatus = 'synced';
      }
      if (pending.length > 0) {
        flightDeckLog('debug', 'sync', 'pending writes remain after sync status refresh', {
          pendingCount: pending.length,
          pending: pending.slice(0, 10).map((row) => ({
            recordId: row.record_id,
            family: row.record_family_hash,
            createdAt: row.created_at,
          })),
        });
      }
    },

    async checkForStaleness() {
      if (!this.workspaceOwnerNpub || this.syncing) return;
      try {
        const result = await checkStaleness(this.workspaceOwnerNpub);
        if (result.stale && this.syncStatus === 'synced') {
          this.syncStatus = 'stale';
          this.updateSyncSession({ state: 'stale' });
        }
      } catch {
        // Staleness check is opportunistic — do not break anything
      }
    },

    async ensureTaskFamilyBackfill() {
      if (this.hasForcedTaskFamilyBackfill) return false;
      if (!this.session?.npub || !this.backendUrl || !this.workspaceOwnerNpub) return false;
      if (this.tasks.length > 0) return false;
      if (this.groups.length === 0) return false;
      if (this.scopes.length === 0 && !this.selectedBoardId) return false;

      this.hasForcedTaskFamilyBackfill = true;
      flightDeckLog('info', 'sync', 'forcing full task-family backfill on empty local task cache', {
        backendUrl: this.backendUrl,
        ownerNpub: this.workspaceOwnerNpub,
        scopesCount: this.scopes.length,
        selectedBoardId: this.selectedBoardId || null,
      });

      await clearSyncStateForFamilies(['task']);
      await this.pullFamiliesFromBackend(['task'], { forceFull: true });
      await this.refreshTasks();

      flightDeckLog('info', 'sync', 'task-family backfill completed', {
        ownerNpub: this.workspaceOwnerNpub,
        taskCount: this.tasks.length,
      });

      return true;
    },

    async restoreFamiliesFromSuperBased(familyIds, options = {}) {
      const dedupedFamilyIds = [...new Set((familyIds || []).filter(Boolean))];
      if (dedupedFamilyIds.length === 0) {
        throw new Error('Select at least one record family.');
      }

      const pending = await getPendingWritesByFamilies(dedupedFamilyIds);
      if (pending.length > 0) {
        const blockingFamilies = [...new Set(
          pending
            .map((row) => getSyncFamily(row.record_family_hash)?.label)
            .filter(Boolean)
        )];
        throw new Error(`Cannot restore while unsynced local changes exist in: ${blockingFamilies.join(', ')}. Sync or resolve them first.`);
      }

      if (options.confirm !== false && typeof window !== 'undefined') {
        const labels = dedupedFamilyIds.map((familyId) => getSyncFamily(familyId)?.label || familyId);
        const confirmed = window.confirm(`Restore ${labels.join(', ')} from SuperBased? This clears local cache for the selected families and rebuilds it from the backend.`);
        if (!confirmed) return { cancelled: true, restored: 0 };
      }

      await clearRuntimeFamilies(dedupedFamilyIds);
      await clearSyncStateForFamilies(dedupedFamilyIds);
      await clearSyncQuarantineForFamilies(dedupedFamilyIds);
      await this.pullFamiliesFromBackend(dedupedFamilyIds, { forceFull: true });
      await this.refreshStateForFamilies(dedupedFamilyIds);
      await this.refreshSyncQuarantine();
      return { cancelled: false, restored: dedupedFamilyIds.length };
    },

    async pullFamiliesFromBackend(familyIds, options = {}) {
      if (!this.session?.npub || !this.backendUrl || !this.workspaceOwnerNpub) {
        throw new Error('Configure settings first');
      }
      const hashes = getSyncFamilyHashes(familyIds);
      if (hashes.length === 0) return { pulled: 0 };
      return pullRecordsForFamilies(this.workspaceOwnerNpub, this.session.npub, hashes, options);
    },

    async refreshStateForFamilies(familyIds = []) {
      const selected = new Set(familyIds);
      if (selected.has('settings')) {
        await this.refreshWorkspaceSettings({ overwriteInput: !this.wingmanHarnessDirty });
      }
      if (selected.has('channel')) await this.refreshChannels();
      if (selected.has('chat_message')) await this.refreshMessages();
      if (selected.has('audio_note')) await this.refreshAudioNotes();
      if (selected.has('directory')) await this.refreshDirectories();
      if (selected.has('document')) await this.refreshDocuments();
      if (selected.has('task')) await this.refreshTasks();
      if (selected.has('schedule')) await this.refreshSchedules();
      if (selected.has('scope')) await this.refreshScopes();
      if (selected.has('task') || selected.has('scope')) await this.ensureTaskBoardScopeSetup();
      if (selected.has('comment') && this.activeTaskId) {
        await this.loadTaskComments(this.activeTaskId);
      }
      if ((selected.has('comment') || selected.has('audio_note')) && this.docsEditorOpen && this.selectedDocId) {
        await this.loadDocComments(this.selectedDocId);
      }
      await this.refreshStatusRecentChanges();
      await this.refreshSyncStatus();
    },

    async restoreSelectedFamiliesFromSuperBased() {
      const familyIds = [...new Set(this.repairSelectedFamilyIds)];
      if (familyIds.length === 0) {
        this.repairError = 'Select at least one record family.';
        return;
      }

      this.repairError = null;
      this.repairNotice = '';

      this.repairBusy = true;
      try {
        const result = await this.restoreFamiliesFromSuperBased(familyIds);
        if (result.cancelled) return;
        this.repairNotice = `Restored ${result.restored} record ${result.restored === 1 ? 'family' : 'families'} from SuperBased.`;
      } catch (error) {
        this.repairError = error?.message || 'Failed to restore selected record families.';
      } finally {
        this.repairBusy = false;
      }
    },

    async dismissSyncQuarantineIssue(entry) {
      this.syncQuarantineError = null;
      this.syncQuarantineNotice = '';
      this.syncQuarantineBusy = true;
      try {
        await deleteSyncQuarantineEntry(entry.family_hash, entry.record_id);
        await this.refreshSyncStatus();
        this.syncQuarantineNotice = `Dismissed quarantine issue for ${this.syncQuarantineRecordLabel(entry)}.`;
      } catch (error) {
        this.syncQuarantineError = error?.message || 'Failed to dismiss quarantine issue.';
      } finally {
        this.syncQuarantineBusy = false;
      }
    },

    async retrySyncQuarantineIssue(entry) {
      const familyId = getSyncFamily(entry?.family_id || entry?.family_hash)?.id;
      if (!familyId) {
        this.syncQuarantineError = 'Unknown sync family for this quarantine issue.';
        return;
      }

      this.syncQuarantineError = null;
      this.syncQuarantineNotice = '';
      this.syncQuarantineBusy = true;
      try {
        const result = await this.restoreFamiliesFromSuperBased([familyId], { confirm: false });
        if (result.cancelled) return;
        this.syncQuarantineNotice = `Rebuilt ${this.syncQuarantineFamilyLabel(entry)} from SuperBased.`;
      } catch (error) {
        this.syncQuarantineError = error?.message || 'Failed to retry quarantined family.';
      } finally {
        this.syncQuarantineBusy = false;
      }
    },

    async deleteLocalQuarantinedRecord(entry) {
      const family = getSyncFamily(entry?.family_id || entry?.family_hash);
      if (!family?.id) {
        this.syncQuarantineError = 'Unknown sync family for this quarantine issue.';
        return;
      }

      if (typeof window !== 'undefined') {
        const confirmed = window.confirm(`Delete local ${this.syncQuarantineFamilyLabel(entry)} record ${this.syncQuarantineRecordLabel(entry)}? This only affects browser state.`);
        if (!confirmed) return;
      }

      this.syncQuarantineError = null;
      this.syncQuarantineNotice = '';
      this.syncQuarantineBusy = true;
      try {
        await deleteRuntimeRecordByFamily(family.id, entry.record_id);
        await deleteSyncQuarantineEntry(entry.family_hash, entry.record_id);
        await this.refreshStateForFamilies([family.id]);
        await this.refreshSyncStatus();
        this.syncQuarantineNotice = `Deleted local ${this.syncQuarantineFamilyLabel(entry)} record ${this.syncQuarantineRecordLabel(entry)}.`;
      } catch (error) {
        this.syncQuarantineError = error?.message || 'Failed to delete local quarantined record.';
      } finally {
        this.syncQuarantineBusy = false;
      }
    },

    // --- channels ---

    async refreshChannels() {
      const ownerNpub = this.workspaceOwnerNpub;
      if (!ownerNpub) return;
      await this.applyChannels(await getChannelsByOwner(ownerNpub));
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
          current_epoch: Number(group.current_epoch || 1),
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
        current_epoch: Number(response.current_epoch || 1),
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
      if (!group?.group_id) throw new Error('Group not found');

      await addGroupMember(group.group_id || groupId, await wrapKnownGroupKeyForMember(group.group_id || group.group_npub, memberNpub, ownerNpub));
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

    async rotateEncryptedGroup(groupId, memberNpubs, options = {}) {
      const wrappedByNpub = this.session?.npub;
      const group = this.groups.find((item) => item.group_id === groupId || item.group_npub === groupId);
      if (!wrappedByNpub) throw new Error('Sign in first');
      if (!group?.group_id) throw new Error('Group not found');

      const nextMembers = [...new Set((memberNpubs || []).map((value) => String(value || '').trim()).filter(Boolean))];
      const groupIdentity = createGroupIdentity();
      const memberKeys = await buildWrappedMemberKeys(groupIdentity, nextMembers, wrappedByNpub);
      const response = await rotateGroup(group.group_id, {
        group_npub: groupIdentity.npub,
        member_keys: memberKeys,
        name: options.name || group.name,
      });

      const updatedGroup = {
        group_id: response.group_id ?? group.group_id,
        group_npub: response.group_npub ?? groupIdentity.npub,
        current_epoch: Number(response.current_epoch || ((group.current_epoch || 1) + 1)),
        owner_npub: response.owner_npub ?? group.owner_npub,
        name: response.name ?? options.name ?? group.name,
        group_kind: response.group_kind || group.group_kind || 'shared',
        private_member_npub: response.private_member_npub ?? group.private_member_npub ?? null,
        member_npubs: (response.members ?? nextMembers).map((member) => member.member_npub ?? member).filter(Boolean),
      };

      await upsertGroup(updatedGroup);
      if (options.refresh !== false) {
        await this.refreshGroups();
      }
      return updatedGroup;
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

    scheduleChatFeedScrollToBottom() {
      if (typeof window === 'undefined' || typeof document === 'undefined') return;
      Alpine.nextTick(() => {
        if (this.chatFeedScrollFrame) window.cancelAnimationFrame(this.chatFeedScrollFrame);
        this.chatFeedScrollFrame = window.requestAnimationFrame(() => {
          this.chatFeedScrollFrame = null;
          const feed = document.querySelector('[data-chat-feed]');
          if (!feed) return;
          feed.scrollTop = feed.scrollHeight;
        });
      });
    },

    scheduleThreadRepliesScrollToBottom() {
      if (typeof window === 'undefined' || typeof document === 'undefined') return;
      Alpine.nextTick(() => {
        if (this.threadRepliesScrollFrame) window.cancelAnimationFrame(this.threadRepliesScrollFrame);
        this.threadRepliesScrollFrame = window.requestAnimationFrame(() => {
          this.threadRepliesScrollFrame = null;
          const replies = document.querySelector('[data-thread-replies]');
          if (!replies) return;
          replies.scrollTop = replies.scrollHeight;
        });
      });
    },

    captureScrollAnchor({ containerSelector, itemSelector, itemAttribute }) {
      if (typeof document === 'undefined') return null;
      const container = document.querySelector(containerSelector);
      if (!container) return null;

      const containerRect = container.getBoundingClientRect();
      const items = [...container.querySelectorAll(itemSelector)];
      const anchorItem = items.find((item) => item.getBoundingClientRect().bottom > containerRect.top + 1) || null;

      return {
        containerSelector,
        itemSelector,
        itemAttribute,
        itemId: anchorItem?.getAttribute(itemAttribute) || '',
        offsetTop: anchorItem ? anchorItem.getBoundingClientRect().top - containerRect.top : 0,
        atBottom: (container.scrollHeight - container.clientHeight - container.scrollTop) <= 8,
      };
    },

    restoreScrollAnchor(anchor) {
      if (!anchor || typeof window === 'undefined' || typeof document === 'undefined') return;
      Alpine.nextTick(() => {
        window.requestAnimationFrame(() => {
          const container = document.querySelector(anchor.containerSelector);
          if (!container) return;

          if (anchor.atBottom) {
            container.scrollTop = container.scrollHeight;
            return;
          }

          if (!anchor.itemId) return;

          const item = [...container.querySelectorAll(anchor.itemSelector)]
            .find((candidate) => candidate.getAttribute(anchor.itemAttribute) === anchor.itemId);
          if (!item) return;

          const containerRect = container.getBoundingClientRect();
          const itemRect = item.getBoundingClientRect();
          container.scrollTop += (itemRect.top - containerRect.top) - anchor.offsetTop;
        });
      });
    },

    autosizeComposer(textarea) {
      if (!textarea || typeof window === 'undefined') return;
      const styles = window.getComputedStyle(textarea);
      const lineHeight = parseFloat(styles.lineHeight) || 20;
      const paddingY = (parseFloat(styles.paddingTop) || 0) + (parseFloat(styles.paddingBottom) || 0);
      const borderY = (parseFloat(styles.borderTopWidth) || 0) + (parseFloat(styles.borderBottomWidth) || 0);
      const maxHeight = (lineHeight * this.COMPOSER_MAX_LINES) + paddingY + borderY;

      textarea.style.height = 'auto';
      const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
      textarea.style.height = `${Math.max(nextHeight, 0)}px`;
      textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
    },

    scheduleComposerAutosize(context) {
      if (typeof window === 'undefined' || typeof document === 'undefined') return;
      Alpine.nextTick(() => {
        const textarea = document.querySelector(`[data-chat-composer="${context}"]`);
        if (!textarea) return;
        this.autosizeComposer(textarea);
      });
    },

    applyAddressBookPeople(people = []) {
      const nextPeople = Array.isArray(people) ? people : [];
      if (sameListBySignature(this.addressBookPeople, nextPeople, (person) => [
        String(person?.npub || ''),
        String(person?.label || ''),
        String(person?.avatar_url || ''),
        String(person?.last_used_at || ''),
      ].join('|'))) {
        return;
      }
      this.addressBookPeople = nextPeople;
    },

    async refreshAddressBook() {
      this.applyAddressBookPeople(await getAddressBookPeople());
    },

    async applyChannels(channels = [], options = {}) {
      const nextChannels = Array.isArray(channels) ? channels : [];
      if (!sameListBySignature(this.channels, nextChannels, (channel) => [
        String(channel?.record_id || ''),
        String(channel?.updated_at || ''),
        String(channel?.version ?? ''),
        String(channel?.record_state || ''),
      ].join('|'))) {
        this.channels = nextChannels;
      }

      for (const channel of nextChannels) {
        await this.rememberPeople(this.getChannelParticipants(channel), 'chat');
      }

      let nextSelectedChannelId = this.selectedChannelId;
      if (nextSelectedChannelId && !nextChannels.some((channel) => channel.record_id === nextSelectedChannelId)) {
        nextSelectedChannelId = nextChannels[0]?.record_id || null;
      }
      if (!nextSelectedChannelId && nextChannels.length > 0) {
        nextSelectedChannelId = nextChannels[0].record_id;
      }

      if (nextSelectedChannelId !== this.selectedChannelId) {
        this.selectedChannelId = nextSelectedChannelId;
        this.expandedChatMessageIds = [];
        this.truncatedChatMessageIds = [];
        this.closeThread({ syncRoute: false });
        this.pendingChatScrollToLatest = Boolean(nextSelectedChannelId);
        this.startSelectedChannelLiveQuery();
        if (options.syncRoute !== false) this.syncRoute(true);
      }

      if (!nextSelectedChannelId) {
        await this.applyMessages([], { scrollToLatest: false });
      }

      this.updatePageTitle();
    },

    async selectChannel(recordId, options = {}) {
      this.selectedChannelId = recordId;
      this.expandedChatMessageIds = [];
      this.truncatedChatMessageIds = [];
      this.closeThread({ syncRoute: false });
      this.pendingChatScrollToLatest = options.scrollToLatest !== false;
      this.startSelectedChannelLiveQuery();
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
        const prepared = await prepareStorageObject(buildStoragePrepareBody({
          ownerNpub: this.workspaceOwnerNpub,
          accessGroupIds: this.getAudioRecorderStorageGroupIds(this.audioRecorderContext),
          contentType: this._audioRecorderBlob.type || 'audio/webm;codecs=opus',
          sizeBytes: encrypted.encryptedBytes.byteLength,
          fileName: `${(this.audioRecorderTitle || this.getAudioRecorderDefaultTitle()).replace(/[^a-zA-Z0-9._-]/g, '_')}.webm`,
        }));
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

    async applyMessages(messages = [], options = {}) {
      const nextMessages = sortMessagesByUpdatedAt(Array.isArray(messages) ? messages : []);
      const messagesChanged = !sameListBySignature(this.messages, nextMessages);
      const chatFeedAnchor = messagesChanged
        ? this.captureScrollAnchor({
          containerSelector: '[data-chat-feed]',
          itemSelector: '[data-message-id]',
          itemAttribute: 'data-message-id',
        })
        : null;
      const threadRepliesAnchor = messagesChanged
        ? this.captureScrollAnchor({
          containerSelector: '[data-thread-replies]',
          itemSelector: '[data-thread-message-id]',
          itemAttribute: 'data-thread-message-id',
        })
        : null;

      if (messagesChanged) {
        this.messages = nextMessages;
      }

      for (const message of nextMessages) {
        await this.rememberPeople([message.sender_npub], 'chat');
      }

      if (
        this.activeThreadId
        && !nextMessages.some((message) => message.record_id === this.activeThreadId || message.parent_message_id === this.activeThreadId)
      ) {
        this.closeThread({ syncRoute: false });
      }

      this.syncChatPreviewState();
      this.scheduleChatPreviewMeasurement();
      this.scheduleStorageImageHydration();

      const shouldScrollChatToLatest = options.scrollToLatest === true || this.pendingChatScrollToLatest || chatFeedAnchor?.atBottom;
      const shouldScrollThreadToLatest = options.scrollThreadToLatest === true || this.pendingThreadScrollToLatest || threadRepliesAnchor?.atBottom;

      if (shouldScrollChatToLatest) this.scheduleChatFeedScrollToBottom();
      else if (chatFeedAnchor) this.restoreScrollAnchor(chatFeedAnchor);

      if (shouldScrollThreadToLatest) this.scheduleThreadRepliesScrollToBottom();
      else if (threadRepliesAnchor) this.restoreScrollAnchor(threadRepliesAnchor);

      this.pendingChatScrollToLatest = false;
      this.pendingThreadScrollToLatest = false;
    },

    async refreshMessages(options = {}) {
      if (!this.selectedChannelId) {
        await this.applyMessages([], { scrollToLatest: false });
        return;
      }
      await this.applyMessages(await getMessagesByChannel(this.selectedChannelId), options);
    },

    async applyAudioNotes(audioNotes = []) {
      const nextAudioNotes = Array.isArray(audioNotes) ? audioNotes : [];
      if (!sameListBySignature(this.audioNotes, nextAudioNotes, (note) => [
        String(note?.record_id || ''),
        String(note?.updated_at || ''),
        String(note?.version ?? ''),
        String(note?.record_state || ''),
        String(note?.transcript_status || ''),
      ].join('|'))) {
        this.audioNotes = nextAudioNotes;
      }

      for (const note of nextAudioNotes) {
        await this.rememberPeople([note.sender_npub], 'audio-note');
      }
    },

    async refreshAudioNotes() {
      const ownerNpub = this.workspaceOwnerNpub;
      if (!ownerNpub) return;
      await this.applyAudioNotes(await getAudioNotesByOwner(ownerNpub));
    },

    patchMessageLocal(nextMessage) {
      const index = this.messages.findIndex((item) => item.record_id === nextMessage.record_id);
      if (index >= 0) {
        this.messages.splice(index, 1, { ...this.messages[index], ...nextMessage });
        this.syncChatPreviewState();
        this.scheduleChatPreviewMeasurement();
        this.scheduleStorageImageHydration();
        return;
      }
      this.messages = sortMessagesByUpdatedAt([...this.messages, nextMessage]);
      this.syncChatPreviewState();
      this.scheduleChatPreviewMeasurement();
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

    openThread(recordId, options = {}) {
      this.activeThreadId = recordId;
      this.threadInput = '';
      this.threadVisibleReplyCount = this.THREAD_REPLY_PAGE_SIZE;
      this.pendingThreadScrollToLatest = options.scrollToLatest !== false;
      if (this.pendingThreadScrollToLatest) this.scheduleThreadRepliesScrollToBottom();
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
      this.threadVisibleReplyCount = this.THREAD_REPLY_PAGE_SIZE;
      this.threadSize = 'default';
      this.pendingThreadScrollToLatest = false;
      if (options.syncRoute !== false) this.syncRoute();
    },

    showMoreThreadMessages() {
      const anchor = this.captureScrollAnchor({
        containerSelector: '[data-thread-replies]',
        itemSelector: '[data-thread-message-id]',
        itemAttribute: 'data-thread-message-id',
      });
      this.threadVisibleReplyCount += this.THREAD_REPLY_PAGE_SIZE;
      this.restoreScrollAnchor(anchor);
    },

    getThreadParentMessage() {
      if (!this.activeThreadId) return null;
      return this.messages.find(msg => msg.record_id === this.activeThreadId) ?? null;
    },

    getThreadReplyCount(recordId) {
      return this.messages.filter(msg => msg.parent_message_id === recordId).length;
    },

    isChatMessageExpanded(recordId) {
      return this.expandedChatMessageIds.includes(recordId);
    },

    isChatMessageTruncated(recordId) {
      return this.truncatedChatMessageIds.includes(recordId);
    },

    toggleChatMessageExpanded(recordId) {
      if (!recordId) return;
      if (this.isChatMessageExpanded(recordId)) {
        this.expandedChatMessageIds = this.expandedChatMessageIds.filter((id) => id !== recordId);
      } else {
        this.expandedChatMessageIds = [...this.expandedChatMessageIds, recordId];
      }
      this.scheduleChatPreviewMeasurement();
    },

    syncChatPreviewState() {
      const validIds = new Set(this.mainFeedMessages.map((message) => message.record_id));
      this.expandedChatMessageIds = this.expandedChatMessageIds.filter((id) => validIds.has(id));
      this.truncatedChatMessageIds = this.truncatedChatMessageIds.filter((id) => validIds.has(id));
    },

    scheduleChatPreviewMeasurement() {
      if (typeof window === 'undefined' || typeof document === 'undefined') return;
      Alpine.nextTick(() => {
        if (this.chatPreviewMeasureFrame) window.cancelAnimationFrame(this.chatPreviewMeasureFrame);
        this.chatPreviewMeasureFrame = window.requestAnimationFrame(() => {
          this.chatPreviewMeasureFrame = null;
          const previews = [...document.querySelectorAll('[data-chat-preview-id]')];
          const nextTruncatedIds = [];

          for (const preview of previews) {
            const recordId = String(preview.dataset.chatPreviewId || '').trim();
            if (!recordId) continue;
            const styles = window.getComputedStyle(preview);
            const lineHeight = parseFloat(styles.lineHeight);
            const maxLines = Number(preview.dataset.chatPreviewMaxLines || this.MESSAGE_PREVIEW_MAX_LINES);
            if (!Number.isFinite(lineHeight) || lineHeight <= 0 || !Number.isFinite(maxLines) || maxLines <= 0) continue;
            if ((preview.scrollHeight - (lineHeight * maxLines)) > 1) nextTruncatedIds.push(recordId);
          }

          this.truncatedChatMessageIds = [...new Set(nextTruncatedIds)];
        });
      });
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
          }).catch(() => {});
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

    getDefaultScopeGroupIds(level = this.newScopeLevel, parentId = this.newScopeParentId || null) {
      return defaultScopeGroupIds({
        level,
        parentId,
        scopesMap: this.scopesMap,
        fallbackGroupId: this.memberPrivateGroupRef || this.scopeAssignableGroups[0]?.groupId || null,
      }).map((groupId) => this.resolveGroupId(groupId));
    },

    syncNewScopePermissionDefaults() {
      this.newScopeAssignedGroupIds = this.getDefaultScopeGroupIds(this.newScopeLevel, this.newScopeParentId || null);
      this.newScopeGroupQuery = '';
    },

    handleNewScopeLevelChange(level) {
      this.newScopeLevel = level;
      if (level === 'product') this.newScopeParentId = null;
      this.syncNewScopePermissionDefaults();
    },

    handleNewScopeParentChange(parentId) {
      this.newScopeParentId = parentId || null;
      this.syncNewScopePermissionDefaults();
    },

    handleNewScopeGroupInput(value) {
      this.newScopeGroupQuery = value;
    },

    addNewScopeGroup(groupId) {
      const nextGroupId = this.resolveGroupId(groupId);
      if (!nextGroupId) return;
      this.newScopeAssignedGroupIds = normalizeGroupIds([
        ...this.newScopeAssignedGroupIds,
        nextGroupId,
      ]);
      this.newScopeGroupQuery = '';
    },

    removeNewScopeGroup(groupId) {
      const targetGroupId = this.resolveGroupId(groupId);
      this.newScopeAssignedGroupIds = this.newScopeAssignedGroupIds.filter((value) => this.resolveGroupId(value) !== targetGroupId);
      this.newScopeGroupQuery = '';
    },

    handleEditingScopeGroupInput(value) {
      this.editingScopeGroupQuery = value;
    },

    addEditingScopeGroup(groupId) {
      const nextGroupId = this.resolveGroupId(groupId);
      if (!nextGroupId) return;
      this.editingScopeAssignedGroupIds = normalizeGroupIds([
        ...this.editingScopeAssignedGroupIds,
        nextGroupId,
      ]);
      this.editingScopeGroupQuery = '';
    },

    removeEditingScopeGroup(groupId) {
      const targetGroupId = this.resolveGroupId(groupId);
      this.editingScopeAssignedGroupIds = this.editingScopeAssignedGroupIds.filter((value) => this.resolveGroupId(value) !== targetGroupId);
      this.editingScopeGroupQuery = '';
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
      const savePromise = this.saveEditingTask();
      this.closeTaskDetail();
      await savePromise;
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
      await this.rememberPeople([this.defaultAgentNpub], 'task-assignee');
      const savePromise = this.saveEditingTask();
      this.closeTaskDetail();
      await savePromise;
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

    // --- scopes ---

    async applyScopes(scopes = []) {
      const normalizedScopes = [];
      for (const scope of (Array.isArray(scopes) ? scopes : [])) {
        const normalized = this.normalizeScopeRowGroupRefs(scope);
        normalizedScopes.push(normalized);
        if (normalized !== scope) {
          await upsertScope(normalized);
        }
      }
      if (!sameListBySignature(this.scopes, normalizedScopes)) {
        this.scopes = normalizedScopes;
      }
    },

    async refreshScopes() {
      const ownerNpub = this.workspaceOwnerNpub;
      if (!ownerNpub) return;
      await this.applyScopes(await getScopesByOwner(ownerNpub));
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

    get scopePickerFlat() {
      const r = this.scopePickerResults;
      return [...(r.product || []), ...(r.project || []), ...(r.deliverable || [])];
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
      Object.assign(this.editingTask, this.buildTaskBoardAssignment(scopeId, this.editingTask));
      this.closeScopePicker();
      await this.saveEditingTask();
    },

    async clearTaskScope() {
      if (!this.editingTask || !this.session?.npub) return;
      Object.assign(this.editingTask, {
        scope_id: null,
        scope_product_id: null,
        scope_project_id: null,
        scope_deliverable_id: null,
      });
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

    findDirectoryByParentAndTitle(parentDirectoryId, title) {
      const needle = String(title || '').trim().toLowerCase();
      return this.directories.find((directory) =>
        directory?.record_state !== 'deleted'
        && (directory.parent_directory_id || null) === (parentDirectoryId || null)
        && String(directory.title || '').trim().toLowerCase() === needle
      ) || null;
    },

    getScopeShareGroupIds(scope) {
      return normalizeGroupIds(scope?.group_ids).map((groupId) => this.resolveGroupId(groupId)).filter(Boolean);
    },

    buildScopeDefaultShares(groupIds = []) {
      return buildScopeShares(
        normalizeGroupIds(groupIds).map((groupId) => this.resolveGroupId(groupId)).filter(Boolean),
        this.groups,
      );
    },

    async queueDirectoryRecord(row, previous = null) {
      await upsertDirectory(row);
      this.patchDirectoryLocal(row);
      const envelope = await outboundDirectory({
        ...row,
        version: row.version ?? 1,
        previous_version: previous?.version ?? 0,
        signature_npub: this.session?.npub,
        write_group_npub: row.group_ids?.[0] || null,
      });
      await addPendingWrite({
        record_id: row.record_id,
        record_family_hash: recordFamilyHash('directory'),
        envelope,
      });
      return row;
    },

    async ensureProductsRootDirectory(scopeGroupIds = []) {
      const ownerNpub = this.workspaceOwnerNpub;
      if (!ownerNpub || !this.session?.npub) return null;

      const desiredShares = this.buildScopeDefaultShares(scopeGroupIds);
      const existing = findActiveRootDirectoryByTitle(this.directories, 'Products');
      if (existing) {
        const mergedShares = this.mergeDocShareLists(this.getStoredDocShares(existing), desiredShares);
        const mergedGroupIds = this.getShareGroupIds(mergedShares);
        const nextParentId = null;
        const hasChanges = JSON.stringify(this.getStoredDocShares(existing)) !== JSON.stringify(mergedShares)
          || JSON.stringify(existing.group_ids || []) !== JSON.stringify(mergedGroupIds)
          || (existing.parent_directory_id || null) !== nextParentId;
        if (!hasChanges) return existing;

        const updated = toRaw({
          ...existing,
          parent_directory_id: nextParentId,
          shares: mergedShares,
          group_ids: mergedGroupIds,
          sync_status: 'pending',
          version: (existing.version ?? 1) + 1,
          updated_at: new Date().toISOString(),
        });
        await this.queueDirectoryRecord(updated, existing);
        return updated;
      }

      const now = new Date().toISOString();
      const shares = desiredShares.length > 0 ? desiredShares : this.getDefaultPrivateShares();
      const created = toRaw({
        record_id: crypto.randomUUID(),
        owner_npub: ownerNpub,
        title: 'Products',
        parent_directory_id: null,
        scope_id: null,
        scope_product_id: null,
        scope_project_id: null,
        scope_deliverable_id: null,
        shares,
        group_ids: this.getShareGroupIds(shares),
        sync_status: 'pending',
        record_state: 'active',
        version: 1,
        updated_at: now,
      });
      await this.queueDirectoryRecord(created, null);
      return created;
    },

    async ensureScopedDirectory(scope, parentDirectoryId, inheritedGroupIds = []) {
      const ownerNpub = this.workspaceOwnerNpub;
      if (!ownerNpub || !scope?.record_id || !this.session?.npub) return null;

      const existing = findActiveDirectoryByScopeId(this.directories, scope.record_id)
        || this.findDirectoryByParentAndTitle(parentDirectoryId, scope.title);
      const folderGroupIds = normalizeGroupIds([
        ...this.getScopeShareGroupIds(scope),
        ...normalizeGroupIds(inheritedGroupIds),
      ]);
      const shares = this.buildScopeDefaultShares(folderGroupIds);
      const tags = buildScopeTags(scope);

      if (existing) {
        const nextShares = shares.length > 0 ? shares : this.getStoredDocShares(existing);
        const nextGroupIds = this.getShareGroupIds(nextShares);
        const hasChanges = existing.title !== scope.title
          || (existing.parent_directory_id || null) !== (parentDirectoryId || null)
          || JSON.stringify(this.getStoredDocShares(existing)) !== JSON.stringify(nextShares)
          || JSON.stringify(existing.group_ids || []) !== JSON.stringify(nextGroupIds)
          || (existing.scope_id || null) !== (tags.scope_id || null)
          || (existing.scope_product_id || null) !== (tags.scope_product_id || null)
          || (existing.scope_project_id || null) !== (tags.scope_project_id || null)
          || (existing.scope_deliverable_id || null) !== (tags.scope_deliverable_id || null);
        if (!hasChanges) return existing;

        const updated = toRaw({
          ...existing,
          title: scope.title,
          parent_directory_id: parentDirectoryId || null,
          ...tags,
          shares: nextShares,
          group_ids: nextGroupIds,
          sync_status: 'pending',
          version: (existing.version ?? 1) + 1,
          updated_at: new Date().toISOString(),
        });
        await this.queueDirectoryRecord(updated, existing);
        return updated;
      }

      const now = new Date().toISOString();
      const created = toRaw({
        record_id: crypto.randomUUID(),
        owner_npub: ownerNpub,
        title: scope.title,
        parent_directory_id: parentDirectoryId || null,
        ...tags,
        shares,
        group_ids: this.getShareGroupIds(shares),
        sync_status: 'pending',
        record_state: 'active',
        version: 1,
        updated_at: now,
      });
      await this.queueDirectoryRecord(created, null);
      return created;
    },

    async ensureScopeDirectoryChain(scope) {
      if (!scope?.record_id) return null;
      const lineage = buildScopeLineage(scope, this.scopesMap);
      if (lineage.length === 0) return null;

      const currentGroupIds = this.getScopeShareGroupIds(scope);
      const root = await this.ensureProductsRootDirectory(currentGroupIds);
      let parentDirectoryId = root?.record_id || null;

      for (const entry of lineage) {
        const directory = await this.ensureScopedDirectory(entry, parentDirectoryId, currentGroupIds);
        parentDirectoryId = directory?.record_id || parentDirectoryId;
      }

      return parentDirectoryId;
    },

    async addScope() {
      const title = String(this.newScopeTitle || '').trim();
      if (!title || !this.session?.npub) return;

      const now = new Date().toISOString();
      const recordId = crypto.randomUUID();
      const ownerNpub = this.workspaceOwnerNpub;
      const level = this.newScopeLevel;
      const parentId = this.newScopeParentId || null;
      const hierarchy = deriveScopeHierarchy({
        level,
        parentId,
        scopesMap: this.scopesMap,
      });
      const groupIds = normalizeGroupIds(this.newScopeAssignedGroupIds)
        .map((groupId) => this.resolveGroupId(groupId))
        .filter(Boolean);
      if (groupIds.length === 0) {
        this.error = 'Add at least one group for the scope.';
        return;
      }

      const localRow = {
        record_id: recordId,
        owner_npub: ownerNpub,
        title,
        description: this.newScopeDescription || '',
        level,
        parent_id: hierarchy.parent_id,
        product_id: hierarchy.product_id,
        project_id: hierarchy.project_id,
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
      this.newScopeAssignedGroupIds = [];
      this.newScopeGroupQuery = '';
      this.showNewScopeForm = false;

      const envelope = await outboundScope({
        ...localRow,
        signature_npub: this.session.npub,
        write_group_npub: localRow.group_ids?.[0] || null,
      });
      await addPendingWrite({
        record_id: recordId,
        record_family_hash: envelope.record_family_hash,
        envelope,
      });
      await this.ensureScopeDirectoryChain(localRow);
      await this.performSync({ silent: false });
      await this.refreshDirectories();
      await this.refreshScopes();
    },

    startNewScope(level = 'product', parentId = null) {
      this.newScopeLevel = level;
      this.newScopeParentId = parentId;
      this.newScopeTitle = '';
      this.newScopeDescription = '';
      this.newScopeAssignedGroupIds = this.getDefaultScopeGroupIds(level, parentId);
      this.newScopeGroupQuery = '';
      this.showNewScopeForm = true;
    },

    cancelNewScope() {
      this.showNewScopeForm = false;
      this.newScopeTitle = '';
      this.newScopeDescription = '';
      this.newScopeAssignedGroupIds = [];
      this.newScopeGroupQuery = '';
    },

    startEditScope(scopeId) {
      const scope = this.scopesMap.get(scopeId);
      if (!scope) return;
      this.editingScopeId = scopeId;
      this.editingScopeTitle = scope.title;
      this.editingScopeDescription = scope.description || '';
      this.editingScopeAssignedGroupIds = this.getScopeShareGroupIds(scope);
      this.editingScopeGroupQuery = '';
    },

    cancelEditScope() {
      this.editingScopeId = null;
      this.editingScopeTitle = '';
      this.editingScopeDescription = '';
      this.editingScopeAssignedGroupIds = [];
      this.editingScopeGroupQuery = '';
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
        group_ids: normalizeGroupIds(this.editingScopeAssignedGroupIds)
          .map((groupId) => this.resolveGroupId(groupId))
          .filter(Boolean),
        version: nextVersion,
        sync_status: 'pending',
        updated_at: new Date().toISOString(),
      });
      if (updated.group_ids.length === 0) {
        this.error = 'Add at least one group for the scope.';
        return;
      }

      await upsertScope(updated);
      this.scopes = this.scopes.map(s => s.record_id === updated.record_id ? updated : s);
      this.editingScopeId = null;
      this.editingScopeTitle = '';
      this.editingScopeDescription = '';
      this.editingScopeAssignedGroupIds = [];
      this.editingScopeGroupQuery = '';

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
      await this.ensureScopeDirectoryChain(updated);
      await this.performSync({ silent: true });
      await this.refreshDirectories();
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
      this.docCommentBackfillAttemptsByDocId = {
        ...this.docCommentBackfillAttemptsByDocId,
        [recordId]: false,
      };
      this.loadDocEditorFromSelection();
      this.loadDocComments(recordId);
      if (options.syncRoute !== false) this.syncRoute();
      this.ensureBackgroundSync(true);
    },

    closeDocEditor(options = {}) {
      this.stopDocCommentsLiveQuery();
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
      this.docCommentBackfillAttemptsByDocId = {};
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
        this.applyDocComments([]);
        return;
      }
      this.startDocCommentsLiveQuery(docId);
      const documentFamilyHash = recordFamilyHash('document');
      let comments = (await getCommentsByTarget(docId))
        .filter((comment) => comment.target_record_family_hash === documentFamilyHash);

      if (
        (comments.length === 0 || await this.hasMissingDocCommentAudio(comments))
        && !this.docCommentBackfillAttemptsByDocId[docId]
      ) {
        this.docCommentBackfillAttemptsByDocId = {
          ...this.docCommentBackfillAttemptsByDocId,
          [docId]: true,
        };
        comments = await this.backfillDocCommentsFromBackend(docId, documentFamilyHash);
      }

      await this.applyDocComments(comments);
    },

    async applyDocComments(comments = [], options = {}) {
      const nextComments = Array.isArray(comments) ? comments : [];
      if (!sameListBySignature(this.docComments, nextComments, (comment) => [
        String(comment?.record_id || ''),
        String(comment?.updated_at || ''),
        String(comment?.version ?? ''),
        String(comment?.record_state || ''),
      ].join('|'))) {
        this.docComments = nextComments;
      }

      for (const comment of nextComments) {
        await this.rememberPeople([comment.sender_npub], 'doc-comment');
      }

      if (
        options.allowBackfill
        && this.selectedDocType === 'document'
        && this.selectedDocId
        && !this.docCommentBackfillAttemptsByDocId[this.selectedDocId]
        && (nextComments.length === 0 || await this.hasMissingDocCommentAudio(nextComments))
      ) {
        this.docCommentBackfillAttemptsByDocId = {
          ...this.docCommentBackfillAttemptsByDocId,
          [this.selectedDocId]: true,
        };
        await this.backfillDocCommentsFromBackend(this.selectedDocId, recordFamilyHash('document'));
      }

      if (this.selectedDocCommentId) {
        const rootId = this.getDocCommentThreadId(this.selectedDocCommentId);
        this.selectedDocCommentId = nextComments.some((comment) => comment.record_id === rootId) ? rootId : null;
      }
      this.scheduleDocCommentConnectorUpdate();
      this.scheduleStorageImageHydration();
    },

    async hasMissingDocCommentAudio(comments = []) {
      for (const comment of comments) {
        for (const attachment of comment.attachments || []) {
          if (attachment?.kind !== 'audio' || !attachment?.audio_note_record_id) continue;
          const note = await getAudioNoteById(attachment.audio_note_record_id);
          if (!note || note.record_state === 'deleted') return true;
        }
      }
      return false;
    },

    async backfillDocCommentsFromBackend(docId, documentFamilyHash) {
      if (!this.backendUrl || !this.workspaceOwnerNpub || !this.session?.npub) return [];

      try {
        await this.pullFamiliesFromBackend(['comment', 'audio_note'], { forceFull: true });
        return (await getCommentsByTarget(docId))
          .filter((comment) => comment.target_record_family_hash === documentFamilyHash);
      } catch (error) {
        console.debug('Doc comment backfill failed:', error?.message || error);
        return [];
      }
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
      return this.docComments
        .filter((comment) => commentBelongsToDocBlock(comment, block))
        .sort((a, b) => String(a.updated_at || '').localeCompare(String(b.updated_at || '')));
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
      this._fireMentionTriggers(body, `doc comment on "${doc.title}"`);
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
      this._fireMentionTriggers(body, `doc comment reply on "${doc.title}"`);
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
      const knownGroup = this.groups.find((group) => group.group_id === groupNpub || group.group_npub === groupNpub);
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
        return existing.group_id || existing.group_npub;
      }

      const group = await this.createEncryptedGroup(
        `Direct: ${this.getSenderName(personNpub)}`,
        [personNpub],
      );
      await this.rememberPeople([personNpub], 'share');
      return group.group_id;
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
        scope_id: null,
        scope_product_id: null,
        scope_project_id: null,
        scope_deliverable_id: null,
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
          scope_id: row.scope_id ?? null,
          scope_product_id: row.scope_product_id ?? null,
          scope_project_id: row.scope_project_id ?? null,
          scope_deliverable_id: row.scope_deliverable_id ?? null,
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

        // Fire triggers for newly added @mentions in doc body
        const oldContent = item.content || '';
        const newContent = updated.content || '';
        if (newContent !== oldContent) {
          const oldMentions = new Set((oldContent.match(/@\[.*?\]\(mention:person:[^\)]+\)/g) || []));
          const newMentions = (newContent.match(/@\[.*?\]\(mention:person:[^\)]+\)/g) || []);
          const freshMentions = newMentions.filter((m) => !oldMentions.has(m));
          if (freshMentions.length > 0) {
            this._fireMentionTriggers(freshMentions.join(' '), `doc "${updated.title}"`);
          }
        }

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

    exportDocMarkdown() {
      const doc = this.selectedDocument;
      if (!doc) return;
      const title = this.docEditorTitle || doc.title || 'document';
      const content = this.docEditorContent || doc.content || '';
      const fullMd = `# ${title}\n\n${content}`;
      const blob = new Blob([fullMd], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${title.replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'document'}.md`;
      a.click();
      URL.revokeObjectURL(url);
    },

    exportDocPDF() {
      const doc = this.selectedDocument;
      if (!doc) return;
      const title = this.docEditorTitle || doc.title || 'document';
      const content = this.docEditorContent || doc.content || '';
      const rendered = this.renderMarkdown(content);
      const printWindow = window.open('about:blank', '_blank');
      if (!printWindow) {
        this.error = 'Popup blocked — please allow popups for this site and try again.';
        return;
      }
      printWindow.document.write(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; color: #222; line-height: 1.6; }
  h1 { font-size: 1.8rem; border-bottom: 1px solid #ddd; padding-bottom: 0.5rem; }
  h2 { font-size: 1.4rem; margin-top: 1.5rem; }
  h3 { font-size: 1.2rem; margin-top: 1.2rem; }
  pre { background: #f5f5f5; padding: 1rem; border-radius: 6px; overflow-x: auto; }
  code { background: #f0f0f0; padding: 0.15rem 0.3rem; border-radius: 3px; font-size: 0.9em; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th, td { border: 1px solid #ddd; padding: 0.5rem; text-align: left; }
  th { background: #f5f5f5; }
  blockquote { border-left: 3px solid #ddd; margin-left: 0; padding-left: 1rem; color: #555; }
  img { max-width: 100%; }
  @media print { body { margin: 0; } }
</style>
</head><body><h1>${title}</h1>${rendered}</body></html>`);
      printWindow.document.close();
      printWindow.onafterprint = () => printWindow.close();
      setTimeout(() => printWindow.print(), 300);
    },

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

    scheduleStorageImageHydration() {
      if (this._storageImageHydrateScheduled || typeof window === 'undefined') return;
      this._storageImageHydrateScheduled = true;
      window.requestAnimationFrame(() => {
        this._storageImageHydrateScheduled = false;
        this.hydrateStorageImages();
        this.scheduleChatPreviewMeasurement();
      });
    },

    revokeStorageImageObjectUrls() {
      for (const url of Object.values(this.storageImageUrlCache || {})) {
        if (typeof url === 'string' && url.startsWith('blob:')) URL.revokeObjectURL(url);
      }
      this.storageImageUrlCache = {};
      this.storageImageLoadPromises = {};
    },

    rememberStorageImageUrl(cacheKey, url) {
      const previous = this.storageImageUrlCache?.[cacheKey];
      if (previous && previous !== url && previous.startsWith('blob:')) {
        URL.revokeObjectURL(previous);
      }
      this.storageImageUrlCache = {
        ...(this.storageImageUrlCache || {}),
        [cacheKey]: url,
      };
      return url;
    },

    async resolveStorageImageUrl(objectId, options = {}) {
      const backendUrl = String(options?.backendUrl || '').trim();
      const cacheKey = storageImageCacheKey(objectId, backendUrl);
      const existing = this.storageImageUrlCache?.[cacheKey];
      if (existing) return existing;

      const pending = this.storageImageLoadPromises?.[cacheKey];
      if (pending) return pending;

      const loadPromise = (async () => {
        let cached = await getCachedStorageImage(cacheKey);
        if (!cached && cacheKey !== objectId) {
          cached = await getCachedStorageImage(objectId);
          if (cached?.blob instanceof Blob && cached.blob.size > 0) {
            await cacheStorageImage({
              object_id: cacheKey,
              blob: cached.blob,
              content_type: cached.content_type || 'application/octet-stream',
            });
          }
        }
        if (cached?.blob instanceof Blob && cached.blob.size > 0) {
          return this.rememberStorageImageUrl(cacheKey, URL.createObjectURL(cached.blob));
        }

        const blob = await downloadStorageObjectBlob(objectId, { backendUrl });
        if (!(blob instanceof Blob) || blob.size === 0) {
          throw new Error(`No image data returned for ${objectId}`);
        }
        await cacheStorageImage({
          object_id: cacheKey,
          blob,
          content_type: blob.type || 'application/octet-stream',
        });
        return this.rememberStorageImageUrl(cacheKey, URL.createObjectURL(blob));
      })();

      this.storageImageLoadPromises = {
        ...(this.storageImageLoadPromises || {}),
        [cacheKey]: loadPromise,
      };

      try {
        return await loadPromise;
      } finally {
        const next = { ...(this.storageImageLoadPromises || {}) };
        delete next[cacheKey];
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
            const chatFeedAnchor = this.captureScrollAnchor({
              containerSelector: '[data-chat-feed]',
              itemSelector: '[data-message-id]',
              itemAttribute: 'data-message-id',
            });
            const threadRepliesAnchor = this.captureScrollAnchor({
              containerSelector: '[data-thread-replies]',
              itemSelector: '[data-thread-message-id]',
              itemAttribute: 'data-thread-message-id',
            });
            image.src = url;
            image.dataset.storageResolved = 'true';
            image.classList.remove('md-storage-image-pending');
            this.scheduleChatPreviewMeasurement();
            this.restoreScrollAnchor(chatFeedAnchor);
            this.restoreScrollAnchor(threadRepliesAnchor);
          })
          .catch(() => {
            const chatFeedAnchor = this.captureScrollAnchor({
              containerSelector: '[data-chat-feed]',
              itemSelector: '[data-message-id]',
              itemAttribute: 'data-message-id',
            });
            const threadRepliesAnchor = this.captureScrollAnchor({
              containerSelector: '[data-thread-replies]',
              itemSelector: '[data-thread-message-id]',
              itemAttribute: 'data-thread-message-id',
            });
            image.dataset.storageResolved = 'error';
            image.classList.add('md-storage-image-error');
            this.scheduleChatPreviewMeasurement();
            this.restoreScrollAnchor(chatFeedAnchor);
            this.restoreScrollAnchor(threadRepliesAnchor);
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
        await this.rememberPeople([ownerNpub, targetNpub], 'chat');

        const channelId = crypto.randomUUID();
        const now = new Date().toISOString();
        const channelRow = {
          record_id: channelId,
          owner_npub: ownerNpub,
          title: name,
          group_ids: [groupId],
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
          group_ids: [groupId],
          participant_npubs: [memberNpub, targetNpub],
          record_state: 'active',
          signature_npub: this.session?.npub,
          write_group_npub: groupId,
        });

        await addPendingWrite({
          record_id: channelId,
          record_family_hash: recordFamilyHash('channel'),
          envelope,
        });

        await this.performSync({ silent: false });
        await this.selectChannel(channelId, { syncRoute: false });
        this.closeNewChannelModal();
      } catch (e) {
        this.error = e.message;
      }
    },

    async createNamedChannel() {
      const ownerNpub = this.workspaceOwnerNpub;
      const title = this.newChannelName.trim();
      const groupId = this.newChannelGroupId;
      if (!ownerNpub || !title || !groupId) return;

      try {
        const group = this.groups.find(g => (g.group_id || g.group_npub) === groupId || g.group_npub === groupId);
        const participants = group?.member_npubs ?? [ownerNpub];

        const channelId = crypto.randomUUID();
        const now = new Date().toISOString();
        const channelRow = {
          record_id: channelId,
          owner_npub: ownerNpub,
          title,
          group_ids: [groupId],
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
          group_ids: [groupId],
          participant_npubs: [...new Set(participants)],
          record_state: 'active',
          signature_npub: this.session?.npub,
          write_group_npub: groupId,
        });

        await addPendingWrite({
          record_id: channelId,
          record_family_hash: recordFamilyHash('channel'),
          envelope,
        });

        await this.performSync({ silent: false });
        await this.selectChannel(channelId, { syncRoute: false });
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
        if (membersToRemove.length > 0) {
          await this.rotateEncryptedGroup(group.group_id, desiredMembers, {
            name: trimmedName,
            refresh: false,
          });
        } else {
          if (trimmedName !== group.name) {
            await this.updateSharingGroupName(group.group_id, trimmedName, { refresh: false });
          }
          for (const memberNpub of membersToAdd) {
            await this.addEncryptedGroupMember(group.group_id, memberNpub, { refresh: false });
          }
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
        await this.rememberPeople([memberNpub, this.botNpub], 'chat');

        const channelId = crypto.randomUUID();
        const channelRow = {
          record_id: channelId,
          owner_npub: ownerNpub,
          title: name,
          group_ids: [groupId],
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
          group_ids: [groupId],
          participant_npubs: [memberNpub, this.botNpub],
          record_state: 'active',
          signature_npub: this.session?.npub,
          write_group_npub: groupId,
        });

        await addPendingWrite({
          record_id: channelId,
          record_family_hash: recordFamilyHash('channel'),
          envelope,
        });

        await this.performSync({ silent: false });
        await this.selectChannel(channelId, { syncRoute: false });
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
        await this.refreshMessages({ scrollToLatest: true });

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
        await this.refreshMessages({ scrollToLatest: true });
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
      this.scheduleChatFeedScrollToBottom();
      this.messageInput = '';
      this.messageAudioDrafts = [];
      this.scheduleComposerAutosize('message');

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

      this._fireMentionTriggers(body, `chat #${channel.label || channel.record_id}`);

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
      this.scheduleThreadRepliesScrollToBottom();
      this.threadInput = '';
      this.threadAudioDrafts = [];
      this.scheduleComposerAutosize('thread');

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

      this._fireMentionTriggers(body, `chat #${channel.label || channel.record_id}`);

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
