import { describe, expect, it } from 'vitest';
import {
  getPendingRecordBaseVersion,
  getPendingRecordWrites,
  hasPendingRecordWrite,
  isTaskBlockedByPendingSave,
  markTaskEditSyncedAfterAcceptedFlush,
} from '../src/task-save-helpers.js';

describe('task save helpers', () => {
  it('blocks editing or saving tasks that still have a pending local write', () => {
    expect(isTaskBlockedByPendingSave({ sync_status: 'pending' })).toBe(true);
    expect(isTaskBlockedByPendingSave({ sync_status: 'synced' })).toBe(false);
    expect(isTaskBlockedByPendingSave(null)).toBe(false);
  });

  it('does not block editable pending tasks when pending writes can be inspected', () => {
    const task = { record_id: 'task-1', sync_status: 'pending' };

    expect(isTaskBlockedByPendingSave(task, [], 'task-family')).toBe(false);
    expect(isTaskBlockedByPendingSave(task, [
      { record_id: 'task-1', record_family_hash: 'task-family', envelope: { previous_version: 0 } },
    ], 'task-family')).toBe(false);
  });

  it('still blocks conflicted pending tasks', () => {
    expect(isTaskBlockedByPendingSave({
      record_id: 'task-1',
      sync_status: 'pending',
      coedit_state: 'conflicted',
    }, [
      { record_id: 'task-1', record_family_hash: 'task-family', envelope: { previous_version: 2 } },
    ], 'task-family')).toBe(true);
  });

  it('matches pending writes by record id and task family hash', () => {
    const pendingWrites = [
      { record_id: 'task-1', record_family_hash: 'task-family', envelope: { previous_version: 0 } },
      { record_id: 'task-1', record_family_hash: 'doc-family' },
    ];

    expect(hasPendingRecordWrite(pendingWrites, 'task-1', 'task-family')).toBe(true);
    expect(getPendingRecordWrites(pendingWrites, 'task-1', 'task-family')).toHaveLength(1);
    expect(hasPendingRecordWrite(pendingWrites, 'task-2', 'task-family')).toBe(false);
    expect(hasPendingRecordWrite(pendingWrites, 'task-1', 'other-family')).toBe(false);
  });

  it('uses the oldest pending write previous version as the editable base', () => {
    const pendingWrites = [
      { record_id: 'task-1', record_family_hash: 'task-family', envelope: { previous_version: 3 } },
      { record_id: 'task-1', record_family_hash: 'task-family', envelope: { previous_version: 1 } },
      { record_id: 'task-2', record_family_hash: 'task-family', envelope: { previous_version: 0 } },
    ];

    expect(getPendingRecordBaseVersion(pendingWrites, 'task-1', 'task-family')).toBe(1);
    expect(getPendingRecordBaseVersion(pendingWrites, 'task-2', 'task-family')).toBe(0);
    expect(getPendingRecordBaseVersion(pendingWrites, 'task-3', 'task-family')).toBeNull();
  });

  it('marks an accepted task edit as synced once its pending write has been flushed', () => {
    const task = {
      record_id: 'task-1',
      title: 'Edited task',
      version: 3,
      sync_status: 'pending',
      coedit_state: 'checkout_required',
      conflict_reason: 'checkout',
    };

    const synced = markTaskEditSyncedAfterAcceptedFlush(task, [], 'task-family');

    expect(synced).toMatchObject({
      record_id: 'task-1',
      version: 3,
      sync_status: 'synced',
      coedit_state: null,
      conflict_reason: null,
    });
  });

  it('keeps an edited task pending when its write is still queued', () => {
    const task = { record_id: 'task-1', version: 3, sync_status: 'pending' };
    const pendingWrites = [{ record_id: 'task-1', record_family_hash: 'task-family' }];

    expect(markTaskEditSyncedAfterAcceptedFlush(task, pendingWrites, 'task-family')).toBeNull();
  });
});
