/**
 * Channel and group management methods extracted from app.js.
 *
 * Pure utility functions are exported individually for direct testing.
 * The channelsManagerMixin object contains methods that use `this` (the Alpine store)
 * and should be spread into the store definition.
 */

import {
  getChannelsByOwner,
  upsertChannel,
  upsertGroup,
  deleteGroupById,
  getAddressBookPeople,
  addPendingWrite,
} from './db.js';
import {
  createGroup,
  addGroupMember,
  rotateGroup,
  deleteGroupMember,
  updateGroup,
  getGroups,
  getGroupKeys,
  deleteGroup,
} from './api.js';
import {
  outboundChannel,
  recordFamilyHash,
} from './translators/chat.js';
import {
  bootstrapWrappedGroupKeys,
  buildWrappedMemberKeys,
  cacheGroupKey,
  createGroupIdentity,
  getLastGroupKeyBootstrapDiagnostics,
  wrapKnownGroupKeyForMember,
} from './crypto/group-keys.js';
import { sameListBySignature, toRaw } from './utils/state-helpers.js';
import { buildSuperBasedConnectionToken } from './superbased-token.js';
import { APP_NPUB } from './app-identity.js';
import { flightDeckLog } from './logging.js';

// ---------------------------------------------------------------------------
// Pure utility functions (no `this` dependency)
// ---------------------------------------------------------------------------

/**
 * Filter channels to only those the viewer should see.
 * The workspace owner sees all channels. Guest viewers only see channels
 * where they are listed in participant_npubs.
 */
export function filterChannelsForViewer(channels, viewerNpub, workspaceOwnerNpub) {
  if (!viewerNpub || viewerNpub === workspaceOwnerNpub) return channels;
  return channels.filter((ch) => {
    const participants = ch.participant_npubs;
    if (!Array.isArray(participants) || participants.length === 0) return true;
    return participants.includes(viewerNpub);
  });
}

function groupSignature(group) {
  return [
    String(group?.group_id || ''),
    String(group?.group_npub || ''),
    String(group?.owner_npub || ''),
    String(group?.name || ''),
    String(group?.group_kind || ''),
    String(group?.private_member_npub || ''),
    String(group?.current_epoch || ''),
    [...(group?.member_npubs || [])].map(String).join(','),
  ].join('|');
}

/**
 * Normalize a raw group object from the API into a consistent shape.
 */
export function mapGroupEntry(group) {
  return {
    group_id: group.id ?? group.group_id,
    group_npub: group.group_npub ?? group.group_id ?? group.id,
    current_epoch: Number(group.current_epoch || 1),
    owner_npub: group.owner_npub,
    name: group.name,
    group_kind: group.group_kind || 'shared',
    private_member_npub: group.private_member_npub ?? null,
    member_npubs: [...(group.members ?? group.member_npubs ?? [])].map(String),
  };
}

/**
 * Map a createGroup API response into the local group shape.
 */
export function mapCreatedGroup(response, name, ownerNpub) {
  const groupNpub = response.group_npub ?? response.group_id ?? response.id;
  return {
    group_id: response.group_id ?? response.id ?? groupNpub,
    group_npub: groupNpub,
    current_epoch: Number(response.current_epoch || 1),
    owner_npub: ownerNpub,
    name: response.name ?? name,
    group_kind: response.group_kind || 'shared',
    private_member_npub: response.private_member_npub ?? null,
    member_npubs: (response.members ?? []).map((member) => member.member_npub ?? member).filter(Boolean),
  };
}

/**
 * Map a rotateGroup API response into the local group shape.
 */
export function mapRotatedGroup(response, groupIdentity, group, nextMembers, options) {
  return {
    group_id: response.group_id ?? group.group_id,
    group_npub: response.group_npub ?? groupIdentity.npub,
    current_epoch: Number(response.current_epoch || ((group.current_epoch || 1) + 1)),
    owner_npub: response.owner_npub ?? group.owner_npub,
    name: response.name ?? options.name ?? group.name,
    group_kind: response.group_kind || group.group_kind || 'shared',
    private_member_npub: response.private_member_npub ?? group.private_member_npub ?? null,
    member_npubs: (response.members ?? nextMembers).map((member) => member.member_npub ?? member).filter(Boolean),
  };
}

/**
 * Deduplicate and normalize member npubs, ensuring the owner is first.
 */
export function deduplicateMembers(ownerNpub, memberNpubs) {
  return [...new Set([ownerNpub, ...(memberNpubs || []).map((value) => String(value || '').trim()).filter(Boolean)])];
}

/**
 * Compute added/removed members between desired and existing sets.
 */
export function computeGroupMemberDiff(desiredMembers, existingMembers) {
  const membersToAdd = desiredMembers.filter((m) => !existingMembers.includes(m));
  const membersToRemove = existingMembers.filter((m) => !desiredMembers.includes(m));
  return { membersToAdd, membersToRemove };
}

/**
 * Parse a comma-separated query string and extract valid npub entries.
 */
