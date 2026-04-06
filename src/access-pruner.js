/**
 * Access pruner — removes locally cached records the viewer can no longer access.
 *
 * After sync, group membership may have changed (user removed from a group,
 * scope access revoked). This module scans local Dexie tables and deletes
 * records whose group_ids do not intersect with the viewer's current groups.
 * Child records (messages → channel, comments → target) are cascade-deleted.
 */

import { getWorkspaceDb, getAllGroups } from './db.js';

// Tables whose rows carry a `group_ids` array that determines access.
const GROUP_BEARING_TABLES = [
  'channels',
  'scopes',
  'tasks',
  'documents',
  'directories',
  'reports',
  'schedules',
  'audio_notes',
];

/**
 * Build the set of group IDs the viewer can access.
 * The workspace owner can access all groups.
 */
function buildAccessibleGroupIds(groups, viewerNpub, workspaceOwnerNpub) {
  if (viewerNpub === workspaceOwnerNpub) {
    return null; // null = owner, skip pruning
  }
  const accessible = new Set();
  for (const group of groups) {
    const members = group.member_npubs ?? [];
    if (members.includes(viewerNpub)) {
      accessible.add(group.group_id);
      if (group.group_npub) accessible.add(group.group_npub);
    }
  }
  return accessible;
}

/**
 * Check whether a record is inaccessible given the viewer's groups.
 * Records with empty group_ids are considered unscoped and always accessible.
 */
function isInaccessible(record, accessibleGroupIds) {
  const groupIds = record.group_ids;
  if (!Array.isArray(groupIds) || groupIds.length === 0) return false;
  return !groupIds.some((gid) => accessibleGroupIds.has(gid));
}

/**
 * Prune records from group-bearing tables, then cascade to children.
 *
 * @param {string} viewerNpub - The current viewer's npub
 * @param {string} workspaceOwnerNpub - The workspace owner's npub
 * @returns {{ pruned: number }} Summary of how many records were removed
 */
export async function pruneInaccessibleRecords(viewerNpub, workspaceOwnerNpub) {
  const groups = await getAllGroups();
  const accessibleGroupIds = buildAccessibleGroupIds(groups, viewerNpub, workspaceOwnerNpub);

  // Owner sees everything — no pruning needed
  if (accessibleGroupIds === null) {
    return { pruned: 0 };
  }

  const db = getWorkspaceDb();
  let totalPruned = 0;
  const prunedRecordIds = new Set();
  const prunedChannelIds = new Set();

  // Phase 1: prune group-bearing tables
  for (const tableName of GROUP_BEARING_TABLES) {
    const table = db[tableName];
    if (!table) continue;

    const rows = await table.toArray();
    const toDelete = [];

    for (const row of rows) {
      if (isInaccessible(row, accessibleGroupIds)) {
        const id = row.record_id;
        if (id) {
          toDelete.push(id);
          prunedRecordIds.add(id);
          if (tableName === 'channels') prunedChannelIds.add(id);
        }
      }
    }

    if (toDelete.length > 0) {
      await table.bulkDelete(toDelete);
      totalPruned += toDelete.length;
    }
  }

  // Phase 2: cascade — messages whose channel was pruned
  if (prunedChannelIds.size > 0) {
    const messagesTable = db.chat_messages;
    if (messagesTable) {
      const allMessages = await messagesTable.toArray();
      const msgToDelete = allMessages
        .filter((m) => prunedChannelIds.has(m.channel_id))
        .map((m) => m.record_id)
        .filter(Boolean);

      if (msgToDelete.length > 0) {
        await messagesTable.bulkDelete(msgToDelete);
        totalPruned += msgToDelete.length;
        for (const id of msgToDelete) prunedRecordIds.add(id);
      }
    }
  }

  // Phase 3: cascade — comments whose target was pruned
  if (prunedRecordIds.size > 0) {
    const commentsTable = db.comments;
    if (commentsTable) {
      const allComments = await commentsTable.toArray();
      const cmtToDelete = allComments
        .filter((c) => prunedRecordIds.has(c.target_record_id))
        .map((c) => c.record_id)
        .filter(Boolean);

      if (cmtToDelete.length > 0) {
        await commentsTable.bulkDelete(cmtToDelete);
        totalPruned += cmtToDelete.length;
      }
    }
  }

  return { pruned: totalPruned };
}

/**
 * Repair stale group_npub refs in local records, replacing them with stable UUIDs.
 *
 * @param {Map<string, string>} npubToUuid — maps any known npub to its stable group UUID
 * @returns {{ repaired: number }} count of records whose group_ids were updated
 */
export async function repairStaleGroupRefs(npubToUuid) {
  if (!npubToUuid || npubToUuid.size === 0) return { repaired: 0 };

  const db = getWorkspaceDb();
  let totalRepaired = 0;

  for (const tableName of GROUP_BEARING_TABLES) {
    const table = db[tableName];
    if (!table) continue;

    const rows = await table.toArray();
    const toUpdate = [];

    for (const row of rows) {
      const groupIds = row.group_ids;
      if (!Array.isArray(groupIds) || groupIds.length === 0) continue;

      let changed = false;
      const repaired = [];
      const seen = new Set();

      for (const gid of groupIds) {
        const resolved = npubToUuid.get(gid) || gid;
        if (resolved !== gid) changed = true;
        if (!seen.has(resolved)) {
          seen.add(resolved);
          repaired.push(resolved);
        } else {
          changed = true; // deduplication counts as a change
        }
      }

      if (changed) {
        toUpdate.push({ ...row, group_ids: repaired });
      }
    }

    if (toUpdate.length > 0) {
      await table.bulkPut(toUpdate);
      totalRepaired += toUpdate.length;
    }
  }

  return { repaired: totalRepaired };
}
