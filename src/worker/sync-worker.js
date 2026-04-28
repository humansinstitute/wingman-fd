/**
 * Sync execution module.
 *
 * The real browser worker entrypoint lives in `sync-worker-runner.js`.
 * This file keeps the sync/pull/prune logic testable and reusable from:
 *   - the dedicated Web Worker
 *   - Node-based unit tests
 *   - the main-thread fallback path when workers are unavailable
 */

import {
  openWorkspaceDb,
  getWorkspaceDb,
  getAllGroups,
  getPendingWrites,
  removePendingWrite,
  upsertWorkspaceSettings,
  upsertChannel,
  upsertMessage,
  upsertDocument,
  upsertDirectory,
  getDocumentById,
  getDirectoryById,
  upsertReport,
  upsertTask,
  getTaskById,
  upsertSchedule,
  upsertComment,
  upsertAudioNote,
  upsertScope,
  upsertFlow,
  upsertApproval,
  upsertPerson,
  upsertOrganisation,
  upsertOpportunity,
  getSyncState,
  setSyncState,
  upsertSyncQuarantineEntry,
  deleteSyncQuarantineEntry,
  getReadCursorsByKeys,
  getReadCursorsByPrefix,
} from '../db.js';

import { syncRecords, fetchRecords, getBaseUrl, fetchRecordsSummary, fetchHeartbeat } from '../api.js';
import { inboundChannel, inboundChatMessage, recordFamilyHash } from '../translators/chat.js';
import { inboundDocument, inboundDirectory } from '../translators/docs.js';
import { inboundReport, recordFamilyHash as reportFamilyHash } from '../translators/reports.js';
import { inboundTask } from '../translators/tasks.js';
import { inboundSchedule, recordFamilyHash as scheduleFamilyHash } from '../translators/schedules.js';
import { inboundComment } from '../translators/comments.js';
import { inboundAudioNote } from '../translators/audio-notes.js';
import { inboundScope } from '../translators/scopes.js';
import { inboundFlow, recordFamilyHash as flowFamilyHash } from '../translators/flows.js';
import { inboundApproval, recordFamilyHash as approvalFamilyHash } from '../translators/approvals.js';
import { inboundPerson, recordFamilyHash as personFamilyHash } from '../translators/persons.js';
import { inboundOrganisation, recordFamilyHash as organisationFamilyHash } from '../translators/organisations.js';
import { inboundOpportunity, recordFamilyHash as opportunityFamilyHash } from '../translators/opportunities.js';
import { inboundWorkspaceSettings, recordFamilyHash as settingsFamilyHash } from '../translators/settings.js';
import { DEFAULT_SYNC_FAMILY_IDS, getSyncFamilyHash, SYNC_FAMILY_BY_HASH } from '../sync-families.js';
import { pruneInaccessibleRecords, repairStaleGroupRefs } from '../access-pruner.js';
import { flightDeckLog } from '../logging.js';
import { isFlightDeckCheckoutRequiredRecordFamily } from '../record-checkout-policy.js';

const SETTINGS_FAMILY = settingsFamilyHash('settings');
const CHANNEL_FAMILY = recordFamilyHash('channel');
const MESSAGE_FAMILY = recordFamilyHash('chat_message');
const DOCUMENT_FAMILY = recordFamilyHash('document');
const DIRECTORY_FAMILY = recordFamilyHash('directory');
const REPORT_FAMILY = reportFamilyHash('report');
const TASK_FAMILY = recordFamilyHash('task');
const SCHEDULE_FAMILY = scheduleFamilyHash('schedule');
const COMMENT_FAMILY = recordFamilyHash('comment');
const AUDIO_NOTE_FAMILY = recordFamilyHash('audio_note');
const SCOPE_FAMILY = recordFamilyHash('scope');
const FLOW_FAMILY = flowFamilyHash('flow');
const APPROVAL_FAMILY = approvalFamilyHash('approval');
const PERSON_FAMILY = personFamilyHash('person');
const ORGANISATION_FAMILY = organisationFamilyHash('organisation');
const OPPORTUNITY_FAMILY = opportunityFamilyHash('opportunity');
const DEFAULT_FAMILIES = DEFAULT_SYNC_FAMILY_IDS.map((familyId) => getSyncFamilyHash(familyId)).filter(Boolean);
const WRITE_BATCH_SIZE = 25;

