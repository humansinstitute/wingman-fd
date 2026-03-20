import { beforeEach, describe, expect, it } from 'vitest';
import {
  openWorkspaceDb,
  addPendingWrite,
  clearRuntimeFamilies,
  clearSyncStateForFamilies,
  getPendingWritesByFamilies,
  getSyncState,
  getTaskById,
  getCommentsByTarget,
  getAudioNoteById,
  setSyncState,
  upsertAudioNote,
  upsertComment,
  upsertTask,
} from '../src/db.js';
import { getSyncFamily, getSyncStateKeyForFamily, SYNC_FAMILY_OPTIONS } from '../src/sync-families.js';

const TEST_OWNER = 'npub_test_workspace';

beforeEach(async () => {
  const wsDb = openWorkspaceDb(TEST_OWNER);
  await wsDb.open();
  await Promise.all(wsDb.tables.map((table) => table.clear()));
});

describe('sync repair helpers', () => {
  it('exposes stable metadata for all selectable sync families', () => {
    expect(SYNC_FAMILY_OPTIONS.map((family) => family.id)).toEqual([
      'settings',
      'channel',
      'chat_message',
      'directory',
      'document',
      'task',
      'schedule',
      'comment',
      'audio_note',
      'scope',
    ]);
    expect(getSyncFamily('comment')?.table).toBe('comments');
    expect(getSyncStateKeyForFamily('audio_note')).toBe(`sync_since:${getSyncFamily('audio_note')?.hash}`);
  });

  it('clears only the selected local families and sync cursors', async () => {
    await upsertComment({
      record_id: 'comment-1',
      target_record_id: 'doc-1',
      target_record_family_hash: 'family:document',
      parent_comment_id: null,
      body: 'Hello',
      sender_npub: 'npub_commenter',
      record_state: 'active',
      updated_at: '2026-03-17T00:00:00.000Z',
    });
    await upsertAudioNote({
      record_id: 'audio-1',
      owner_npub: 'npub_owner',
      target_record_id: 'comment-1',
      target_record_family_hash: 'family:comment',
      record_state: 'active',
      updated_at: '2026-03-17T00:00:00.000Z',
    });
    await upsertTask({
      record_id: 'task-1',
      owner_npub: 'npub_owner',
      title: 'Keep me',
      state: 'new',
      record_state: 'active',
      updated_at: '2026-03-17T00:00:00.000Z',
    });

    await setSyncState(getSyncStateKeyForFamily('comment'), '2026-03-17T00:00:00.000Z');
    await setSyncState(getSyncStateKeyForFamily('audio_note'), '2026-03-17T00:00:00.000Z');
    await setSyncState(getSyncStateKeyForFamily('task'), '2026-03-17T00:00:00.000Z');

    await clearRuntimeFamilies(['comment', 'audio_note']);
    await clearSyncStateForFamilies(['comment', 'audio_note']);

    expect(await getCommentsByTarget('doc-1')).toEqual([]);
    expect(await getAudioNoteById('audio-1')).toBeUndefined();
    expect((await getTaskById('task-1'))?.title).toBe('Keep me');
    expect(await getSyncState(getSyncStateKeyForFamily('comment'))).toBeNull();
    expect(await getSyncState(getSyncStateKeyForFamily('audio_note'))).toBeNull();
    expect(await getSyncState(getSyncStateKeyForFamily('task'))).toBe('2026-03-17T00:00:00.000Z');
  });

  it('detects pending writes only for the selected families', async () => {
    await addPendingWrite({
      record_id: 'comment-1',
      record_family_hash: getSyncFamily('comment').hash,
      envelope: { record_id: 'comment-1' },
    });
    await addPendingWrite({
      record_id: 'task-1',
      record_family_hash: getSyncFamily('task').hash,
      envelope: { record_id: 'task-1' },
    });

    const pending = await getPendingWritesByFamilies(['comment', 'audio_note']);
    expect(pending).toHaveLength(1);
    expect(pending[0].record_id).toBe('comment-1');
  });
});
