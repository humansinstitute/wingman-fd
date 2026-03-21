/**
 * Sync worker — runs on a timer or manual trigger.
 *
 * Responsibilities:
 *  1. Flush pending_writes to the V4 backend via POST /api/v4/records/sync
 *  2. Pull new records from GET /api/v4/records
 *  3. Translate inbound records through chat translators
 *  4. Write materialized rows into Dexie
 *
 * Communication with the main thread is via postMessage / onmessage.
 *
 * NOTE: Because Dexie doesn't work inside a true Web Worker without
 * workarounds, this file is designed to be imported as a *module* by
 * the main thread and driven via a simple call interface.  A real
 * Web Worker upgrade can happen later.
 */

import {
  openWorkspaceDb,
  getPendingWrites,
  removePendingWrite,
  upsertWorkspaceSettings,
  upsertChannel,
  upsertMessage,
  upsertDocument,
  upsertDirectory,
  upsertTask,
  upsertSchedule,
  upsertComment,
  upsertAudioNote,
  upsertScope,
  getSyncState,
  setSyncState,
  upsertSyncQuarantineEntry,
  deleteSyncQuarantineEntry,
} from '../db.js';

import { syncRecords, fetchRecords, getBaseUrl, fetchRecordsSummary } from '../api.js';
import { inboundChannel, inboundChatMessage, recordFamilyHash } from '../translators/chat.js';
import { inboundDocument, inboundDirectory } from '../translators/docs.js';
import { inboundTask } from '../translators/tasks.js';
import { inboundSchedule, recordFamilyHash as scheduleFamilyHash } from '../translators/schedules.js';
import { inboundComment } from '../translators/comments.js';
import { inboundAudioNote } from '../translators/audio-notes.js';
import { inboundScope } from '../translators/scopes.js';
import { inboundWorkspaceSettings, recordFamilyHash as settingsFamilyHash } from '../translators/settings.js';
import { DEFAULT_SYNC_FAMILY_IDS, getSyncFamilyHash, SYNC_FAMILY_BY_HASH } from '../sync-families.js';
import { flightDeckLog } from '../logging.js';

const SETTINGS_FAMILY = settingsFamilyHash('settings');
const CHANNEL_FAMILY = recordFamilyHash('channel');
const MESSAGE_FAMILY = recordFamilyHash('chat_message');
const DOCUMENT_FAMILY = recordFamilyHash('document');
const DIRECTORY_FAMILY = recordFamilyHash('directory');
const TASK_FAMILY = recordFamilyHash('task');
const SCHEDULE_FAMILY = scheduleFamilyHash('schedule');
const COMMENT_FAMILY = recordFamilyHash('comment');
const AUDIO_NOTE_FAMILY = recordFamilyHash('audio_note');
const SCOPE_FAMILY = recordFamilyHash('scope');
const DEFAULT_FAMILIES = DEFAULT_SYNC_FAMILY_IDS.map((familyId) => getSyncFamilyHash(familyId)).filter(Boolean);
const WRITE_BATCH_SIZE = 25;

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
  }
}

/**
 * Push all pending writes to the backend then clear them locally.
 */
