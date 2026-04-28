import { selectPreferredWritableGroupRef } from './task-board-state.js';
import { hasGroupKey } from './crypto/group-keys.js';

export function resolveGroupIdForStore(store, groupId) {
  if (typeof store?.resolveGroupId === 'function') return store.resolveGroupId(groupId);
  return String(groupId || '').trim() || null;
}

export function normalizeRecordDeliveryGroupRefs(record = null, options = {}) {
  const resolveGroupId = typeof options.resolveGroupId === 'function'
    ? options.resolveGroupId
    : (value) => String(value || '').trim() || null;
  const groupRefs = Array.isArray(options.groupRefs)
    ? options.groupRefs
    : (Array.isArray(record?.group_ids) ? record.group_ids : []);
  const seen = new Set();
  const normalized = [];
  for (const groupRef of groupRefs) {
    const resolved = resolveGroupId(groupRef) || String(groupRef || '').trim() || null;
    if (!resolved || seen.has(resolved)) continue;
    seen.add(resolved);
    normalized.push(resolved);
  }
  return normalized;
}

export function getRecordGroupKeyState(record = null, options = {}) {
  const hasKey = typeof options.hasKey === 'function' ? options.hasKey : hasGroupKey;
  const requestedGroupIds = normalizeRecordDeliveryGroupRefs(record, options);
  const encryptableGroupIds = requestedGroupIds.filter((groupId) => hasKey(groupId));
  const missingGroupIds = requestedGroupIds.filter((groupId) => !encryptableGroupIds.includes(groupId));
  return {
    requestedGroupIds,
    encryptableGroupIds,
    missingGroupIds,
  };
}

export async function getEncryptableRecordGroupRefsForStore(store, record = null, options = {}) {
  const label = options.label || 'Record write';
  const resolveGroupId = options.resolveGroupId || ((groupId) => resolveGroupIdForStore(store, groupId));
  const keyOptions = {
    ...options,
    resolveGroupId,
    hasKey: options.hasKey || hasGroupKey,
  };
  let { requestedGroupIds, encryptableGroupIds } = getRecordGroupKeyState(record, keyOptions);
  if (requestedGroupIds.length === 0) return [];

  if (encryptableGroupIds.length < requestedGroupIds.length && typeof store?.refreshGroups === 'function') {
    await store.refreshGroups({ force: true });
    ({ requestedGroupIds, encryptableGroupIds } = getRecordGroupKeyState(record, keyOptions));
  }

  if (encryptableGroupIds.length === 0) {
    throw new Error(`${label} is missing group keys: ${requestedGroupIds.join(', ')}`);
  }
  return encryptableGroupIds;
}

export async function getRecordWriteFieldsForStore(store, record = null, options = {}) {
  const groupIds = await getEncryptableRecordGroupRefsForStore(store, record, options);
  const resolveGroupId = options.resolveGroupId || ((groupId) => resolveGroupIdForStore(store, groupId));
  const explicitWriteGroupRef = resolveGroupId(options.writeGroupRef) || String(options.writeGroupRef || '').trim() || null;
  const safeExplicitWriteGroupRef = explicitWriteGroupRef && groupIds.includes(explicitWriteGroupRef)
    ? explicitWriteGroupRef
    : null;
  const writeGroupRef = safeExplicitWriteGroupRef || selectPreferredRecordWriteGroupRef({
    ...record,
    group_ids: groupIds,
  }, {
    resolveGroupId,
    allowedGroupIds: options.allowedGroupIds || getStoreActorWritableGroupRefs(store),
    hasKey: options.hasKey || hasGroupKey,
  });
  return {
    group_ids: groupIds,
    write_group_ref: writeGroupRef,
  };
}

export function getMissingRecordGroupRefsForStore(store, record = null, options = {}) {
  const resolveGroupId = options.resolveGroupId || ((groupId) => resolveGroupIdForStore(store, groupId));
  return getRecordGroupKeyState(record, {
    ...options,
    resolveGroupId,
    hasKey: options.hasKey || hasGroupKey,
  }).missingGroupIds;
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

  const sharedRefs = [];
  const privateRefs = [];
  const seen = new Set();

  for (const group of groups) {
    const isViewerPrivate = String(group?.private_member_npub || '').trim() === viewerNpub;
    const hasMembership = Array.isArray(group?.member_npubs) && group.member_npubs.includes(viewerNpub);
    if (!isViewerPrivate && !hasMembership) continue;

    const groupRef = resolveGroupIdForStore(store, group?.group_id || group?.group_npub);
    if (!groupRef || seen.has(groupRef)) continue;
    seen.add(groupRef);

    if (isViewerPrivate) {
      privateRefs.push(groupRef);
    } else {
      sharedRefs.push(groupRef);
    }
  }

  return [...sharedRefs, ...privateRefs];
}

export function selectPreferredRecordWriteGroupRef(record = null, options = {}) {
  const resolveGroupId = typeof options.resolveGroupId === 'function'
    ? options.resolveGroupId
    : (value) => String(value || '').trim() || null;
  return selectPreferredWritableGroupRef({
    writeGroupId: record?.write_group_id,
    boardGroupId: record?.board_group_id,
    groupIds: record?.group_ids || [],
    scopePolicyGroupIds: record?.scope_policy_group_ids || [],
    shares: record?.shares || [],
    resolveGroupId,
    allowedGroupIds: options.allowedGroupIds || [],
    hasKey: options.hasKey || hasGroupKey,
  });
}

export function getPreferredRecordWriteGroupForStore(store, record = null) {
  if (typeof store?.getPreferredRecordWriteGroup === 'function') {
    return store.getPreferredRecordWriteGroup(record);
  }
  return selectPreferredRecordWriteGroupRef(record, {
    resolveGroupId: (groupId) => resolveGroupIdForStore(store, groupId),
    allowedGroupIds: getStoreActorWritableGroupRefs(store),
  });
}