function stablePolicyConfigKey(config = null) {
  if (!config || typeof config !== 'object') return '';
  const normalizeMap = (map = {}) => Object.fromEntries(
    Object.entries(map || {})
      .filter(([key, value]) => key && value)
      .sort(([left], [right]) => left.localeCompare(right))
  );
  return JSON.stringify({
    recordFamilyHashes: normalizeMap(config.recordFamilyHashes),
    familySuffixes: normalizeMap(config.familySuffixes),
  });
}

function pendingWriteCheckoutPolicyConfig(pendingWrite, options = {}) {
  return pendingWrite?.checkout_policy_config || options.checkoutPolicyConfig || null;
}

async function normalizePendingWritesForFlush(pendingWrites = []) {
  const normalized = [];
  for (const pendingWrite of pendingWrites) {
    const familyHash = String(pendingWrite?.record_family_hash || pendingWrite?.envelope?.record_family_hash || '').trim();
    if (
      familyHash === TASK_FAMILY
      && pendingWrite?.checkout_policy_config
      && !pendingWrite?.envelope?.checkout?.checkout_id
    ) {
      const task = await getTaskById(String(pendingWrite?.record_id || pendingWrite?.envelope?.record_id || '').trim());
      if (task?.state === 'archive' || task?.state === 'done') {
        const { checkout_policy_config: _checkoutPolicyConfig, ...optimisticPendingWrite } = pendingWrite;
        normalized.push(optimisticPendingWrite);
        continue;
      }
    }
    normalized.push(pendingWrite);
  }
  return normalized;
}

function nextPendingWriteBatch(pending, offset, options = {}) {
  const firstConfig = pendingWriteCheckoutPolicyConfig(pending[offset], options);
  const firstKey = stablePolicyConfigKey(firstConfig);
  let end = offset;
  while (end < pending.length && end - offset < WRITE_BATCH_SIZE) {
    const candidateKey = stablePolicyConfigKey(pendingWriteCheckoutPolicyConfig(pending[end], options));
    if (candidateKey !== firstKey) break;
    end += 1;
  }
  return {
    batch: pending.slice(offset, end),
    nextOffset: end,
    checkoutPolicyConfig: firstConfig,
  };
}

function describePendingWriteForError(pendingWrite, options = {}) {
  const envelope = pendingWrite?.envelope || {};
  const recordId = String(pendingWrite?.record_id || envelope.record_id || '').trim() || 'unknown-record';
  const family = String(pendingWrite?.record_family_hash || envelope.record_family_hash || '').trim() || 'unknown-family';
  const version = Number(envelope.version ?? 0) || 0;
  const previousVersion = Number(envelope.previous_version ?? 0) || 0;
  const checkoutId = String(envelope.checkout?.checkout_id || '').trim();
  const checkoutRequired = isFlightDeckCheckoutRequiredRecordFamily(family, options.checkoutPolicyConfig);
  const checkoutState = checkoutId
    ? `checkout_id=${checkoutId}`
    : checkoutRequired
      ? 'checkout_id=missing'
      : 'checkout_id=not-required';
  const rowId = pendingWrite?.row_id != null ? `row=${pendingWrite.row_id}` : 'row=unknown';
  return `${recordId} ${family} v${version}/prev${previousVersion} ${checkoutState} ${rowId}`;
}

function resolveWorkspaceDbKey(ownerNpub, options = {}) {
  return String(options.workspaceDbKey || ownerNpub || '').trim();
}

