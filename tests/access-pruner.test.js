import { describe, expect, it, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// In-memory fake Dexie tables
// ---------------------------------------------------------------------------
const tables = {
  groups: [],
  channels: [],
  chat_messages: [],
  documents: [],
  directories: [],
  tasks: [],
  reports: [],
  scopes: [],
  schedules: [],
  audio_notes: [],
  comments: [],
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
        bulkDelete: vi.fn(async (keys) => {
          tables[name] = tables[name].filter((r) => !keys.includes(r.record_id ?? r.group_id));
        }),
        where: vi.fn((field) => ({
          anyOf: vi.fn((values) => ({
            primaryKeys: vi.fn(async () =>
              tables[name]
                .filter((r) => values.includes(r[field]))
                .map((r) => r.record_id ?? r.group_id)
            ),
            delete: vi.fn(async () => {
              const before = tables[name].length;
              tables[name] = tables[name].filter((r) => !values.includes(r[field]));
              return before - tables[name].length;
            }),
          })),
          equals: vi.fn((value) => ({
            primaryKeys: vi.fn(async () =>
              tables[name]
                .filter((r) => r[field] === value)
                .map((r) => r.record_id ?? r.group_id)
            ),
            delete: vi.fn(async () => {
              const before = tables[name].length;
              tables[name] = tables[name].filter((r) => r[field] !== value);
              return before - tables[name].length;
            }),
          })),
        })),
      };
    }
    return db;
  }),
  getAllGroups: vi.fn(async () => [...tables.groups]),
}));

const { pruneInaccessibleRecords } = await import('../src/access-pruner.js');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OWNER = 'npub-owner';
const VIEWER = 'npub-viewer';
const GROUP_A = 'group-a';
const GROUP_B = 'group-b';

