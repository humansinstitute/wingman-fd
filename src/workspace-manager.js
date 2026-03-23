/**
 * Workspace management methods extracted from app.js.
 *
 * The workspaceManagerMixin object contains methods and getters that use `this`
 * (the Alpine store) and should be spread into the store definition via applyMixins.
 */

import {
  getSettings,
  saveSettings,
  getWorkspaceSettings,
  getWorkspaceSettingsSnapshot,
  upsertWorkspaceSettings,
  openWorkspaceDb,
  deleteWorkspaceDb,
  clearRuntimeData,
  addPendingWrite,
  cacheStorageImage,
  evictStorageImageCache,
} from './db.js';
import {
  setBaseUrl,
  createWorkspace,
  getWorkspaces,
  recoverWorkspace,
  prepareStorageObject,
  uploadStorageObject,
  completeStorageObject,
} from './api.js';
import {
  mergeWorkspaceEntries,
  normalizeWorkspaceEntry,
  workspaceFromToken,
  slugify,
} from './workspaces.js';
import {
  toRaw,
  normalizeBackendUrl,
  workspaceSettingsRecordId,
  storageObjectIdFromRef,
  storageImageCacheKey,
} from './utils/state-helpers.js';
import {
  getPrivateGroupNpub as resolvePrivateGroupNpub,
  getPrivateGroupRef as resolvePrivateGroupRef,
  getWorkspaceSettingsGroupNpub as resolveWorkspaceSettingsGroupNpub,
  getWorkspaceSettingsGroupRef as resolveWorkspaceSettingsGroupRef,
} from './workspace-group-refs.js';
import {
  buildWrappedMemberKeys,
  createGroupIdentity,
} from './crypto/group-keys.js';
import { personalEncryptForNpub } from './auth/nostr.js';
import { outboundWorkspaceSettings, normalizeHarnessUrl } from './translators/settings.js';
import { buildStoragePrepareBody } from './storage-payloads.js';
import { buildSuperBasedConnectionToken } from './superbased-token.js';
import { flightDeckLog } from './logging.js';
import { DEFAULT_SUPERBASED_URL } from './app-identity.js';

export function guessDefaultBackendUrl() {
  return DEFAULT_SUPERBASED_URL || '';
}

// ---------------------------------------------------------------------------
// Mixin — methods and getters that use `this` (the Alpine store)
// ---------------------------------------------------------------------------

export const workspaceManagerMixin = {

  // --- computed getters ---

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

  get currentWorkspaceSlug() {
    return this.currentWorkspace?.slug || slugify(this.currentWorkspaceName) || 'workspace';
  },

  // --- workspace display ---

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

  // --- workspace switcher ---

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

    // Persist the new workspace selection, then navigate via slug URL so the
    // browser does a full reload into the new workspace context.
    const workspace = this.knownWorkspaces.find((w) => w.workspaceOwnerNpub === workspaceOwnerNpub);
    if (!workspace) return;
    this.currentWorkspaceOwnerNpub = workspace.workspaceOwnerNpub;
    this.superbasedTokenInput = workspace.connectionToken || this.superbasedTokenInput;
    this.backendUrl = normalizeBackendUrl(workspace.directHttpsUrl || this.backendUrl || guessDefaultBackendUrl());
    this.ownerNpub = workspace.workspaceOwnerNpub;
    setBaseUrl(this.backendUrl);
    await this.persistWorkspaceSettings();
    const slug = workspace.slug || slugify(workspace.name);
    const page = this.navSection === 'status' ? 'notifications' : (this.navSection || 'chat');
    window.location.href = `/${slug}/${page}${window.location.search}`;
  },

  // --- workspace list ---

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

  // --- workspace profile editing ---

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
    this.workspaceProfileSlugInput = String(workspace?.slug || '').trim() || slugify(workspace?.name);
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
    if (field === 'slug') this.workspaceProfileSlugInput = slugify(value);
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

  // --- workspace settings row ---

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

  // --- workspace settings persistence ---

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

      // Persist slug locally (not synced to Tower)
      const newSlug = String(this.workspaceProfileSlugInput || '').trim() || slugify(name);
      this.mergeKnownWorkspaces([{ workspaceOwnerNpub, slug: newSlug }]);

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

  // --- workspace CRUD ---

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
        evictStorageImageCache().catch(() => {});
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
};
