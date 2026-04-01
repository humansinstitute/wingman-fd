import { buildScopeShares, buildScopeTags, normalizeGroupIds } from './scope-delivery.js';

/**
 * Separate a record's shares into scope-granted and explicit.
 *
 * Scope-granted shares are group-type shares whose group_npub matches one
 * of the scope's group_ids. Person shares and group shares not matching the
 * scope's groups are classified as explicit.
 *
 * @param {Array} shares - Current shares on the record.
 * @param {Array} scopeGroupIds - The scope's group_ids that define its policy.
 * @returns {{ scopeShares: Array, explicitShares: Array }}
 */
export function separateScopeShares(shares = [], scopeGroupIds = []) {
  const scopeGroupSet = new Set(normalizeGroupIds(scopeGroupIds));
  const scopeShares = [];
  const explicitShares = [];

  for (const share of shares) {
    if (
      share.type === 'group'
      && share.group_npub
      && scopeGroupSet.has(share.group_npub)
    ) {
      scopeShares.push(share);
    } else {
      explicitShares.push(share);
    }
  }

  return { scopeShares, explicitShares };
}

/**
 * Rebuild shares and group_ids for a destination scope.
 *
 * Merges the destination scope's default shares with the record's explicit
 * (non-scope) shares. Deduplicates by key, promoting access to 'write' when
 * either side grants it.
 *
 * @param {Array} explicitShares - Shares not granted by the old scope.
 * @param {Object} destScope - The destination scope record.
 * @param {Array} groups - Known groups for label resolution.
 * @returns {{ shares: Array, group_ids: Array }}
 */
export function rebuildAccessForScope(explicitShares = [], destScope, groups = []) {
  const destGroupIds = normalizeGroupIds(destScope?.group_ids);
  const newScopeShares = buildScopeShares(destGroupIds, groups);

  // Merge: scope shares first, then explicit shares on top (dedup by key)
  const merged = new Map();

  for (const share of newScopeShares) {
    merged.set(share.key, share);
  }

  for (const share of explicitShares) {
    if (!share?.key) continue;
    const existing = merged.get(share.key);
    if (!existing) {
      merged.set(share.key, share);
    } else {
      // Promote access to write if either grants it
      merged.set(share.key, {
        ...existing,
        access: existing.access === 'write' || share.access === 'write' ? 'write' : 'read',
      });
    }
  }

  const shares = [...merged.values()];
  const group_ids = extractGroupIdsFromShares(shares);

  return { shares, group_ids };
}

/**
 * Build the full update object for a scope move.
 *
 * Strips shares from the old scope, builds shares for the new scope,
 * preserves explicit shares, updates scope tags, bumps version, and
 * marks the record as pending sync.
 *
 * @param {Object} record - The record being moved.
 * @param {Object|null} fromScope - The current scope (null if unscoped).
 * @param {Object|null} toScope - The destination scope (null to unscope).
 * @param {Array} groups - Known groups for label resolution.
 * @param {string} [now] - ISO timestamp for updated_at.
 * @returns {Object} Updated record fields.
 */
export function buildScopeMoveUpdate(record, fromScope, toScope, groups = [], now = new Date().toISOString()) {
  const fromGroupIds = normalizeGroupIds(fromScope?.group_ids);

  // Step 1: separate scope-granted shares from explicit shares
  const { explicitShares } = separateScopeShares(record.shares || [], fromGroupIds);

  // Step 2: rebuild access from destination scope policy + explicit shares
  let shares, group_ids;
  if (toScope) {
    const rebuilt = rebuildAccessForScope(explicitShares, toScope, groups);
    shares = rebuilt.shares;
    group_ids = rebuilt.group_ids;
  } else {
    // Removing scope — keep only explicit shares
    shares = explicitShares;
    group_ids = extractGroupIdsFromShares(explicitShares);
  }

  // Step 3: compute scope tags from destination
  const scopeTags = toScope
    ? buildScopeTags(toScope)
    : { scope_id: null, scope_l1_id: null, scope_l2_id: null, scope_l3_id: null, scope_l4_id: null, scope_l5_id: null };

  // Step 4: update board_group_id
  const destGroupIds = normalizeGroupIds(toScope?.group_ids);
  let board_group_id = record.board_group_id;
  if (board_group_id && !destGroupIds.includes(board_group_id) && !group_ids.includes(board_group_id)) {
    board_group_id = destGroupIds[0] ?? group_ids[0] ?? null;
  } else if (!board_group_id && destGroupIds.length > 0) {
    board_group_id = destGroupIds[0];
  }

  return {
    ...record,
    ...scopeTags,
    shares,
    group_ids,
    board_group_id,
    version: (record.version ?? 1) + 1,
    sync_status: 'pending',
    updated_at: now,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function extractGroupIdsFromShares(shares = []) {
  const ids = new Set();
  for (const share of shares) {
    if (share.type === 'person') {
      if (share.via_group_npub) ids.add(share.via_group_npub);
      if (share.group_npub) ids.add(share.group_npub);
    } else if (share.group_npub) {
      ids.add(share.group_npub);
    }
  }
  return [...ids];
}
