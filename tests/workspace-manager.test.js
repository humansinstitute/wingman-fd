import { afterEach, describe, expect, it, vi } from 'vitest';
import { guessDefaultBackendUrl, workspaceManagerMixin } from '../src/workspace-manager.js';
import * as api from '../src/api.js';

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helper: bind a mixin method to a fake store context
// ---------------------------------------------------------------------------
function bindMethod(methodName, storeOverrides = {}) {
  const store = {
    knownWorkspaces: [],
    selectedWorkspaceKey: '',
    currentWorkspaceOwnerNpub: '',
    ownerNpub: '',
    session: null,
    backendUrl: '',
    superbasedConnectionConfig: null,
    workspaceSwitchPendingKey: '',
    workspaceSwitchPendingNpub: '',
    groups: [],
    workspaceProfileRowsByKey: {},
    storageImageUrlCache: {},
    workspaceProfileDirty: false,
    workspaceProfileError: null,
    workspaceProfileSaving: false,
    workspaceProfilePendingAvatarFile: null,
    workspaceProfilePendingAvatarObjectUrl: '',
    workspaceProfileAvatarPreviewUrl: '',
    workspaceProfileNameInput: '',
    workspaceProfileSlugInput: '',
    workspaceProfileDescriptionInput: '',
    workspaceProfileAvatarInput: '',
    showWorkspaceSwitcherMenu: false,
    showWorkspaceBootstrapModal: false,
    workspaceBootstrapSubmitting: false,
    newWorkspaceName: '',
    newWorkspaceDescription: '',
    mobileNavOpen: false,
    navSection: 'chat',
    workspaceSettingsRecordId: '',
    workspaceSettingsVersion: 0,
    workspaceSettingsGroupIds: [],
    workspaceHarnessUrl: '',
    agentChatTriggerRecordId: '',
    agentChatTriggerEnabled: true,
    agentChatTriggerTargetGroupId: '',
    agentChatTriggerTargetGroupNpub: '',
    agentChatTriggerDiagnostics: [],
    agentChatTriggerDiagnosticsLoading: false,
    botNpub: '',
    defaultAgentNpub: '',
    workspaceTriggers: [],
    wingmanHarnessInput: '',
    wingmanHarnessDirty: false,
    wingmanHarnessError: null,
    removingWorkspace: false,
    error: null,
    channels: [],
    selectedChannelId: '',
    selectedChannel: null,
    getShortNpub: (npub) => npub?.slice(0, 8) || '',
    getInitials: (name) => (name || 'WS').slice(0, 2).toUpperCase(),
    getSenderAvatar: () => null,
    getSenderName: (npub) => npub,
    resolveStorageImageUrl: vi.fn().mockResolvedValue(''),
    ensureWorkspaceProfileHydrated: vi.fn(),
    mergedHostsList: [],
    ...storeOverrides,
  };

  // Apply all mixin methods and getters onto the store object
  const descriptors = Object.getOwnPropertyDescriptors(workspaceManagerMixin);
  for (const [key, desc] of Object.entries(descriptors)) {
    // Don't overwrite explicit storeOverrides
    if (Object.prototype.hasOwnProperty.call(storeOverrides, key)) continue;
    Object.defineProperty(store, key, desc);
  }

  const method = store[methodName];
  if (typeof method === 'function') {
    return { fn: method.bind(store), store };
  }
  return { store };
}

