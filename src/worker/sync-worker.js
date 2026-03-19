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

import db, {
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
} from '../db.js';

import { syncRecords, fetchRecords, getBaseUrl } from '../api.js';
import { inboundChannel, inboundChatMessage, recordFamilyHash } from '../translators/chat.js';
import { inboundDocument, inboundDirectory } from '../translators/docs.js';
import { inboundTask } from '../translators/tasks.js';
import { inboundSchedule, recordFamilyHash as scheduleFamilyHash } from '../translators/schedules.js';
import { inboundComment } from '../translators/comments.js';
import { inboundAudioNote } from '../translators/audio-notes.js';
import { inboundScope } from '../translators/scopes.js';
import { inboundWorkspaceSettings, recordFamilyHash as settingsFamilyHash } from '../translators/settings.js';
import { DEFAULT_SYNC_FAMILY_IDS, getSyncFamilyHash } from '../sync-families.js';
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
export async function flushPendingWrites(ownerNpub) {
  const pending = await getPendingWrites();
  if (pending.length === 0) return { pushed: 0 };
  let pushed = 0;

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

/**
 * Pull records from backend, translate, and materialize locally.
 */
export async function pullRecords(ownerNpub, viewerNpub = ownerNpub) {
  return pullRecordsForFamilies(ownerNpub, viewerNpub, DEFAULT_FAMILIES);
}

export async function pullRecordsForFamilies(ownerNpub, viewerNpub = ownerNpub, families = DEFAULT_FAMILIES, options = {}) {
  const forceFull = options.forceFull === true;
  let totalPulled = 0;

  for (const family of families) {
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
export async function runSync(ownerNpub, viewerNpub = ownerNpub) {
  if (!getBaseUrl()) throw new Error('Backend URL not configured');

  const pushResult = await flushPendingWrites(ownerNpub);
  const pullResult = await pullRecords(ownerNpub, viewerNpub);

  return { ...pushResult, ...pullResult };
}
