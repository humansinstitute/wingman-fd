import { describe, expect, it } from 'vitest';
import { createShellState, SHELL_STATE_KEYS, SHELL_METHOD_NAMES } from '../src/shell-state.js';

// ---------------------------------------------------------------------------
// Shell state boundary tests
//
// These tests verify that the shell state extraction from app.js is correct:
// - The shell module exports the expected state keys and lifecycle methods
// - Shell state does not include domain-specific keys
// - Lifecycle methods are callable
// - The state object is suitable for spreading into the assembled store
// ---------------------------------------------------------------------------

describe('shell state exports', () => {
  it('exports createShellState as a function', () => {
    expect(typeof createShellState).toBe('function');
  });

  it('exports SHELL_STATE_KEYS as a frozen array of strings', () => {
    expect(Array.isArray(SHELL_STATE_KEYS)).toBe(true);
    expect(SHELL_STATE_KEYS.length).toBeGreaterThan(0);
    for (const key of SHELL_STATE_KEYS) {
      expect(typeof key).toBe('string');
    }
  });

  it('exports SHELL_METHOD_NAMES as a frozen array of strings', () => {
    expect(Array.isArray(SHELL_METHOD_NAMES)).toBe(true);
    expect(SHELL_METHOD_NAMES.length).toBeGreaterThan(0);
    for (const name of SHELL_METHOD_NAMES) {
      expect(typeof name).toBe('string');
    }
  });
});

describe('shell state object shape', () => {
  it('returns an object with all declared shell state keys', () => {
    const shell = createShellState();
    for (const key of SHELL_STATE_KEYS) {
      const descriptor = Object.getOwnPropertyDescriptor(shell, key);
      expect(descriptor, `missing shell key: ${key}`).toBeDefined();
    }
  });

  it('returns an object with all declared shell methods', () => {
    const shell = createShellState();
    for (const name of SHELL_METHOD_NAMES) {
      const descriptor = Object.getOwnPropertyDescriptor(shell, name);
      expect(descriptor, `missing shell method: ${name}`).toBeDefined();
      // Methods should be functions (not getters)
      expect(typeof descriptor.value, `${name} should be a function`).toBe('function');
    }
  });

  it('preserves getter descriptors for computed shell properties', () => {
    const shell = createShellState();
    const signingDesc = Object.getOwnPropertyDescriptor(shell, 'signingNpub');
    expect(signingDesc?.get, 'signingNpub should be a getter').toBeDefined();

    const isLoggedInDesc = Object.getOwnPropertyDescriptor(shell, 'isLoggedIn');
    expect(isLoggedInDesc?.get, 'isLoggedIn should be a getter').toBeDefined();
  });
});

describe('shell state key inventory', () => {
  // App/session state
  it('includes identity and session keys', () => {
    expect(SHELL_STATE_KEYS).toContain('backendUrl');
    expect(SHELL_STATE_KEYS).toContain('ownerNpub');
    expect(SHELL_STATE_KEYS).toContain('botNpub');
    expect(SHELL_STATE_KEYS).toContain('session');
    expect(SHELL_STATE_KEYS).toContain('settingsTab');
    expect(SHELL_STATE_KEYS).toContain('appBuildId');
  });

  // Navigation state
  it('includes navigation keys', () => {
    expect(SHELL_STATE_KEYS).toContain('navSection');
    expect(SHELL_STATE_KEYS).toContain('navCollapsed');
    expect(SHELL_STATE_KEYS).toContain('mobileNavOpen');
    expect(SHELL_STATE_KEYS).toContain('routeSyncPaused');
    expect(SHELL_STATE_KEYS).toContain('popstateHandler');
  });

  // Sync status indicators
  it('includes sync status keys', () => {
    expect(SHELL_STATE_KEYS).toContain('syncStatus');
    expect(SHELL_STATE_KEYS).toContain('syncSession');
    expect(SHELL_STATE_KEYS).toContain('sseStatus');
    expect(SHELL_STATE_KEYS).toContain('catchUpSyncActive');
  });

  // Shell UI state
  it('includes shell UI keys', () => {
    expect(SHELL_STATE_KEYS).toContain('showAvatarMenu');
    expect(SHELL_STATE_KEYS).toContain('showConnectModal');
    expect(SHELL_STATE_KEYS).toContain('showAgentConnectModal');
    expect(SHELL_STATE_KEYS).toContain('knownHosts');
  });

  // Connect modal fields
  it('includes connect modal fields', () => {
    expect(SHELL_STATE_KEYS).toContain('connectStep');
    expect(SHELL_STATE_KEYS).toContain('connectHostUrl');
    expect(SHELL_STATE_KEYS).toContain('connectHostLabel');
    expect(SHELL_STATE_KEYS).toContain('connectHostServiceNpub');
    expect(SHELL_STATE_KEYS).toContain('connectHostError');
    expect(SHELL_STATE_KEYS).toContain('connectHostBusy');
    expect(SHELL_STATE_KEYS).toContain('connectManualUrl');
    expect(SHELL_STATE_KEYS).toContain('connectWorkspaces');
    expect(SHELL_STATE_KEYS).toContain('connectWorkspacesBusy');
    expect(SHELL_STATE_KEYS).toContain('connectWorkspacesError');
    expect(SHELL_STATE_KEYS).toContain('connectNewWorkspaceName');
    expect(SHELL_STATE_KEYS).toContain('connectNewWorkspaceDescription');
    expect(SHELL_STATE_KEYS).toContain('connectCreatingWorkspace');
    expect(SHELL_STATE_KEYS).toContain('connectTokenInput');
    expect(SHELL_STATE_KEYS).toContain('connectShowTokenFallback');
  });

  // Constants
  it('includes timing constants', () => {
    expect(SHELL_STATE_KEYS).toContain('FAST_SYNC_MS');
    expect(SHELL_STATE_KEYS).toContain('IDLE_SYNC_MS');
    expect(SHELL_STATE_KEYS).toContain('SSE_HEARTBEAT_CADENCE_MS');
    expect(SHELL_STATE_KEYS).toContain('BACKGROUND_GROUP_REFRESH_MS');
  });
});

