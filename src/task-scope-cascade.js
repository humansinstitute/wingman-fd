export function taskScopeAssignmentChanged(previousTask, nextTask) {
  return (previousTask?.scope_id || null) !== (nextTask?.scope_id || null)
    || (previousTask?.scope_product_id || null) !== (nextTask?.scope_product_id || null)
    || (previousTask?.scope_project_id || null) !== (nextTask?.scope_project_id || null)
    || (previousTask?.scope_deliverable_id || null) !== (nextTask?.scope_deliverable_id || null)
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
