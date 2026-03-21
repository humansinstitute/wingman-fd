import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = {
  pending: [],
  removed: [],
  syncCalls: [],
  syncStates: {},
  summaryResponse: null,
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
  getSyncState: vi.fn(async (key) => state.syncStates[key] ?? null),
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
  fetchRecordsSummary: vi.fn(async () => state.summaryResponse ?? { available: false, families: [] }),
}));

describe('sync worker pending write batching', () => {
  beforeEach(() => {
    state.pending = [];
    state.removed = [];
    state.syncCalls = [];
    state.syncStates = {};
    state.summaryResponse = null;
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

  it('emits progress callbacks during flush', async () => {
    state.pending = Array.from({ length: 30 }, (_, index) => ({
      row_id: index + 1,
      envelope: { record_id: `rec-${index + 1}` },
    }));

    const { flushPendingWrites } = await import('../src/worker/sync-worker.js');
    const updates = [];
    await flushPendingWrites('npub-owner', (update) => updates.push({ ...update }));

    expect(updates.length).toBeGreaterThanOrEqual(3);
    expect(updates[0]).toMatchObject({ phase: 'pushing', pushed: 0, pushTotal: 30 });
    expect(updates[updates.length - 1]).toMatchObject({ phase: 'pushing', pushed: 30, pushTotal: 30 });
  });

  it('emits progress callbacks during pull', async () => {
    const { pullRecords } = await import('../src/worker/sync-worker.js');
    const updates = [];
    await pullRecords('npub-owner', 'npub-owner', (update) => updates.push({ ...update }));

    expect(updates.length).toBeGreaterThanOrEqual(1);
    expect(updates[0]).toMatchObject({ phase: 'pulling', completedFamilies: 0 });
    const last = updates[updates.length - 1];
    expect(last.completedFamilies).toBe(last.totalFamilies);
  });

  it('emits full lifecycle progress through runSync', async () => {
    state.pending = [];

    const { runSync } = await import('../src/worker/sync-worker.js');
    const updates = [];
    await runSync('npub-owner', 'npub-owner', (update) => updates.push({ ...update }));

    const phases = updates.map((u) => u.phase);
    expect(phases[0]).toBe('checking');
    expect(phases).toContain('pulling');
    expect(phases[phases.length - 1]).toBe('applying');
  });
});

describe('staleness check', () => {
  beforeEach(() => {
    state.syncStates = {};
    state.summaryResponse = null;
    vi.resetModules();
  });

  it('returns not stale when summary endpoint is unavailable', async () => {
    state.summaryResponse = { available: false, families: [] };
    const { checkStaleness } = await import('../src/worker/sync-worker.js');
    const result = await checkStaleness('npub-owner');
    expect(result).toEqual({ stale: false, available: false });
  });

  it('returns stale when remote cursor is ahead of local', async () => {
    state.summaryResponse = {
      available: true,
      families: [{ record_family_hash: 'abc123', latest_updated_at: '2026-01-02T00:00:00Z' }],
    };
    state.syncStates['sync_since:abc123'] = '2026-01-01T00:00:00Z';

    const { checkStaleness } = await import('../src/worker/sync-worker.js');
    const result = await checkStaleness('npub-owner');
    expect(result).toEqual({ stale: true, available: true });
  });

  it('returns not stale when local cursor matches remote', async () => {
    state.summaryResponse = {
      available: true,
      families: [{ record_family_hash: 'abc123', latest_updated_at: '2026-01-01T00:00:00Z' }],
    };
    state.syncStates['sync_since:abc123'] = '2026-01-01T00:00:00Z';

    const { checkStaleness } = await import('../src/worker/sync-worker.js');
    const result = await checkStaleness('npub-owner');
    expect(result).toEqual({ stale: false, available: true });
  });
});