async function materializeRecordForFamily(family, record) {
  if (family === SETTINGS_FAMILY) {
    const row = await inboundWorkspaceSettings(record);
    await upsertWorkspaceSettings(row);
  } else if (family === CHANNEL_FAMILY) {
    const row = await inboundChannel(record);
    await upsertChannel(row);
  } else if (family === MESSAGE_FAMILY) {
    const row = await inboundChatMessage(record);
    await upsertMessage(row);
  } else if (family === DIRECTORY_FAMILY) {
    const row = await inboundDirectory(record);
    await upsertDirectory(row);
  } else if (family === DOCUMENT_FAMILY) {
    const row = await inboundDocument(record);
    await upsertDocument(row);
  } else if (family === REPORT_FAMILY) {
    const row = await inboundReport(record);
    await upsertReport(row);
  } else if (family === TASK_FAMILY) {
    const row = await inboundTask(record);
    await upsertTask(row);
  } else if (family === SCHEDULE_FAMILY) {
    const row = await inboundSchedule(record);
    await upsertSchedule(row);
  } else if (family === COMMENT_FAMILY) {
    const row = await inboundComment(record);
    await upsertComment(row);
  } else if (family === AUDIO_NOTE_FAMILY) {
    const row = await inboundAudioNote(record);
    await upsertAudioNote(row);
  } else if (family === SCOPE_FAMILY) {
    const row = await inboundScope(record);
    await upsertScope(row);
  } else if (family === FLOW_FAMILY) {
    const row = await inboundFlow(record);
    await upsertFlow(row);
  } else if (family === APPROVAL_FAMILY) {
    const row = await inboundApproval(record);
    await upsertApproval(row);
  } else if (family === PERSON_FAMILY) {
    const row = await inboundPerson(record);
    await upsertPerson(row);
  } else if (family === ORGANISATION_FAMILY) {
    const row = await inboundOrganisation(record);
    await upsertOrganisation(row);
  } else if (family === OPPORTUNITY_FAMILY) {
    const row = await inboundOpportunity(record);
    await upsertOpportunity(row);
  }
}

async function markLockManagedWriteState(recordId, familyHash, patch = {}, options = {}) {
  if (!recordId || !isFlightDeckCheckoutRequiredRecordFamily(familyHash, options.checkoutPolicyConfig)) return;
  if (familyHash === DIRECTORY_FAMILY) {
    const current = await getDirectoryById(recordId);
    if (!current) return;
    await upsertDirectory({ ...current, ...patch });
    return;
  }
  if (familyHash === DOCUMENT_FAMILY) {
    const current = await getDocumentById(recordId);
    if (!current) return;
    await upsertDocument({ ...current, ...patch });
    return;
  }
  if (familyHash === TASK_FAMILY) {
    const current = await getTaskById(recordId);
    if (!current) return;
    await upsertTask({ ...current, ...patch });
  }
}

/**
 * Push all pending writes to the backend then clear them locally.
 */
