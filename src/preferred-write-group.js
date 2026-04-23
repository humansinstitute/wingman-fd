import { selectPreferredWritableGroupRef } from './task-board-state.js';

export function getPreferredRecordWriteGroupForStore(store, record = null) {
  if (typeof store?.getPreferredRecordWriteGroup === 'function') {
    return store.getPreferredRecordWriteGroup(record);
  }
  const resolveGroupId = typeof store?.resolveGroupId === 'function'
    ? (groupId) => store.resolveGroupId(groupId)
    : (groupId) => String(groupId || '').trim() || null;
  return selectPreferredWritableGroupRef({
    writeGroupId: record?.write_group_id,
    boardGroupId: record?.board_group_id,
    groupIds: record?.group_ids || [],
    scopePolicyGroupIds: record?.scope_policy_group_ids || [],
    shares: record?.shares || [],
    resolveGroupId,
  });
}
