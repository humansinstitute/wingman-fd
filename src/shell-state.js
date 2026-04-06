/**
 * Shell state module — owns app-level state that is not section-domain-specific.
 *
 * This is the first runtime boundary extraction from the monolithic Alpine store.
 * The state and methods defined here are spread into the assembled store via
 * applyMixins in src/app.js, so $store.chat.* template bindings continue to work.
 *
 * Ownership boundary:
 * - Shell owns: identity, session, workspace context, route, navigation, sync status,
 *   global error, login flow, connect modal, extension signer, build version, constants.
 * - Shell does NOT own: section data arrays, section selection state, domain mixin methods,
 *   editor buffers, section-specific modals.
 *
 * See docs/design/store-template-decomposition.md for the full decomposition plan.
 */

import { getRunningBuildId } from './version-check.js';
import { getActiveWorkspaceKeyNpub } from './crypto/workspace-keys.js';
import { parseRouteLocation } from './route-helpers.js';
import {
  normalizeBackendUrl,
} from './utils/state-helpers.js';
import { getShortNpub, getInitials } from './utils/naming.js';
import {
  getSettings,
  migrateFromLegacyDb,
  hasWorkspaceDb,
  clearRuntimeData,
} from './db.js';
import { setBaseUrl } from './api.js';
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
  setActiveSessionNpub,
  clearCryptoContext,
} from './crypto/group-keys.js';
import { buildFlightDeckDocumentTitle } from './page-title.js';
import { mergeWorkspaceEntries, workspaceFromToken, findWorkspaceByKey, findWorkspaceBySlug } from './workspaces.js';
import { guessDefaultBackendUrl } from './workspace-manager.js';
import { parseSuperBasedToken } from './superbased-token.js';
import { extractInviteToken } from './invite-link.js';

/**
 * Canonical list of shell state keys (data properties and getters).
 * This list is the authoritative boundary — used by tests to verify
 * no domain keys leak in and no shell keys are omitted.
 */
export const SHELL_STATE_KEYS = Object.freeze([
  // Constants
  'FAST_SYNC_MS',
  'IDLE_SYNC_MS',
  'SSE_HEARTBEAT_CADENCE_MS',
  'BACKGROUND_GROUP_REFRESH_MS',

  // Identity and session
  'appBuildId',
  'backendUrl',
  'ownerNpub',
  'botNpub',
  'session',
  'signingNpub',       // getter
  'isLoggedIn',        // getter
  'settingsTab',
  'extensionSignerAvailable',
  'extensionSignerPollTimer',
  'isLoggingIn',
  'loginError',
  'error',

  // Navigation
  'navSection',
  'navCollapsed',
  'mobileNavOpen',
  'routeSyncPaused',
  'popstateHandler',

  // Sync status indicators
  'syncStatus',
  'syncSession',
  'syncFamilyProgress',
  'sseStatus',
  'catchUpSyncActive',

  // Sync internals (owned by shell, consumed by sync mixin)
  'hasForcedInitialBackfill',
  'hasForcedTaskFamilyBackfill',
  'backgroundSyncTimer',
  'backgroundSyncInFlight',
  'syncBackoffMs',
  'hasBootstrappedUnreadTracking',
  'visibilityHandler',
  'lastGroupsRefreshAt',

  // Shell UI
  'showAvatarMenu',
  'showSyncProgressModal',
  'showWorkspaceSwitcherMenu',
  'presetConnecting',

  // Connect modal (two-step)
  'showConnectModal',
  'connectStep',
  'connectHostUrl',
  'connectHostLabel',
  'connectHostServiceNpub',
  'connectHostError',
  'connectHostBusy',
  'connectManualUrl',
  'connectWorkspaces',
  'connectWorkspacesBusy',
  'connectWorkspacesError',
  'connectNewWorkspaceName',
  'connectNewWorkspaceDescription',
  'connectCreatingWorkspace',
  'connectTokenInput',
  'connectShowTokenFallback',
  'knownHosts',
  'showAgentConnectModal',

  // Workspace bootstrap
  'showWorkspaceBootstrapModal',
  'newWorkspaceName',
  'newWorkspaceDescription',
  'workspaceBootstrapSubmitting',
  'agentConnectJson',
  'agentConfigCopied',
  'pendingInviteToken',

  // Workspace identity (read/write by shell, read by domain)
  'superbasedTokenInput',
  'superbasedError',
  'knownWorkspaces',
  'workspaceProfileRowsByKey',
  'selectedWorkspaceKey',
  'currentWorkspaceOwnerNpub',
  'workspaceSwitchPendingKey',
  'workspaceSwitchPendingNpub',
  'removingWorkspace',
  'workspaceSettingsRecordId',
  'workspaceSettingsVersion',
  'workspaceSettingsGroupIds',
  'workspaceHarnessUrl',
  'workspaceProfileNameInput',
  'workspaceProfileSlugInput',
  'workspaceProfileDescriptionInput',
  'workspaceProfileAvatarInput',
  'workspaceProfileAvatarPreviewUrl',
  'workspaceProfilePendingAvatarFile',
  'workspaceProfilePendingAvatarObjectUrl',
  'workspaceProfileDirty',
  'workspaceProfileSaving',
  'workspaceProfileError',
  'defaultAgentNpub',
  'defaultAgentQuery',
  'useCvmSync',

  // Harness
  'wingmanHarnessInput',
  'wingmanHarnessError',
  'wingmanHarnessDirty',
]);

