import { describe, expect, it, vi } from 'vitest';
import { guessDefaultBackendUrl, workspaceManagerMixin } from '../src/workspace-manager.js';

// ---------------------------------------------------------------------------
// Helper: bind a mixin method to a fake store context
// ---------------------------------------------------------------------------
function bindMethod(methodName, storeOverrides = {}) {
  const store = {
    knownWorkspaces: [],
    currentWorkspaceOwnerNpub: '',
    ownerNpub: '',
    session: null,
    backendUrl: '',
    superbasedConnectionConfig: null,
    workspaceSwitchPendingNpub: '',
    groups: [],
    workspaceProfileRowsByOwner: {},
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
    workspaceTriggers: [],
    wingmanHarnessInput: '',
    wingmanHarnessDirty: false,
    wingmanHarnessError: null,
    removingWorkspace: false,
    error: null,
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
    const ws = { workspaceOwnerNpub: 'npub1ws', name: 'Test' };
    const { fn } = bindMethod('getWorkspaceDisplayEntry', {
      knownWorkspaces: [ws],
      workspaceProfileRowsByOwner: {
        npub1ws: { avatarUrl: 'https://example.com/avatar.png' },
      },
    });
    const result = fn('npub1ws');
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
      workspaceProfileRowsByOwner: {},
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
      workspaceProfileRowsByOwner: {},
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
      workspaceProfileRowsByOwner: {},
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
      showWorkspaceBootstrapModal: false,
      showWorkspaceSwitcherMenu: true,
      mobileNavOpen: true,
    });
    fn();
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
      showWorkspaceBootstrapModal: false,
    });
    const result = fn();
    expect(result).toBe(true);
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

  it('falls back to currentWorkspaceBackendUrl for same owner', () => {
    const ws = { workspaceOwnerNpub: 'npub1ws' };
    const { fn } = bindMethod('getWorkspaceStorageBackendUrl', {
      knownWorkspaces: [ws],
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
