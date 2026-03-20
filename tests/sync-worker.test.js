import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = {
  pending: [],
  removed: [],
  syncCalls: [],
};

vi.mock('../src/db.js', () => ({
  openWorkspaceDb: vi.fn(),
  getPendingWrites: vi.fn(async () => state.pending),
  removePendingWrite: vi.fn(async (rowId) => {
    state.removed.push(rowId);
  }),
  upsertWorkspaceSettings: vi.fn(),
  upsertChannel: vi.fn(),
  upsertMessage: vi.fn(),
  upsertDocument: vi.fn(),
  upsertDirectory: vi.fn(),
  upsertTask: vi.fn(),
  upsertSchedule: vi.fn(),
  upsertComment: vi.fn(),
  upsertAudioNote: vi.fn(),
  upsertScope: vi.fn(),
  getSyncState: vi.fn(),
  setSyncState: vi.fn(),
  upsertSyncQuarantineEntry: vi.fn(),
  deleteSyncQuarantineEntry: vi.fn(),
}));

vi.mock('../src/api.js', () => ({
  getBaseUrl: vi.fn(() => 'https://sb4.otherstuff.studio'),
  syncRecords: vi.fn(async ({ records }) => {
    state.syncCalls.push(records.map((record) => record.record_id));
  }),
  fetchRecords: vi.fn(async () => ({ records: [] })),
}));

describe('sync worker pending write batching', () => {
  beforeEach(() => {
    state.pending = [];
    state.removed = [];
    state.syncCalls = [];
    vi.resetModules();
  });

  it('flushes pending writes in bounded batches', async () => {
    state.pending = Array.from({ length: 52 }, (_, index) => ({
      row_id: index + 1,
      envelope: { record_id: `task-${index + 1}` },
    }));

    const { flushPendingWrites } = await import('../src/worker/sync-worker.js');
    const result = await flushPendingWrites('npub-owner');

    expect(result).toEqual({ pushed: 52 });
    expect(state.syncCalls).toHaveLength(3);
    expect(state.syncCalls.map((batch) => batch.length)).toEqual([25, 25, 2]);
    expect(state.removed).toEqual(Array.from({ length: 52 }, (_, index) => index + 1));
  });

  it('keeps the failing batch pending and reports batch context', async () => {
    state.pending = Array.from({ length: 30 }, (_, index) => ({
      row_id: index + 1,
      envelope: { record_id: `task-${index + 1}` },
    }));

    const { syncRecords } = await import('../src/api.js');
    syncRecords.mockImplementationOnce(async ({ records }) => {
      state.syncCalls.push(records.map((record) => record.record_id));
    });
    syncRecords.mockImplementationOnce(async ({ records }) => {
      state.syncCalls.push(records.map((record) => record.record_id));
      throw new Error('NetworkError when attempting to fetch resource.');
    });

    const { flushPendingWrites } = await import('../src/worker/sync-worker.js');

    await expect(flushPendingWrites('npub-owner')).rejects.toThrow(
      'Pending write sync failed for batch 2 (5 records, 25/30 flushed): NetworkError when attempting to fetch resource.'
    );

    expect(state.removed).toEqual(Array.from({ length: 25 }, (_, index) => index + 1));
    expect(state.syncCalls).toHaveLength(2);
    expect(state.syncCalls.map((batch) => batch.length)).toEqual([25, 5]);
  });
});