export async function flushPendingWrites(ownerNpub, onProgress, options = {}) {
  openWorkspaceDb(resolveWorkspaceDbKey(ownerNpub, options));
  const pending = await normalizePendingWritesForFlush(await getPendingWrites());
  if (pending.length === 0) return { pushed: 0 };
  let pushed = 0;

  if (onProgress) onProgress({ phase: 'pushing', pushed: 0, pushTotal: pending.length });

  flightDeckLog('info', 'sync', 'flushing pending writes', {
    ownerNpub,
    pendingCount: pending.length,
    batchSize: WRITE_BATCH_SIZE,
  });

  let offset = 0;
  let batchNumber = 0;
  while (offset < pending.length) {
    const {
      batch,
      nextOffset,
      checkoutPolicyConfig,
    } = nextPendingWriteBatch(pending, offset, options);
    offset = nextOffset;
    batchNumber += 1;
    const batchOptions = { ...options, checkoutPolicyConfig };
    const envelopes = batch.map((pw) => pw.envelope);
    flightDeckLog('debug', 'sync', 'syncing pending write batch', {
      ownerNpub,
      batchNumber,
      batchCount: batch.length,
      pendingCount: pending.length,
      recordIds: batch.map((pw) => pw.record_id),
      families: [...new Set(batch.map((pw) => pw.record_family_hash))],
    });
    let result;
    try {
      result = await syncRecords({
        owner_npub: ownerNpub,
        records: envelopes,
        checkout_policy_config: checkoutPolicyConfig,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const punctuatedReason = /[.!?]$/.test(reason) ? reason : `${reason}.`;
      flightDeckLog('error', 'sync', 'pending write batch failed', {
        ownerNpub,
        batchNumber,
        batchCount: batch.length,
        pushed,
        pendingCount: pending.length,
        recordIds: batch.map((pw) => pw.record_id),
        families: [...new Set(batch.map((pw) => pw.record_family_hash))],
        error: reason,
      });
      throw new Error(
        `Pending write sync failed for batch ${batchNumber} `
        + `(${batch.length} records, ${pushed}/${pending.length} flushed): ${punctuatedReason} `
        + `Batch records: ${batch.map((pendingWrite) => describePendingWriteForError(pendingWrite, batchOptions)).join('; ')}`
      );
    }

    // Keep rejected writes pending so local unsynced changes are never
    // dropped silently. They can be retried or handled explicitly.
    const rejectedIds = new Set();
    let hasUnscopedRejection = false;
    if (Array.isArray(result?.rejected) && result.rejected.length > 0) {
      for (const rej of result.rejected) {
        if (rej.record_id) {
          rejectedIds.add(rej.record_id);
          await markLockManagedWriteState(
            rej.record_id,
            rej.record_family_hash || batch.find((entry) => entry.record_id === rej.record_id)?.record_family_hash,
            {
              sync_status: 'failed',
              coedit_state: rej.code === 'prior_version_mismatch' ? 'conflicted' : 'rejected',
              conflict_reason: rej.code || rej.reason || null,
            },
            batchOptions,
          );
        } else {
          hasUnscopedRejection = true;
        }
      }
      flightDeckLog('warn', 'sync', 'Tower rejected records in batch — keeping rejected writes pending', {
        ownerNpub,
        rejectedCount: result.rejected.length,
        acceptedCount: (result.synced ?? 0),
        hasUnscopedRejection,
        rejected: result.rejected,
      });
    }

    // Deferred records = group key not available yet. Keep their pending
    // writes so they retry on the next sync cycle when keys may be loaded.
    const deferredIds = new Set(Array.isArray(result?.deferred) ? result.deferred : []);
    if (deferredIds.size > 0) {
      flightDeckLog('warn', 'sync', 'deferred records — group key not loaded, will retry', {
        ownerNpub,
        deferredCount: deferredIds.size,
        deferredRecordIds: [...deferredIds],
      });
      for (const deferredRecordId of deferredIds) {
        await markLockManagedWriteState(
          deferredRecordId,
          batch.find((entry) => entry.record_id === deferredRecordId)?.record_family_hash,
          {
            coedit_state: 'deferred',
            conflict_reason: null,
          },
          batchOptions,
        );
      }
    }

    let removedInBatch = 0;
    for (const pw of batch) {
      // Keep deferred pending writes for retry on next cycle.
      if (deferredIds.has(pw.record_id)) continue;
      // Keep explicitly rejected writes pending to avoid local data loss.
      if (rejectedIds.has(pw.record_id)) continue;
      // If Tower returned an unscoped rejection, keep the whole batch pending
      // because we cannot safely map acceptance per record.
      if (hasUnscopedRejection) continue;
      await removePendingWrite(pw.row_id);
      removedInBatch++;
    }
    pushed += removedInBatch;
    if (onProgress) onProgress({ phase: 'pushing', pushed, pushTotal: pending.length });
    flightDeckLog('info', 'sync', 'pending write batch flushed', {
      ownerNpub,
      batchNumber,
      batchCount: batch.length,
      pushed,
      pendingCount: pending.length,
    });
  }

  return { pushed };
}

function familyLabel(familyHash) {
  const entry = SYNC_FAMILY_BY_HASH[familyHash];
  return entry ? entry.label : familyHash;
}

/**
 * Pull records from backend, translate, and materialize locally.
 */
export async function pullRecords(ownerNpub, viewerNpub = ownerNpub, onProgress, options = {}) {
  return pullRecordsForFamilies(ownerNpub, viewerNpub, DEFAULT_FAMILIES, options, onProgress);
}

export async function pullRecordsForFamilies(ownerNpub, viewerNpub = ownerNpub, families = DEFAULT_FAMILIES, options = {}, onProgress) {
  openWorkspaceDb(resolveWorkspaceDbKey(ownerNpub, options));
  const forceFull = options.forceFull === true;
  const totalFamilies = families.length;
  const pendingWrites = await getPendingWrites();
  const pendingVersionByRecordId = new Map();
  const pendingWritesByFamilyRecord = new Map();
  for (const pendingWrite of pendingWrites) {
    const recordId = String(pendingWrite?.record_id ?? pendingWrite?.envelope?.record_id ?? '').trim();
    if (!recordId) continue;
    const pendingFamily = String(pendingWrite?.record_family_hash ?? pendingWrite?.envelope?.record_family_hash ?? '').trim();
    const pendingVersion = Number(pendingWrite?.envelope?.version ?? 0) || 0;
    if (pendingFamily) {
      const key = `${pendingFamily}\u0000${recordId}`;
      const rows = pendingWritesByFamilyRecord.get(key) || [];
      rows.push(pendingWrite);
      pendingWritesByFamilyRecord.set(key, rows);
    }
    if (pendingVersion <= 0) continue;
    const existingPendingVersion = pendingVersionByRecordId.get(recordId) || 0;
    if (pendingVersion > existingPendingVersion) {
      pendingVersionByRecordId.set(recordId, pendingVersion);
    }
  }

  if (onProgress) onProgress({ phase: 'pulling', completedFamilies: 0, totalFamilies, currentFamily: null, pulled: 0 });

  // Read all cursors upfront, then fetch all families in parallel.
  const cursorEntries = await Promise.all(
    families.map(async (family) => {
      const sinceKey = `sync_since:${family}`;
      const since = forceFull ? null : await getSyncState(sinceKey);
      return { family, sinceKey, since };
    })
  );

  // Fetch all families from Tower concurrently.
  const fetchResults = await Promise.all(
    cursorEntries.map(async ({ family, since }) => {
      const result = await fetchRecords({
        owner_npub: ownerNpub,
        viewer_npub: viewerNpub,
        record_family_hash: family,
        since: since ?? undefined,
      });
      return { family, records: result.records ?? result ?? [] };
    })
  );

  // Materialize results sequentially per family (Dexie writes are ordered).
  let totalPulled = 0;
  let completedFamilies = 0;

  for (let i = 0; i < fetchResults.length; i++) {
    const { family, records } = fetchResults[i];
    const { sinceKey, since } = cursorEntries[i];
    const label = familyLabel(family);

    if (onProgress) {
      onProgress({
        phase: 'pulling',
        completedFamilies,
        totalFamilies,
        currentFamily: label,
        currentFamilyHash: family,
        pulled: totalPulled,
      });
    }

    let latestApplied = since ?? '';
    let appliedCount = 0;
    let skippedCount = 0;

    for (const record of records) {
      try {
        const recordId = String(record?.record_id || '').trim();
        const inboundVersion = Number(record?.version ?? 0) || 0;
        const pendingVersion = pendingVersionByRecordId.get(recordId) || 0;
        const lockManaged = isFlightDeckCheckoutRequiredRecordFamily(family, options.checkoutPolicyConfig);
        if (
          pendingVersion > 0
          && inboundVersion > 0
          && (
            (!lockManaged && inboundVersion <= pendingVersion)
            || (lockManaged && inboundVersion < pendingVersion)
          )
        ) {
          flightDeckLog('debug', 'sync', 'skipping inbound record older/equal to local pending write', {
            family,
            recordId,
            inboundVersion,
            pendingVersion,
            lockManaged,
          });
          continue;
        }
        await materializeRecordForFamily(family, record);
        if (lockManaged && recordId && inboundVersion > 0) {
          const pendingRows = pendingWritesByFamilyRecord.get(`${family}\u0000${recordId}`) || [];
          for (const pendingRow of pendingRows) {
            const pendingRowVersion = Number(pendingRow?.envelope?.version ?? 0) || 0;
            if (pendingRowVersion > 0 && pendingRowVersion <= inboundVersion && pendingRow?.row_id != null) {
              await removePendingWrite(pendingRow.row_id);
            }
          }
        }
        appliedCount++;
        if ((record.updated_at ?? '') > latestApplied) latestApplied = record.updated_at ?? '';
      } catch (error) {
        skippedCount++;
        flightDeckLog('warn', 'sync', 'skipping undecryptable record', {
          family,
          recordId: record.record_id,
          error: error?.message || String(error),
          diagnostics: error?.diagnostics || null,
        });
      }
    }

    totalPulled += records.length;
    completedFamilies++;

    if (onProgress) onProgress({
      phase: 'pulling',
      completedFamilies,
      totalFamilies,
      currentFamily: label,
      currentFamilyHash: family,
      pulled: totalPulled,
    });

    if (appliedCount > 0 && skippedCount === 0 && latestApplied) {
      await setSyncState(sinceKey, latestApplied);
    } else if (skippedCount > 0) {
      flightDeckLog('warn', 'sync', 'holding sync cursor due to skipped records', {
        family,
        appliedCount,
        skippedCount,
      });
    }
  }

  return { pulled: totalPulled };
}

/**
 * Ask the server which families have updates since our local cursors.
 * Returns { stale_families: string[], server_cursors: {}, heartbeatUsed: true }
 * On failure (e.g. 404 from old Tower), returns null so caller can fall back.
 */
export async function heartbeatCheck(ownerNpub, viewerNpub = ownerNpub, options = {}) {
  openWorkspaceDb(resolveWorkspaceDbKey(ownerNpub, options));

  const cursorPairs = await Promise.all(
    DEFAULT_FAMILIES.map(async (family) => [family, await getSyncState(`sync_since:${family}`) || null])
  );
  const familyCursors = Object.fromEntries(cursorPairs);

  try {
    const result = await fetchHeartbeat({
      owner_npub: ownerNpub,
      viewer_npub: viewerNpub,
      family_cursors: familyCursors,
    });
    return { ...result, heartbeatUsed: true };
  } catch (error) {
    flightDeckLog('warn', 'sync', 'heartbeat check failed, falling back to full pull', {
      ownerNpub,
      error: error?.message || String(error),
    });
    return null;
  }
}

/**
 * Client-side access pruning — a convenience optimization, not a security boundary.
 * Tower enforces read access authoritatively on every pull via group_payloads and
 * epoch keys. This local prune removes records the viewer can no longer decrypt,
 * keeping the Dexie cache lean. Runs at most once per hour, persisted in IndexedDB.
 *
 * Pruning only happens:
 *  1. On login / workspace selection (explicit call to pruneOnLogin)
 *  2. During sync when records were pulled AND the hourly cooldown has elapsed
 *
 * The last-prune timestamp is stored in the workspace sync_state table so it
 * survives page reloads and is scoped to the active workspace DB.
 */
const PRUNE_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
const PRUNE_STATE_KEY = 'access_prune_last';

async function getLastPruneTime() {
  const raw = await getSyncState(PRUNE_STATE_KEY);
  return typeof raw === 'number' ? raw : 0;
}

async function setLastPruneTime(ts) {
  await setSyncState(PRUNE_STATE_KEY, ts);
}

async function executePrune(viewerNpub, ownerNpub) {
  try {
    const result = await pruneInaccessibleRecords(viewerNpub, ownerNpub);
    await setLastPruneTime(Date.now());
    if (result.pruned > 0) {
      flightDeckLog('info', 'sync', 'pruned inaccessible local records', {
        viewerNpub,
        ownerNpub,
        pruned: result.pruned,
      });
    }
    return { pruned: result.pruned };
  } catch (error) {
    flightDeckLog('warn', 'sync', 'access pruning failed', {
      viewerNpub,
      ownerNpub,
      error: error?.message || String(error),
    });
    return { pruned: 0 };
  }
}

/**
 * Build a repair map from rotating group_npub values to stable group_id UUIDs.
 * Maps both the current and historical group_npub (rotating crypto identity)
 * to the canonical group_id (stable product identity) for local-state migration.
 */
async function buildNpubToUuidMap() {
  const groups = await getAllGroups();
  const map = new Map();
  for (const group of groups) {
    if (!group.group_id) continue;
    if (group.group_npub) map.set(group.group_npub, group.group_id);
    if (group.current_group_npub) map.set(group.current_group_npub, group.group_id);
  }
  return map;
}

/**
 * Run access pruning immediately — called on login / workspace selection.
 * Bypasses the hourly cooldown so stale data is cleaned up at session start.
 * Also repairs stale group_npub refs in local records to stable UUIDs.
 */
export async function pruneOnLogin(viewerNpub, ownerNpub, options = {}) {
  openWorkspaceDb(resolveWorkspaceDbKey(ownerNpub, options));

  // Repair stale npub refs before pruning so access checks use canonical IDs
  try {
    const npubToUuid = await buildNpubToUuidMap();
    if (npubToUuid.size > 0) {
      const repairResult = await repairStaleGroupRefs(npubToUuid);
      if (repairResult.repaired > 0) {
        flightDeckLog('info', 'sync', 'repaired stale group refs in local records', {
          repaired: repairResult.repaired,
        });
      }
    }
  } catch (error) {
    flightDeckLog('warn', 'sync', 'stale group ref repair failed', {
      error: error?.message || String(error),
    });
  }

  return executePrune(viewerNpub, ownerNpub);
}

/**
 * Conditionally prune during a sync cycle if the hourly cooldown has elapsed.
 */
async function maybePruneAfterSync(viewerNpub, ownerNpub) {
  const lastPrune = await getLastPruneTime();
  if (Date.now() - lastPrune < PRUNE_COOLDOWN_MS) {
    return { pruned: 0 };
  }
  return executePrune(viewerNpub, ownerNpub);
}

/**
 * Full sync cycle: push then pull.
 * Uses heartbeat-first approach: asks the server which families changed,
 * then only pulls stale families. Falls back to full pull if heartbeat unavailable.
 *
 * Access pruning only runs when records were actually pulled (pulled > 0)
 * AND the hourly cooldown has elapsed. Login pruning is handled separately
 * via pruneOnLogin().
 */
export async function runSync(ownerNpub, viewerNpub = ownerNpub, onProgress, options = {}) {
  if (!getBaseUrl()) throw new Error('Backend URL not configured');

  if (onProgress) onProgress({ phase: 'checking' });

  let pushResult = { pushed: 0 };
  let pushError = null;
  try {
    pushResult = await flushPendingWrites(ownerNpub, onProgress, options);
  } catch (error) {
    pushError = error;
    if (options.forceFull !== true) throw error;
    flightDeckLog('warn', 'sync', 'push failed during forced sync; continuing pull to reconcile accepted writes', {
      ownerNpub,
      viewerNpub,
      error: error?.message || String(error),
    });
  }

  if (options.forceFull === true) {
    if (onProgress) onProgress({ phase: 'pulling', completedFamilies: 0, totalFamilies: DEFAULT_FAMILIES.length, currentFamily: null, currentFamilyHash: null, pulled: 0, heartbeat: false });
    const pullResult = await pullRecords(ownerNpub, viewerNpub, onProgress, options);
    if (pushError) {
      const remainingPending = await getPendingWrites();
      if (remainingPending.length > 0) throw pushError;
      pushError = null;
    }

    if (onProgress) onProgress({ phase: 'applying' });
    const pruneResult = pullResult.pulled > 0
      ? await maybePruneAfterSync(viewerNpub, ownerNpub)
      : { pruned: 0 };
    if (pullResult.pulled > 0 || pruneResult.pruned > 0) {
      await updateUnreadSummaries(viewerNpub);
    }
    return { ...pushResult, ...pullResult, ...pruneResult, heartbeatUsed: false, forcedFull: true };
  }

  // Heartbeat: ask server which families have updates
  const heartbeat = await heartbeatCheck(ownerNpub, viewerNpub, options);

  if (heartbeat && Array.isArray(heartbeat.stale_families)) {
    // Heartbeat succeeded — only pull stale families
    if (heartbeat.stale_families.length === 0) {
      if (onProgress) onProgress({ phase: 'pulling', completedFamilies: 0, totalFamilies: 0, currentFamily: null, pulled: 0, heartbeat: true });
      if (onProgress) onProgress({ phase: 'applying' });
      // Nothing changed on server — skip pruning entirely
      return { ...pushResult, pulled: 0, pruned: 0, heartbeatUsed: true, staleFamilies: 0 };
    }

    if (onProgress) onProgress({ phase: 'pulling', completedFamilies: 0, totalFamilies: heartbeat.stale_families.length, currentFamily: null, pulled: 0, heartbeat: true });
    const pullResult = await pullRecordsForFamilies(ownerNpub, viewerNpub, heartbeat.stale_families, options, onProgress);

    if (onProgress) onProgress({ phase: 'applying' });
    const pruneResult = pullResult.pulled > 0
      ? await maybePruneAfterSync(viewerNpub, ownerNpub)
      : { pruned: 0 };
    if (pullResult.pulled > 0 || pruneResult.pruned > 0) {
      await updateUnreadSummaries(viewerNpub);
    }
    return { ...pushResult, ...pullResult, ...pruneResult, heartbeatUsed: true, staleFamilies: heartbeat.stale_families.length };
  }

  // Fallback: heartbeat unavailable, pull all families
  if (onProgress) onProgress({ phase: 'pulling', completedFamilies: 0, totalFamilies: DEFAULT_FAMILIES.length, currentFamily: null, pulled: 0 });
  const pullResult = await pullRecords(ownerNpub, viewerNpub, onProgress, options);

  if (onProgress) onProgress({ phase: 'applying' });
  const pruneResult = pullResult.pulled > 0
    ? await maybePruneAfterSync(viewerNpub, ownerNpub)
    : { pruned: 0 };
  if (pullResult.pulled > 0 || pruneResult.pruned > 0) {
    await updateUnreadSummaries(viewerNpub);
  }
  return { ...pushResult, ...pullResult, ...pruneResult, heartbeatUsed: false };
}

/**
 * Compute unread summaries and store them in sync_state.
 * Runs in the worker after a pull that fetched new records,
 * so the main thread can read cheap pre-computed flags.
 */
async function updateUnreadSummaries(viewerNpub) {
  if (!viewerNpub) return;
  try {
    const db = getWorkspaceDb();

    // Load read cursors
    const navRows = await getReadCursorsByKeys(viewerNpub, ['chat:nav', 'tasks:nav', 'docs:nav']);
    const cursorMap = {};
    for (const row of navRows) cursorMap[row.cursor_key] = row.read_until;

    // Chat unread
    const chatReadUntil = cursorMap['chat:nav'] || '1970-01-01T00:00:00.000Z';
    const newestChatMsg = await db.chat_messages.where('updated_at').above(chatReadUntil).first();
    const chatUnread = newestChatMsg != null && newestChatMsg.record_state !== 'deleted';

    // Docs unread
    const docsReadUntil = cursorMap['docs:nav'] || '1970-01-01T00:00:00.000Z';
    const newestDoc = await db.documents.where('updated_at').above(docsReadUntil).first();
    const docsUnread = newestDoc != null && newestDoc.record_state !== 'deleted';

    // Tasks unread
    const tasksNavReadUntil = cursorMap['tasks:nav'] || null;
    let tasksUnread = false;
    if (tasksNavReadUntil) {
      const taskCursorRows = await getReadCursorsByPrefix(viewerNpub, 'tasks:item:');
      const taskCursorMap = {};
      for (const row of taskCursorRows) taskCursorMap[row.cursor_key] = row.read_until;

      const allTasks = await db.tasks.toArray();
      for (const task of allTasks) {
        if (task.record_state === 'deleted') continue;
        const itemKey = `tasks:item:${task.record_id}`;
        const itemReadUntil = taskCursorMap[itemKey] || null;
        let effective = tasksNavReadUntil;
        if (itemReadUntil && itemReadUntil > effective) effective = itemReadUntil;
        if (viewerNpub && task.owner_npub === viewerNpub && task.created_at && task.created_at > effective) {
          effective = task.created_at;
        }
        if (task.updated_at > effective) {
          tasksUnread = true;
          break;
        }
      }
    }

    // Per-channel unread (batched)
    const channelRows = await getReadCursorsByPrefix(viewerNpub, 'chat:channel:');
    const channelCursorMap = {};
    for (const row of channelRows) channelCursorMap[row.cursor_key] = row.read_until;

    const channels = await db.channels.toArray();
    const channelUnread = {};
    if (channels.length > 0) {
      let earliestCursor = chatReadUntil;
      const perChannelCursors = {};
      for (const ch of channels) {
        if (ch.record_state === 'deleted') continue;
        const chCursorKey = `chat:channel:${ch.record_id}`;
        const chReadUntil = channelCursorMap[chCursorKey] || null;
        const effective = (chReadUntil && chReadUntil > chatReadUntil) ? chReadUntil : chatReadUntil;
        perChannelCursors[ch.record_id] = effective;
        if (effective < earliestCursor) earliestCursor = effective;
      }
      const recentMsgs = await db.chat_messages.where('updated_at').above(earliestCursor).toArray();
      for (const ch of channels) {
        if (ch.record_state === 'deleted') continue;
        const cursor = perChannelCursors[ch.record_id];
        if (!cursor) continue;
        channelUnread[ch.record_id] = recentMsgs.some(
          (m) => m.channel_id === ch.record_id && m.updated_at > cursor && m.record_state !== 'deleted'
        );
      }
    }

    await setSyncState('unread_summary', {
      chatUnread,
      docsUnread,
      tasksUnread,
      channelUnread,
      computedAt: Date.now(),
    });
  } catch (error) {
    flightDeckLog('warn', 'sync', 'unread summary update failed', {
      error: error?.message || String(error),
    });
  }
}

/**
 * Check if local cursors are behind the remote summary.
 */
export async function checkStaleness(ownerNpub, options = {}) {
  openWorkspaceDb(resolveWorkspaceDbKey(ownerNpub, options));
  const summary = await fetchRecordsSummary(ownerNpub);
  if (!summary.available || !Array.isArray(summary.families)) return { stale: false, available: false };

  for (const remote of summary.families) {
    const sinceKey = `sync_since:${remote.record_family_hash}`;
    const localCursor = await getSyncState(sinceKey);
    if (!localCursor && remote.latest_updated_at) return { stale: true, available: true };
    if (localCursor && remote.latest_updated_at && remote.latest_updated_at > localCursor) return { stale: true, available: true };
  }

  return { stale: false, available: true };
}
