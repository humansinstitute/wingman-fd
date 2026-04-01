import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// In-memory fake Dexie tables
// ---------------------------------------------------------------------------
const tables = {
  groups: [],
  channels: [],
  tasks: [],
  documents: [],
  directories: [],
  scopes: [],
  reports: [],
  schedules: [],
  audio_notes: [],
};

function resetTables() {
  for (const key of Object.keys(tables)) tables[key] = [];
}

vi.mock('../src/db.js', () => ({
  getWorkspaceDb: vi.fn(() => {
    const db = {};
    for (const [name, rows] of Object.entries(tables)) {
      db[name] = {
        toArray: vi.fn(async () => [...rows]),
        bulkPut: vi.fn(async (items) => {
          for (const item of items) {
            const idx = tables[name].findIndex((r) => r.record_id === item.record_id);
            if (idx >= 0) tables[name][idx] = item;
            else tables[name].push(item);
          }
        }),
        bulkDelete: vi.fn(async (keys) => {
          tables[name] = tables[name].filter((r) => !keys.includes(r.record_id ?? r.group_id));
        }),
      };
    }
    return db;
  }),
  getAllGroups: vi.fn(async () => [...tables.groups]),
}));

const { repairStaleGroupRefs } = await import('../src/access-pruner.js');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const UUID_1 = 'aaaaaaaa-1111-4111-a111-111111111111';
const UUID_2 = 'bbbbbbbb-2222-4222-a222-222222222222';
const STALE_NPUB_1 = 'npub_stale_epoch1';
const STALE_NPUB_2 = 'npub_stale_epoch2';

function seedGroups() {
  tables.groups = [
    {
      group_id: UUID_1,
      group_npub: 'npub_current_1',
      current_group_npub: 'npub_current_1',
      owner_npub: 'npub_owner',
      member_npubs: ['npub_owner', 'npub_viewer'],
    },
    {
      group_id: UUID_2,
      group_npub: 'npub_current_2',
      current_group_npub: 'npub_current_2',
      owner_npub: 'npub_owner',
      member_npubs: ['npub_owner'],
    },
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('repairStaleGroupRefs', () => {
  beforeEach(() => {
    resetTables();
    seedGroups();
  });

  it('replaces stale npub in group_ids with stable UUID', async () => {
    tables.tasks = [
      { record_id: 'task-1', group_ids: [STALE_NPUB_1, UUID_2] },
    ];

    // Pass the npub→uuid mapping so repair knows which npubs map to which UUIDs
    const npubToUuid = new Map([
      [STALE_NPUB_1, UUID_1],
      ['npub_current_1', UUID_1],
      [STALE_NPUB_2, UUID_2],
      ['npub_current_2', UUID_2],
    ]);

    const result = await repairStaleGroupRefs(npubToUuid);

    expect(result.repaired).toBe(1);
    expect(tables.tasks[0].group_ids).toEqual([UUID_1, UUID_2]);
  });

  it('does nothing when group_ids already contain UUIDs', async () => {
    tables.channels = [
      { record_id: 'ch-1', group_ids: [UUID_1] },
    ];

    const npubToUuid = new Map([['npub_current_1', UUID_1]]);
    const result = await repairStaleGroupRefs(npubToUuid);

    expect(result.repaired).toBe(0);
    expect(tables.channels[0].group_ids).toEqual([UUID_1]);
  });

  it('deduplicates after repair if npub and uuid pointed to same group', async () => {
    tables.documents = [
      { record_id: 'doc-1', group_ids: [STALE_NPUB_1, UUID_1] },
    ];

    const npubToUuid = new Map([[STALE_NPUB_1, UUID_1]]);
    const result = await repairStaleGroupRefs(npubToUuid);

    expect(result.repaired).toBe(1);
    expect(tables.documents[0].group_ids).toEqual([UUID_1]);
  });

  it('repairs across multiple tables', async () => {
    tables.tasks = [
      { record_id: 'task-1', group_ids: [STALE_NPUB_1] },
    ];
    tables.channels = [
      { record_id: 'ch-1', group_ids: [STALE_NPUB_2] },
    ];

    const npubToUuid = new Map([
      [STALE_NPUB_1, UUID_1],
      [STALE_NPUB_2, UUID_2],
    ]);
    const result = await repairStaleGroupRefs(npubToUuid);

    expect(result.repaired).toBe(2);
    expect(tables.tasks[0].group_ids).toEqual([UUID_1]);
    expect(tables.channels[0].group_ids).toEqual([UUID_2]);
  });

  it('returns 0 repaired for empty tables', async () => {
    const npubToUuid = new Map();
    const result = await repairStaleGroupRefs(npubToUuid);
    expect(result.repaired).toBe(0);
  });

  it('skips records with empty or missing group_ids', async () => {
    tables.tasks = [
      { record_id: 'task-1', group_ids: [] },
      { record_id: 'task-2' },
    ];

    const npubToUuid = new Map([[STALE_NPUB_1, UUID_1]]);
    const result = await repairStaleGroupRefs(npubToUuid);

    expect(result.repaired).toBe(0);
  });
});
