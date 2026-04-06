/**
 * Connection, settings, and agent-connect methods extracted from app.js.
 *
 * The connectSettingsManagerMixin object contains methods and getters that use `this`
 * (the Alpine store) and should be spread into the store definition via applyMixins.
 */

import {
  setBaseUrl,
  createWorkspace,
  getWorkspaces,
} from './api.js';
import {
  normalizeWorkspaceEntry,
  workspaceFromToken,
} from './workspaces.js';
import { normalizeBackendUrl } from './utils/state-helpers.js';
import { parseSuperBasedToken, buildSuperBasedConnectionToken } from './superbased-token.js';
import { buildAgentConnectPackage } from './agent-connect.js';
import { APP_NPUB, DEFAULT_SUPERBASED_URL } from './app-identity.js';
import {
  personalEncryptForNpub,
} from './auth/nostr.js';
import {
  buildWrappedMemberKeys,
  createGroupIdentity,
} from './crypto/group-keys.js';

const DEFAULT_KNOWN_HOSTS = [
  { url: 'https://sb4.otherstuff.ai', label: 'The Other Stuff — SuperBased', serviceNpub: '' },
];

// ---------------------------------------------------------------------------
// Mixin — methods and getters that use `this` (the Alpine store)
// ---------------------------------------------------------------------------

export const connectSettingsManagerMixin = {

  // --- settings ---

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

  async saveSettings() {
    setBaseUrl(this.backendUrl);
    await this.persistWorkspaceSettings();
    this.ensureBackgroundSync();
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

  // --- connection settings ---

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
        this.selectedWorkspaceKey = workspace.workspaceKey || '';
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
    if (this.selectedWorkspaceKey || this.currentWorkspaceOwnerNpub) {
      await this.selectWorkspace(this.selectedWorkspaceKey || this.currentWorkspaceOwnerNpub);
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

  toggleCvmSync() {
    this.useCvmSync = !this.useCvmSync;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('use_cvm_sync', this.useCvmSync ? 'true' : 'false');
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
    this.selectedWorkspaceKey = workspace.workspaceKey || '';
    this.showConnectModal = false;
    await this.selectWorkspace(workspace.workspaceKey || workspace.workspaceOwnerNpub);
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
      const adminGroupIdentity = createGroupIdentity();
      const privateGroupIdentity = createGroupIdentity();
      const wrappedWorkspaceNsec = await personalEncryptForNpub(memberNpub, workspaceIdentity.nsec);
      const defaultGroupMemberKeys = await buildWrappedMemberKeys(defaultGroupIdentity, [memberNpub], memberNpub);
      const adminGroupMemberKeys = await buildWrappedMemberKeys(adminGroupIdentity, [memberNpub], memberNpub);
      const privateGroupMemberKeys = await buildWrappedMemberKeys(privateGroupIdentity, [memberNpub], memberNpub);
      const response = await createWorkspace({
        workspace_owner_npub: workspaceIdentity.npub, name,
        description: String(this.connectNewWorkspaceDescription || '').trim(),
        wrapped_workspace_nsec: wrappedWorkspaceNsec, wrapped_by_npub: memberNpub,
        default_group_npub: defaultGroupIdentity.npub, default_group_name: `${name} Shared`,
        default_group_member_keys: defaultGroupMemberKeys,
        admin_group_npub: adminGroupIdentity.npub, admin_group_name: 'Workspace Admins',
        admin_group_member_keys: adminGroupMemberKeys,
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
      await this.selectWorkspace(workspace.workspaceKey || workspace.workspaceOwnerNpub);
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

  // --- known hosts ---

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

  // --- agent connect ---

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
};
