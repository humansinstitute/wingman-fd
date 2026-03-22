import { describe, expect, it, vi } from 'vitest';
import { connectSettingsManagerMixin } from '../src/connect-settings-manager.js';

function createStore(overrides = {}) {
  const store = {
    session: null,
    backendUrl: '',
    ownerNpub: '',
    botNpub: '',
    superbasedTokenInput: '',
    superbasedError: null,
    useCvmSync: false,
    knownHosts: [],
    knownWorkspaces: [],
    currentWorkspaceOwnerNpub: '',
    defaultAgentNpub: '',
    defaultAgentQuery: '',
    wingmanHarnessInput: '',
    wingmanHarnessDirty: false,
    wingmanHarnessError: null,
    showAvatarMenu: false,
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
    showWorkspaceSwitcherMenu: false,
    mobileNavOpen: false,
    showAgentConnectModal: false,
    agentConnectJson: '',
    agentConfigCopied: false,
    presetConnecting: false,
    error: null,
    // Stubs
    persistWorkspaceSettings: vi.fn().mockResolvedValue(undefined),
    ensureBackgroundSync: vi.fn(),
    selectWorkspace: vi.fn().mockResolvedValue(undefined),
    mergeKnownWorkspaces: vi.fn(),
    loadRemoteWorkspaces: vi.fn().mockResolvedValue(undefined),
    tryRecoverWorkspace: vi.fn().mockResolvedValue(undefined),
    updateWorkspaceBootstrapPrompt: vi.fn(),
    rememberPeople: vi.fn().mockResolvedValue(undefined),
    resolveChatProfile: vi.fn(),
    ...overrides,
  };

  const descriptors = Object.getOwnPropertyDescriptors(connectSettingsManagerMixin);
  for (const [key, desc] of Object.entries(descriptors)) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) continue;
    Object.defineProperty(store, key, desc);
  }
  return store;
}

function bindMethod(methodName, overrides = {}) {
  const store = createStore(overrides);
  const method = store[methodName];
  if (typeof method === 'function') return { fn: method.bind(store), store };
  return { store };
}

// --- settings ---
describe('settings methods', () => {
  it('handleHarnessInput updates state', () => {
    const { fn, store } = bindMethod('handleHarnessInput', {
      wingmanHarnessInput: '',
      wingmanHarnessDirty: false,
      wingmanHarnessError: 'old',
    });
    fn('https://harness.example.com');
    expect(store.wingmanHarnessInput).toBe('https://harness.example.com');
    expect(store.wingmanHarnessDirty).toBe(true);
    expect(store.wingmanHarnessError).toBeNull();
  });

  it('handleDefaultAgentInput updates query', () => {
    const { fn, store } = bindMethod('handleDefaultAgentInput', {
      defaultAgentQuery: '',
    });
    fn('some-query');
    expect(store.defaultAgentQuery).toBe('some-query');
  });

  it('handleDefaultAgentInput resolves profile for npub-like input', () => {
    const resolveChatProfile = vi.fn();
    const { fn } = bindMethod('handleDefaultAgentInput', {
      defaultAgentQuery: '',
      resolveChatProfile,
    });
    fn('npub1abcdefghijklmnopqrst');
    expect(resolveChatProfile).toHaveBeenCalledWith('npub1abcdefghijklmnopqrst');
  });

  it('selectDefaultAgent sets npub and persists', async () => {
    const { fn, store } = bindMethod('selectDefaultAgent');
    await fn('npub1agent');
    expect(store.defaultAgentNpub).toBe('npub1agent');
    expect(store.defaultAgentQuery).toBe('');
    expect(store.persistWorkspaceSettings).toHaveBeenCalled();
  });

  it('clearDefaultAgent clears and persists', async () => {
    const { fn, store } = bindMethod('clearDefaultAgent', {
      defaultAgentNpub: 'npub1old',
      defaultAgentQuery: 'old',
    });
    await fn();
    expect(store.defaultAgentNpub).toBe('');
    expect(store.defaultAgentQuery).toBe('');
    expect(store.persistWorkspaceSettings).toHaveBeenCalled();
  });

  it('saveSettings calls setBaseUrl and persists', async () => {
    const { fn, store } = bindMethod('saveSettings', {
      backendUrl: 'https://backend.example.com',
    });
    await fn();
    expect(store.persistWorkspaceSettings).toHaveBeenCalled();
    expect(store.ensureBackgroundSync).toHaveBeenCalled();
  });
});

// --- connection settings ---
describe('saveConnectionSettings', () => {
  it('sets error for invalid token', async () => {
    const { fn, store } = bindMethod('saveConnectionSettings', {
      superbasedTokenInput: 'bad-token',
    });
    await fn();
    expect(store.superbasedError).toBe('Connection key must include a direct HTTPS URL');
  });

  it('sets error when no backend URL', async () => {
    const { fn, store } = bindMethod('saveConnectionSettings', {
      superbasedTokenInput: '',
      backendUrl: '',
      session: { npub: 'npub1me' },
    });
    await fn();
    expect(store.superbasedError).toBe('Connection key or backend URL required');
  });
});

