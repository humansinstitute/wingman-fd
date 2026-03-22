/**
 * People / profile resolution and address-book methods extracted from app.js.
 *
 * The peopleProfilesManagerMixin object contains methods and getters that use `this`
 * (the Alpine store) and should be spread into the store definition via applyMixins.
 */

import {
  getAddressBookPeople,
  upsertAddressBookPerson,
} from './db.js';
import { fetchProfileByNpub } from './profiles.js';

// ---------------------------------------------------------------------------
// Mixin — methods and getters that use `this` (the Alpine store)
// ---------------------------------------------------------------------------

export const peopleProfilesManagerMixin = {

  // --- profile resolution ---

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

  getCachedPerson(npub) {
    if (!npub) return null;
    return this.addressBookPeople.find((person) => person.npub === npub) ?? null;
  },

  getSenderName(npub) {
    if (!npub) return 'Unknown';
    const cached = this.getCachedPerson(npub);
    return this.chatProfiles[npub]?.name || cached?.label || this.getShortNpub(npub);
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

  // --- address book ---

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

  // --- people search / suggestions ---

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

  // --- computed getters ---

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

  get defaultAgentSuggestions() {
    return this.findPeopleSuggestions(this.defaultAgentQuery, [this.defaultAgentNpub]);
  },

  get defaultAgentLabel() {
    return this.defaultAgentNpub ? this.getSenderName(this.defaultAgentNpub) : '';
  },

  get canDoTaskWithDefaultAgent() {
    return Boolean(this.defaultAgentNpub && this.editingTask);
  },
};