function seedGroups() {
  tables.groups = [
    { group_id: GROUP_A, owner_npub: OWNER, member_npubs: [OWNER, VIEWER] },
    { group_id: GROUP_B, owner_npub: OWNER, member_npubs: [OWNER] },
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('access-pruner', () => {
  beforeEach(() => {
    resetTables();
    seedGroups();
  });

  // --- owner sees everything ------------------------------------------------
  it('owner: no records pruned even when groups differ', async () => {
    tables.channels = [
      { record_id: 'ch-1', group_ids: [GROUP_A] },
      { record_id: 'ch-2', group_ids: [GROUP_B] },
    ];
    const result = await pruneInaccessibleRecords(OWNER, OWNER);
    expect(tables.channels).toHaveLength(2);
    expect(result.pruned).toBe(0);
  });

  // --- guest: channels pruned by group membership ---------------------------
  it('guest: channels not in accessible groups are pruned', async () => {
    tables.channels = [
      { record_id: 'ch-1', group_ids: [GROUP_A] },
      { record_id: 'ch-2', group_ids: [GROUP_B] },
    ];
    const result = await pruneInaccessibleRecords(VIEWER, OWNER);
    expect(tables.channels.map((c) => c.record_id)).toEqual(['ch-1']);
    expect(result.pruned).toBeGreaterThan(0);
  });

  // --- guest: messages cascade when channel pruned --------------------------
  it('guest: messages in pruned channels are removed', async () => {
    tables.channels = [
      { record_id: 'ch-1', group_ids: [GROUP_B] },
    ];
    tables.chat_messages = [
      { record_id: 'msg-1', channel_id: 'ch-1' },
      { record_id: 'msg-2', channel_id: 'ch-kept' },
    ];
    await pruneInaccessibleRecords(VIEWER, OWNER);
    // ch-1 pruned → msg-1 should be removed, msg-2 stays (orphan channel ok)
    expect(tables.channels).toHaveLength(0);
    expect(tables.chat_messages.map((m) => m.record_id)).toEqual(['msg-2']);
  });

  // --- guest: tasks pruned by group membership ------------------------------
  it('guest: tasks in inaccessible groups are pruned', async () => {
    tables.tasks = [
      { record_id: 'task-1', group_ids: [GROUP_A] },
      { record_id: 'task-2', group_ids: [GROUP_B] },
      { record_id: 'task-3', group_ids: [] },
    ];
    await pruneInaccessibleRecords(VIEWER, OWNER);
    // task-1 kept (GROUP_A accessible), task-2 pruned, task-3 kept (no groups = unscoped)
    expect(tables.tasks.map((t) => t.record_id).sort()).toEqual(['task-1', 'task-3']);
  });

  // --- guest: documents pruned by group membership --------------------------
  it('guest: documents in inaccessible groups are pruned', async () => {
    tables.documents = [
      { record_id: 'doc-1', group_ids: [GROUP_A] },
      { record_id: 'doc-2', group_ids: [GROUP_B] },
    ];
    await pruneInaccessibleRecords(VIEWER, OWNER);
    expect(tables.documents.map((d) => d.record_id)).toEqual(['doc-1']);
  });

  // --- guest: directories pruned by group membership ------------------------
  it('guest: directories in inaccessible groups are pruned', async () => {
    tables.directories = [
      { record_id: 'dir-1', group_ids: [GROUP_A] },
      { record_id: 'dir-2', group_ids: [GROUP_B] },
    ];
    await pruneInaccessibleRecords(VIEWER, OWNER);
    expect(tables.directories.map((d) => d.record_id)).toEqual(['dir-1']);
  });

  // --- guest: scopes pruned by group membership -----------------------------
  it('guest: scopes in inaccessible groups are pruned', async () => {
    tables.scopes = [
      { record_id: 'scope-1', group_ids: [GROUP_A] },
      { record_id: 'scope-2', group_ids: [GROUP_B] },
    ];
    await pruneInaccessibleRecords(VIEWER, OWNER);
    expect(tables.scopes.map((s) => s.record_id)).toEqual(['scope-1']);
  });

  // --- guest: reports pruned by group membership ----------------------------
  it('guest: reports in inaccessible groups are pruned', async () => {
    tables.reports = [
      { record_id: 'rpt-1', group_ids: [GROUP_A] },
      { record_id: 'rpt-2', group_ids: [GROUP_B] },
    ];
    await pruneInaccessibleRecords(VIEWER, OWNER);
    expect(tables.reports.map((r) => r.record_id)).toEqual(['rpt-1']);
  });

  // --- guest: schedules pruned by group membership --------------------------
  it('guest: schedules in inaccessible groups are pruned', async () => {
    tables.schedules = [
      { record_id: 'sched-1', group_ids: [GROUP_A] },
      { record_id: 'sched-2', group_ids: [GROUP_B] },
    ];
    await pruneInaccessibleRecords(VIEWER, OWNER);
    expect(tables.schedules.map((s) => s.record_id)).toEqual(['sched-1']);
  });

  // --- guest: audio_notes pruned by group membership ------------------------
  it('guest: audio notes in inaccessible groups are pruned', async () => {
    tables.audio_notes = [
      { record_id: 'an-1', group_ids: [GROUP_A] },
      { record_id: 'an-2', group_ids: [GROUP_B] },
    ];
    await pruneInaccessibleRecords(VIEWER, OWNER);
    expect(tables.audio_notes.map((a) => a.record_id)).toEqual(['an-1']);
  });

  // --- guest: comments cascade when target pruned ---------------------------
  it('guest: comments targeting pruned records are removed', async () => {
    tables.tasks = [
      { record_id: 'task-1', group_ids: [GROUP_B] },
    ];
    tables.comments = [
      { record_id: 'cmt-1', target_record_id: 'task-1' },
      { record_id: 'cmt-2', target_record_id: 'task-kept' },
    ];
    await pruneInaccessibleRecords(VIEWER, OWNER);
    expect(tables.tasks).toHaveLength(0);
    expect(tables.comments.map((c) => c.record_id)).toEqual(['cmt-2']);
  });

  // --- multi-group: record accessible via at least one group ----------------
  it('record with multiple groups kept if any group is accessible', async () => {
    tables.channels = [
      { record_id: 'ch-multi', group_ids: [GROUP_A, GROUP_B] },
    ];
    await pruneInaccessibleRecords(VIEWER, OWNER);
    expect(tables.channels).toHaveLength(1);
  });

  // --- empty state: no errors -----------------------------------------------
  it('handles empty tables gracefully', async () => {
    const result = await pruneInaccessibleRecords(VIEWER, OWNER);
    expect(result.pruned).toBe(0);
  });

  // --- deleted records: already-deleted records stay deleted, not counted ----
  it('records with record_state deleted are still pruned if inaccessible', async () => {
    tables.channels = [
      { record_id: 'ch-del', group_ids: [GROUP_B], record_state: 'deleted' },
    ];
    await pruneInaccessibleRecords(VIEWER, OWNER);
    expect(tables.channels).toHaveLength(0);
  });

  // --- no groups at all: viewer not in any group, prune group-bearing -------
  it('viewer with no group membership: all group-bearing records pruned', async () => {
    const OUTSIDER = 'npub-outsider';
    tables.channels = [
      { record_id: 'ch-1', group_ids: [GROUP_A] },
    ];
    tables.tasks = [
      { record_id: 'task-1', group_ids: [] },
    ];
    await pruneInaccessibleRecords(OUTSIDER, OWNER);
    // ch-1 pruned (outsider not in GROUP_A), task-1 kept (no group)
    expect(tables.channels).toHaveLength(0);
    expect(tables.tasks).toHaveLength(1);
  });

  // --- result summary reports correct counts --------------------------------
  it('returns summary with total pruned count', async () => {
    tables.channels = [
      { record_id: 'ch-1', group_ids: [GROUP_B] },
    ];
    tables.tasks = [
      { record_id: 'task-1', group_ids: [GROUP_B] },
    ];
    tables.comments = [
      { record_id: 'cmt-1', target_record_id: 'task-1' },
    ];
    const result = await pruneInaccessibleRecords(VIEWER, OWNER);
    expect(result.pruned).toBe(3); // channel + task + comment
  });
});