export async function flushPendingWrites(ownerNpub, onProgress) {
  openWorkspaceDb(ownerNpub);
  const pending = await getPendingWrites();
  if (pending.length === 0) return { pushed: 0 };
  let pushed = 0;

  if (onProgress) onProgress({ phase: 'pushing', pushed: 0, pushTotal: pending.length });

  flightDeckLog('info', 'sync', 'flushing pending writes', {
    ownerNpub,
    pendingCount: pending.length,
    batchSize: WRITE_BATCH_SIZE,
  });

  for (let offset = 0; offset < pending.length; offset += WRITE_BATCH_SIZE) {
    const batch = pending.slice(offset, offset + WRITE_BATCH_SIZE);
    const envelopes = batch.map((pw) => pw.envelope);
    flightDeckLog('debug', 'sync', 'syncing pending write batch', {
      ownerNpub,
      batchNumber: Math.floor(offset / WRITE_BATCH_SIZE) + 1,
      batchCount: batch.length,
      pendingCount: pending.length,
      recordIds: batch.map((pw) => pw.record_id),
      families: [...new Set(batch.map((pw) => pw.record_family_hash))],
    });
    try {
      await syncRecords({
        owner_npub: ownerNpub,
        records: envelopes,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      flightDeckLog('error', 'sync', 'pending write batch failed', {
        ownerNpub,
        batchNumber: Math.floor(offset / WRITE_BATCH_SIZE) + 1,
        batchCount: batch.length,
        pushed,
        pendingCount: pending.length,
        recordIds: batch.map((pw) => pw.record_id),
        families: [...new Set(batch.map((pw) => pw.record_family_hash))],
        error: reason,
      });
      throw new Error(
        `Pending write sync failed for batch ${Math.floor(offset / WRITE_BATCH_SIZE) + 1} `
        + `(${batch.length} records, ${pushed}/${pending.length} flushed): ${reason}`
      );
    }

    for (const pw of batch) {
      await removePendingWrite(pw.row_id);
    }
    pushed += batch.length;
    if (onProgress) onProgress({ phase: 'pushing', pushed, pushTotal: pending.length });
    flightDeckLog('info', 'sync', 'pending write batch flushed', {
      ownerNpub,
      batchNumber: Math.floor(offset / WRITE_BATCH_SIZE) + 1,
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
export async function pullRecords(ownerNpub, viewerNpub = ownerNpub, onProgress) {
  return pullRecordsForFamilies(ownerNpub, viewerNpub, DEFAULT_FAMILIES, {}, onProgress);
}

export async function pullRecordsForFamilies(ownerNpub, viewerNpub = ownerNpub, families = DEFAULT_FAMILIES, options = {}, onProgress) {
  openWorkspaceDb(ownerNpub);
  const forceFull = options.forceFull === true;
  let totalPulled = 0;
  let completedFamilies = 0;
  const totalFamilies = families.length;

  if (onProgress) onProgress({ phase: 'pulling', completedFamilies: 0, totalFamilies, currentFamily: null, pulled: 0 });

  for (const family of families) {
    const label = familyLabel(family);
    if (onProgress) onProgress({ phase: 'pulling', completedFamilies, totalFamilies, currentFamily: label, pulled: totalPulled });

    const sinceKey = `sync_since:${family}`;
    const since = forceFull ? null : await getSyncState(sinceKey);

    const result = await fetchRecords({
      owner_npub: ownerNpub,
      viewer_npub: viewerNpub,
      record_family_hash: family,
      since: since ?? undefined,
    });

    const records = result.records ?? result ?? [];
    let latestApplied = since ?? '';
    let appliedCount = 0;
    let skippedCount = 0;

    for (const record of records) {
      try {
        await materializeRecordForFamily(family, record);
        appliedCount++;
        if ((record.updated_at ?? '') > latestApplied) latestApplied = record.updated_at ?? '';
      } catch (error) {
        skippedCount++;
        flightDeckLog('warn', 'sync', 'skipping undecryptable record', {
          family,
          recordId: record.record_id,
          error: error?.message || String(error),
        });
      }
    }

    totalPulled += records.length;
    completedFamilies++;

    if (onProgress) onProgress({ phase: 'pulling', completedFamilies, totalFamilies, currentFamily: label, pulled: totalPulled });

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
 * Full sync cycle: push then pull.
 */
export async function runSync(ownerNpub, viewerNpub = ownerNpub, onProgress) {
  if (!getBaseUrl()) throw new Error('Backend URL not configured');

  if (onProgress) onProgress({ phase: 'checking' });

  const pushResult = await flushPendingWrites(ownerNpub, onProgress);

  if (onProgress) onProgress({ phase: 'pulling', completedFamilies: 0, totalFamilies: DEFAULT_FAMILIES.length, currentFamily: null, pulled: 0 });
  const pullResult = await pullRecords(ownerNpub, viewerNpub, onProgress);

  if (onProgress) onProgress({ phase: 'applying' });

  return { ...pushResult, ...pullResult };
}

/**
 * Check if local cursors are behind the remote summary.
 */
export async function checkStaleness(ownerNpub) {
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
