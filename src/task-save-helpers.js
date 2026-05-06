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

export function isTerminalTaskStateTransition(updatedTask, previousTask = null) {
  const nextState = String(updatedTask?.state || '').trim();
  const previousState = String(previousTask?.state || '').trim();
  return (nextState === 'done' || nextState === 'archive') && previousState !== nextState;
}

export function isBoardOrderOnlyTaskChange(updatedTask, previousTask = null) {
  const nextBoardOrder = Number(updatedTask?.board_order);
  const previousBoardOrder = Number(previousTask?.board_order);
  const boardOrderChanged = Number.isFinite(nextBoardOrder)
    && (!Number.isFinite(previousBoardOrder) || Math.abs(nextBoardOrder - previousBoardOrder) > 0.000001);
  if (!boardOrderChanged) return false;

  const contentKeys = [
    'title',
    'description',
    'state',
    'priority',
    'parent_task_id',
    'board_group_id',
    'assigned_to_npub',
    'scheduled_for',
    'tags',
    'scope_id',
    'scope_l1_id',
    'scope_l2_id',
    'scope_l3_id',
    'scope_l4_id',
    'scope_l5_id',
    'flow_id',
    'flow_run_id',
    'flow_step',
  ];

  return contentKeys.every((key) => (updatedTask?.[key] ?? null) === (previousTask?.[key] ?? null));
}

export function shouldUseOptimisticTaskWrite(updatedTask, previousTask = null) {
  return isTerminalTaskStateTransition(updatedTask, previousTask)
    || isBoardOrderOnlyTaskChange(updatedTask, previousTask);
}
