import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Stub db.js and api.js so sync-worker can be imported without real backends
// ---------------------------------------------------------------------------
vi.mock('../src/db.js', () => ({
  openWorkspaceDb: vi.fn(),
  getWorkspaceDb: vi.fn(() => ({})),
  getPendingWrites: vi.fn(async () => []),
  removePendingWrite: vi.fn(),
  upsertWorkspaceSettings: vi.fn(),
  upsertChannel: vi.fn(),
  upsertMessage: vi.fn(),
  upsertDocument: vi.fn(),
  upsertDirectory: vi.fn(),
  upsertReport: vi.fn(),
  upsertTask: vi.fn(),
  upsertSchedule: vi.fn(),
  upsertComment: vi.fn(),
  upsertAudioNote: vi.fn(),
  upsertScope: vi.fn(),
  getSyncState: vi.fn(async () => null),
  setSyncState: vi.fn(),
  upsertSyncQuarantineEntry: vi.fn(),
  deleteSyncQuarantineEntry: vi.fn(),
  getAllGroups: vi.fn(async () => []),
}));

vi.mock('../src/api.js', () => ({
  syncRecords: vi.fn(),
  fetchRecords: vi.fn(async () => ({ records: [] })),
  getBaseUrl: vi.fn(() => 'http://localhost:3100'),
  fetchRecordsSummary: vi.fn(async () => ({ available: false })),
  fetchHeartbeat: vi.fn(async () => ({ stale_families: [] })),
}));

// Track pruneInaccessibleRecords calls
const pruneSpy = vi.fn(async () => ({ pruned: 0 }));
vi.mock('../src/access-pruner.js', () => ({
  pruneInaccessibleRecords: (...args) => pruneSpy(...args),
}));

vi.mock('../src/logging.js', () => ({
  flightDeckLog: vi.fn(),
}));

const { runSync, resetPruneThrottle } = await import('../src/worker/sync-worker.js');
const { fetchHeartbeat, fetchRecords } = await import('../src/api.js');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sync-worker pruner throttle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Set a base time well past the throttle window so the first prune isn't
    // blocked by the initial lastPruneTime = 0.
    vi.setSystemTime(new Date('2026-03-31T00:00:00Z'));
    resetPruneThrottle();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('skips pruning when heartbeat reports 0 stale families', async () => {
    fetchHeartbeat.mockResolvedValueOnce({ stale_families: [] });

    await runSync('owner', 'viewer', vi.fn());

    expect(pruneSpy).not.toHaveBeenCalled();
  });

  it('skips pruning when pull returns 0 records', async () => {
    fetchHeartbeat.mockResolvedValueOnce({ stale_families: ['family-hash-1'] });
    fetchRecords.mockResolvedValueOnce({ records: [] });

    await runSync('owner', 'viewer', vi.fn());

    expect(pruneSpy).not.toHaveBeenCalled();
  });

  it('runs pruning when records were actually pulled', async () => {
    fetchHeartbeat.mockResolvedValueOnce({ stale_families: ['family-hash-1'] });
    fetchRecords.mockResolvedValueOnce({
      records: [{ record_id: 'r1', updated_at: '2026-03-31T00:00:00Z' }],
    });

    await runSync('owner', 'viewer', vi.fn());

    expect(pruneSpy).toHaveBeenCalledOnce();
    expect(pruneSpy).toHaveBeenCalledWith('viewer', 'owner');
  });

  it('throttles pruning to at most once per 30 seconds', async () => {
    // First sync with records → prune runs
    fetchHeartbeat.mockResolvedValue({ stale_families: ['family-hash-1'] });
    fetchRecords.mockResolvedValue({
      records: [{ record_id: 'r1', updated_at: '2026-03-31T00:00:00Z' }],
    });

    await runSync('owner', 'viewer', vi.fn());
    expect(pruneSpy).toHaveBeenCalledTimes(1);

    // Second sync 5 seconds later → should be throttled
    vi.advanceTimersByTime(5000);
    await runSync('owner', 'viewer', vi.fn());
    expect(pruneSpy).toHaveBeenCalledTimes(1); // still 1

    // Third sync 30+ seconds after first → should run again
    vi.advanceTimersByTime(30000);
    await runSync('owner', 'viewer', vi.fn());
    expect(pruneSpy).toHaveBeenCalledTimes(2);
  });

  it('runs pruning on full-pull fallback when records are pulled', async () => {
    // Heartbeat fails → falls back to full pull
    fetchHeartbeat.mockRejectedValueOnce(new Error('heartbeat 404'));
    fetchRecords.mockResolvedValue({
      records: [{ record_id: 'r1', updated_at: '2026-03-31T00:00:00Z' }],
    });

    await runSync('owner', 'viewer', vi.fn());

    expect(pruneSpy).toHaveBeenCalledOnce();
  });

  it('skips pruning on full-pull fallback when 0 records pulled', async () => {
    fetchHeartbeat.mockRejectedValueOnce(new Error('heartbeat 404'));
    fetchRecords.mockResolvedValue({ records: [] });

    await runSync('owner', 'viewer', vi.fn());

    expect(pruneSpy).not.toHaveBeenCalled();
  });
});
