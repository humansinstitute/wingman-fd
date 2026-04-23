import { selectPreferredWritableGroupRef } from './task-board-state.js';

function resolveGroupIdForStore(store, groupId) {
  if (typeof store?.resolveGroupId === 'function') return store.resolveGroupId(groupId);
  return String(groupId || '').trim() || null;
}

export function getStoreActorWritableGroupRefs(store) {
  if (typeof store?.getActorWritableGroupRefs === 'function') {
    return store.getActorWritableGroupRefs();
  }

  const viewerNpub = String(store?.session?.npub || '').trim();
  const workspaceOwnerNpub = String(store?.workspaceOwnerNpub || '').trim();
  if (!viewerNpub) return [];

  const groups = Array.isArray(store?.currentWorkspaceContentGroups) && store.currentWorkspaceContentGroups.length > 0
    ? store.currentWorkspaceContentGroups
    : (Array.isArray(store?.groups) ? store.groups : []);

  if (viewerNpub === workspaceOwnerNpub) {
    return [...new Set(groups
      .map((group) => resolveGroupIdForStore(store, group?.group_id || group?.group_npub))
      .filter(Boolean))];
  }

  return [...new Set(groups
    .filter((group) => {
      if (String(group?.private_member_npub || '').trim() === viewerNpub) return true;
      return Array.isArray(group?.member_npubs) && group.member_npubs.includes(viewerNpub);
    })
    .map((group) => resolveGroupIdForStore(store, group?.group_id || group?.group_npub))
    .filter(Boolean))];
}

export function getPreferredRecordWriteGroupForStore(store, record = null) {
  if (typeof store?.getPreferredRecordWriteGroup === 'function') {
    return store.getPreferredRecordWriteGroup(record);
  }
  const resolveGroupId = (groupId) => resolveGroupIdForStore(store, groupId);
  return selectPreferredWritableGroupRef({
    writeGroupId: record?.write_group_id,
    boardGroupId: record?.board_group_id,
    groupIds: record?.group_ids || [],
    scopePolicyGroupIds: record?.scope_policy_group_ids || [],
    shares: record?.shares || [],
    resolveGroupId,
    allowedGroupIds: getStoreActorWritableGroupRefs(store),
  });
}
