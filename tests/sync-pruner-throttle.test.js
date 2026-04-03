import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Stub db.js and api.js so sync-worker can be imported without real backends
// ---------------------------------------------------------------------------

// In-memory sync_state store for the pruner's IndexedDB-backed cooldown
const syncStateStore = {};
let fakeNow = Date.parse('2026-03-31T00:00:00Z');
let dateNowSpy;

vi.mock('../src/db.js', () => ({
  openWorkspaceDb: vi.fn(),
  getWorkspaceDb: vi.fn(() => ({
    chat_messages: {
      where: vi.fn(() => ({
        above: vi.fn(() => ({
          first: vi.fn(async () => null),
          toArray: vi.fn(async () => []),
        })),
      })),
    },
    documents: {
      where: vi.fn(() => ({
        above: vi.fn(() => ({
          first: vi.fn(async () => null),
        })),
      })),
    },
    tasks: {
      toArray: vi.fn(async () => []),
    },
    channels: {
      toArray: vi.fn(async () => []),
    },
  })),
  getSharedDb: vi.fn(() => ({ workspace_keys: {} })),
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
  getSyncState: vi.fn(async (key) => syncStateStore[key] ?? null),
  setSyncState: vi.fn(async (key, value) => { syncStateStore[key] = value; }),
  upsertSyncQuarantineEntry: vi.fn(),
  deleteSyncQuarantineEntry: vi.fn(),
  getReadCursorsByKeys: vi.fn(async () => []),
  getReadCursorsByPrefix: vi.fn(async () => []),
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
const repairSpy = vi.fn(async () => ({ repaired: 0 }));
vi.mock('../src/access-pruner.js', () => ({
  pruneInaccessibleRecords: (...args) => pruneSpy(...args),
  repairStaleGroupRefs: (...args) => repairSpy(...args),
}));

vi.mock('../src/logging.js', () => ({
  flightDeckLog: vi.fn(),
}));

const { runSync, pruneOnLogin } = await import('../src/worker/sync-worker.js');
const { fetchHeartbeat, fetchRecords } = await import('../src/api.js');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sync-worker pruner throttle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeNow = Date.parse('2026-03-31T00:00:00Z');
    dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => fakeNow);
    // Clear persisted prune state
    for (const key of Object.keys(syncStateStore)) delete syncStateStore[key];
  });

  afterEach(() => {
    dateNowSpy?.mockRestore();
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

  it('throttles sync-triggered pruning to at most once per hour', async () => {
    fetchHeartbeat.mockResolvedValue({ stale_families: ['family-hash-1'] });
    fetchRecords.mockResolvedValue({
      records: [{ record_id: 'r1', updated_at: '2026-03-31T00:00:00Z' }],
    });

    // First sync with records → prune runs
    await runSync('owner', 'viewer', vi.fn());
    expect(pruneSpy).toHaveBeenCalledTimes(1);

    // Second sync 5 minutes later → should be throttled (< 1 hour)
    fakeNow += 5 * 60 * 1000;
    await runSync('owner', 'viewer', vi.fn());
    expect(pruneSpy).toHaveBeenCalledTimes(1); // still 1

    // Third sync 1 hour after first → should run again
    fakeNow += 60 * 60 * 1000;
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

  // --- pruneOnLogin ---

  it('pruneOnLogin always runs regardless of cooldown', async () => {
    // Simulate a recent prune (would block sync-triggered prunes)
    syncStateStore['access_prune_last'] = Date.now();

    await pruneOnLogin('viewer', 'owner');

    expect(pruneSpy).toHaveBeenCalledOnce();
    expect(pruneSpy).toHaveBeenCalledWith('viewer', 'owner');
  });

  it('pruneOnLogin attempts stale group ref repair before pruning', async () => {
    const { getAllGroups } = await import('../src/db.js');
    getAllGroups.mockResolvedValueOnce([
      {
        group_id: 'group-1',
        group_npub: 'npub-group-1',
        current_group_npub: 'npub-group-current-1',
      },
    ]);

    await pruneOnLogin('viewer', 'owner');

    expect(repairSpy).toHaveBeenCalledOnce();
    expect(repairSpy).toHaveBeenCalledWith(new Map([
      ['npub-group-1', 'group-1'],
      ['npub-group-current-1', 'group-1'],
    ]));
  });

  it('pruneOnLogin persists last-prune timestamp', async () => {
    await pruneOnLogin('viewer', 'owner');

    expect(syncStateStore['access_prune_last']).toBeGreaterThan(0);
  });

  it('sync-triggered prune is skipped after recent pruneOnLogin', async () => {
    // Login prune
    await pruneOnLogin('viewer', 'owner');
    expect(pruneSpy).toHaveBeenCalledTimes(1);

    // Sync shortly after — should be skipped by cooldown
    fetchHeartbeat.mockResolvedValueOnce({ stale_families: ['family-hash-1'] });
    fetchRecords.mockResolvedValueOnce({
      records: [{ record_id: 'r1', updated_at: '2026-03-31T00:00:00Z' }],
    });
    await runSync('owner', 'viewer', vi.fn());

    expect(pruneSpy).toHaveBeenCalledTimes(1); // login only, sync skipped
  });
});