export function parseGroupMemberQueryNpubs(query) {
  const raw = String(query || '').trim();
  if (!raw) return [];
  const parts = raw.split(',').map((v) => v.trim()).filter(Boolean);
  const seen = new Set();
  const result = [];
  for (const part of parts) {
    if (part.startsWith('npub1') && part.length >= 60 && !seen.has(part)) {
      seen.add(part);
      result.push(part);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Mixin — methods that use `this` (the Alpine store)
// ---------------------------------------------------------------------------

export const channelsManagerMixin = {
  // --- channels ---

  async refreshChannels() {
    const ownerNpub = this.workspaceOwnerNpub;
    if (!ownerNpub) return;
    await this.applyChannels(await getChannelsByOwner(ownerNpub));
  },

  async refreshGroups(options = {}) {
    const viewerNpub = this.session?.npub;
    if (!viewerNpub || !this.backendUrl) return;
    const force = options.force === true;
    const minIntervalMs = Number(options.minIntervalMs);
    if (
      !force
      && Number.isFinite(minIntervalMs)
      && minIntervalMs > 0
      && this.lastGroupsRefreshAt > 0
      && this.groups.length > 0
      && (Date.now() - this.lastGroupsRefreshAt) < minIntervalMs
    ) {
      return this.groups;
    }
    try {
      const [result, keyResult] = await Promise.all([
        getGroups(viewerNpub),
        getGroupKeys(viewerNpub),
      ]);
      const groups = result.groups ?? [];
      const mappedGroups = groups.map((group) => mapGroupEntry(group))
        .filter((group) => !this.workspaceOwnerNpub || group.owner_npub === this.workspaceOwnerNpub);
      const bootstrapResult = await bootstrapWrappedGroupKeys(keyResult.keys ?? []);
      const workspaceGroupRefs = new Set(
        mappedGroups.flatMap((group) => [group.group_id, group.group_npub]).filter(Boolean)
      );
      const relevantFailures = (bootstrapResult.failures || [])
        .filter((entry) => workspaceGroupRefs.has(entry.group_id) || workspaceGroupRefs.has(entry.group_npub));
      if (relevantFailures.length > 0 || (mappedGroups.length > 0 && (bootstrapResult.loaded || 0) === 0)) {
        flightDeckLog('warn', 'groups', 'group-key bootstrap diagnostics', {
          viewerNpub,
          workspaceOwnerNpub: this.workspaceOwnerNpub || null,
          visibleGroupCount: mappedGroups.length,
          wrappedKeyCount: (keyResult.keys || []).length,
          bootstrap: getLastGroupKeyBootstrapDiagnostics(),
          relevantFailures,
        });
      } else {
        flightDeckLog('debug', 'groups', 'group-key bootstrap complete', {
          viewerNpub,
          workspaceOwnerNpub: this.workspaceOwnerNpub || null,
          visibleGroupCount: mappedGroups.length,
          wrappedKeyCount: (keyResult.keys || []).length,
          loadedKeyCount: bootstrapResult.loaded || 0,
        });
      }
      const groupsChanged = !sameListBySignature(this.groups, mappedGroups, groupSignature);
      if (groupsChanged) {
        this.groups = mappedGroups;
        const memberNpubs = new Set();
        for (const group of mappedGroups) {
          await upsertGroup({
            ...group,
            member_npubs: [...(group.member_npubs ?? [])],
          });
          for (const memberNpub of group.member_npubs ?? []) {
            if (memberNpub) memberNpubs.add(String(memberNpub));
          }
        }
        if (memberNpubs.size > 0) {
          await this.rememberPeople([...memberNpubs], 'group');
        }
      }
      this.lastGroupsRefreshAt = Date.now();
      this.validateSelectedBoardId();
      this.normalizeTaskFilterTags();
      return this.groups;
    } catch (error) {
      flightDeckLog('error', 'groups', 'refreshGroups failed', {
        viewerNpub,
        workspaceOwnerNpub: this.workspaceOwnerNpub || null,
        error: error?.message || String(error),
      });
      console.debug('refreshGroups failed:', error?.message || error);
      return this.groups;
    }
  },

  async createEncryptedGroup(name, memberNpubs = []) {
    const wrappedByNpub = this.session?.npub;
    const ownerNpub = this.workspaceOwnerNpub;
    if (!wrappedByNpub || !ownerNpub) throw new Error('Sign in first');

    const uniqueMembers = deduplicateMembers(wrappedByNpub, memberNpubs);
    const groupIdentity = createGroupIdentity();
    const memberKeys = await buildWrappedMemberKeys(groupIdentity, uniqueMembers, wrappedByNpub);
    const response = await createGroup({
      owner_npub: ownerNpub,
      name,
      group_npub: groupIdentity.npub,
      member_keys: memberKeys,
    });

    const group = mapCreatedGroup(response, name, ownerNpub);

    await upsertGroup(group);
    await this.refreshGroups();
    // Keep the freshly created epoch-1 key locally even if the follow-up
    // /groups/keys bootstrap path lags or fails for this render cycle.
    cacheGroupKey({
      group_id: group.group_id,
      group_npub: group.group_npub,
      name: group.name,
      key_version: group.current_epoch ?? 1,
      nsec: groupIdentity.nsec,
    });
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

    const updatedGroup = mapRotatedGroup(response, groupIdentity, group, nextMembers, options);

    await upsertGroup(updatedGroup);
    if (options.refresh !== false) {
      await this.refreshGroups();
    }
    cacheGroupKey({
      group_id: updatedGroup.group_id,
      group_npub: updatedGroup.group_npub,
      name: updatedGroup.name,
      key_version: updatedGroup.current_epoch ?? group.current_epoch + 1,
      nsec: groupIdentity.nsec,
    });
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
    const allChannels = Array.isArray(channels) ? channels : [];
    const nextChannels = filterChannelsForViewer(allChannels, this.session?.npub, this.workspaceOwnerNpub);
    if (!sameListBySignature(this.channels, nextChannels, (channel) => [
      String(channel?.record_id || ''),
      String(channel?.updated_at || ''),
      String(channel?.version ?? ''),
      String(channel?.record_state || ''),
    ].join('|'))) {
      this.channels = nextChannels;
    }

    const participantNpubs = new Set();
    for (const channel of nextChannels) {
      for (const participantNpub of this.getChannelParticipants(channel)) {
        if (participantNpub) participantNpubs.add(String(participantNpub));
      }
    }
    if (participantNpubs.size > 0) {
      await this.rememberPeople([...participantNpubs], 'chat');
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
      this.mainFeedVisibleCount = this.MAIN_FEED_PAGE_SIZE;
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
    this.mainFeedVisibleCount = this.MAIN_FEED_PAGE_SIZE;
    this.expandedChatMessageIds = [];
    this.truncatedChatMessageIds = [];
    this.closeThread({ syncRoute: false });
    this.pendingChatScrollToLatest = options.scrollToLatest !== false;
    this.startSelectedChannelLiveQuery();
    if (options.syncRoute !== false) this.syncRoute();
    this.ensureBackgroundSync(true);
    // Mark this channel (and the chat section) as read
    this.markChannelRead(recordId);
  },

  // --- group modals ---

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
        signature_npub: this.signingNpub,
        write_group_ref: groupId,
      });

      await addPendingWrite({
        record_id: channelId,
        record_family_hash: recordFamilyHash('channel'),
        envelope,
      });

      await this.flushAndBackgroundSync();
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
        signature_npub: this.signingNpub,
        write_group_ref: groupId,
      });

      await addPendingWrite({
        record_id: channelId,
        record_family_hash: recordFamilyHash('channel'),
        envelope,
      });

      await this.flushAndBackgroundSync();
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
    const { membersToAdd, membersToRemove } = computeGroupMemberDiff(desiredMembers, existingMembers);

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

  // --- Share invite link ---

  resetShareInvite() {
    this.shareInviteNpub = '';
    this.shareInviteGroupId = '';
    this.shareInviteUrl = '';
    this.shareInvitePending = false;
    this.shareInviteError = null;
    this.shareInviteCopied = false;
  },

  async generateShareLink() {
    const inviteeNpub = String(this.shareInviteNpub || '').trim();
    const groupId = String(this.shareInviteGroupId || '').trim();

    if (!inviteeNpub || !inviteeNpub.startsWith('npub1')) {
      this.shareInviteError = 'Enter a valid npub for the invitee';
      return;
    }
    if (!groupId) {
      this.shareInviteError = 'Select a group';
      return;
    }
    if (!this.session?.npub) {
      this.shareInviteError = 'Sign in first';
      return;
    }

    this.shareInvitePending = true;
    this.shareInviteError = null;
    this.shareInviteUrl = '';
    this.shareInviteCopied = false;

    try {
      const group = this.groups.find((g) => g.group_id === groupId || g.group_npub === groupId);
      if (!group) throw new Error('Group not found');

      const alreadyMember = (group.member_npubs || []).includes(inviteeNpub);
      if (!alreadyMember) {
        await this.addEncryptedGroupMember(groupId, inviteeNpub);
      }

      const workspace = this.currentWorkspace;
      const token = workspace?.connectionToken || buildSuperBasedConnectionToken({
        directHttpsUrl: this.backendUrl,
        serviceNpub: workspace?.serviceNpub || this.connectHostServiceNpub || '',
        workspaceOwnerNpub: this.workspaceOwnerNpub,
        appNpub: workspace?.appNpub || APP_NPUB,
      });

      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      this.shareInviteUrl = `${origin}?token=${encodeURIComponent(token)}`;
    } catch (error) {
      this.shareInviteError = error?.message || 'Failed to generate share link';
    } finally {
      this.shareInvitePending = false;
    }
  },

  async copyShareLink() {
    if (!this.shareInviteUrl) return;
    try {
      await navigator.clipboard.writeText(this.shareInviteUrl);
      this.shareInviteCopied = true;
      setTimeout(() => { this.shareInviteCopied = false; }, 2000);
    } catch {
      this.shareInviteError = 'Failed to copy link';
    }
  },
};
