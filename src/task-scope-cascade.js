function sameArray(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      if (typeof a[i] === 'object' && typeof b[i] === 'object') {
        const ak = a[i], bk = b[i];
        if ((ak?.group_npub ?? null) !== (bk?.group_npub ?? null)
          || (ak?.via_group_npub ?? null) !== (bk?.via_group_npub ?? null)) return false;
      } else {
        return false;
      }
    }
  }
  return true;
}

export function taskScopeAssignmentChanged(previousTask, nextTask) {
  return (previousTask?.scope_id || null) !== (nextTask?.scope_id || null)
    || (previousTask?.scope_l1_id || null) !== (nextTask?.scope_l1_id || null)
    || (previousTask?.scope_l2_id || null) !== (nextTask?.scope_l2_id || null)
    || (previousTask?.scope_l3_id || null) !== (nextTask?.scope_l3_id || null)
    || (previousTask?.scope_l4_id || null) !== (nextTask?.scope_l4_id || null)
    || (previousTask?.scope_l5_id || null) !== (nextTask?.scope_l5_id || null)
    || (previousTask?.board_group_id || null) !== (nextTask?.board_group_id || null)
    || !sameArray(previousTask?.group_ids || [], nextTask?.group_ids || [])
    || !sameArray(previousTask?.shares || [], nextTask?.shares || []);
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
