import { describe, expect, it, vi } from 'vitest';
import { peopleProfilesManagerMixin } from '../src/people-profiles-manager.js';

function createStore(overrides = {}) {
  const store = {
    chatProfiles: {},
    addressBookPeople: [],
    groups: [],
    docEditorShares: [],
    docShareQuery: '',
    newGroupMemberQuery: '',
    newGroupMembers: [],
    editGroupMemberQuery: '',
    editGroupMembers: [],
    taskAssigneeQuery: '',
    editingTask: null,
    defaultAgentQuery: '',
    defaultAgentNpub: '',
    getShortNpub: (npub) => npub?.slice(0, 8) || '',
    ...overrides,
  };
  const descriptors = Object.getOwnPropertyDescriptors(peopleProfilesManagerMixin);
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

// --- profile resolution ---
describe('profile resolution', () => {
  it('getCachedPerson returns matching person', () => {
    const { fn } = bindMethod('getCachedPerson', {
      addressBookPeople: [{ npub: 'npub1a', label: 'Alice' }],
    });
    expect(fn('npub1a')).toEqual({ npub: 'npub1a', label: 'Alice' });
  });

  it('getCachedPerson returns null for no match', () => {
    const { fn } = bindMethod('getCachedPerson', { addressBookPeople: [] });
    expect(fn('npub1x')).toBeNull();
  });

  it('getCachedPerson returns null for empty input', () => {
    const { fn } = bindMethod('getCachedPerson');
    expect(fn('')).toBeNull();
    expect(fn(null)).toBeNull();
  });

  it('getSenderName returns profile name when available', () => {
    const { fn } = bindMethod('getSenderName', {
      chatProfiles: { npub1a: { name: 'Alice', picture: null } },
    });
    expect(fn('npub1a')).toBe('Alice');
  });

  it('getSenderName returns cached label as fallback', () => {
    const { fn } = bindMethod('getSenderName', {
      addressBookPeople: [{ npub: 'npub1a', label: 'Cached Alice' }],
    });
    expect(fn('npub1a')).toBe('Cached Alice');
  });

  it('getSenderName returns short npub as last fallback', () => {
    const { fn } = bindMethod('getSenderName');
    expect(fn('npub1abcdefgh')).toBe('npub1abc');
  });

  it('getSenderName returns Unknown for empty', () => {
    const { fn } = bindMethod('getSenderName');
    expect(fn('')).toBe('Unknown');
    expect(fn(null)).toBe('Unknown');
  });

  it('getSenderIdentity returns nip05 when available', () => {
    const { fn } = bindMethod('getSenderIdentity', {
      chatProfiles: { npub1a: { name: 'Alice', nip05: 'alice@example.com' } },
    });
    expect(fn('npub1a')).toBe('alice@example.com');
  });

  it('getSenderIdentity returns short npub when name exists but no nip05', () => {
    const { fn } = bindMethod('getSenderIdentity', {
      chatProfiles: { npub1a: { name: 'Alice', nip05: null } },
    });
    expect(fn('npub1a')).toBe('npub1a'.slice(0, 8));
  });

  it('getSenderIdentity returns empty for unknown', () => {
    const { fn } = bindMethod('getSenderIdentity');
    expect(fn('npub1unknown')).toBe('');
  });

  it('getSenderAvatar returns profile picture', () => {
    const { fn } = bindMethod('getSenderAvatar', {
      chatProfiles: { npub1a: { picture: 'https://img.example.com/a.png' } },
    });
    expect(fn('npub1a')).toBe('https://img.example.com/a.png');
  });

  it('getSenderAvatar returns cached avatar_url', () => {
    const { fn } = bindMethod('getSenderAvatar', {
      addressBookPeople: [{ npub: 'npub1a', avatar_url: 'https://cached.example.com/a.png' }],
    });
    expect(fn('npub1a')).toBe('https://cached.example.com/a.png');
  });

  it('getSenderAvatar returns null for unknown', () => {
    const { fn } = bindMethod('getSenderAvatar');
    expect(fn('npub1x')).toBeNull();
    expect(fn(null)).toBeNull();
  });

  it('resolveChatProfile skips if already loading', () => {
    const { fn, store } = bindMethod('resolveChatProfile', {
      chatProfiles: { npub1a: { loading: true } },
    });
    fn('npub1a');
    // Should not overwrite
    expect(store.chatProfiles.npub1a.loading).toBe(true);
  });

  it('resolveChatProfile skips if already resolved', () => {
    const { fn, store } = bindMethod('resolveChatProfile', {
      chatProfiles: { npub1a: { name: 'Alice', picture: null, loading: false } },
    });
    fn('npub1a');
    expect(store.chatProfiles.npub1a.name).toBe('Alice');
  });

  it('resolveChatProfile sets loading state for new profile', () => {
    const { fn, store } = bindMethod('resolveChatProfile');
    fn('npub1new');
    expect(store.chatProfiles.npub1new.loading).toBe(true);
  });
});

// --- people search ---
describe('findPeopleSuggestions', () => {
  it('returns empty for empty query', () => {
    const { fn } = bindMethod('findPeopleSuggestions', {
      addressBookPeople: [{ npub: 'npub1a', label: 'Alice' }],
    });
    expect(fn('')).toEqual([]);
  });

  it('finds by npub substring', () => {
    const { fn } = bindMethod('findPeopleSuggestions', {
      addressBookPeople: [
        { npub: 'npub1alice', label: 'Alice' },
        { npub: 'npub1bob', label: 'Bob' },
      ],
    });
    const results = fn('alice');
    expect(results).toHaveLength(1);
    expect(results[0].npub).toBe('npub1alice');
  });

  it('excludes specified npubs', () => {
    const { fn } = bindMethod('findPeopleSuggestions', {
      addressBookPeople: [
        { npub: 'npub1alice', label: 'Alice' },
        { npub: 'npub1bob', label: 'Bob' },
      ],
    });
    const results = fn('npub1', ['npub1alice']);
    expect(results.every((r) => r.npub !== 'npub1alice')).toBe(true);
  });

  it('limits to 8 results', () => {
    const people = Array.from({ length: 15 }, (_, i) => ({
      npub: `npub1person${i}`,
      label: `Person ${i}`,
    }));
    const { fn } = bindMethod('findPeopleSuggestions', { addressBookPeople: people });
    expect(fn('person').length).toBeLessThanOrEqual(8);
  });
});

describe('findGroupMemberSuggestions', () => {
  it('returns empty for empty query', () => {
    const { fn } = bindMethod('findGroupMemberSuggestions');
    expect(fn('')).toEqual([]);
  });

  it('excludes selected members', () => {
    const { fn } = bindMethod('findGroupMemberSuggestions', {
      addressBookPeople: [
        { npub: 'npub1a', label: 'Alice' },
        { npub: 'npub1b', label: 'Bob' },
      ],
    });
    const results = fn('npub1', [{ npub: 'npub1a' }]);
    expect(results.every((r) => r.npub !== 'npub1a')).toBe(true);
  });
});

describe('mapGroupDraftMembers', () => {
  it('maps npubs to member objects', () => {
    const { fn } = bindMethod('mapGroupDraftMembers', {
      chatProfiles: { npub1a: { name: 'Alice' } },
      addressBookPeople: [{ npub: 'npub1a', label: 'Alice' }],
    });
    const result = fn(['npub1a', 'npub1b']);
    expect(result).toHaveLength(2);
    expect(result[0].npub).toBe('npub1a');
    expect(result[0].label).toBe('Alice');
  });

  it('deduplicates and trims', () => {
    const { fn } = bindMethod('mapGroupDraftMembers');
    const result = fn(['npub1a', '  npub1a  ', '', null]);
    expect(result).toHaveLength(1);
  });
});

describe('consumeGroupMemberQuery', () => {
  it('returns unchanged for empty query', () => {
    const { fn } = bindMethod('consumeGroupMemberQuery');
    const result = fn('', [{ npub: 'npub1a' }]);
    expect(result.added).toBe(false);
    expect(result.members).toHaveLength(1);
  });

  it('adds valid npub from query', () => {
    const npub = 'npub1' + 'x'.repeat(58);
    const { fn } = bindMethod('consumeGroupMemberQuery');
    const result = fn(npub, []);
    expect(result.added).toBe(true);
    expect(result.members).toHaveLength(1);
    expect(result.members[0].npub).toBe(npub);
  });

  it('does not add duplicate npub', () => {
    const npub = 'npub1' + 'x'.repeat(58);
    const { fn } = bindMethod('consumeGroupMemberQuery');
    const result = fn(npub, [{ npub }]);
    expect(result.added).toBe(false);
  });

  it('falls back to suggestion matching', () => {
    const { fn } = bindMethod('consumeGroupMemberQuery', {
      addressBookPeople: [{ npub: 'npub1alice', label: 'Alice' }],
    });
    const result = fn('alice', []);
    expect(result.added).toBe(true);
    expect(result.members[0].npub).toBe('npub1alice');
  });
});

// --- computed getters ---
describe('computed getters', () => {
  it('defaultAgentLabel returns name when set', () => {
    const store = createStore({
      defaultAgentNpub: 'npub1a',
      chatProfiles: { npub1a: { name: 'Bot' } },
    });
    expect(store.defaultAgentLabel).toBe('Bot');
  });

  it('defaultAgentLabel returns empty when not set', () => {
    const store = createStore({ defaultAgentNpub: '' });
    expect(store.defaultAgentLabel).toBe('');
  });

  it('canDoTaskWithDefaultAgent requires both', () => {
    expect(createStore({ defaultAgentNpub: '', editingTask: null }).canDoTaskWithDefaultAgent).toBe(false);
    expect(createStore({ defaultAgentNpub: 'npub1a', editingTask: null }).canDoTaskWithDefaultAgent).toBe(false);
    expect(createStore({ defaultAgentNpub: 'npub1a', editingTask: { id: 't1' } }).canDoTaskWithDefaultAgent).toBe(true);
  });

  it('groupMemberSuggestions delegates to findGroupMemberSuggestions', () => {
    const store = createStore({
      newGroupMemberQuery: 'alice',
      newGroupMembers: [],
      addressBookPeople: [{ npub: 'npub1alice', label: 'Alice' }],
    });
    expect(store.groupMemberSuggestions.length).toBe(1);
  });

  it('docShareSuggestions returns empty for empty query', () => {
    const store = createStore({ docShareQuery: '' });
    expect(store.docShareSuggestions).toEqual([]);
  });

  it('docShareSuggestions finds people and groups', () => {
    const store = createStore({
      docShareQuery: 'test',
      docEditorShares: [],
      addressBookPeople: [{ npub: 'npub1test', label: 'Test User' }],
      groups: [{ group_id: 'g1', name: 'Test Group', member_npubs: ['npub1a'] }],
    });
    const suggestions = store.docShareSuggestions;
    expect(suggestions.some((s) => s.type === 'person')).toBe(true);
    expect(suggestions.some((s) => s.type === 'group')).toBe(true);
  });
});
