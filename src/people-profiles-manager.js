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

const EMPTY_ARRAY = Object.freeze([]);
const addressBookPeopleMapCache = new WeakMap();
const REMEMBER_PEOPLE_TOUCH_MS = 15 * 60 * 1000;

function getAddressBookPeopleMap(store) {
  const people = Array.isArray(store?.addressBookPeople) ? store.addressBookPeople : EMPTY_ARRAY;
  let cached = addressBookPeopleMapCache.get(people);
  if (cached) return cached;
  cached = new Map();
  for (const person of people) cached.set(person.npub, person);
  addressBookPeopleMapCache.set(people, cached);
  return cached;
}

// ---------------------------------------------------------------------------
// Mixin — methods and getters that use `this` (the Alpine store)
// ---------------------------------------------------------------------------

export const peopleProfilesManagerMixin = {

  // --- profile resolution ---

  resolveChatProfile(npub) {
    if (!npub || this.chatProfiles[npub]?.loading) return;
    if (this.chatProfiles[npub]?.name || this.chatProfiles[npub]?.picture) return;

    // Cap chatProfiles at 200 entries — evict oldest when full
    const MAX_CHAT_PROFILES = 200;
    const keys = Object.keys(this.chatProfiles);
    if (keys.length >= MAX_CHAT_PROFILES) {
      const trimmed = {};
      // Keep the most recent half
      const keep = keys.slice(keys.length - Math.floor(MAX_CHAT_PROFILES / 2));
      for (const k of keep) trimmed[k] = this.chatProfiles[k];
      this.chatProfiles = trimmed;
    }

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
    return getAddressBookPeopleMap(this).get(npub) ?? null;
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
    const uniqueNpubs = [...new Set(npubs.filter(Boolean))];
    if (uniqueNpubs.length === 0) return;

    const existingPeople = getAddressBookPeopleMap(this);
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    let wroteAny = false;

    for (const npub of uniqueNpubs) {
      const existing = existingPeople.get(npub) ?? null;
      const nextLabel = this.chatProfiles[npub]?.name ?? null;
      const nextAvatar = this.chatProfiles[npub]?.picture ?? null;
      const existingLastUsedAt = Date.parse(existing?.last_used_at || '');
      const shouldTouchTimestamp = !Number.isFinite(existingLastUsedAt)
        || (now - existingLastUsedAt) >= REMEMBER_PEOPLE_TOUCH_MS;
      const shouldWrite = !existing
        || (existing.label ?? null) !== nextLabel
        || (existing.avatar_url ?? null) !== nextAvatar
        || shouldTouchTimestamp;

      if (shouldWrite) {
        await upsertAddressBookPerson({
          npub,
          label: nextLabel,
          avatar_url: nextAvatar,
          source: existing?.source || source,
          last_used_at: nowIso,
        });
        wroteAny = true;
      }
      this.resolveChatProfile(npub);
    }

    if (wroteAny) {
      this.addressBookPeople = await getAddressBookPeople();
    }
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
