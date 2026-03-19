import { describe, expect, it } from 'vitest';
import { resolveChannelLabel } from '../src/channel-labels.js';

describe('channel labels', () => {
  it('prefers the stored title for named channels', () => {
    const label = resolveChannelLabel(
      {
        record_id: 'channel-1',
        title: 'Other Stuff',
        participant_npubs: ['npub_me', 'npub_a', 'npub_b'],
      },
      {
        sessionNpub: 'npub_me',
        getParticipants: (channel) => channel.participant_npubs,
        getSenderName: (npub) => ({ npub_a: 'Alice', npub_b: 'Bob' }[npub] || npub),
      },
    );

    expect(label).toBe('Other Stuff');
  });

  it('uses participant names for DM-labelled channels', () => {
    const label = resolveChannelLabel(
      {
        record_id: 'channel-2',
        title: 'DM: Alice',
        participant_npubs: ['npub_me', 'npub_a'],
      },
      {
        sessionNpub: 'npub_me',
        getParticipants: (channel) => channel.participant_npubs,
        getSenderName: (npub) => ({ npub_a: 'Alice' }[npub] || npub),
      },
    );

    expect(label).toBe('Alice');
  });
});
