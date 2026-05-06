export function isTaskBlockedByPendingSave(task) {
  return String(task?.sync_status || '').trim() === 'pending';
}

export function hasPendingRecordWrite(pendingWrites = [], recordId, familyHash) {
  if (!recordId || !familyHash) return false;
  return pendingWrites.some((write) =>
    write?.record_id === recordId
    && write?.record_family_hash === familyHash
  );
}

export function markTaskEditSyncedAfterAcceptedFlush(task, pendingWrites = [], familyHash) {
  if (!task?.record_id) return null;
  if (hasPendingRecordWrite(pendingWrites, task.record_id, familyHash)) return null;
  return {
    ...task,
    sync_status: 'synced',
    coedit_state: null,
    conflict_reason: null,
  };
}
