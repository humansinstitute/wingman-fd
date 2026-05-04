import { beforeEach, describe, expect, it } from 'vitest';
import {
  getReactionByIdentity,
  getReactionsByTarget,
  getReactionsByTargets,
  openWorkspaceDb,
  upsertReaction,
} from '../src/db.js';
import { summarizeReactions } from '../src/reactions.js';

const TEST_OWNER = 'npub_test_reactions_workspace';
const CHAT_FAMILY = 'app:chat_message';

beforeEach(async () => {
  const wsDb = openWorkspaceDb(TEST_OWNER);
  await wsDb.open();
  await Promise.all(wsDb.tables.map((table) => table.clear()));
});

describe('reaction db helpers', () => {
  it('upserts reactions by record id and loads them by target', async () => {
    await upsertReaction({
      record_id: 'reaction-1',
      owner_npub: 'npub_owner',
      target_record_id: 'message-1',
      target_record_family_hash: CHAT_FAMILY,
      emoji: 'thumbs_up',
      emoji_shortcode: ':thumbs_up:',
      reactor_npub: 'npub_actor',
      record_state: 'active',
      version: 1,
      updated_at: '2026-04-30T00:00:00.000Z',
    });

    const rows = await getReactionsByTarget('message-1', CHAT_FAMILY);
    expect(rows).toHaveLength(1);
    expect(rows[0].record_id).toBe('reaction-1');
  });

  it('dedupes same target emoji reactor identity by keeping the newest row', async () => {
    await upsertReaction({
      record_id: 'reaction-old',
      owner_npub: 'npub_owner',
      target_record_id: 'message-1',
      target_record_family_hash: CHAT_FAMILY,
      emoji: 'heart',
      emoji_shortcode: ':heart:',
      reactor_npub: 'npub_actor',
      record_state: 'active',
      version: 1,
      updated_at: '2026-04-30T00:00:00.000Z',
    });
    await upsertReaction({
      record_id: 'reaction-new',
      owner_npub: 'npub_owner',
      target_record_id: 'message-1',
      target_record_family_hash: CHAT_FAMILY,
      emoji: 'heart',
      emoji_shortcode: ':heart:',
      reactor_npub: 'npub_actor',
      record_state: 'deleted',
      version: 2,
      updated_at: '2026-04-30T00:01:00.000Z',
    });

    const match = await getReactionByIdentity({
      target_record_id: 'message-1',
      target_record_family_hash: CHAT_FAMILY,
      emoji: 'heart',
      reactor_npub: 'npub_actor',
    });
    expect(match.record_id).toBe('reaction-new');
    expect(match.record_state).toBe('deleted');
  });

  it('loads reactions for batches and summarizes active unique reactors', async () => {
    await upsertReaction({
      record_id: 'reaction-1',
      target_record_id: 'message-1',
      target_record_family_hash: CHAT_FAMILY,
      emoji: 'thumbs_up',
      emoji_shortcode: ':thumbs_up:',
      reactor_npub: 'npub_me',
      record_state: 'active',
      updated_at: '2026-04-30T00:00:00.000Z',
    });
    await upsertReaction({
      record_id: 'reaction-2',
      target_record_id: 'message-1',
      target_record_family_hash: CHAT_FAMILY,
      emoji: 'thumbs_up',
      emoji_shortcode: ':thumbs_up:',
      reactor_npub: 'npub_friend',
      record_state: 'active',
      updated_at: '2026-04-30T00:01:00.000Z',
    });
    await upsertReaction({
      record_id: 'reaction-3',
      target_record_id: 'message-2',
      target_record_family_hash: CHAT_FAMILY,
      emoji: 'eyes',
      emoji_shortcode: ':eyes:',
      reactor_npub: 'npub_friend',
      record_state: 'deleted',
      updated_at: '2026-04-30T00:02:00.000Z',
    });

    const rows = await getReactionsByTargets(['message-1', 'message-2'], CHAT_FAMILY);
    expect(rows).toHaveLength(3);

    expect(summarizeReactions(rows, 'npub_me')).toEqual([
      {
        emoji: 'thumbs_up',
        emoji_shortcode: ':thumbs_up:',
        count: 2,
        reacted_by_me: true,
        reactor_npubs: ['npub_me', 'npub_friend'],
      },
    ]);
  });
});