// --- connect modal ---
describe('connect modal', () => {
  it('openConnectModal initializes state', () => {
    const { fn, store } = bindMethod('openConnectModal');
    fn();
    expect(store.showConnectModal).toBe(true);
    expect(store.connectStep).toBe(1);
    expect(store.connectHostUrl).toBe('');
    expect(store.connectHostBusy).toBe(false);
    expect(store.connectWorkspaces).toEqual([]);
  });

  it('closeConnectModal closes when not busy', () => {
    const { fn, store } = bindMethod('closeConnectModal', {
      showConnectModal: true,
      connectHostBusy: false,
      connectWorkspacesBusy: false,
      connectCreatingWorkspace: false,
    });
    fn();
    expect(store.showConnectModal).toBe(false);
  });

  it('closeConnectModal blocked when busy', () => {
    const { fn, store } = bindMethod('closeConnectModal', {
      showConnectModal: true,
      connectHostBusy: true,
    });
    fn();
    expect(store.showConnectModal).toBe(true);
  });

  it('connectGoBack resets to step 1', () => {
    const { fn, store } = bindMethod('connectGoBack', {
      connectStep: 2,
      connectWorkspaces: [{ id: 'w1' }],
      connectNewWorkspaceName: 'Test',
    });
    fn();
    expect(store.connectStep).toBe(1);
    expect(store.connectWorkspaces).toEqual([]);
    expect(store.connectNewWorkspaceName).toBe('');
  });
});

// --- known hosts ---
describe('known hosts', () => {
  it('addKnownHost adds new host', () => {
    const { fn, store } = bindMethod('addKnownHost', { knownHosts: [] });
    fn({ url: 'https://host.example.com', label: 'Test', serviceNpub: 'npub1svc' });
    expect(store.knownHosts).toHaveLength(1);
    expect(store.knownHosts[0].url).toBe('https://host.example.com');
  });

  it('addKnownHost updates existing host', () => {
    const { fn, store } = bindMethod('addKnownHost', {
      knownHosts: [{ url: 'https://host.example.com', label: 'Old', serviceNpub: '' }],
    });
    fn({ url: 'https://host.example.com', label: 'New', serviceNpub: 'npub1svc' });
    expect(store.knownHosts).toHaveLength(1);
    expect(store.knownHosts[0].label).toBe('New');
  });

  it('addKnownHost strips trailing slashes', () => {
    const { fn, store } = bindMethod('addKnownHost', { knownHosts: [] });
    fn({ url: 'https://host.example.com///', label: 'Test', serviceNpub: '' });
    expect(store.knownHosts[0].url).toBe('https://host.example.com');
  });

  it('addKnownHost ignores empty URL', () => {
    const { fn, store } = bindMethod('addKnownHost', { knownHosts: [] });
    fn({ url: '', label: 'Test', serviceNpub: '' });
    expect(store.knownHosts).toHaveLength(0);
  });

  it('mergedHostsList includes defaults and custom', () => {
    const store = createStore({
      knownHosts: [{ url: 'https://custom.example.com', label: 'Custom', serviceNpub: '' }],
    });
    const merged = store.mergedHostsList;
    expect(merged.length).toBeGreaterThanOrEqual(2);
    expect(merged.some((h) => h.url === 'https://custom.example.com')).toBe(true);
  });

  it('mergedHostsList deduplicates by URL', () => {
    const store = createStore({
      knownHosts: [{ url: 'https://sb4.otherstuff.ai', label: 'Dup', serviceNpub: '' }],
    });
    const merged = store.mergedHostsList;
    const matchingUrls = merged.filter((h) => h.url === 'https://sb4.otherstuff.ai');
    expect(matchingUrls).toHaveLength(1);
  });
});

// --- toggleCvmSync ---
describe('toggleCvmSync', () => {
  it('toggles useCvmSync', () => {
    const { fn, store } = bindMethod('toggleCvmSync', { useCvmSync: false });
    fn();
    expect(store.useCvmSync).toBe(true);
    fn();
    expect(store.useCvmSync).toBe(false);
  });
});

// --- agent connect ---
describe('agent connect', () => {
  it('showAgentConnect sets modal state', () => {
    const { fn, store } = bindMethod('showAgentConnect', {
      showAvatarMenu: true,
      backendUrl: 'https://backend.example.com',
      session: { npub: 'npub1me' },
    });
    fn();
    expect(store.showAvatarMenu).toBe(false);
    expect(store.showAgentConnectModal).toBe(true);
    expect(store.agentConfigCopied).toBe(false);
    expect(store.agentConnectJson).toBeTruthy();
  });

  it('closeAgentConnect closes modal', () => {
    const { fn, store } = bindMethod('closeAgentConnect', {
      showAgentConnectModal: true,
    });
    fn();
    expect(store.showAgentConnectModal).toBe(false);
  });
});

// --- loadConnectWorkspaces ---
describe('loadConnectWorkspaces', () => {
  it('sets error when not signed in', async () => {
    const { fn, store } = bindMethod('loadConnectWorkspaces', { session: null });
    await fn();
    expect(store.connectWorkspacesError).toBe('Sign in first');
  });
});

// --- connectCreateWorkspace ---
describe('connectCreateWorkspace', () => {
  it('sets error when not signed in', async () => {
    const { fn, store } = bindMethod('connectCreateWorkspace', { session: null });
    await fn();
    expect(store.connectWorkspacesError).toBe('Sign in first');
  });

  it('sets error for empty name', async () => {
    const { fn, store } = bindMethod('connectCreateWorkspace', {
      session: { npub: 'npub1me' },
      connectNewWorkspaceName: '',
    });
    await fn();
    expect(store.connectWorkspacesError).toBe('Workspace name is required');
  });
});