describe('shell state does NOT include domain keys', () => {
  const DOMAIN_KEYS = [
    // Section data arrays
    'channels', 'messages', 'documents', 'directories', 'reports',
    'tasks', 'schedules', 'audioNotes', 'groups', 'scopes',
    'flows', 'approvals', 'persons', 'organisations',
    'addressBookPeople', 'taskComments', 'docComments',
    // Section selection state
    'selectedChannelId', 'selectedDocId', 'selectedDocType',
    'selectedReportId', 'activeThreadId', 'activeTaskId',
    'editingFlowId', 'editingPersonId', 'editingOrgId',
    // Section UI state
    'messageInput', 'threadInput', 'docEditorContent',
    'docEditorBlocks', 'docBlockBuffer', 'newTaskTitle',
    'showTaskDetail', 'showFlowEditor', 'showDocShareModal',
    'taskViewMode', 'showBoardPicker', 'selectedBoardId',
  ];

  it('does not contain any domain data array keys', () => {
    const shell = createShellState();
    const shellKeys = Object.keys(shell);
    for (const key of DOMAIN_KEYS) {
      expect(shellKeys, `shell should not contain domain key: ${key}`).not.toContain(key);
    }
  });

  it('SHELL_STATE_KEYS does not list any domain keys', () => {
    for (const key of DOMAIN_KEYS) {
      expect(SHELL_STATE_KEYS, `SHELL_STATE_KEYS should not contain: ${key}`).not.toContain(key);
    }
  });
});

describe('shell state default values', () => {
  it('initializes navSection to status by default', () => {
    const shell = createShellState();
    expect(shell.navSection).toBe('status');
  });

  it('accepts an initial section override', () => {
    const shell = createShellState({ initialSection: 'tasks' });
    expect(shell.navSection).toBe('tasks');
  });

  it('initializes session to null', () => {
    const shell = createShellState();
    expect(shell.session).toBeNull();
  });

  it('initializes sync status to synced', () => {
    const shell = createShellState();
    expect(shell.syncStatus).toBe('synced');
  });

  it('initializes syncSession with expected structure', () => {
    const shell = createShellState();
    expect(shell.syncSession).toEqual({
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
    });
  });

  it('initializes connect modal fields to default values', () => {
    const shell = createShellState();
    expect(shell.showConnectModal).toBe(false);
    expect(shell.connectStep).toBe(1);
    expect(shell.connectHostUrl).toBe('');
    expect(shell.connectWorkspaces).toEqual([]);
  });

  it('sets constants to expected values', () => {
    const shell = createShellState();
    expect(shell.FAST_SYNC_MS).toBe(15000);
    expect(shell.IDLE_SYNC_MS).toBe(30000);
    expect(shell.SSE_HEARTBEAT_CADENCE_MS).toBe(120000);
    expect(shell.BACKGROUND_GROUP_REFRESH_MS).toBe(300000);
  });

  it('isLoggedIn returns false when session is null', () => {
    const shell = createShellState();
    expect(shell.isLoggedIn).toBe(false);
  });

  it('isLoggedIn returns true when session has an npub', () => {
    const shell = createShellState();
    shell.session = { npub: 'npub1abc', pubkey: 'abc', method: 'extension' };
    expect(shell.isLoggedIn).toBe(true);
  });
});

