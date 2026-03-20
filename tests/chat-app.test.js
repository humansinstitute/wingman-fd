import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  openWorkspaceDb,
  getSharedDb,
  upsertChannel,
  getChannelsByOwner,
  upsertMessage,
  getMessagesByChannel,
  getRecentChatMessagesSince,
  upsertDocument,
  upsertDirectory,
  getRecentDocumentChangesSince,
  getRecentDirectoryChangesSince,
  addPendingWrite,
  getPendingWrites,
  saveSettings,
  getSettings,
  upsertWorkspaceSettings,
  getWorkspaceSettings,
  cacheStorageImage,
  getCachedStorageImage,
} from '../src/db.js';

const TEST_OWNER = 'npub_test_workspace';

// Clear all tables between tests
beforeEach(async () => {
  const wsDb = openWorkspaceDb(TEST_OWNER);
  await wsDb.open();
  await Promise.all(wsDb.tables.map(table => table.clear()));
  const shared = getSharedDb();
  await shared.open();
  await Promise.all(shared.tables.map(table => table.clear()));
});

describe('app DB operations', () => {
  it('creating a bot DM writes a pending channel row', async () => {
    const channelId = 'ch-bot-dm';
    const ownerNpub = 'npub_test_owner';

    // Simulate what createBotDm does: upsert channel + add pending write
    await upsertChannel({
      record_id: channelId,
      owner_npub: ownerNpub,
      title: 'DM: owner + bot',
      group_ids: ['gpub_bot'],
      participant_npubs: [ownerNpub, 'npub_bot'],
      version: 1,
      updated_at: new Date().toISOString(),
    });

    await addPendingWrite({
      record_id: channelId,
      record_family_hash: 'coworker:channel',
      envelope: { record_id: channelId },
    });

    // Verify channel exists
    const channels = await getChannelsByOwner(ownerNpub);
    expect(channels).toHaveLength(1);
    expect(channels[0].record_id).toBe(channelId);
    expect(channels[0].title).toBe('DM: owner + bot');

    // Verify pending write exists
    const pending = await getPendingWrites();
    expect(pending).toHaveLength(1);
    expect(pending[0].record_id).toBe(channelId);
    expect(pending[0].record_family_hash).toBe('coworker:channel');
  });

  it('sending a message writes a pending chat row', async () => {
    const channelId = 'ch-1';
    const msgId = 'msg-test';
    const ownerNpub = 'npub_test_owner';

    // Pre-create channel
    await upsertChannel({
      record_id: channelId,
      owner_npub: ownerNpub,
      title: 'Test channel',
      group_ids: ['gpub_1'],
      participant_npubs: [ownerNpub],
      version: 1,
      updated_at: new Date().toISOString(),
    });

    // Simulate sendMessage: upsert local message + add pending write
    await upsertMessage({
      record_id: msgId,
      channel_id: channelId,
      parent_message_id: null,
      body: 'hello from test',
      sender_npub: ownerNpub,
      sync_status: 'pending',
      version: 1,
      updated_at: new Date().toISOString(),
    });

    await addPendingWrite({
      record_id: msgId,
      record_family_hash: 'coworker:chat_message',
      envelope: { record_id: msgId },
    });

    // Verify message in channel
    const msgs = await getMessagesByChannel(channelId);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].body).toBe('hello from test');
    expect(msgs[0].sync_status).toBe('pending');

    // Verify pending write
    const pending = await getPendingWrites();
    expect(pending).toHaveLength(1);
    expect(pending[0].record_id).toBe(msgId);
    expect(pending[0].record_family_hash).toBe('coworker:chat_message');
  });

  it('thread replies persist parent_message_id in the local table', async () => {
    const channelId = 'ch-thread';
    const parentId = 'msg-parent';
    const replyId = 'msg-reply';
    const ownerNpub = 'npub_test_owner';

    await upsertChannel({
      record_id: channelId,
      owner_npub: ownerNpub,
      title: 'Thread test channel',
      group_ids: ['gpub_1'],
      participant_npubs: [ownerNpub],
      version: 1,
      updated_at: new Date().toISOString(),
    });

    await upsertMessage({
      record_id: parentId,
      channel_id: channelId,
      parent_message_id: null,
      body: 'parent',
      sender_npub: ownerNpub,
      sync_status: 'synced',
      version: 1,
      updated_at: new Date().toISOString(),
    });

    await upsertMessage({
      record_id: replyId,
      channel_id: channelId,
      parent_message_id: parentId,
      body: 'reply',
      sender_npub: ownerNpub,
      sync_status: 'pending',
      version: 1,
      updated_at: new Date().toISOString(),
    });

    const msgs = await getMessagesByChannel(channelId);
    const reply = msgs.find(msg => msg.record_id === replyId);
    expect(reply?.parent_message_id).toBe(parentId);
  });

  it('settings round-trip', async () => {
    await saveSettings({ backendUrl: 'https://api.test', ownerNpub: 'npub_x', botNpub: 'npub_y' });
    const s = await getSettings();
    expect(s.backendUrl).toBe('https://api.test');
    expect(s.ownerNpub).toBe('npub_x');
    expect(s.botNpub).toBe('npub_y');
  });

  it('workspace settings round-trip by workspace owner', async () => {
    await upsertWorkspaceSettings({
      workspace_owner_npub: 'npub_workspace',
      record_id: 'workspace-settings:npub_workspace',
      owner_npub: 'npub_workspace',
      wingman_harness_url: 'https://wm21.otherstuff.ai',
      group_ids: ['gpub_workspace'],
      version: 3,
      updated_at: '2026-03-16T00:00:00.000Z',
    });

    const settings = await getWorkspaceSettings('npub_workspace');
    expect(settings?.record_id).toBe('workspace-settings:npub_workspace');
    expect(settings?.wingman_harness_url).toBe('https://wm21.otherstuff.ai');
    expect(settings?.group_ids).toEqual(['gpub_workspace']);
    expect(settings?.version).toBe(3);
  });

  it('storage image cache round-trip', async () => {
    const blob = new Blob([Uint8Array.from([137, 80, 78, 71])], { type: 'image/png' });
    await cacheStorageImage({
      object_id: 'img-1',
      blob,
      content_type: 'image/png',
      cached_at: 123,
    });

    const cached = await getCachedStorageImage('img-1');
    expect(cached?.object_id).toBe('img-1');
    expect(cached?.content_type).toBe('image/png');
    expect(cached?.cached_at).toBe(123);
    expect(cached?.blob).toBeInstanceOf(Blob);
    expect(cached?.blob.size).toBe(blob.size);
  });

  it('recent chat changes exclude deleted rows and sort newest first', async () => {
    const channelId = 'ch-status';
    const ownerNpub = 'npub_test_owner';

    await upsertChannel({
      record_id: channelId,
      owner_npub: ownerNpub,
      title: 'Status test',
      group_ids: [],
      participant_npubs: [ownerNpub],
      record_state: 'active',
      version: 1,
      updated_at: '2026-03-12T00:00:00.000Z',
    });

    await upsertMessage({
      record_id: 'msg-old',
      channel_id: channelId,
      parent_message_id: null,
      body: 'older',
      sender_npub: ownerNpub,
      sync_status: 'synced',
      record_state: 'active',
      version: 1,
      updated_at: '2026-03-12T01:00:00.000Z',
    });

    await upsertMessage({
      record_id: 'msg-hidden',
      channel_id: channelId,
      parent_message_id: null,
      body: 'hidden',
      sender_npub: ownerNpub,
      sync_status: 'synced',
      record_state: 'deleted',
      version: 2,
      updated_at: '2026-03-12T03:00:00.000Z',
    });

    await upsertMessage({
      record_id: 'msg-new',
      channel_id: channelId,
      parent_message_id: null,
      body: 'newer',
      sender_npub: ownerNpub,
      sync_status: 'synced',
      record_state: 'active',
      version: 1,
      updated_at: '2026-03-12T02:00:00.000Z',
    });

    const recent = await getRecentChatMessagesSince('2026-03-12T00:30:00.000Z');
    expect(recent.map((row) => row.record_id)).toEqual(['msg-new', 'msg-old']);
  });

  it('recent doc and directory changes exclude deleted rows and sort newest first', async () => {
    const ownerNpub = 'npub_test_owner';

    await upsertDirectory({
      record_id: 'dir-old',
      owner_npub: ownerNpub,
      title: 'Folder old',
      parent_directory_id: null,
      shares: [],
      sync_status: 'synced',
      record_state: 'active',
      version: 1,
      updated_at: '2026-03-12T01:00:00.000Z',
    });

    await upsertDirectory({
      record_id: 'dir-hidden',
      owner_npub: ownerNpub,
      title: 'Folder hidden',
      parent_directory_id: null,
      shares: [],
      sync_status: 'synced',
      record_state: 'deleted',
      version: 2,
      updated_at: '2026-03-12T03:00:00.000Z',
    });

    await upsertDocument({
      record_id: 'doc-new',
      owner_npub: ownerNpub,
      title: 'Doc new',
      content: 'content',
      parent_directory_id: 'dir-old',
      shares: [],
      sync_status: 'synced',
      record_state: 'active',
      version: 1,
      updated_at: '2026-03-12T02:00:00.000Z',
    });

    await upsertDocument({
      record_id: 'doc-hidden',
      owner_npub: ownerNpub,
      title: 'Doc hidden',
      content: 'content',
      parent_directory_id: null,
      shares: [],
      sync_status: 'synced',
      record_state: 'deleted',
      version: 2,
      updated_at: '2026-03-12T04:00:00.000Z',
    });

    const recentDocs = await getRecentDocumentChangesSince('2026-03-12T00:30:00.000Z');
    const recentDirs = await getRecentDirectoryChangesSince('2026-03-12T00:30:00.000Z');

    expect(recentDocs.map((row) => row.record_id)).toEqual(['doc-new']);
    expect(recentDirs.map((row) => row.record_id)).toEqual(['dir-old']);
  });
});
