export function taskScopeAssignmentChanged(previousTask, nextTask) {
  return (previousTask?.scope_id || null) !== (nextTask?.scope_id || null)
    || (previousTask?.scope_l1_id || null) !== (nextTask?.scope_l1_id || null)
    || (previousTask?.scope_l2_id || null) !== (nextTask?.scope_l2_id || null)
    || (previousTask?.scope_l3_id || null) !== (nextTask?.scope_l3_id || null)
    || (previousTask?.scope_l4_id || null) !== (nextTask?.scope_l4_id || null)
    || (previousTask?.scope_l5_id || null) !== (nextTask?.scope_l5_id || null)
    || (previousTask?.board_group_id || null) !== (nextTask?.board_group_id || null)
    || JSON.stringify(previousTask?.group_ids || []) !== JSON.stringify(nextTask?.group_ids || [])
    || JSON.stringify(previousTask?.shares || []) !== JSON.stringify(nextTask?.shares || []);
}

export function buildCascadedSubtaskUpdate(subtask, assignment, updatedAt = new Date().toISOString()) {
  return {
    ...subtask,
    ...assignment,
    version: (subtask?.version ?? 1) + 1,
    sync_status: 'pending',
    updated_at: updatedAt,
  };
}