describe('shell lifecycle methods', () => {
  it('includes initRouteSync method', () => {
    expect(SHELL_METHOD_NAMES).toContain('initRouteSync');
  });

  it('includes navigateTo method', () => {
    expect(SHELL_METHOD_NAMES).toContain('navigateTo');
  });

  it('includes buildRouteUrl method', () => {
    expect(SHELL_METHOD_NAMES).toContain('buildRouteUrl');
  });

  it('includes syncRoute method', () => {
    expect(SHELL_METHOD_NAMES).toContain('syncRoute');
  });

  it('includes getRoutePath method', () => {
    expect(SHELL_METHOD_NAMES).toContain('getRoutePath');
  });

  it('includes init method', () => {
    expect(SHELL_METHOD_NAMES).toContain('init');
  });

  it('includes login and logout methods', () => {
    expect(SHELL_METHOD_NAMES).toContain('login');
    expect(SHELL_METHOD_NAMES).toContain('logout');
  });

  it('includes togglePrimaryNav method', () => {
    expect(SHELL_METHOD_NAMES).toContain('togglePrimaryNav');
  });

  it('includes startExtensionSignerWatch and stopExtensionSignerWatch', () => {
    expect(SHELL_METHOD_NAMES).toContain('startExtensionSignerWatch');
    expect(SHELL_METHOD_NAMES).toContain('stopExtensionSignerWatch');
  });

  it('includes clearInactiveSectionData method', () => {
    expect(SHELL_METHOD_NAMES).toContain('clearInactiveSectionData');
  });

  it('includes bootstrapSelectedWorkspace method', () => {
    expect(SHELL_METHOD_NAMES).toContain('bootstrapSelectedWorkspace');
  });

  it('includes applyRouteFromLocation method', () => {
    expect(SHELL_METHOD_NAMES).toContain('applyRouteFromLocation');
  });

  it('includes updatePageTitle method', () => {
    expect(SHELL_METHOD_NAMES).toContain('updatePageTitle');
  });
});

describe('shell state is spreadable into a store', () => {
  it('can be applied with Object.defineProperties (mixin pattern)', () => {
    const target = { domainKey: 'test' };
    const shell = createShellState();
    const descriptors = Object.getOwnPropertyDescriptors(shell);
    Object.defineProperties(target, descriptors);

    // Shell keys should be present
    expect(target.navSection).toBe('status');
    expect(target.session).toBeNull();
    expect(target.FAST_SYNC_MS).toBe(15000);

    // Domain key should still be there
    expect(target.domainKey).toBe('test');
  });

  it('getters survive defineProperties application', () => {
    const target = {};
    const shell = createShellState();
    const descriptors = Object.getOwnPropertyDescriptors(shell);
    Object.defineProperties(target, descriptors);

    // signingNpub should still be a getter
    const desc = Object.getOwnPropertyDescriptor(target, 'signingNpub');
    expect(desc?.get).toBeDefined();

    // isLoggedIn should still be a getter
    const loggedInDesc = Object.getOwnPropertyDescriptor(target, 'isLoggedIn');
    expect(loggedInDesc?.get).toBeDefined();
  });
});

describe('shell state boundary is documented', () => {
  it('SHELL_STATE_KEYS matches the keys actually returned by createShellState', () => {
    const shell = createShellState();
    const descriptors = Object.getOwnPropertyDescriptors(shell);

    // Collect all non-function keys (state + getters)
    const actualStateKeys = [];
    for (const [key, desc] of Object.entries(descriptors)) {
      if (typeof desc.value === 'function') continue; // skip methods
      if (desc.get) { actualStateKeys.push(key); continue; } // getter = state
      actualStateKeys.push(key);
    }

    const sortedExpected = [...SHELL_STATE_KEYS].sort();
    const sortedActual = [...actualStateKeys].sort();
    expect(sortedActual).toEqual(sortedExpected);
  });

  it('SHELL_METHOD_NAMES matches the methods actually returned by createShellState', () => {
    const shell = createShellState();
    const descriptors = Object.getOwnPropertyDescriptors(shell);

    const actualMethods = [];
    for (const [key, desc] of Object.entries(descriptors)) {
      if (typeof desc.value === 'function') actualMethods.push(key);
    }

    const sortedExpected = [...SHELL_METHOD_NAMES].sort();
    const sortedActual = [...actualMethods].sort();
    expect(sortedActual).toEqual(sortedExpected);
  });
});