/**
 * Canonical list of shell methods (lifecycle, route, auth, nav).
 * These are functions defined directly on the shell state object.
 */
export const SHELL_METHOD_NAMES = Object.freeze([
  'init',
  'bootstrapSelectedWorkspace',
  'initRouteSync',
  'getRoutePath',
  'buildRouteUrl',
  'syncRoute',
  'applyRouteFromLocation',
  'updatePageTitle',
  'navigateTo',
  'togglePrimaryNav',
  'clearInactiveSectionData',
  'startExtensionSignerWatch',
  'stopExtensionSignerWatch',
  'refreshExtensionSignerAvailability',
  'maybeAutoLogin',
  'login',
  'logout',
  'hasExtensionSigner',
  'openHarnessLink',
]);

/**
 * Create the shell state object with all shell-owned state, getters, and methods.
 *
 * @param {object} options
 * @param {string} [options.initialSection='status'] - Initial nav section
 * @returns {object} Shell state suitable for spreading into the assembled Alpine store
 */
export function createShellState(options = {}) {
  const initialSection = options.initialSection || 'status';

  return {
    // ── Constants ──────────────────────────────────────────────
    FAST_SYNC_MS: 15000,
    IDLE_SYNC_MS: 30000,
    SSE_HEARTBEAT_CADENCE_MS: 120000,
    BACKGROUND_GROUP_REFRESH_MS: 5 * 60 * 1000,

    // ── Identity and session ──────────────────────────────────
    appBuildId: getRunningBuildId(),
    backendUrl: '',
    ownerNpub: '',
    botNpub: '',
    session: null,
    get signingNpub() {
      return getActiveWorkspaceKeyNpub() || this.session?.npub || null;
    },
    get isLoggedIn() {
      return Boolean(this.session?.npub);
    },
    settingsTab: 'connection',
    extensionSignerAvailable: false,
    extensionSignerPollTimer: null,
    isLoggingIn: false,
    loginError: null,
    error: null,

    // ── Navigation ────────────────────────────────────────────
    navSection: initialSection,
    navCollapsed: false,
    mobileNavOpen: false,
    routeSyncPaused: false,
    popstateHandler: null,

    // ── Sync status indicators ────────────────────────────────
    syncStatus: 'synced',
    syncSession: {
      state: 'synced',
      phase: 'idle',
      startedAt: null,
      finishedAt: null,
      lastSuccessAt: null,
      manual: false,
      currentFamily: null,
      currentFamilyHash: null,
      completedFamilies: 0,
      totalFamilies: 0,
      pushed: 0,
      pushTotal: 0,
      pulled: 0,
      heartbeat: false,
      error: null,
    },
    syncFamilyProgress: [],
    sseStatus: 'disconnected',
    catchUpSyncActive: false,

    // ── Sync internals ────────────────────────────────────────
    hasForcedInitialBackfill: false,
    hasForcedTaskFamilyBackfill: false,
    backgroundSyncTimer: null,
    backgroundSyncInFlight: false,
    syncBackoffMs: 0,
    hasBootstrappedUnreadTracking: false,
    visibilityHandler: null,
    lastGroupsRefreshAt: 0,

    // ── Shell UI ──────────────────────────────────────────────
    showAvatarMenu: false,
    showSyncProgressModal: false,
    showWorkspaceSwitcherMenu: false,
    presetConnecting: false,

    // ── Connect modal (two-step) ──────────────────────────────
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

    // ── Workspace bootstrap ───────────────────────────────────
    showWorkspaceBootstrapModal: false,
    newWorkspaceName: '',
    newWorkspaceDescription: '',
    workspaceBootstrapSubmitting: false,
    agentConnectJson: '',
    agentConfigCopied: false,
    pendingInviteToken: null,

    // ── Workspace identity ────────────────────────────────────
    superbasedTokenInput: '',
    superbasedError: null,
    knownWorkspaces: [],
    workspaceProfileRowsByKey: {},
    selectedWorkspaceKey: '',
    currentWorkspaceOwnerNpub: '',
    workspaceSwitchPendingKey: '',
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
    useCvmSync: typeof localStorage !== 'undefined' ? localStorage.getItem('use_cvm_sync') === 'true' : false,

    // ── Harness ───────────────────────────────────────────────
    wingmanHarnessInput: '',
    wingmanHarnessError: null,
    wingmanHarnessDirty: false,

    // ── Lifecycle methods ─────────────────────────────────────

    async init() {
      this.startExtensionSignerWatch();
      this.initRouteSync();
      this.routeSyncPaused = true;
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
        this.selectedWorkspaceKey = settings.currentWorkspaceKey ?? '';
        this.currentWorkspaceOwnerNpub = settings.currentWorkspaceOwnerNpub ?? '';
        this.knownWorkspaces = mergeWorkspaceEntries([], settings.knownWorkspaces ?? []);
        this.knownHosts = Array.isArray(settings.knownHosts) ? settings.knownHosts : [];
      }
      if (typeof window !== 'undefined') {
        const invite = extractInviteToken(window.location.href);
        if (invite) {
          this.pendingInviteToken = invite;
          this.superbasedTokenInput = invite.token;
          this.backendUrl = invite.backendUrl;
          this.mergeKnownWorkspaces([invite.workspace]);
          if (invite.workspaceOwnerNpub) {
            this.selectedWorkspaceKey = invite.workspace.workspaceKey || '';
            this.currentWorkspaceOwnerNpub = invite.workspaceOwnerNpub;
            this.ownerNpub = invite.workspaceOwnerNpub;
          }
          window.history.replaceState(null, '', invite.cleanUrl);
        }
      }
      if (!this.pendingInviteToken && this.superbasedTokenInput) {
        const config = parseSuperBasedToken(this.superbasedTokenInput);
        if (config.isValid && config.directHttpsUrl) {
          this.backendUrl = normalizeBackendUrl(config.directHttpsUrl);
          const tokenWorkspace = workspaceFromToken(this.superbasedTokenInput);
          if (tokenWorkspace) {
            this.mergeKnownWorkspaces([tokenWorkspace]);
            this.selectedWorkspaceKey = this.selectedWorkspaceKey || tokenWorkspace.workspaceKey || '';
          }
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
      if (!this.selectedWorkspaceKey && this.currentWorkspaceOwnerNpub) {
        const legacyMatch = this.knownWorkspaces.find((workspace) => workspace.workspaceOwnerNpub === this.currentWorkspaceOwnerNpub) || null;
        if (legacyMatch) this.selectedWorkspaceKey = legacyMatch.workspaceKey || '';
      }
      if (!this.selectedWorkspaceKey && this.knownWorkspaces.length > 0) {
        this.selectedWorkspaceKey = this.knownWorkspaces[0].workspaceKey || '';
        this.currentWorkspaceOwnerNpub = this.knownWorkspaces[0].workspaceOwnerNpub;
      }
      if (this.selectedWorkspaceKey || this.currentWorkspaceOwnerNpub) {
        await this.selectWorkspace(this.selectedWorkspaceKey || this.currentWorkspaceOwnerNpub, { refresh: false });
      }
      this.updateWorkspaceBootstrapPrompt();
      if (this.session?.npub && (!this.backendUrl || !this.selectedWorkspaceKey)) {
        this.openConnectModal();
      }
      if (this.selectedWorkspaceKey) {
        await this.bootstrapSelectedWorkspace({ runAccessPrune: true });
      }
      this.pendingInviteToken = null;
      this.routeSyncPaused = false;
    },

    async bootstrapSelectedWorkspace(options = {}) {
      if (!this.selectedWorkspaceKey && !this.currentWorkspaceOwnerNpub) return;
      await this.refreshGroups();
      this.refreshFlows().catch(() => {});
      this.refreshWorkspaceKeyMappings().catch(() => {});
      if (options.runAccessPrune === true) {
        this.runAccessPruneOnLogin().catch(() => {});
      }
      this.selectedBoardId = this.readStoredTaskBoardId();
      this.collapsedSections = this.readStoredCollapsedSections();
      this.validateSelectedBoardId();
      await this.applyRouteFromLocation();
      await this.refreshSyncStatus();
      if (this.navSection === 'status') {
        await this.refreshStatusRecentChanges({ force: true });
      }
      if (this.navSection === 'chat' && this.selectedChannelId) {
        this.scheduleChatFeedScrollToBottom();
      }
      if (this.defaultAgentNpub) this.resolveChatProfile(this.defaultAgentNpub);
    },

    // ── Route lifecycle ───────────────────────────────────────

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

    getRoutePath(section = this.navSection) {
      const slug = this.currentWorkspaceSlug;
      const page = (() => {
        switch (section) {
          case 'status': return 'flight-deck';
          case 'tasks': return 'tasks';
          case 'calendar': return 'calendar';
          case 'schedules': return 'schedules';
          case 'chat': return 'chat';
          case 'docs': return 'docs';
          case 'reports': return 'reports';
          case 'people': return 'people';
          case 'scopes': return 'scopes';
          case 'settings': return 'settings';
          default: return 'flight-deck';
        }
      })();
      return `/${slug}/${page}`;
    },

    buildRouteUrl() {
      if (typeof window === 'undefined') return '';
      const url = new URL(window.location.href);
      url.pathname = this.getRoutePath();
      url.search = '';
      if (this.currentWorkspaceKey) url.searchParams.set('workspacekey', this.currentWorkspaceKey);
      if (this.selectedBoardId) url.searchParams.set('scopeid', this.selectedBoardId);

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
      } else if (this.navSection === 'reports') {
        if (this.selectedReport?.record_id) url.searchParams.set('reportid', this.selectedReport.record_id);
      } else if (this.navSection === 'tasks' || this.navSection === 'calendar') {
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
        if (route.params.workspacekey) {
          const targetByKey = findWorkspaceByKey(this.knownWorkspaces, route.params.workspacekey);
          if (targetByKey && targetByKey.workspaceKey !== this.currentWorkspaceKey) {
            this.routeSyncPaused = false;
            await this.handleWorkspaceSwitcherSelect(targetByKey.workspaceKey);
            return;
          }
        }
        if (route.workspaceSlug) {
          const target = findWorkspaceBySlug(this.knownWorkspaces, route.workspaceSlug);
          if (target && target.workspaceKey !== this.currentWorkspaceKey) {
            this.routeSyncPaused = false;
            await this.handleWorkspaceSwitcherSelect(target.workspaceKey || target.workspaceOwnerNpub);
            return;
          }
        }

        this.navSection = route.section;
        this.mobileNavOpen = false;

        if (route.params.scopeid || route.params.groupid) {
          this.selectedBoardId = route.params.scopeid
            || route.params.groupid
            || this.readStoredTaskBoardId()
            || this.preferredTaskBoardId;
          this.validateSelectedBoardId();
          this.persistSelectedBoardId(this.selectedBoardId);
        }

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
        } else if (route.section === 'reports') {
          this.selectedReportId = route.params.reportid || this.selectedReport?.record_id || null;
        } else if (route.section === 'tasks' || route.section === 'calendar') {
          if (!route.params.scopeid && !route.params.groupid) {
            this.selectedBoardId = this.readStoredTaskBoardId() || this.preferredTaskBoardId;
            this.validateSelectedBoardId();
            this.persistSelectedBoardId(this.selectedBoardId);
          }
          this.showBoardDescendantTasks = route.params.descendants === '1';
          if (route.params.view === 'list') this.taskViewMode = 'list';
          else this.taskViewMode = 'kanban';
          this.normalizeTaskFilterTags();
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
      this.startWorkspaceLiveQueries();
      this.syncRoute(true);
    },

    // ── Navigation ────────────────────────────────────────────

    navigateTo(section, options = {}) {
      this.clearInactiveSectionData(section);
      this.navSection = section;
      this.mobileNavOpen = false;
      this.showWorkspaceSwitcherMenu = false;
      if (section === 'chat' || section === 'docs') {
        this.markSectionRead(section);
      }
      if (section === 'tasks' || section === 'calendar' || section === 'reports') {
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
        this.refreshStatusRecentChanges({ force: true });
      }
      if (section === 'reports' && !this.selectedReportId) {
        this.selectedReportId = this.selectedReport?.record_id || null;
      }
      if (options.syncRoute !== false) this.syncRoute();
      this.startWorkspaceLiveQueries();
      this.ensureBackgroundSync(true);
    },

    togglePrimaryNav() {
      if (typeof window !== 'undefined' && window.innerWidth <= 768) {
        this.mobileNavOpen = !this.mobileNavOpen;
        return;
      }
      this.navCollapsed = !this.navCollapsed;
    },

    clearInactiveSectionData(activeSection) {
      if (activeSection !== 'chat') {
        this.messages = [];
        this.audioNotes = [];
      }
      if (activeSection !== 'tasks' && activeSection !== 'calendar') {
        this.tasks = [];
        this.taskComments = [];
        this.showTaskDetail = false;
        this.editingTask = null;
      }
      if (activeSection !== 'docs') {
        this.documents = [];
        this.directories = [];
        this.docComments = [];
      }
      if (activeSection !== 'reports' && activeSection !== 'status') {
        this.reports = [];
      }
      if (activeSection !== 'schedules' && activeSection !== 'calendar') {
        this.schedules = [];
      }
      if (activeSection !== 'status') {
        this.statusRecentChanges = [];
      }
    },

    // ── Extension signer ──────────────────────────────────────

    startExtensionSignerWatch() {
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

    // ── Auth ──────────────────────────────────────────────────

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
        if (!this.selectedWorkspaceKey && this.currentWorkspaceOwnerNpub) {
          const legacyMatch = this.knownWorkspaces.find((workspace) => workspace.workspaceOwnerNpub === this.currentWorkspaceOwnerNpub) || null;
          if (legacyMatch) this.selectedWorkspaceKey = legacyMatch.workspaceKey || '';
        }
        if (!this.selectedWorkspaceKey && this.knownWorkspaces.length > 0) {
          this.selectedWorkspaceKey = this.knownWorkspaces[0].workspaceKey || '';
          this.currentWorkspaceOwnerNpub = this.knownWorkspaces[0].workspaceOwnerNpub;
        }
        this.updateWorkspaceBootstrapPrompt();
        if (!this.backendUrl || !this.selectedWorkspaceKey) {
          this.openConnectModal();
        }
      } catch (error) {
        this.loginError = error.message;
      }
    },

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
        if (!this.selectedWorkspaceKey && this.currentWorkspaceOwnerNpub) {
          const legacyMatch = this.knownWorkspaces.find((workspace) => workspace.workspaceOwnerNpub === this.currentWorkspaceOwnerNpub) || null;
          if (legacyMatch) this.selectedWorkspaceKey = legacyMatch.workspaceKey || '';
        }
        if (!this.selectedWorkspaceKey && this.knownWorkspaces.length > 0) {
          this.selectedWorkspaceKey = this.knownWorkspaces[0].workspaceKey || '';
          this.currentWorkspaceOwnerNpub = this.knownWorkspaces[0].workspaceOwnerNpub;
        }
        if (this.selectedWorkspaceKey || this.currentWorkspaceOwnerNpub) {
          await this.selectWorkspace(this.selectedWorkspaceKey || this.currentWorkspaceOwnerNpub, { refresh: false });
        }

        await this.persistWorkspaceSettings();

        if (this.selectedWorkspaceKey) {
          await this.bootstrapSelectedWorkspace({ runAccessPrune: true });
        }
        this.updateWorkspaceBootstrapPrompt();
        if (!this.backendUrl || !this.selectedWorkspaceKey) {
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
      this.jobDefinitions = [];
      this.jobRuns = [];
      this.jobsError = null;
      this.jobsSuccess = null;
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
      this.workspaceProfileRowsByKey = {};
      this.selectedWorkspaceKey = '';
      this.currentWorkspaceOwnerNpub = '';
      this.workspaceSwitchPendingKey = '';
      this.workspaceSwitchPendingNpub = '';
      this.workspaceSettingsRecordId = '';
      this.workspaceSettingsVersion = 0;
      this.workspaceSettingsGroupIds = [];
      this.workspaceHarnessUrl = '';
      this.revokeWorkspaceAvatarPreviewObjectUrl();
      this.hasBootstrappedUnreadTracking = false;
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

    openHarnessLink() {
      if (!this.workspaceHarnessUrl || typeof window === 'undefined') return;
      window.open(this.workspaceHarnessUrl, '_blank', 'noopener,noreferrer');
    },
  };
}
