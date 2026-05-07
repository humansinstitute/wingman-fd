export function isTaskBlockedByPendingSave(task, pendingWrites = null, familyHash = null) {
  if (String(task?.sync_status || '').trim() !== 'pending') return false;
  const coeditState = String(task?.coedit_state || '').trim();
  if (coeditState === 'conflicted' || coeditState === 'rejected') return true;
  if (Array.isArray(pendingWrites) && familyHash) {
    return false;
  }
  return true;
}

export function getPendingRecordWrites(pendingWrites = [], recordId, familyHash) {
  if (!recordId || !familyHash) return [];
  return pendingWrites.filter((write) =>
    String(write?.record_id || write?.envelope?.record_id || '') === recordId
    && String(write?.record_family_hash || write?.envelope?.record_family_hash || '') === familyHash
  );
}

export function hasPendingRecordWrite(pendingWrites = [], recordId, familyHash) {
  return getPendingRecordWrites(pendingWrites, recordId, familyHash).length > 0;
}

export function getPendingRecordBaseVersion(pendingWrites = [], recordId, familyHash) {
  const versions = getPendingRecordWrites(pendingWrites, recordId, familyHash)
    .map((write) => Number(write?.envelope?.previous_version ?? Number.NaN))
    .filter((version) => Number.isFinite(version) && version >= 0);
  if (versions.length === 0) return null;
  return Math.min(...versions);
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
