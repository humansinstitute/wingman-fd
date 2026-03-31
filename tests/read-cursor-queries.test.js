import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';

globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;

const {
  openWorkspaceDb,
  getReadCursorsByKeys,
  getReadCursorsByPrefix,
  getMessagesByChannel,
  getCommentsByTarget,
  getWindowedTasksByOwner,
  upsertReadCursor,
  upsertMessage,
  upsertComment,
  upsertTask,
} = await import('../src/db.js');

const TEST_OWNER = 'npub_test_workspace';
const VIEWER = 'npub_viewer';
const OTHER_VIEWER = 'npub_other_viewer';

beforeEach(async () => {
  const wsDb = openWorkspaceDb(TEST_OWNER);
  await wsDb.open();
  await Promise.all(wsDb.tables.map((table) => table.clear()));
});

describe('read cursor query helpers', () => {
  it('reads only the requested keys for a viewer', async () => {
    await upsertReadCursor({
      record_id: 'c-1',
      cursor_key: 'chat:nav',
      viewer_npub: VIEWER,
      read_until: '2026-03-31T10:00:00.000Z',
    });
    await upsertReadCursor({
      record_id: 'c-2',
      cursor_key: 'tasks:item:task-1',
      viewer_npub: VIEWER,
      read_until: '2026-03-31T11:00:00.000Z',
    });
    await upsertReadCursor({
      record_id: 'c-3',
      cursor_key: 'tasks:item:task-2',
      viewer_npub: OTHER_VIEWER,
      read_until: '2026-03-31T12:00:00.000Z',
    });

    const exact = await getReadCursorsByKeys(VIEWER, ['chat:nav', 'tasks:item:task-1']);
    expect(exact.map((row) => row.cursor_key).sort()).toEqual(['chat:nav', 'tasks:item:task-1']);

    const taskPrefix = await getReadCursorsByPrefix(VIEWER, 'tasks:item:');
    expect(taskPrefix).toHaveLength(1);
    expect(taskPrefix[0].cursor_key).toBe('tasks:item:task-1');
  });
});

describe('windowed query helpers', () => {
  it('returns the newest channel messages while preserving chronological display order', async () => {
    await upsertMessage({
      record_id: 'm-1',
      channel_id: 'channel-1',
      body: 'oldest',
      sender_npub: VIEWER,
      record_state: 'active',
      sync_status: 'synced',
      updated_at: '2026-03-31T10:00:00.000Z',
    });
    await upsertMessage({
      record_id: 'm-2',
      channel_id: 'channel-1',
      body: 'middle',
      sender_npub: VIEWER,
      record_state: 'active',
      sync_status: 'synced',
      updated_at: '2026-03-31T11:00:00.000Z',
    });
    await upsertMessage({
      record_id: 'm-3',
      channel_id: 'channel-1',
      body: 'newest',
      sender_npub: VIEWER,
      record_state: 'active',
      sync_status: 'synced',
      updated_at: '2026-03-31T12:00:00.000Z',
    });

    const window = await getMessagesByChannel('channel-1', { limit: 2 });
    expect(window.map((row) => row.record_id)).toEqual(['m-2', 'm-3']);
  });

  it('windows task projections by updated_at', async () => {
    await upsertTask({
      record_id: 't-1',
      owner_npub: TEST_OWNER,
      state: 'new',
      record_state: 'active',
      sync_status: 'synced',
      updated_at: '2026-03-31T10:00:00.000Z',
    });
    await upsertTask({
      record_id: 't-2',
      owner_npub: TEST_OWNER,
      state: 'new',
      record_state: 'active',
      sync_status: 'synced',
      updated_at: '2026-03-31T11:00:00.000Z',
    });
    await upsertTask({
      record_id: 't-3',
      owner_npub: TEST_OWNER,
      state: 'new',
      record_state: 'active',
      sync_status: 'synced',
      updated_at: '2026-03-31T12:00:00.000Z',
    });

    const window = await getWindowedTasksByOwner(TEST_OWNER, { limit: 2 });
    expect(window.map((row) => row.record_id)).toEqual(['t-3', 't-2']);
  });

  it('windows comment threads newest-first', async () => {
    await upsertComment({
      record_id: 'c-1',
      target_record_id: 'doc-1',
      target_record_family_hash: 'coworker:document',
      body: 'oldest',
      record_state: 'active',
      updated_at: '2026-03-31T10:00:00.000Z',
    });
    await upsertComment({
      record_id: 'c-2',
      target_record_id: 'doc-1',
      target_record_family_hash: 'coworker:document',
      body: 'middle',
      record_state: 'active',
      updated_at: '2026-03-31T11:00:00.000Z',
    });
    await upsertComment({
      record_id: 'c-3',
      target_record_id: 'doc-1',
      target_record_family_hash: 'coworker:document',
      body: 'newest',
      record_state: 'active',
      updated_at: '2026-03-31T12:00:00.000Z',
    });

    const window = await getCommentsByTarget('doc-1', { limit: 2 });
    expect(window.map((row) => row.record_id)).toEqual(['c-3', 'c-2']);
  });
});
