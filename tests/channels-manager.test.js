import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  mapGroupEntry,
  mapCreatedGroup,
  mapRotatedGroup,
  deduplicateMembers,
  computeGroupMemberDiff,
  parseGroupMemberQueryNpubs,
  filterChannelsForViewer,
  channelsManagerMixin,
} from '../src/channels-manager.js';

const channelsManagerSource = fs.readFileSync(
  path.resolve(import.meta.dirname, '..', 'src', 'channels-manager.js'),
  'utf-8',
);

describe('channels-manager pure utilities', () => {
  it('does not call retired trigger diagnostics during ordinary group refresh', () => {
    expect(channelsManagerSource).not.toContain('refreshAgentChat' + 'TriggerDiagnostics');
  });

  // --- mapGroupEntry ---
  describe('mapGroupEntry', () => {
    it('maps a group with id field', () => {
      const result = mapGroupEntry({
        id: 'g1',
        group_npub: 'npub1grp',
        current_epoch: 2,
        owner_npub: 'npub1owner',
        name: 'Team',
        group_kind: 'shared',
        private_member_npub: null,
        members: ['npub1a', 'npub1b'],
      });
      expect(result).toEqual({
        group_id: 'g1',
        group_npub: 'npub1grp',
        current_epoch: 2,
        owner_npub: 'npub1owner',
        name: 'Team',
        group_kind: 'shared',
        private_member_npub: null,
        member_npubs: ['npub1a', 'npub1b'],
      });
    });

    it('maps a group with group_id field', () => {
      const result = mapGroupEntry({
        group_id: 'g2',
        group_npub: 'npub1grp2',
        owner_npub: 'npub1owner',
        name: 'Dev',
        member_npubs: ['npub1c'],
      });
      expect(result.group_id).toBe('g2');
      expect(result.group_npub).toBe('npub1grp2');
      expect(result.member_npubs).toEqual(['npub1c']);
    });

    it('defaults current_epoch to 1', () => {
      const result = mapGroupEntry({ id: 'g3', owner_npub: 'npub1o', name: 'X' });
      expect(result.current_epoch).toBe(1);
    });

    it('defaults group_kind to shared', () => {
      const result = mapGroupEntry({ id: 'g4', owner_npub: 'npub1o', name: 'Y' });
      expect(result.group_kind).toBe('shared');
    });

    it('falls back group_npub to group_id then id', () => {
      expect(mapGroupEntry({ id: 'g5', owner_npub: 'o', name: 'Z' }).group_npub).toBe('g5');
      expect(mapGroupEntry({ group_id: 'g6', owner_npub: 'o', name: 'Z' }).group_npub).toBe('g6');
    });

    it('handles empty members gracefully', () => {
      const result = mapGroupEntry({ id: 'g7', owner_npub: 'o', name: 'Z' });
      expect(result.member_npubs).toEqual([]);
    });

    it('converts member entries to strings', () => {
      const result = mapGroupEntry({ id: 'g8', owner_npub: 'o', name: 'Z', members: [123, 'npub1x'] });
      expect(result.member_npubs).toEqual(['123', 'npub1x']);
    });

    it('extracts member_npub when members are objects', () => {
      const result = mapGroupEntry({
        id: 'g9',
        owner_npub: 'o',
        name: 'Z',
        members: [{ member_npub: 'npub1a' }, { member_npub: 'npub1b' }],
      });
      expect(result.member_npubs).toEqual(['npub1a', 'npub1b']);
    });
  });

  // --- mapCreatedGroup ---
  describe('mapCreatedGroup', () => {
    it('maps a create-group response', () => {
      const response = {
        group_id: 'g1',
        group_npub: 'npub1new',
        current_epoch: 1,
        name: 'Created',
        group_kind: 'shared',
        private_member_npub: null,
        members: [{ member_npub: 'npub1a' }, { member_npub: 'npub1b' }],
      };
      const result = mapCreatedGroup(response, 'Fallback Name', 'npub1owner');
      expect(result).toEqual({
        group_id: 'g1',
        group_npub: 'npub1new',
        current_epoch: 1,
        owner_npub: 'npub1owner',
        name: 'Created',
        group_kind: 'shared',
        private_member_npub: null,
        member_npubs: ['npub1a', 'npub1b'],
      });
    });

    it('falls back name to provided name', () => {
      const result = mapCreatedGroup({}, 'My Group', 'npub1owner');
      expect(result.name).toBe('My Group');
    });

    it('falls back group_npub to group_id then id', () => {
      expect(mapCreatedGroup({ id: 'x' }, 'n', 'o').group_npub).toBe('x');
      expect(mapCreatedGroup({ group_id: 'y' }, 'n', 'o').group_npub).toBe('y');
    });

    it('defaults current_epoch to 1', () => {
      const result = mapCreatedGroup({}, 'n', 'o');
      expect(result.current_epoch).toBe(1);
    });

    it('filters out falsy members', () => {
      const result = mapCreatedGroup({ members: [{ member_npub: 'npub1a' }, { member_npub: '' }] }, 'n', 'o');
      expect(result.member_npubs).toEqual(['npub1a']);
    });

    it('handles missing members array', () => {
      const result = mapCreatedGroup({}, 'n', 'o');
      expect(result.member_npubs).toEqual([]);
    });

    it('normalizes mixed member entry shapes in create responses', () => {
      const result = mapCreatedGroup({
        members: [{ member_npub: 'npub1a' }, { npub: 'npub1b' }, 'npub1c'],
      }, 'n', 'o');
      expect(result.member_npubs).toEqual(['npub1a', 'npub1b', 'npub1c']);
    });
  });

  // --- mapRotatedGroup ---
  describe('mapRotatedGroup', () => {
    const baseGroup = {
      group_id: 'g1',
      group_npub: 'npub1old',
      current_epoch: 2,
      owner_npub: 'npub1owner',
      name: 'Original',
      group_kind: 'shared',
      private_member_npub: null,
    };

    it('maps a rotate-group response', () => {
      const response = {
        group_id: 'g1',
        group_npub: 'npub1rotated',
        current_epoch: 3,
        owner_npub: 'npub1owner',
        name: 'Renamed',
        group_kind: 'shared',
        private_member_npub: null,
        members: [{ member_npub: 'npub1a' }],
      };
      const result = mapRotatedGroup(response, { npub: 'npub1identity' }, baseGroup, ['npub1a'], {});
      expect(result.group_npub).toBe('npub1rotated');
      expect(result.current_epoch).toBe(3);
      expect(result.name).toBe('Renamed');
      expect(result.member_npubs).toEqual(['npub1a']);
    });

    it('falls back to identity npub', () => {
      const result = mapRotatedGroup({}, { npub: 'npub1identity' }, baseGroup, ['npub1a'], {});
      expect(result.group_npub).toBe('npub1identity');
    });

    it('increments epoch when response lacks it', () => {
      const result = mapRotatedGroup({}, { npub: 'npub1id' }, baseGroup, [], {});
      expect(result.current_epoch).toBe(3);
    });

    it('falls back name to options.name then group.name', () => {
      expect(mapRotatedGroup({}, { npub: 'n' }, baseGroup, [], { name: 'Opt' }).name).toBe('Opt');
      expect(mapRotatedGroup({}, { npub: 'n' }, baseGroup, [], {}).name).toBe('Original');
    });

    it('falls back member_npubs to nextMembers', () => {
      const result = mapRotatedGroup({}, { npub: 'n' }, baseGroup, ['npub1x', 'npub1y'], {});
      expect(result.member_npubs).toEqual(['npub1x', 'npub1y']);
    });

    it('maps member objects from response', () => {
      const result = mapRotatedGroup(
        { members: [{ member_npub: 'npub1a' }, { member_npub: 'npub1b' }] },
        { npub: 'n' }, baseGroup, [], {},
      );
      expect(result.member_npubs).toEqual(['npub1a', 'npub1b']);
    });

    it('normalizes fallback members when rotate response omits members', () => {
      const result = mapRotatedGroup(
        {},
        { npub: 'n' },
        baseGroup,
        [{ member_npub: 'npub1a' }, { npub: 'npub1b' }, 'npub1c'],
        {},
      );
      expect(result.member_npubs).toEqual(['npub1a', 'npub1b', 'npub1c']);
    });
  });

  // --- deduplicateMembers ---
  describe('deduplicateMembers', () => {
    it('includes the owner first', () => {
      const result = deduplicateMembers('npub1owner', ['npub1a', 'npub1b']);
      expect(result[0]).toBe('npub1owner');
    });

    it('deduplicates members', () => {
      const result = deduplicateMembers('npub1owner', ['npub1a', 'npub1a', 'npub1owner']);
      expect(result).toEqual(['npub1owner', 'npub1a']);
    });

    it('trims and filters blank entries', () => {
      const result = deduplicateMembers('npub1owner', ['  npub1a  ', '', null, undefined]);
      expect(result).toEqual(['npub1owner', 'npub1a']);
    });

    it('handles null memberNpubs', () => {
      const result = deduplicateMembers('npub1owner', null);
      expect(result).toEqual(['npub1owner']);
    });

    it('converts non-string members to strings', () => {
      const result = deduplicateMembers('npub1owner', [123]);
      expect(result).toEqual(['npub1owner', '123']);
    });

    it('normalizes object-shaped member entries', () => {
      const result = deduplicateMembers('npub1owner', [{ member_npub: 'npub1a' }, { npub: 'npub1b' }]);
      expect(result).toEqual(['npub1owner', 'npub1a', 'npub1b']);
    });
  });

  // --- computeGroupMemberDiff ---
  describe('computeGroupMemberDiff', () => {
    it('computes members to add and remove', () => {
      const result = computeGroupMemberDiff(
        ['npub1a', 'npub1b', 'npub1c'],
        ['npub1a', 'npub1d'],
      );
      expect(result.membersToAdd).toEqual(['npub1b', 'npub1c']);
      expect(result.membersToRemove).toEqual(['npub1d']);
    });

    it('returns empty arrays when lists are identical', () => {
      const result = computeGroupMemberDiff(['npub1a'], ['npub1a']);
      expect(result.membersToAdd).toEqual([]);
      expect(result.membersToRemove).toEqual([]);
    });

    it('handles empty desired list', () => {
      const result = computeGroupMemberDiff([], ['npub1a', 'npub1b']);
      expect(result.membersToAdd).toEqual([]);
      expect(result.membersToRemove).toEqual(['npub1a', 'npub1b']);
    });

    it('handles empty existing list', () => {
      const result = computeGroupMemberDiff(['npub1a', 'npub1b'], []);
      expect(result.membersToAdd).toEqual(['npub1a', 'npub1b']);
      expect(result.membersToRemove).toEqual([]);
    });
  });

  // --- parseGroupMemberQueryNpubs ---
  describe('parseGroupMemberQueryNpubs', () => {
    const fakeNpub = 'npub1' + 'a'.repeat(58);

    it('extracts valid npubs from comma-separated query', () => {
      const result = parseGroupMemberQueryNpubs(`${fakeNpub},npub1${'b'.repeat(58)}`);
      expect(result).toHaveLength(2);
      expect(result[0]).toBe(fakeNpub);
    });

    it('returns empty array for empty string', () => {
      expect(parseGroupMemberQueryNpubs('')).toEqual([]);
    });

    it('returns empty array for null', () => {
      expect(parseGroupMemberQueryNpubs(null)).toEqual([]);
    });

    it('ignores entries that are too short', () => {
      const result = parseGroupMemberQueryNpubs('npub1short,not-npub');
      expect(result).toEqual([]);
    });

    it('ignores entries not starting with npub1', () => {
      const result = parseGroupMemberQueryNpubs('nsec1' + 'a'.repeat(58));
      expect(result).toEqual([]);
    });

    it('trims whitespace around entries', () => {
      const result = parseGroupMemberQueryNpubs(`  ${fakeNpub}  `);
      expect(result).toEqual([fakeNpub]);
    });

    it('deduplicates entries', () => {
      const result = parseGroupMemberQueryNpubs(`${fakeNpub},${fakeNpub}`);
      expect(result).toEqual([fakeNpub]);
    });
  });

  // --- filterChannelsForViewer ---
  describe('filterChannelsForViewer', () => {
    const OWNER = 'npub1owner';
    const VIEWER = 'npub1viewer';
    const OTHER = 'npub1other';

    const channels = [
      { record_id: 'ch1', title: 'Team Channel', participant_npubs: [OWNER, VIEWER, OTHER] },
      { record_id: 'ch2', title: 'DM: Pete', participant_npubs: [OWNER, OTHER] },
      { record_id: 'ch3', title: 'WM21', participant_npubs: [OWNER, OTHER] },
      { record_id: 'ch4', title: 'Open', participant_npubs: [] },
      { record_id: 'ch5', title: 'Legacy', participant_npubs: undefined },
    ];

    it('workspace owner sees all channels', () => {
      const result = filterChannelsForViewer(channels, OWNER, OWNER);
      expect(result).toHaveLength(5);
    });

    it('guest viewer only sees channels where they are a participant', () => {
      const result = filterChannelsForViewer(channels, VIEWER, OWNER);
      expect(result.map(c => c.record_id)).toEqual(['ch1', 'ch4', 'ch5']);
    });

    it('filters out channels where viewer is not in participant_npubs', () => {
      const result = filterChannelsForViewer(channels, VIEWER, OWNER);
      expect(result.map(c => c.record_id)).not.toContain('ch2');
      expect(result.map(c => c.record_id)).not.toContain('ch3');
    });

    it('channels without participant_npubs are always visible', () => {
      const result = filterChannelsForViewer(channels, VIEWER, OWNER);
      expect(result.map(c => c.record_id)).toContain('ch4');
      expect(result.map(c => c.record_id)).toContain('ch5');
    });

    it('returns all channels when viewerNpub is null', () => {
      const result = filterChannelsForViewer(channels, null, OWNER);
      expect(result).toHaveLength(5);
    });

    it('returns all channels when viewerNpub is undefined', () => {
      const result = filterChannelsForViewer(channels, undefined, OWNER);
      expect(result).toHaveLength(5);
    });
  });

  describe('channel tab ordering', () => {
    const orderedChannels = [
      { record_id: 'ch1', title: 'Team Channel', participant_npubs: [] },
      { record_id: 'ch2', title: 'DM: Pete', participant_npubs: [] },
      { record_id: 'ch3', title: 'WM21', participant_npubs: [] },
    ];

    function createStore(overrides = {}) {
      return {
        channels: [],
        channelOrder: [],
        channelDragSourceId: '',
        selectedChannelId: '',
        session: { npub: 'npub1owner' },
        workspaceOwnerNpub: 'npub1owner',
        MAIN_FEED_PAGE_SIZE: 20,
        mainFeedVisibleCount: 20,
        chatFeedNearTop: false,
        expandedChatMessageIds: [],
        truncatedChatMessageIds: [],
        pendingChatScrollToLatest: false,
        getChannelParticipants: (channel) => channel.participant_npubs || [],
        rememberPeople: vi.fn(),
        closeThread: vi.fn(),
        startSelectedChannelLiveQuery: vi.fn(),
        syncRoute: vi.fn(),
        applyMessages: vi.fn(),
        updatePageTitle: vi.fn(),
        saveWorkspaceChannelOrder: vi.fn(),
        ...overrides,
      };
    }

    it('applies saved channel order when channels load', async () => {
      const store = createStore({ channelOrder: ['ch3', 'ch1'] });

      await channelsManagerMixin.applyChannels.call(store, orderedChannels, { syncRoute: false });

      expect(store.channels.map((channel) => channel.record_id)).toEqual(['ch3', 'ch1', 'ch2']);
      expect(store.channelOrder).toEqual(['ch3', 'ch1', 'ch2']);
      expect(store.selectedChannelId).toBe('ch3');
    });

    it('preserves saved channel order through an empty channel batch', async () => {
      const store = createStore({ channelOrder: ['ch3', 'ch1'] });

      await channelsManagerMixin.applyChannels.call(store, [], { syncRoute: false });

      expect(store.channelOrder).toEqual(['ch3', 'ch1']);
      expect(store.channels).toEqual([]);
    });

    it('persists the new order after a tab drop', async () => {
      const store = createStore({
        channels: orderedChannels,
        channelOrder: ['ch1', 'ch2', 'ch3'],
        channelDragSourceId: 'ch3',
      });
      const event = { preventDefault: vi.fn() };

      await channelsManagerMixin.dropChannelTab.call(store, 'ch1', event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(store.channelDragSourceId).toBe('');
      expect(store.channelOrder).toEqual(['ch3', 'ch1', 'ch2']);
      expect(store.channels.map((channel) => channel.record_id)).toEqual(['ch3', 'ch1', 'ch2']);
      expect(store.saveWorkspaceChannelOrder).toHaveBeenCalledWith(['ch3', 'ch1', 'ch2']);
    });

    it('keeps the local order and surfaces sync errors when saving fails', async () => {
      const store = createStore({
        channels: orderedChannels,
        channelOrder: ['ch1', 'ch2', 'ch3'],
        channelDragSourceId: 'ch3',
        saveWorkspaceChannelOrder: vi.fn().mockRejectedValue(new Error('missing group keys')),
      });

      await channelsManagerMixin.dropChannelTab.call(store, 'ch1', { preventDefault: vi.fn() });

      expect(store.channelOrder).toEqual(['ch3', 'ch1', 'ch2']);
      expect(store.error).toBe('missing group keys');
    });
  });
});