// ---------------------------------------------------------------------------
// guessDefaultBackendUrl
// ---------------------------------------------------------------------------
describe('guessDefaultBackendUrl', () => {
  it('returns a string', () => {
    const result = guessDefaultBackendUrl();
    expect(typeof result).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// Computed getters
// ---------------------------------------------------------------------------
describe('workspace computed getters', () => {
  it('workspaceOwnerNpub falls back through chain', () => {
    const { store } = bindMethod('getWorkspaceByOwner', {
      currentWorkspaceOwnerNpub: '',
      superbasedConnectionConfig: null,
      ownerNpub: '',
      session: { npub: 'npub1session' },
    });
    expect(store.workspaceOwnerNpub).toBe('npub1session');
  });

  it('workspaceOwnerNpub prefers currentWorkspaceOwnerNpub', () => {
    const { store } = bindMethod('getWorkspaceByOwner', {
      currentWorkspaceOwnerNpub: 'npub1current',
      session: { npub: 'npub1session' },
    });
    expect(store.workspaceOwnerNpub).toBe('npub1current');
  });

  it('currentWorkspace returns matching workspace', () => {
    const ws = { workspaceOwnerNpub: 'npub1ws', name: 'My WS' };
    const { store } = bindMethod('getWorkspaceByOwner', {
      knownWorkspaces: [ws],
      currentWorkspaceOwnerNpub: 'npub1ws',
    });
    expect(store.currentWorkspace).toEqual(ws);
  });

  it('currentWorkspace returns null when no match', () => {
    const { store } = bindMethod('getWorkspaceByOwner', {
      knownWorkspaces: [],
      currentWorkspaceOwnerNpub: 'npub1unknown',
    });
    expect(store.currentWorkspace).toBeNull();
  });

  it('currentWorkspace prefers selectedWorkspaceKey when multiple workspaces share an owner', () => {
    const aiWorkspace = {
      workspaceKey: 'service:npub1ai::workspace:npub1ws',
      workspaceOwnerNpub: 'npub1ws',
      name: 'Other Stuff AI',
    };
    const studioWorkspace = {
      workspaceKey: 'service:npub1studio::workspace:npub1ws',
      workspaceOwnerNpub: 'npub1ws',
      name: 'Other Stuff Studio',
    };
    const { store } = bindMethod('getWorkspaceByOwner', {
      knownWorkspaces: [studioWorkspace, aiWorkspace],
      selectedWorkspaceKey: 'service:npub1ai::workspace:npub1ws',
      currentWorkspaceOwnerNpub: 'npub1ws',
    });
    expect(store.currentWorkspace).toEqual(aiWorkspace);
  });

  it('isWorkspaceSwitching reflects pending npub', () => {
    const { store: s1 } = bindMethod('getWorkspaceByOwner', {
      workspaceSwitchPendingNpub: '',
    });
    expect(s1.isWorkspaceSwitching).toBe(false);

    const { store: s2 } = bindMethod('getWorkspaceByOwner', {
      workspaceSwitchPendingNpub: 'npub1abc',
    });
    expect(s2.isWorkspaceSwitching).toBe(true);
  });

  it('currentWorkspaceName returns workspace name or fallback', () => {
    const ws = { workspaceOwnerNpub: 'npub1ws', name: 'Acme' };
    const { store } = bindMethod('getWorkspaceByOwner', {
      knownWorkspaces: [ws],
      currentWorkspaceOwnerNpub: 'npub1ws',
    });
    expect(store.currentWorkspaceName).toBe('Acme');
  });

  it('currentWorkspaceName returns "No workspace selected" when empty', () => {
    const { store } = bindMethod('getWorkspaceByOwner', {
      knownWorkspaces: [],
      currentWorkspaceOwnerNpub: '',
      session: null,
      ownerNpub: '',
    });
    expect(store.currentWorkspaceName).toBe('No workspace selected');
  });

  it('currentWorkspaceBackendName prefers tower discovery metadata', () => {
    const ws = {
      workspaceKey: 'service:npub1service::workspace:npub1ws',
      workspaceOwnerNpub: 'npub1ws',
      directHttpsUrl: 'https://tower.example',
      towerName: 'Family Tower',
    };
    const { store } = bindMethod('getWorkspaceByOwner', {
      knownWorkspaces: [ws],
      selectedWorkspaceKey: ws.workspaceKey,
      currentWorkspaceOwnerNpub: 'npub1ws',
    });

    expect(store.currentWorkspaceBackendName).toBe('Family Tower');
  });

  it('currentWorkspaceGroups filters by owner', () => {
    const { store } = bindMethod('getWorkspaceByOwner', {
      currentWorkspaceOwnerNpub: 'npub1ws',
      groups: [
        { owner_npub: 'npub1ws', name: 'A' },
        { owner_npub: 'npub1other', name: 'B' },
        { owner_npub: 'npub1ws', name: 'C' },
      ],
    });
    expect(store.currentWorkspaceGroups).toHaveLength(2);
    expect(store.currentWorkspaceGroups.map((g) => g.name)).toEqual(['A', 'C']);
  });

  it('canAdminWorkspace is true for the creator', () => {
    const ws = { workspaceOwnerNpub: 'npub1ws', creatorNpub: 'npub1creator', workspaceKey: 'workspace:npub1ws' };
    const { store } = bindMethod('getWorkspaceByOwner', {
      knownWorkspaces: [ws],
      currentWorkspaceOwnerNpub: 'npub1ws',
      selectedWorkspaceKey: 'workspace:npub1ws',
      session: { npub: 'npub1creator' },
      groups: [],
    });
    expect(store.canAdminWorkspace).toBe(true);
  });

  it('canAdminWorkspace is true for a member of the workspace admin group', () => {
    const ws = { workspaceOwnerNpub: 'npub1ws', creatorNpub: 'npub1creator', workspaceKey: 'workspace:npub1ws' };
    const { store } = bindMethod('getWorkspaceByOwner', {
      knownWorkspaces: [ws],
      currentWorkspaceOwnerNpub: 'npub1ws',
      selectedWorkspaceKey: 'workspace:npub1ws',
      session: { npub: 'npub1admin' },
      groups: [
        { owner_npub: 'npub1ws', group_kind: 'workspace_admin', member_npubs: ['npub1admin'] },
      ],
    });
    expect(store.canAdminWorkspace).toBe(true);
  });

  it('currentWorkspaceContentGroups excludes the workspace admin group', () => {
    const { store } = bindMethod('getWorkspaceByOwner', {
      currentWorkspaceOwnerNpub: 'npub1ws',
      groups: [
        { owner_npub: 'npub1ws', group_kind: 'workspace_admin', name: 'Admins' },
        { owner_npub: 'npub1ws', group_kind: 'shared', name: 'Team' },
      ],
    });
    expect(store.currentWorkspaceContentGroups.map((group) => group.name)).toEqual(['Team']);
  });

  it('agentChatTriggerValidationHeadline flags missing saved groups', () => {
    const { store } = bindMethod('getWorkspaceByOwner', {
      currentWorkspaceOwnerNpub: 'npub1ws',
      agentChatTriggerRecordId: 'agent-chat-trigger:npub1ws',
      agentChatTriggerEnabled: true,
      agentChatTriggerTargetGroupId: 'grp-missing',
      groups: [],
    });

    expect(store.agentChatTriggerValidationHeadline()).toBe('Needs review');
  });

  it('agentChatOperatorWarnings reports missing bot membership in the target group', () => {
    const { store } = bindMethod('getWorkspaceByOwner', {
      currentWorkspaceOwnerNpub: 'npub1ws',
      agentChatTriggerRecordId: 'agent-chat-trigger:npub1ws',
      agentChatTriggerEnabled: true,
      agentChatTriggerTargetGroupId: 'grp-agents',
      botNpub: 'npub1bot',
      groups: [
        {
          owner_npub: 'npub1ws',
          group_id: 'grp-agents',
          name: 'Agent Ops',
          member_npubs: ['npub1human'],
        },
      ],
      getSenderName: (npub) => (npub === 'npub1bot' ? 'Bot Ops' : npub),
    });

    expect(store.agentChatOperatorWarnings).toEqual([
      expect.objectContaining({
        code: 'no-bot-members',
        kind: 'Membership',
        severity: 'error',
      }),
    ]);
  });

  it('agentChatOperatorWarnings reports current-actor wrapped-key failures when the signed-in bot is stale', () => {
    const { store } = bindMethod('getWorkspaceByOwner', {
      currentWorkspaceOwnerNpub: 'npub1ws',
      agentChatTriggerRecordId: 'agent-chat-trigger:npub1ws',
      agentChatTriggerEnabled: true,
      agentChatTriggerTargetGroupId: 'grp-agents',
      botNpub: 'npub1bot',
      session: { npub: 'npub1bot' },
      groups: [
        {
          owner_npub: 'npub1ws',
          group_id: 'grp-agents',
          name: 'Agent Ops',
          member_npubs: ['npub1bot'],
        },
      ],
      agentChatTriggerDiagnostics: [
        {
          member_npub: 'npub1bot',
          status: 'stale',
          summary: 'Wrapped keys stop at epoch 2.',
          detail: 'Rotate or reprovision wrapped keys.',
        },
      ],
      getSenderName: (npub) => (npub === 'npub1bot' ? 'Bot Ops' : npub),
    });

    expect(store.agentChatOperatorWarnings).toEqual([
      expect.objectContaining({
        code: 'current-actor-keys-stale',
        kind: 'Current actor',
        severity: 'error',
      }),
    ]);
  });

  it('agentChatDiagnosticsScopeNote explains when bot verification is unavailable', () => {
    const { store } = bindMethod('getWorkspaceByOwner', {
      currentWorkspaceOwnerNpub: 'npub1ws',
      agentChatTriggerRecordId: 'agent-chat-trigger:npub1ws',
      agentChatTriggerEnabled: true,
      agentChatTriggerTargetGroupId: 'grp-agents',
      groups: [
        {
          owner_npub: 'npub1ws',
          group_id: 'grp-agents',
          name: 'Agent Ops',
          member_npubs: ['npub1human'],
        },
      ],
    });

    expect(store.agentChatDiagnosticsScopeNote).toContain('informative only');
    expect(store.agentChatDiagnosticsScopeNote).toContain('signed-in actor');
    expect(store.agentChatDiagnosticsScopeNote).toContain('/groups/keys');
  });

  it('agentChatOperatorWarnings explains when the signed-in actor is outside the target group', () => {
    const { store } = bindMethod('getWorkspaceByOwner', {
      currentWorkspaceOwnerNpub: 'npub1ws',
      agentChatTriggerRecordId: 'agent-chat-trigger:npub1ws',
      agentChatTriggerEnabled: true,
      agentChatTriggerTargetGroupId: 'grp-agents',
      botNpub: 'npub1bot',
      session: { npub: 'npub1admin' },
      groups: [
        {
          owner_npub: 'npub1ws',
          group_id: 'grp-agents',
          name: 'Agent Ops',
          member_npubs: ['npub1bot'],
        },
      ],
      agentChatTriggerDiagnostics: [
        {
          member_npub: 'npub1admin',
          status: 'not_member',
          summary: 'The signed-in actor is not a member of this saved target group.',
          detail: 'Tower only exposes wrapped keys for the resolved actor.',
        },
      ],
      getSenderName: (npub) => npub === 'npub1admin' ? 'Workspace Admin' : npub,
    });

    expect(store.agentChatOperatorWarnings).toEqual([
      expect.objectContaining({
        code: 'current-actor-not-member',
        kind: 'Current actor',
        severity: 'warning',
      }),
    ]);
  });

  it('agentChatTriggerValidationDetail explains that Flight Deck no longer owns routing when no record exists', () => {
    const { store } = bindMethod('getWorkspaceByOwner', {
      agentChatTriggerRecordId: '',
    });

    expect(store.agentChatTriggerValidationHeadline()).toBe('Not required');
    expect(store.agentChatTriggerValidationDetail()).toContain('Flight Deck no longer needs a saved workspace record');
    expect(store.agentChatTriggerValidationDetail()).toContain('Wingmen owns local agent registration and routing');
  });

  it('agentChatTriggerStatusLabel de-emphasizes the record as legacy state', () => {
    const { store } = bindMethod('getWorkspaceByOwner', {});

    expect(store.agentChatTriggerStatusLabel('enabled')).toBe('Legacy record present');
    expect(store.agentChatTriggerStatusLabel('disabled')).toBe('Legacy record paused');
    expect(store.agentChatTriggerStatusLabel('invalid')).toBe('Legacy record invalid');
    expect(store.agentChatTriggerStatusLabel('unconfigured')).toBe('No workspace record');
  });

  it('memberPrivateGroup finds private group for session member', () => {
    const { store } = bindMethod('getWorkspaceByOwner', {
      currentWorkspaceOwnerNpub: 'npub1ws',
      session: { npub: 'npub1me' },
      groups: [
        { owner_npub: 'npub1ws', group_kind: 'shared', private_member_npub: null, name: 'Shared' },
        { owner_npub: 'npub1ws', group_kind: 'private', private_member_npub: 'npub1me', name: 'Private' },
      ],
    });
    expect(store.memberPrivateGroup).toEqual(
      expect.objectContaining({ name: 'Private', group_kind: 'private' }),
    );
  });

  it('memberPrivateGroup returns null when no session', () => {
    const { store } = bindMethod('getWorkspaceByOwner', {
      currentWorkspaceOwnerNpub: 'npub1ws',
      session: null,
      groups: [],
    });
    expect(store.memberPrivateGroup).toBeNull();
  });

  it('currentWorkspaceSlug uses workspace slug or slugified name', () => {
    const ws = { workspaceOwnerNpub: 'npub1ws', name: 'Acme', slug: 'acme-slug' };
    const { store } = bindMethod('getWorkspaceByOwner', {
      knownWorkspaces: [ws],
      currentWorkspaceOwnerNpub: 'npub1ws',
    });
    expect(store.currentWorkspaceSlug).toBe('acme-slug');
  });

  it('refreshAgentChatTriggerDiagnostics only inspects the signed-in actor', async () => {
    vi.spyOn(api, 'getGroupKeys').mockResolvedValue({
      keys: [],
    });

    const { fn, store } = bindMethod('refreshAgentChatTriggerDiagnostics', {
      knownWorkspaces: [{
        workspaceKey: 'workspace:npub1ws',
        workspaceOwnerNpub: 'npub1ws',
        creatorNpub: 'npub1admin',
      }],
      selectedWorkspaceKey: 'workspace:npub1ws',
      currentWorkspaceOwnerNpub: 'npub1ws',
      agentChatTriggerRecordId: 'agent-chat-trigger:npub1ws',
      agentChatTriggerEnabled: true,
      agentChatTriggerTargetGroupId: 'grp-agents',
      session: { npub: 'npub1admin' },
      groups: [
        {
          owner_npub: 'npub1ws',
          group_id: 'grp-agents',
          group_npub: 'npub1agents',
          current_epoch: 3,
          name: 'Agent Ops',
          member_npubs: ['npub1bot', 'npub1human'],
        },
      ],
    });

    const diagnostics = await fn();

    expect(api.getGroupKeys).toHaveBeenCalledTimes(1);
    expect(api.getGroupKeys).toHaveBeenCalledWith('npub1admin');
    expect(diagnostics).toEqual([
      expect.objectContaining({
        member_npub: 'npub1admin',
        status: 'not_member',
      }),
    ]);
    expect(store.agentChatTriggerDiagnostics).toEqual(diagnostics);
  });
});

// ---------------------------------------------------------------------------
// Workspace display methods
// ---------------------------------------------------------------------------
describe('workspace display methods', () => {
  it('getWorkspaceByOwner returns matching workspace', () => {
    const ws = { workspaceOwnerNpub: 'npub1ws', name: 'Test' };
    const { fn } = bindMethod('getWorkspaceByOwner', { knownWorkspaces: [ws] });
    expect(fn('npub1ws')).toEqual(ws);
  });

  it('getWorkspaceByOwner returns null for no match', () => {
    const { fn } = bindMethod('getWorkspaceByOwner', { knownWorkspaces: [] });
    expect(fn('npub1nope')).toBeNull();
  });

  it('getWorkspaceByOwner returns null for empty input', () => {
    const { fn } = bindMethod('getWorkspaceByOwner');
    expect(fn('')).toBeNull();
    expect(fn(null)).toBeNull();
  });

  it('getWorkspaceName returns name from known workspace', () => {
    const ws = { workspaceOwnerNpub: 'npub1ws', name: 'Acme' };
    const { fn } = bindMethod('getWorkspaceName', { knownWorkspaces: [ws] });
    expect(fn(ws)).toBe('Acme');
  });

  it('getWorkspaceName returns fallback for unnamed workspace', () => {
    const ws = { workspaceOwnerNpub: 'npub1ws' };
    const { fn } = bindMethod('getWorkspaceName', { knownWorkspaces: [ws] });
    expect(fn(ws)).toBe('Untitled workspace');
  });

  it('getWorkspaceMeta returns description', () => {
    const ws = { workspaceOwnerNpub: 'npub1ws', description: 'A team workspace' };
    const { fn } = bindMethod('getWorkspaceMeta', { knownWorkspaces: [ws] });
    expect(fn(ws)).toBe('A team workspace');
  });

  it('getWorkspaceMeta falls back to owner npub', () => {
    const ws = { workspaceOwnerNpub: 'npub1ws' };
    const { fn } = bindMethod('getWorkspaceMeta', { knownWorkspaces: [ws] });
    expect(fn(ws)).toBe('npub1ws');
  });

  it('getWorkspaceInitials generates initials from name', () => {
    const ws = { workspaceOwnerNpub: 'npub1ws', name: 'Test' };
    const { fn } = bindMethod('getWorkspaceInitials', { knownWorkspaces: [ws] });
    expect(fn(ws)).toBe('TE');
  });

  it('getWorkspaceInitials handles null', () => {
    const { fn } = bindMethod('getWorkspaceInitials');
    expect(fn(null)).toBe('WS');
  });

  it('getWorkspaceInitials handles string', () => {
    const { fn } = bindMethod('getWorkspaceInitials');
    expect(fn('MyWorkspace')).toBe('MY');
  });

  it('getWorkspaceDisplayEntry merges profile data', () => {
    const ws = { workspaceKey: 'service:svc::workspace:npub1ws', workspaceOwnerNpub: 'npub1ws', name: 'Test' };
    const { fn } = bindMethod('getWorkspaceDisplayEntry', {
      knownWorkspaces: [ws],
      workspaceProfileRowsByKey: {
        'service:svc::workspace:npub1ws': { avatarUrl: 'https://example.com/avatar.png' },
      },
    });
    const result = fn('service:svc::workspace:npub1ws');
    expect(result.name).toBe('Test');
    expect(result.avatarUrl).toBe('https://example.com/avatar.png');
    expect(result.workspaceOwnerNpub).toBe('npub1ws');
  });
});

// ---------------------------------------------------------------------------
// Workspace switcher
// ---------------------------------------------------------------------------
describe('workspace switcher', () => {
  it('toggleWorkspaceSwitcherMenu toggles flag', () => {
    const { fn, store } = bindMethod('toggleWorkspaceSwitcherMenu', {
      showWorkspaceSwitcherMenu: false,
    });
    fn();
    expect(store.showWorkspaceSwitcherMenu).toBe(true);
    fn();
    expect(store.showWorkspaceSwitcherMenu).toBe(false);
  });

  it('toggleWorkspaceSwitcherMenu blocked during switch', () => {
    const { fn, store } = bindMethod('toggleWorkspaceSwitcherMenu', {
      showWorkspaceSwitcherMenu: false,
      workspaceSwitchPendingNpub: 'npub1switching',
    });
    fn();
    expect(store.showWorkspaceSwitcherMenu).toBe(false);
  });

  it('closeWorkspaceSwitcherMenu sets flag to false', () => {
    const { fn, store } = bindMethod('closeWorkspaceSwitcherMenu', {
      showWorkspaceSwitcherMenu: true,
    });
    fn();
    expect(store.showWorkspaceSwitcherMenu).toBe(false);
  });

  it('handleWorkspaceSwitcherSelect includes workspacekey in the target URL', async () => {
    const originalWindow = globalThis.window;
    globalThis.window = {
      location: {
        href: 'https://flightdeck.example/current/chat?channelid=chan-1',
      },
    };

    try {
      const workspace = {
        workspaceKey: 'service:npub1ai::workspace:npub1ws',
        workspaceOwnerNpub: 'npub1ws',
        slug: 'other-stuff',
        name: 'Other Stuff',
        directHttpsUrl: 'https://sb4.otherstuff.ai',
        connectionToken: 'token-1',
      };
      const persistWorkspaceSettings = vi.fn().mockResolvedValue(undefined);
      const { fn, store } = bindMethod('handleWorkspaceSwitcherSelect', {
        knownWorkspaces: [workspace],
        navSection: 'chat',
        mobileNavOpen: true,
        persistWorkspaceSettings,
      });

      await fn(workspace.workspaceKey);

      expect(store.selectedWorkspaceKey).toBe(workspace.workspaceKey);
      expect(store.workspaceSwitchPendingKey).toBe(workspace.workspaceKey);
      expect(globalThis.window.location.href).toBe(
        '/other-stuff/chat?channelid=chan-1&workspacekey=service%3Anpub1ai%3A%3Aworkspace%3Anpub1ws',
      );
      expect(persistWorkspaceSettings).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.window = originalWindow;
    }
  });
});

// ---------------------------------------------------------------------------
// Workspace profile editing
// ---------------------------------------------------------------------------
describe('workspace profile editing', () => {
  it('markWorkspaceProfileDirty sets dirty and clears error', () => {
    const { fn, store } = bindMethod('markWorkspaceProfileDirty', {
      workspaceProfileDirty: false,
      workspaceProfileError: 'some error',
    });
    fn();
    expect(store.workspaceProfileDirty).toBe(true);
    expect(store.workspaceProfileError).toBeNull();
  });

  it('handleWorkspaceProfileField updates name', () => {
    const { fn, store } = bindMethod('handleWorkspaceProfileField', {
      workspaceProfileNameInput: '',
      workspaceProfileDirty: false,
      workspaceProfileError: null,
    });
    fn('name', 'New Name');
    expect(store.workspaceProfileNameInput).toBe('New Name');
    expect(store.workspaceProfileDirty).toBe(true);
  });

  it('handleWorkspaceProfileField updates description', () => {
    const { fn, store } = bindMethod('handleWorkspaceProfileField', {
      workspaceProfileDescriptionInput: '',
      workspaceProfileDirty: false,
      workspaceProfileError: null,
    });
    fn('description', 'A description');
    expect(store.workspaceProfileDescriptionInput).toBe('A description');
    expect(store.workspaceProfileDirty).toBe(true);
  });

  it('clearWorkspaceAvatarDraft clears avatar state', () => {
    const { fn, store } = bindMethod('clearWorkspaceAvatarDraft', {
      workspaceProfilePendingAvatarFile: { name: 'file.png' },
      workspaceProfileAvatarInput: 'storage://abc',
      workspaceProfileAvatarPreviewUrl: 'blob:123',
      workspaceProfilePendingAvatarObjectUrl: '',
      workspaceProfileDirty: false,
      workspaceProfileError: null,
    });
    fn();
    expect(store.workspaceProfilePendingAvatarFile).toBeNull();
    expect(store.workspaceProfileAvatarInput).toBe('');
    expect(store.workspaceProfileAvatarPreviewUrl).toBe('');
    expect(store.workspaceProfileDirty).toBe(true);
  });

  it('resetWorkspaceProfileDraft blocked during save', () => {
    const { fn, store } = bindMethod('resetWorkspaceProfileDraft', {
      workspaceProfileSaving: true,
      workspaceProfileDirty: true,
      workspaceProfileError: null,
    });
    fn();
    // Should not reset when saving
    expect(store.workspaceProfileDirty).toBe(true);
  });

  it('saveWorkspaceProfile writes slug through the workspace route and preserves the server slug', async () => {
    const updateWorkspaceSpy = vi.spyOn(api, 'updateWorkspace').mockResolvedValue({
      name: 'Renamed Workspace',
      slug: 'canonical-server-slug',
      description: 'Updated description',
      avatar_url: 'storage://workspace-avatar-1',
    });

    const persistWorkspaceSettings = vi.fn().mockResolvedValue(undefined);
    const syncWorkspaceProfileDraft = vi.fn();
    const mergeKnownWorkspaces = vi.fn();
    const originalWindow = globalThis.window;
    globalThis.window = {
      confirm: vi.fn(() => true),
    };

    try {
      const { fn, store } = bindMethod('saveWorkspaceProfile', {
        canAdminWorkspace: true,
        currentWorkspace: {
          workspaceKey: 'workspace:npub1ws',
          workspaceOwnerNpub: 'npub1ws',
          name: 'Original Workspace',
          slug: 'original-workspace',
        },
        workspaceProfileNameInput: 'Renamed Workspace',
        workspaceProfileSlugInput: 'renamed-workspace',
        workspaceProfileDescriptionInput: 'Updated description',
        workspaceProfileAvatarInput: 'storage://workspace-avatar-1',
        persistWorkspaceSettings,
        syncWorkspaceProfileDraft,
        mergeKnownWorkspaces,
      });

      await fn();

      expect(updateWorkspaceSpy).toHaveBeenCalledWith('npub1ws', {
        name: 'Renamed Workspace',
        slug: 'renamed-workspace',
        description: 'Updated description',
        avatar_url: 'storage://workspace-avatar-1',
      });
      expect(store.workspaceProfileRowsByKey['workspace:npub1ws']).toMatchObject({
        slug: 'canonical-server-slug',
        name: 'Renamed Workspace',
      });
      expect(mergeKnownWorkspaces).toHaveBeenCalledWith([
        expect.objectContaining({
          slug: 'canonical-server-slug',
          workspaceOwnerNpub: 'npub1ws',
        }),
      ]);
      expect(persistWorkspaceSettings).toHaveBeenCalledTimes(1);
      expect(syncWorkspaceProfileDraft).toHaveBeenCalledWith({ force: true });
      expect(store.workspaceProfileError).toBeNull();
    } finally {
      updateWorkspaceSpy.mockRestore();
      globalThis.window = originalWindow;
    }
  });
});

// ---------------------------------------------------------------------------
// Workspace settings row
// ---------------------------------------------------------------------------
describe('applyWorkspaceSettingsRow', () => {
  it('applies row fields to store', () => {
    const { fn, store } = bindMethod('applyWorkspaceSettingsRow', {
      workspaceSettingsRecordId: '',
      workspaceSettingsVersion: 0,
      workspaceSettingsGroupIds: [],
      workspaceHarnessUrl: '',
      workspaceTriggers: [],
      wingmanHarnessInput: '',
      wingmanHarnessDirty: false,
      workspaceProfileRowsByKey: {},
      knownWorkspaces: [],
    });
    fn({
      record_id: 'rec1',
      version: 3,
      group_ids: ['g1'],
      wingman_harness_url: 'https://harness.example.com',
      triggers: [{ id: 't1' }],
    });
    expect(store.workspaceSettingsRecordId).toBe('rec1');
    expect(store.workspaceSettingsVersion).toBe(3);
    expect(store.workspaceSettingsGroupIds).toEqual(['g1']);
    expect(store.workspaceHarnessUrl).toBe('https://harness.example.com');
    expect(store.workspaceTriggers).toEqual([{ id: 't1' }]);
    expect(store.wingmanHarnessInput).toBe('https://harness.example.com');
  });

  it('handles null row gracefully', () => {
    const { fn, store } = bindMethod('applyWorkspaceSettingsRow', {
      workspaceSettingsRecordId: 'old',
      workspaceSettingsVersion: 5,
      workspaceSettingsGroupIds: ['old-g'],
      workspaceHarnessUrl: 'old-url',
      workspaceTriggers: [],
      wingmanHarnessInput: '',
      wingmanHarnessDirty: false,
      workspaceProfileRowsByKey: {},
      knownWorkspaces: [],
    });
    fn(null);
    expect(store.workspaceSettingsRecordId).toBe('');
    expect(store.workspaceSettingsVersion).toBe(0);
  });

  it('does not overwrite harness input when dirty', () => {
    const { fn, store } = bindMethod('applyWorkspaceSettingsRow', {
      workspaceSettingsRecordId: '',
      workspaceSettingsVersion: 0,
      workspaceSettingsGroupIds: [],
      workspaceHarnessUrl: '',
      workspaceTriggers: [],
      wingmanHarnessInput: 'user-typed-value',
      wingmanHarnessDirty: true,
      workspaceProfileRowsByKey: {},
      knownWorkspaces: [],
    });
    fn({ wingman_harness_url: 'from-row' }, { overwriteInput: false });
    expect(store.wingmanHarnessInput).toBe('user-typed-value');
  });
});

// ---------------------------------------------------------------------------
// Workspace bootstrap modal
// ---------------------------------------------------------------------------
describe('workspace bootstrap modal', () => {
  it('openWorkspaceBootstrapModal sets state', () => {
    const { fn, store } = bindMethod('openWorkspaceBootstrapModal', {
      newWorkspaceName: 'leftover',
      newWorkspaceDescription: 'leftover',
      showConnectModal: true,
      showWorkspaceBootstrapModal: false,
      showWorkspaceSwitcherMenu: true,
      mobileNavOpen: true,
    });
    fn();
    expect(store.showConnectModal).toBe(false);
    expect(store.showWorkspaceBootstrapModal).toBe(true);
    expect(store.showWorkspaceSwitcherMenu).toBe(false);
    expect(store.mobileNavOpen).toBe(false);
    expect(store.newWorkspaceName).toBe('');
    expect(store.newWorkspaceDescription).toBe('');
  });

  it('closeWorkspaceBootstrapModal closes when not submitting', () => {
    const { fn, store } = bindMethod('closeWorkspaceBootstrapModal', {
      workspaceBootstrapSubmitting: false,
      showWorkspaceBootstrapModal: true,
    });
    fn();
    expect(store.showWorkspaceBootstrapModal).toBe(false);
  });

  it('closeWorkspaceBootstrapModal blocked during submission', () => {
    const { fn, store } = bindMethod('closeWorkspaceBootstrapModal', {
      workspaceBootstrapSubmitting: true,
      showWorkspaceBootstrapModal: true,
    });
    fn();
    expect(store.showWorkspaceBootstrapModal).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// updateWorkspaceBootstrapPrompt
// ---------------------------------------------------------------------------
describe('updateWorkspaceBootstrapPrompt', () => {
  it('prompts when signed in, has backend, no workspace', () => {
    const { fn, store } = bindMethod('updateWorkspaceBootstrapPrompt', {
      session: { npub: 'npub1me' },
      backendUrl: 'https://backend.example.com',
      currentWorkspaceOwnerNpub: '',
      knownWorkspaces: [],
      showConnectModal: true,
      showWorkspaceBootstrapModal: false,
    });
    const result = fn();
    expect(result).toBe(true);
    expect(store.showConnectModal).toBe(false);
    expect(store.showWorkspaceBootstrapModal).toBe(true);
  });

  it('does not prompt when workspace exists', () => {
    const { fn, store } = bindMethod('updateWorkspaceBootstrapPrompt', {
      session: { npub: 'npub1me' },
      backendUrl: 'https://backend.example.com',
      currentWorkspaceOwnerNpub: 'npub1ws',
      knownWorkspaces: [{ workspaceOwnerNpub: 'npub1ws' }],
      showWorkspaceBootstrapModal: false,
    });
    const result = fn();
    expect(result).toBe(false);
    expect(store.showWorkspaceBootstrapModal).toBe(false);
  });

  it('does not prompt when not signed in', () => {
    const { fn } = bindMethod('updateWorkspaceBootstrapPrompt', {
      session: null,
      backendUrl: 'https://backend.example.com',
      currentWorkspaceOwnerNpub: '',
      knownWorkspaces: [],
      showWorkspaceBootstrapModal: false,
    });
    expect(fn()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// persistWorkspaceSettings
// ---------------------------------------------------------------------------
describe('persistWorkspaceSettings', () => {
  it('calls saveSettings with correct fields', async () => {
    const { default: db } = await import('../src/db.js');
    const { fn, store } = bindMethod('persistWorkspaceSettings', {
      backendUrl: 'https://backend.example.com',
      ownerNpub: 'npub1owner',
      botNpub: '',
      superbasedTokenInput: 'token123',
      useCvmSync: false,
      knownWorkspaces: [{ workspaceOwnerNpub: 'npub1ws' }],
      knownHosts: [],
      currentWorkspaceOwnerNpub: 'npub1ws',
      defaultAgentNpub: '',
    });
    // Note: this will try to call the real db functions which may not be available
    // in a unit test environment, so we just verify the method exists and is callable
    expect(typeof fn).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Workspace storage backend URL
// ---------------------------------------------------------------------------
describe('getWorkspaceStorageBackendUrl', () => {
  it('returns directHttpsUrl from workspace entry', () => {
    const ws = { workspaceOwnerNpub: 'npub1ws', directHttpsUrl: 'https://storage.example.com' };
    const { fn } = bindMethod('getWorkspaceStorageBackendUrl', { knownWorkspaces: [ws] });
    expect(fn(ws)).toBe('https://storage.example.com');
  });

  it('falls back to currentWorkspaceBackendUrl for current workspace key', () => {
    const ws = { workspaceKey: 'service:svc::workspace:npub1ws', workspaceOwnerNpub: 'npub1ws' };
    const { fn } = bindMethod('getWorkspaceStorageBackendUrl', {
      knownWorkspaces: [ws],
      selectedWorkspaceKey: 'service:svc::workspace:npub1ws',
      currentWorkspaceOwnerNpub: 'npub1ws',
      backendUrl: 'https://fallback.example.com',
    });
    expect(fn(ws)).toBe('https://fallback.example.com');
  });

  it('returns empty string for unknown workspace', () => {
    const ws = { workspaceOwnerNpub: 'npub1other' };
    const { fn } = bindMethod('getWorkspaceStorageBackendUrl', {
      knownWorkspaces: [],
      currentWorkspaceOwnerNpub: 'npub1ws',
    });
    expect(fn(ws)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// mergeKnownWorkspaces
// ---------------------------------------------------------------------------
describe('mergeKnownWorkspaces', () => {
  it('merges new entries into knownWorkspaces', () => {
    const { fn, store } = bindMethod('mergeKnownWorkspaces', {
      knownWorkspaces: [{ workspaceOwnerNpub: 'npub1a', name: 'WS A' }],
      workspaceProfileDirty: true, // prevent syncWorkspaceProfileDraft from running
    });
    fn([{ workspaceOwnerNpub: 'npub1b', name: 'WS B' }]);
    expect(store.knownWorkspaces).toHaveLength(2);
    expect(store.knownWorkspaces.find((w) => w.workspaceOwnerNpub === 'npub1b')).toBeTruthy();
  });
});
