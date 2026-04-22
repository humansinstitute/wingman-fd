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
  getAgentChatTrigger,
  upsertWorkspaceSettings,
  upsertAgentChatTrigger,
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
  updateWorkspace,
  prepareStorageObject,
  uploadStorageObject,
  completeStorageObject,
  getGroupKeys,
} from './api.js';
import {
  findWorkspaceByKey,
  mergeWorkspaceEntries,
  normalizeWorkspaceEntry,
  workspaceFromToken,
  slugify,
} from './workspaces.js';
import {
  toRaw,
  normalizeBackendUrl,
  workspaceSettingsRecordId,
  agentChatTriggerRecordId,
  storageObjectIdFromRef,
  storageImageCacheKey,
} from './utils/state-helpers.js';
import {
  getWorkspaceAdminGroupNpub as resolveWorkspaceAdminGroupNpub,
  getWorkspaceAdminGroupRef as resolveWorkspaceAdminGroupRef,
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
import { outboundAgentChatTrigger } from './translators/agent-chat-trigger.js';
import { buildStoragePrepareBody } from './storage-payloads.js';
import { buildSuperBasedConnectionToken } from './superbased-token.js';
import { flightDeckLog } from './logging.js';
import { DEFAULT_SUPERBASED_URL } from './app-identity.js';

function clean(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

export function findAgentChatTriggerTargetGroup(groups = [], trigger = {}) {
  const targetGroupId = clean(trigger?.target_group_id);
  const targetGroupNpub = clean(trigger?.target_group_npub);
  if (!targetGroupId && !targetGroupNpub) return null;
  return (groups || []).find((group) => (
    clean(group?.group_id) === targetGroupId
    || clean(group?.group_npub) === targetGroupNpub
  )) || null;
}

function normalizeWrappedGroupKeyEntry(entry = {}) {
  return {
    group_id: clean(entry.group_id),
    group_npub: clean(entry.group_npub),
    key_version: Number(
      entry.key_version
      ?? entry.group_epoch
      ?? entry.current_epoch
      ?? 1
    ) || 1,
  };
}

export function evaluateAgentChatTargetMemberKeys(group, keyEntries = []) {
  const targetGroupId = clean(group?.group_id);
  const targetGroupNpub = clean(group?.group_npub);
  const currentEpoch = Number(group?.current_epoch || 1) || 1;
  const relevantKeys = (keyEntries || [])
    .map((entry) => normalizeWrappedGroupKeyEntry(entry))
    .filter((entry) => (
      (targetGroupId && entry.group_id === targetGroupId)
      || (targetGroupNpub && entry.group_npub === targetGroupNpub)
    ));

  const latestKeyVersion = relevantKeys.reduce((latest, entry) => (
    Math.max(latest, Number(entry.key_version || 0) || 0)
  ), 0);
  const hasCurrentEpoch = relevantKeys.some((entry) => Number(entry.key_version || 0) >= currentEpoch);
  const hasCurrentIdentity = !targetGroupNpub || relevantKeys.some((entry) => !entry.group_npub || entry.group_npub === targetGroupNpub);

  if (relevantKeys.length === 0) {
    return {
      status: 'missing',
      summary: 'No wrapped key is visible for this group.',
      detail: 'The member is listed in the target group but has no matching wrapped key entry.',
      latest_key_version: null,
      current_epoch: currentEpoch,
      relevant_key_count: 0,
    };
  }

  if (hasCurrentEpoch && hasCurrentIdentity) {
    return {
      status: 'healthy',
      summary: `Wrapped keys include the current group epoch (${currentEpoch}).`,
      detail: 'This member should be decrypt-capable for the selected target group.',
      latest_key_version: latestKeyVersion || currentEpoch,
      current_epoch: currentEpoch,
      relevant_key_count: relevantKeys.length,
    };
  }

  if (!hasCurrentEpoch) {
    return {
      status: 'stale',
      summary: `Wrapped keys stop at epoch ${latestKeyVersion || 0}, but the group is at epoch ${currentEpoch}.`,
      detail: 'Rotate or reprovision wrapped keys for this member before relying on Agent Chat.',
      latest_key_version: latestKeyVersion || null,
      current_epoch: currentEpoch,
      relevant_key_count: relevantKeys.length,
    };
  }

  return {
    status: 'stale',
    summary: 'Wrapped keys are present but do not include the current group identity.',
    detail: 'The member may still be holding only an older group npub after rotation.',
    latest_key_version: latestKeyVersion || null,
    current_epoch: currentEpoch,
    relevant_key_count: relevantKeys.length,
  };
}

export function guessDefaultBackendUrl() {
  return DEFAULT_SUPERBASED_URL || '';
}

function uniqueCleanValues(values = []) {
  return [...new Set((values || []).map((value) => clean(value)).filter(Boolean))];
}

// ---------------------------------------------------------------------------
// Mixin — methods and getters that use `this` (the Alpine store)
// ---------------------------------------------------------------------------

export const workspaceManagerMixin = {

  // --- computed getters ---

  get currentWorkspaceKey() {
    return this.currentWorkspace?.workspaceKey || this.selectedWorkspaceKey || '';
  },

  get workspaceOwnerNpub() {
    return this.currentWorkspace?.workspaceOwnerNpub
      || this.currentWorkspaceOwnerNpub
      || this.superbasedConnectionConfig?.workspaceOwnerNpub
      || this.ownerNpub
      || this.session?.npub
      || '';
  },

  get currentWorkspace() {
    return findWorkspaceByKey(this.knownWorkspaces, this.selectedWorkspaceKey)
      || this.knownWorkspaces.find((workspace) => workspace.workspaceOwnerNpub === this.currentWorkspaceOwnerNpub)
      || null;
  },

  get activeWorkspaceOwnerNpub() {
    return this.currentWorkspace?.workspaceOwnerNpub || this.currentWorkspaceOwnerNpub || '';
  },

  get isWorkspaceSwitching() {
    return Boolean(this.workspaceSwitchPendingKey || this.workspaceSwitchPendingNpub);
  },

  get currentWorkspaceName() {
    if (this.currentWorkspace?.name) return this.currentWorkspace.name;
    if (this.activeWorkspaceOwnerNpub) return 'Workspace';
    return 'No workspace selected';
  },

  get currentWorkspaceMeta() {
    if (this.isWorkspaceSwitching) {
      const pendingWorkspace = this.getWorkspaceByKey(this.workspaceSwitchPendingKey)
        || this.getWorkspaceByOwner(this.workspaceSwitchPendingNpub);
      const fallbackLabel = pendingWorkspace?.workspaceOwnerNpub || this.workspaceSwitchPendingNpub;
      return `Switching to ${pendingWorkspace?.name || this.getShortNpub(fallbackLabel) || 'workspace'}...`;
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
    const towerName = String(
      this.currentWorkspace?.towerName
      || this.superbasedConnectionConfig?.towerName
      || ''
    ).trim();
    if (towerName) return towerName;
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

  get currentWorkspaceContentGroups() {
    return this.currentWorkspaceGroups.filter((group) => group.group_kind !== 'workspace_admin');
  },

  get agentChatTriggerTargetGroup() {
    return findAgentChatTriggerTargetGroup(this.currentWorkspaceGroups, {
      target_group_id: this.agentChatTriggerTargetGroupId,
      target_group_npub: this.agentChatTriggerTargetGroupNpub,
    });
  },

  get agentChatTriggerGroupOptions() {
    return this.currentWorkspaceGroups.map((group) => ({
      id: group.group_id || group.group_npub,
      label: group.name || this.getShortNpub(group.group_id || group.group_npub),
      subtitle: `${(group.member_npubs || []).length} member${(group.member_npubs || []).length === 1 ? '' : 's'}`,
      group_kind: group.group_kind || 'shared',
    }));
  },

  get agentChatTriggerConfigured() {
    return Boolean(this.agentChatTriggerRecordId);
  },

  get agentChatTriggerStatus() {
    if (!this.agentChatTriggerConfigured) return 'unconfigured';
    if (!this.agentChatTriggerTargetGroup && (this.agentChatTriggerTargetGroupId || this.agentChatTriggerTargetGroupNpub)) {
      return 'invalid';
    }
    return this.agentChatTriggerEnabled ? 'enabled' : 'disabled';
  },

  get canAdminWorkspace() {
    const viewerNpub = String(this.session?.npub || '').trim();
    if (!viewerNpub || !this.currentWorkspace) return false;
    if (String(this.currentWorkspace.creatorNpub || '').trim() === viewerNpub) return true;
    return this.currentWorkspaceGroups.some((group) =>
      group.group_kind === 'workspace_admin'
      && Array.isArray(group.member_npubs)
      && group.member_npubs.includes(viewerNpub)
    );
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

  isProtectedWorkspaceGroup(groupOrId) {
    const group = typeof groupOrId === 'object' && groupOrId
      ? groupOrId
      : this.groups.find((item) => item.group_id === groupOrId || item.group_npub === groupOrId);
    return ['workspace_shared', 'workspace_admin', 'private'].includes(String(group?.group_kind || '').trim());
  },

  normalizeSettingsTab() {
    const visibleTabs = this.canAdminWorkspace
      ? ['workspace', 'connection', 'automation', 'data', 'sharing']
      : ['connection', 'data'];
    if (!visibleTabs.includes(this.settingsTab)) {
      this.settingsTab = 'connection';
    }
  },

  agentChatTriggerStatusLabel(status = this.agentChatTriggerStatus) {
    if (status === 'enabled') return 'Legacy record present';
    if (status === 'disabled') return 'Legacy record paused';
    if (status === 'invalid') return 'Legacy record invalid';
    return 'No workspace record';
  },

  agentChatTriggerDiagnosticLabel(status) {
    if (status === 'healthy') return 'Healthy';
    if (status === 'missing') return 'Missing keys';
    if (status === 'stale') return 'Stale keys';
    if (status === 'error') return 'Check failed';
    return 'Unknown';
  },

  agentChatTargetGroupLabel(group = this.agentChatTriggerTargetGroup) {
    if (group?.name) return group.name;
    return group?.group_npub
      || group?.group_id
      || this.agentChatTriggerTargetGroupNpub
      || this.agentChatTriggerTargetGroupId
      || 'No target group selected';
  },

  agentChatTargetGroupDetail(group = this.agentChatTriggerTargetGroup) {
    if (!group) {
      if (this.agentChatTriggerConfigured && (this.agentChatTriggerTargetGroupId || this.agentChatTriggerTargetGroupNpub)) {
        return 'The saved workspace group reference is no longer visible, so Flight Deck can only show limited diagnostics.';
      }
      return 'No legacy workspace group record is available to inspect here.';
    }

    const memberCount = Array.isArray(group.member_npubs) ? group.member_npubs.length : 0;
    const kind = String(group.group_kind || '').trim();
    const kindLabel = kind === 'private'
      ? 'Private group'
      : kind === 'workspace_admin'
        ? 'Workspace admin group'
        : kind === 'workspace_shared'
          ? 'Workspace shared group'
          : 'Shared group';
    return `${memberCount} member${memberCount === 1 ? '' : 's'} · ${kindLabel}`;
  },

  agentChatTriggerValidationHeadline() {
    if (!this.agentChatTriggerConfigured) return 'Not required';
    if (this.agentChatTriggerStatus === 'invalid') return 'Needs review';
    return 'Passive only';
  },

  agentChatTriggerValidationDetail() {
    if (!this.agentChatTriggerConfigured) {
      return 'Flight Deck no longer needs a saved workspace record for normal local Agent Chat routing. Wingmen owns local agent registration and routing.';
    }
    if (this.agentChatTriggerStatus === 'invalid') {
      return 'The saved workspace record points at a group Flight Deck can no longer inspect. That limits passive diagnostics here, but local Wingmen routing does not depend on this record.';
    }
    if (!this.agentChatTriggerEnabled) {
      return 'This saved workspace record is paused. Flight Deck keeps it visible for compatibility checks only; local Wingmen routing may still be active through agent registration.';
    }
    return 'This saved workspace record is visible for compatibility and diagnostics only. Wingmen remains the local runtime control plane.';
  },

  formatAgentChatParticipantNames(npubs = [], maxNames = 2) {
    const uniqueNpubs = uniqueCleanValues(npubs);
    if (uniqueNpubs.length === 0) return '';
    const names = uniqueNpubs.map((npub) => this.getSenderName(npub) || this.getShortNpub(npub) || npub);
    const visible = names.slice(0, Math.max(1, Number(maxNames || 0) || 2));
    const remaining = names.length - visible.length;
    if (remaining <= 0) return visible.join(', ');
    if (visible.length === 1) return `${visible[0]} and ${remaining} more`;
    return `${visible.join(', ')} and ${remaining} more`;
  },

  get agentChatKnownBotNpubs() {
    return uniqueCleanValues([this.botNpub, this.defaultAgentNpub]);
  },

  isKnownAgentChatBotNpub(npub) {
    const memberNpub = clean(npub);
    if (!memberNpub) return false;
    return this.agentChatKnownBotNpubs.includes(memberNpub);
  },

  get agentChatTargetBotMemberNpubs() {
    const targetGroup = this.agentChatTriggerTargetGroup;
    if (!targetGroup) return [];
    const targetMemberNpubs = new Set(uniqueCleanValues(targetGroup.member_npubs || []));
    return this.agentChatKnownBotNpubs.filter((npub) => targetMemberNpubs.has(npub));
  },

  get agentChatTargetBotDiagnostics() {
    const diagMap = new Map(
      (this.agentChatTriggerDiagnostics || [])
        .map((diag) => [clean(diag?.member_npub), diag])
        .filter(([memberNpub]) => Boolean(memberNpub))
    );
    return this.agentChatTargetBotMemberNpubs
      .map((memberNpub) => diagMap.get(memberNpub) || (
        this.agentChatTriggerDiagnosticsLoading
          ? null
          : {
            member_npub: memberNpub,
            status: 'error',
            summary: 'No wrapped-key diagnostic is available for this bot yet.',
            detail: 'Refresh diagnostics after Tower is reachable.',
          }
      ))
      .filter(Boolean);
  },

  get agentChatDiagnosticsScopeNote() {
    if (this.agentChatKnownBotNpubs.length === 0) {
      return 'These checks are informative only. Add a local bot or default agent if you want Flight Deck to compare the saved workspace record against known bot identities here.';
    }
    return 'These checks are informative only. Flight Deck can inspect a saved workspace record, configured bot membership, and wrapped-key readiness here. Wingmen agent registration and runtime subscription state live elsewhere.';
  },

  get agentChatOperatorWarnings() {
    if (!this.agentChatTriggerConfigured) return [];

    const warnings = [];
    const targetGroup = this.agentChatTriggerTargetGroup;
    const targetGroupLabel = this.agentChatTargetGroupLabel(targetGroup);
    const configuredBotNpubs = this.agentChatKnownBotNpubs;
    const configuredBotNames = this.formatAgentChatParticipantNames(configuredBotNpubs, 3) || 'configured bots';

    if (this.agentChatTriggerStatus === 'invalid') {
      warnings.push({
        code: 'invalid-group',
        kind: 'Saved record',
        severity: 'error',
        title: 'Saved workspace group is no longer visible',
        summary: `The saved workspace Agent Chat record points at ${this.agentChatTriggerTargetGroupNpub || this.agentChatTriggerTargetGroupId || 'a group'} that is no longer visible in this workspace.`,
        action: 'If you still need this record for compatibility checks, repair or remove it in the owning system. Local Wingmen routing does not depend on it.',
      });
      return warnings;
    }

    if (!targetGroup) return warnings;

    if (configuredBotNpubs.length === 0) {
      warnings.push({
        code: 'bot-verification-unconfigured',
        kind: 'Passive diagnostics',
        severity: 'warning',
        title: 'No configured bot identity is available for verification',
        summary: `Flight Deck cannot compare ${targetGroupLabel} with a local bot identity because no local bot or default agent is configured here.`,
        action: 'Configure a local bot identity only if you want membership-specific diagnostics in Flight Deck. Wingmen routing itself is owned elsewhere.',
      });
      return warnings;
    }

    if (this.agentChatTargetBotMemberNpubs.length === 0) {
      warnings.push({
        code: 'no-bot-members',
        kind: 'Membership',
        severity: 'error',
        title: 'No configured bot is in the target group',
        summary: `Flight Deck checked ${configuredBotNames}. None of them are members of ${targetGroupLabel}.`,
        action: `If you expect this saved record to explain current replies, verify bot membership and agent registration in Wingmen or repair the legacy group reference outside Flight Deck.`,
      });
      return warnings;
    }

    const botDiagnostics = this.agentChatTargetBotDiagnostics;
    const unhealthyBotDiagnostics = botDiagnostics.filter((diag) => diag.status !== 'healthy');
    if (unhealthyBotDiagnostics.length === 0) return warnings;

    const missingLike = unhealthyBotDiagnostics.filter((diag) => diag.status === 'missing' || diag.status === 'error');
    const stale = unhealthyBotDiagnostics.filter((diag) => diag.status === 'stale');
    const affectedNames = this.formatAgentChatParticipantNames(
      unhealthyBotDiagnostics.map((diag) => diag.member_npub),
      3,
    ) || 'Affected bots';
    const issueBits = [];
    if (missingLike.length > 0) {
      issueBits.push(`${missingLike.length} missing or unreadable`);
    }
    if (stale.length > 0) {
      issueBits.push(`${stale.length} stale`);
    }
    const issueSummary = issueBits.join(', ');

    warnings.push({
      code: unhealthyBotDiagnostics.length === botDiagnostics.length ? 'bot-keys-blocked' : 'bot-keys-degraded',
      kind: 'Wrapped keys',
      severity: unhealthyBotDiagnostics.length === botDiagnostics.length ? 'error' : 'warning',
      title: unhealthyBotDiagnostics.length === botDiagnostics.length
        ? 'No target-group bot is decrypt-ready'
        : 'Some bot members need wrapped-key repair',
      summary: `${affectedNames} ${unhealthyBotDiagnostics.length === 1 ? 'has' : 'have'} ${issueSummary} wrapped-key state for ${targetGroupLabel}.`,
      action: `Repair the affected bot's wrapped keys, then refresh diagnostics. This affects decryptability, not whether Flight Deck owns routing policy.`,
    });

    return warnings;
  },

  // --- workspace display ---

  getWorkspaceByOwner(workspaceOwnerNpub) {
    if (!workspaceOwnerNpub) return null;
    return this.knownWorkspaces.find((entry) => entry.workspaceOwnerNpub === workspaceOwnerNpub) || null;
  },

  getWorkspaceByKey(workspaceKey) {
    return findWorkspaceByKey(this.knownWorkspaces, workspaceKey);
  },

  getWorkspaceDisplayEntry(workspace) {
    const workspaceKey = typeof workspace === 'string' ? workspace : workspace?.workspaceKey || '';
    const workspaceOwnerNpub = typeof workspace === 'string' ? '' : workspace?.workspaceOwnerNpub || '';
    const known = this.getWorkspaceByKey(workspaceKey)
      || this.getWorkspaceByOwner(workspaceOwnerNpub)
      || (typeof workspace === 'object' ? workspace : null)
      || {};
    const profile = this.workspaceProfileRowsByKey?.[known.workspaceKey || workspaceKey] || {};
    return {
      ...profile,
      ...known,
      workspaceKey: known.workspaceKey || workspaceKey,
      workspaceOwnerNpub: known.workspaceOwnerNpub || workspaceOwnerNpub,
      name: String(known?.name || '').trim() || String(profile?.name || '').trim(),
      description: String(known?.description || '').trim() || String(profile?.description || '').trim(),
      avatarUrl: String(known?.avatarUrl || '').trim() || String(profile?.avatarUrl || '').trim() || null,
      slug: String(known?.slug || '').trim() || String(profile?.slug || '').trim() || '',
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
    if (entry?.workspaceKey && entry.workspaceKey === this.currentWorkspaceKey) {
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
      const knownFailure = this.getStorageImageFailure?.(cacheKey);
      if (!knownFailure) {
        this.resolveStorageImageUrl(storedObjectId, { backendUrl }).catch(() => {});
      }
    } else if (storedAvatar) {
      return storedAvatar;
    }
    if (workspaceOwnerNpub) {
      void this.ensureWorkspaceProfileHydrated(entry?.workspaceKey || workspaceOwnerNpub);
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

  async handleWorkspaceSwitcherSelect(workspaceKeyOrOwner) {
    if (!workspaceKeyOrOwner || this.isWorkspaceSwitching) return;
    const workspace = this.getWorkspaceByKey(workspaceKeyOrOwner) || this.getWorkspaceByOwner(workspaceKeyOrOwner);
    if (!workspace) return;
    if (workspace.workspaceKey === this.currentWorkspaceKey) {
      this.closeWorkspaceSwitcherMenu();
      return;
    }
    // Keep the switcher visible during the switch so the user sees progress.
    this.workspaceSwitchPendingKey = workspace.workspaceKey || '';
    this.workspaceSwitchPendingNpub = workspace.workspaceOwnerNpub || '';
    this.mobileNavOpen = false;

    // Persist the new workspace selection, then navigate via slug URL so the
    // browser does a full reload into the new workspace context.
    this.selectedWorkspaceKey = workspace.workspaceKey || '';
    this.currentWorkspaceOwnerNpub = workspace.workspaceOwnerNpub;
    this.superbasedTokenInput = workspace.connectionToken || this.superbasedTokenInput;
    this.backendUrl = normalizeBackendUrl(workspace.directHttpsUrl || this.backendUrl || guessDefaultBackendUrl());
    this.ownerNpub = workspace.workspaceOwnerNpub;
    setBaseUrl(this.backendUrl);
    await this.persistWorkspaceSettings();
    const slug = workspace.slug || slugify(workspace.name);
    const page = this.navSection === 'status' ? 'flight-deck' : (this.navSection || 'flight-deck');
    const nextUrl = new URL(window.location.href);
    nextUrl.pathname = `/${slug}/${page}`;
    nextUrl.searchParams.set('workspacekey', workspace.workspaceKey || '');
    window.location.href = `${nextUrl.pathname}${nextUrl.search}`;
  },

  // --- workspace list ---

  mergeKnownWorkspaces(entries = []) {
    this.knownWorkspaces = mergeWorkspaceEntries(this.knownWorkspaces, entries);
    this.syncWorkspaceProfileDraft();
  },

  async hydrateKnownWorkspaceProfiles() {
    // Canonical workspace metadata now comes from the workspace API route,
    // not the shared workspace_settings record family.
  },

  async ensureWorkspaceProfileHydrated(workspaceKeyOrOwner) {
    const existing = this.getWorkspaceByKey(workspaceKeyOrOwner) || this.getWorkspaceByOwner(workspaceKeyOrOwner);
    const workspaceKey = String(existing?.workspaceKey || '').trim();
    if (!workspaceKey) return;
    if (!this._workspaceProfileHydratedKeys) this._workspaceProfileHydratedKeys = new Set();
    this._workspaceProfileHydratedKeys.add(workspaceKey);
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
    if (overwriteInput || !this.wingmanHarnessDirty) {
      this.wingmanHarnessInput = this.workspaceHarnessUrl;
      this.wingmanHarnessDirty = false;
    }
  },

  applyAgentChatTriggerRow(row) {
    if (!row || row.record_state === 'deleted') {
      this.agentChatTriggerRecordId = '';
      this.agentChatTriggerVersion = 0;
      this.agentChatTriggerGroupIds = [];
      this.agentChatTriggerEnabled = true;
      this.agentChatTriggerTargetGroupId = '';
      this.agentChatTriggerTargetGroupNpub = '';
      this.agentChatTriggerUpdatedAt = '';
      this.agentChatTriggerDiagnostics = [];
      this.agentChatTriggerDiagnosticsError = null;
      this.agentChatTriggerDiagnosticsLoading = false;
      return;
    }

    this.agentChatTriggerRecordId = row.record_id || '';
    this.agentChatTriggerVersion = Number(row.version || 0);
    this.agentChatTriggerGroupIds = Array.isArray(row.group_ids) ? [...row.group_ids] : [];
    this.agentChatTriggerEnabled = row.enabled !== false;
    this.agentChatTriggerTargetGroupId = row.target_group_id || '';
    this.agentChatTriggerTargetGroupNpub = row.target_group_npub || '';
    this.agentChatTriggerUpdatedAt = row.updated_at || '';
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

  async refreshAgentChatTrigger(options = {}) {
    const workspaceOwnerNpub = this.workspaceOwnerNpub;
    if (!workspaceOwnerNpub) {
      this.applyAgentChatTriggerRow(null);
      return null;
    }

    const row = await getAgentChatTrigger(workspaceOwnerNpub);
    this.applyAgentChatTriggerRow(row);
    if (options.refreshDiagnostics !== false) {
      await this.refreshAgentChatTriggerDiagnostics();
    }
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

  getWorkspaceAdminGroupNpub() {
    return resolveWorkspaceAdminGroupNpub({
      currentWorkspace: this.currentWorkspace,
    });
  },

  getWorkspaceAdminGroupRef() {
    return resolveWorkspaceAdminGroupRef({
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
      currentWorkspaceKey: this.currentWorkspaceKey || '',
      currentWorkspaceOwnerNpub: this.currentWorkspaceOwnerNpub || '',
      defaultAgentNpub: this.defaultAgentNpub || '',
    });
  },

  async uploadWorkspaceAvatarFile(file) {
    const workspaceOwnerNpub = this.workspaceOwnerNpub;
    if (!workspaceOwnerNpub) {
      throw new Error('Select a workspace first');
    }
    if (!this.canAdminWorkspace) {
      throw new Error('Only workspace admins can update the workspace avatar.');
    }
    if (!file || !String(file.type || '').startsWith('image/')) {
      throw new Error('Choose an image file for the workspace avatar.');
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const settingsGroupId = this.getWorkspaceAdminGroupRef();
    if (!settingsGroupId) {
      throw new Error('Workspace admin group is not configured yet.');
    }
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
    if (!this.canAdminWorkspace) {
      this.workspaceProfileError = 'Only workspace admins can update the workspace profile.';
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
      const description = String(this.workspaceProfileDescriptionInput || '').trim();
      const newSlug = String(this.workspaceProfileSlugInput || '').trim() || slugify(name);
      const currentSlug = String(workspace.slug || '').trim() || slugify(workspace.name);
      if (
        newSlug !== currentSlug
        && typeof window !== 'undefined'
        && !window.confirm(
          `Change the workspace URL slug from "${currentSlug}" to "${newSlug}"?\n\nExisting bookmarked links will break.`,
        )
      ) {
        return;
      }

      const response = await updateWorkspace(workspaceOwnerNpub, {
        name,
        slug: newSlug,
        description,
        avatar_url: avatarUrl,
      });
      const savedSlug = String(response?.slug || '').trim() || newSlug;
      this.workspaceProfileRowsByKey = {
        ...(this.workspaceProfileRowsByKey || {}),
        [workspace.workspaceKey]: {
          ...(this.workspaceProfileRowsByKey?.[workspace.workspaceKey] || {}),
          workspaceKey: workspace.workspaceKey,
          workspaceOwnerNpub,
          name: response?.name ?? name,
          description: response?.description ?? description,
          avatarUrl: response?.avatar_url ?? avatarUrl,
          slug: savedSlug,
        },
      };
      this.mergeKnownWorkspaces([{
        workspaceKey: workspace.workspaceKey,
        workspaceOwnerNpub,
        name: response?.name ?? name,
        description: response?.description ?? description,
        avatarUrl: response?.avatar_url ?? avatarUrl,
        slug: savedSlug,
      }]);
      await this.persistWorkspaceSettings();
      this.syncWorkspaceProfileDraft({ force: true });
    } catch (error) {
      this.workspaceProfileError = error?.message || 'Failed to save workspace profile';
    } finally {
      this.workspaceProfileSaving = false;
    }
  },

  async saveHarnessSettings({ triggerOnly = false } = {}) {
    if (!triggerOnly) this.wingmanHarnessError = null;
    if (!this.canAdminWorkspace) {
      const msg = 'Only workspace admins can update shared automation settings.';
      if (triggerOnly) throw new Error(msg);
      this.wingmanHarnessError = msg;
      return;
    }
    if (!this.session?.npub) {
      const msg = 'Sign in first';
      if (triggerOnly) throw new Error(msg);
      this.wingmanHarnessError = msg;
      return;
    }

    const workspaceOwnerNpub = this.workspaceOwnerNpub;
    if (!workspaceOwnerNpub) {
      const msg = 'Select a workspace first';
      if (triggerOnly) throw new Error(msg);
      this.wingmanHarnessError = msg;
      return;
    }

    let normalizedUrl;
    if (triggerOnly) {
      // When saving triggers, use the stored harness URL, not the input field
      normalizedUrl = this.workspaceHarnessUrl || '';
    } else {
      const rawInput = String(this.wingmanHarnessInput || '').trim();
      normalizedUrl = rawInput ? normalizeHarnessUrl(rawInput) : '';
      if (rawInput && !normalizedUrl) {
        this.wingmanHarnessError = 'Enter a valid harness hostname or URL';
        return;
      }
    }

    const now = new Date().toISOString();
    const writeGroupRef = this.getWorkspaceAdminGroupRef();
    if (!writeGroupRef) {
      const msg = 'Workspace admin group is not configured yet.';
      if (triggerOnly) throw new Error(msg);
      this.wingmanHarnessError = msg;
      return;
    }
    const groupIds = [writeGroupRef];
    const nextVersion = Math.max(1, Number(this.workspaceSettingsVersion || 0) + 1);
    const recordId = this.workspaceSettingsRecordId || workspaceSettingsRecordId(workspaceOwnerNpub);

    // Preserve workspace profile fields so a harness/trigger save doesn't blank them
    const existing = await getWorkspaceSettings(workspaceOwnerNpub);
    const workspaceName = existing?.workspace_name ?? String(this.workspaceProfileNameInput || '').trim();
    const workspaceDescription = existing?.workspace_description ?? String(this.workspaceProfileDescriptionInput || '').trim();
    const workspaceAvatarUrl = (existing?.workspace_avatar_url ?? String(this.workspaceProfileAvatarInput || '').trim()) || null;

    const localRow = {
      workspace_owner_npub: workspaceOwnerNpub,
      record_id: recordId,
      owner_npub: workspaceOwnerNpub,
      workspace_name: workspaceName,
      workspace_description: workspaceDescription,
      workspace_avatar_url: workspaceAvatarUrl,
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
      workspace_name: workspaceName,
      workspace_description: workspaceDescription,
      workspace_avatar_url: workspaceAvatarUrl,
      wingman_harness_url: normalizedUrl,
      triggers: toRaw(this.workspaceTriggers || []),
      group_ids: groupIds,
      version: nextVersion,
      previous_version: Math.max(0, nextVersion - 1),
      signature_npub: this.session.npub,
      write_group_ref: writeGroupRef,
    });
    await addPendingWrite({
      record_id: recordId,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });
    // Perform immediate sync so the caller gets feedback on push failures.
    // If sync fails, the pending write remains in Dexie for the next cycle.
    try {
      await this.flushAndBackgroundSync();
    } catch (syncError) {
      flightDeckLog('warn', 'settings', 'harness settings sync failed, will retry', {
        error: syncError?.message || String(syncError),
      });
    }
    await this.refreshSyncStatus();
    this.ensureBackgroundSync(true);
  },

  async saveAgentChatTrigger() {
    this.agentChatTriggerError = null;
    this.agentChatTriggerSuccess = null;

    if (!this.canAdminWorkspace) {
      this.agentChatTriggerError = 'Only workspace admins can update the Agent Chat trigger.';
      return;
    }
    if (!this.session?.npub) {
      this.agentChatTriggerError = 'Sign in first';
      return;
    }

    const workspaceOwnerNpub = this.workspaceOwnerNpub;
    if (!workspaceOwnerNpub) {
      this.agentChatTriggerError = 'Select a workspace first';
      return;
    }

    const targetGroup = findAgentChatTriggerTargetGroup(this.currentWorkspaceGroups, {
      target_group_id: this.agentChatTriggerTargetGroupId,
      target_group_npub: this.agentChatTriggerTargetGroupNpub,
    }) || this.currentWorkspaceGroups.find((group) => (
      clean(group?.group_id) === clean(this.agentChatTriggerTargetGroupId)
      || clean(group?.group_npub) === clean(this.agentChatTriggerTargetGroupId)
    ));

    if (!targetGroup?.group_id && !targetGroup?.group_npub) {
      this.agentChatTriggerError = 'Select a target group for Agent Chat.';
      return;
    }

    const now = new Date().toISOString();
    const writeGroupRef = this.getWorkspaceAdminGroupRef();
    if (!writeGroupRef) {
      this.agentChatTriggerError = 'Workspace admin group is not configured yet.';
      return;
    }
    const groupIds = [writeGroupRef];
    const nextVersion = Math.max(1, Number(this.agentChatTriggerVersion || 0) + 1);
    const recordId = this.agentChatTriggerRecordId || agentChatTriggerRecordId(workspaceOwnerNpub);

    const localRow = {
      workspace_owner_npub: workspaceOwnerNpub,
      record_id: recordId,
      owner_npub: workspaceOwnerNpub,
      type: 'agent_chat_trigger_v1',
      enabled: this.agentChatTriggerEnabled !== false,
      scope: 'workspace',
      target_group_id: targetGroup.group_id || null,
      target_group_npub: targetGroup.group_npub || null,
      group_ids: groupIds,
      sync_status: 'pending',
      record_state: 'active',
      version: nextVersion,
      updated_at: now,
    };

    await upsertAgentChatTrigger(localRow);
    this.applyAgentChatTriggerRow(localRow);

    const envelope = await outboundAgentChatTrigger({
      record_id: recordId,
      owner_npub: workspaceOwnerNpub,
      workspace_owner_npub: workspaceOwnerNpub,
      enabled: this.agentChatTriggerEnabled !== false,
      scope: 'workspace',
      target_group_id: targetGroup.group_id || null,
      target_group_npub: targetGroup.group_npub || null,
      group_ids: groupIds,
      version: nextVersion,
      previous_version: Math.max(0, nextVersion - 1),
      signature_npub: this.session.npub,
      write_group_ref: writeGroupRef,
      updated_at: now,
    });
    await addPendingWrite({
      record_id: recordId,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });

    try {
      await this.flushAndBackgroundSync();
    } catch (syncError) {
      flightDeckLog('warn', 'agent-chat-trigger', 'trigger sync failed, will retry', {
        error: syncError?.message || String(syncError),
      });
    }

    await this.refreshSyncStatus();
    this.ensureBackgroundSync(true);
    await this.refreshAgentChatTriggerDiagnostics();
    this.agentChatTriggerSuccess = 'Agent Chat trigger saved.';
    setTimeout(() => {
      if (this.agentChatTriggerSuccess === 'Agent Chat trigger saved.') {
        this.agentChatTriggerSuccess = null;
      }
    }, 3000);
  },

  async refreshAgentChatTriggerDiagnostics() {
    const requestId = Number(this._agentChatTriggerDiagnosticsRequestId || 0) + 1;
    this._agentChatTriggerDiagnosticsRequestId = requestId;
    this.agentChatTriggerDiagnosticsError = null;

    if (!this.canAdminWorkspace) {
      this.agentChatTriggerDiagnostics = [];
      this.agentChatTriggerDiagnosticsLoading = false;
      return [];
    }

    if (!this.agentChatTriggerConfigured) {
      this.agentChatTriggerDiagnostics = [];
      this.agentChatTriggerDiagnosticsLoading = false;
      return [];
    }

    const targetGroup = this.agentChatTriggerTargetGroup;
    if (!targetGroup) {
      this.agentChatTriggerDiagnostics = [];
      this.agentChatTriggerDiagnosticsLoading = false;
      return [];
    }

    const memberNpubs = [...new Set((targetGroup.member_npubs || []).map((value) => String(value || '').trim()).filter(Boolean))];
    if (memberNpubs.length === 0) {
      this.agentChatTriggerDiagnostics = [];
      this.agentChatTriggerDiagnosticsLoading = false;
      return [];
    }

    this.agentChatTriggerDiagnosticsLoading = true;
    const diagnostics = await Promise.all(memberNpubs.map(async (memberNpub) => {
      try {
        const result = await getGroupKeys(memberNpub);
        const health = evaluateAgentChatTargetMemberKeys(targetGroup, result?.keys || []);
        return {
          member_npub: memberNpub,
          ...health,
        };
      } catch (error) {
        return {
          member_npub: memberNpub,
          status: 'error',
          summary: 'Unable to inspect wrapped keys for this member.',
          detail: error?.message || String(error),
          latest_key_version: null,
          current_epoch: Number(targetGroup.current_epoch || 1) || 1,
          relevant_key_count: 0,
        };
      }
    }));

    if (this._agentChatTriggerDiagnosticsRequestId !== requestId) return [];
    this.agentChatTriggerDiagnostics = diagnostics;
    this.agentChatTriggerDiagnosticsLoading = false;
    return diagnostics;
  },

  // --- workspace CRUD ---

  async selectWorkspace(workspaceKeyOrOwner, options = {}) {
    const workspace = this.getWorkspaceByKey(workspaceKeyOrOwner) || this.getWorkspaceByOwner(workspaceKeyOrOwner);
    if (!workspace) return;

    const previousWorkspaceKey = this.currentWorkspaceKey;
    this.selectedWorkspaceKey = workspace.workspaceKey || '';
    this.workspaceSwitchPendingNpub = workspace.workspaceOwnerNpub;
    this.workspaceSwitchPendingKey = workspace.workspaceKey || '';
    this.showWorkspaceSwitcherMenu = false;
    try {
      this.startSharedLiveQueries();
      this.stopWorkspaceLiveQueries();
      this.currentWorkspaceOwnerNpub = workspace.workspaceOwnerNpub;
      openWorkspaceDb(workspace.workspaceKey || workspace.workspaceOwnerNpub);
      this.showWorkspaceBootstrapModal = false;
      this.superbasedTokenInput = workspace.connectionToken || this.superbasedTokenInput;
      this.backendUrl = normalizeBackendUrl(workspace.directHttpsUrl || this.backendUrl || guessDefaultBackendUrl());
      this.ownerNpub = workspace.workspaceOwnerNpub;
      setBaseUrl(this.backendUrl);

      // Reset hydration cache so the new workspace can hydrate fresh
      if (this._workspaceProfileHydratedKeys) this._workspaceProfileHydratedKeys.clear();

      if (previousWorkspaceKey && previousWorkspaceKey !== workspace.workspaceKey) {
        await clearRuntimeData();
        evictStorageImageCache().catch(() => {});
        this.revokeStorageImageObjectUrls();
        this.chatProfiles = {};
        this.channels = [];
        this.messages = [];
        this.groups = [];
        this.documents = [];
        this.directories = [];
        this.tasks = [];
        this.schedules = [];
        this.audioNotes = [];
        this.taskComments = [];
        this.flows = [];
        this.approvals = [];
        this.showNewScheduleModal = false;
        this.cancelEditSchedule();
        this.hasForcedInitialBackfill = false;
        this.hasForcedTaskFamilyBackfill = false;
        this.docCommentBackfillAttemptsByDocId = {};
        this.scopesLoaded = false;
      }

      this.startWorkspaceLiveQueries();
      this.selectedBoardId = this.readStoredTaskBoardId() || null;
      this.validateSelectedBoardId();
      this.normalizeSettingsTab();
      await this.persistWorkspaceSettings();
      await this.refreshWorkspaceSettings();
      await this.refreshAgentChatTrigger({ refreshDiagnostics: false });
      this.syncWorkspaceProfileDraft({ force: true });
    } finally {
      if (this.workspaceSwitchPendingKey === workspace.workspaceKey) {
        this.workspaceSwitchPendingKey = '';
      }
      if (this.workspaceSwitchPendingNpub === workspace.workspaceOwnerNpub) {
        this.workspaceSwitchPendingNpub = '';
      }
    }
  },

  async removeWorkspace(workspaceKeyOrOwner) {
    if (!workspaceKeyOrOwner || this.removingWorkspace) return;
    const workspace = this.getWorkspaceByKey(workspaceKeyOrOwner) || this.getWorkspaceByOwner(workspaceKeyOrOwner);
    if (!workspace) return;
    const label = workspace?.name || workspace.workspaceOwnerNpub;
    if (!confirm(`Remove workspace "${label}"?\n\nThis will delete all local data for this workspace. The workspace will remain on SuperBased and can be re-added later.`)) {
      return;
    }

    this.removingWorkspace = true;
    this.stopBackgroundSync();

    const isCurrentWorkspace = this.currentWorkspaceKey === workspace.workspaceKey;
    if (isCurrentWorkspace) this.stopWorkspaceLiveQueries();

    // Remove from known workspaces list
    this.knownWorkspaces = this.knownWorkspaces.filter((w) => w.workspaceKey !== workspace.workspaceKey);

    // Delete the local IndexedDB for this workspace
    try {
      await deleteWorkspaceDb(workspace.workspaceKey || workspace.workspaceOwnerNpub);
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
      this.selectedWorkspaceKey = '';
      this.currentWorkspaceOwnerNpub = '';

      if (this.knownWorkspaces.length > 0) {
        // Switch to next available workspace and land on home
        await this.selectWorkspace(this.knownWorkspaces[0].workspaceKey || this.knownWorkspaces[0].workspaceOwnerNpub);
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
      const activeBackendUrl = normalizeBackendUrl(this.backendUrl);
      const result = await getWorkspaces(this.session.npub);
      const workspaces = (result.workspaces || []).map((entry) => {
        const workspaceOwnerNpub = entry.workspace_owner_npub || entry.workspaceOwnerNpub || entry.owner_npub || '';
        const existing = this.knownWorkspaces.find((item) =>
          item.workspaceOwnerNpub === workspaceOwnerNpub
          && (
            (entry.service_npub && item.serviceNpub === entry.service_npub)
            || (entry.direct_https_url && item.directHttpsUrl === entry.direct_https_url)
          )
        ) || null;
        return {
          ...entry,
          directHttpsUrl: entry.direct_https_url || entry.directHttpsUrl || existing?.directHttpsUrl || activeBackendUrl,
          serviceNpub: entry.service_npub || entry.serviceNpub || existing?.serviceNpub || serviceNpub,
          appNpub: entry.app_npub || entry.appNpub || existing?.appNpub || this.superbasedConnectionConfig?.appNpub || null,
        };
      });
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
    const shouldPrompt = Boolean(this.session?.npub) && Boolean(this.backendUrl) && !this.currentWorkspaceKey && this.knownWorkspaces.length === 0;
    if (shouldPrompt) {
      this.showConnectModal = false;
      this.showWorkspaceSwitcherMenu = false;
      this.mobileNavOpen = false;
    }
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
    this.showConnectModal = false;
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
      const adminGroupIdentity = createGroupIdentity();
      const privateGroupIdentity = createGroupIdentity();
      const serviceNpub = await this.fetchBackendServiceNpub();
      const wrappedWorkspaceNsec = await personalEncryptForNpub(memberNpub, workspaceIdentity.nsec);
      const defaultGroupMemberKeys = await buildWrappedMemberKeys(defaultGroupIdentity, [memberNpub], memberNpub);
      const adminGroupMemberKeys = await buildWrappedMemberKeys(adminGroupIdentity, [memberNpub], memberNpub);
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
        admin_group_npub: adminGroupIdentity.npub,
        admin_group_name: 'Workspace Admins',
        admin_group_member_keys: adminGroupMemberKeys,
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
          towerName: this.superbasedConnectionConfig?.towerName || null,
          towerDescription: this.superbasedConnectionConfig?.towerDescription || null,
          workspaceOwnerNpub: response.workspace_owner_npub,
          appNpub: this.superbasedConnectionConfig?.appNpub || null,
        }),
      });
      this.mergeKnownWorkspaces([workspace]);
      await this.selectWorkspace(workspace.workspaceKey || workspace.workspaceOwnerNpub);
      this.showWorkspaceBootstrapModal = false;
    } catch (error) {
      this.error = error?.message || 'Failed to create workspace';
    } finally {
      this.workspaceBootstrapSubmitting = false;
    }
  },
};
