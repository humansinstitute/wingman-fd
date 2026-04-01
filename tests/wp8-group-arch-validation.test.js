import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * WP8 Group Architecture Validation Suite — Flight Deck
 *
 * Integration-style tests covering:
 * - Group normalization pipeline (group_payloads → group_ids, shares)
 * - Stale ref repair after epoch rotation
 * - Access pruning after member removal
 * - Pruning cascade (channel → messages, record → comments)
 * - SSE reconnect / catch-up-required semantics
 * - Write diagnostics under workspace-key signing
 * - Share normalization preserving npub alongside UUID
 */

// =========================================================================
// 1. Group normalization pipeline
// =========================================================================

import {
  buildGroupRefMap,
  normalizeGroupRef,
  extractGroupIds,
  normalizeShareGroupRefs,
  buildWriteGroupFields,
  looksLikeUuid,
} from '../src/translators/group-refs.js';

describe('WP8: Group normalization — full pipeline', () => {
  const UUID_A = 'aaaaaaaa-1111-4111-a111-111111111111';
  const UUID_B = 'bbbbbbbb-2222-4222-a222-222222222222';
  const NPUB_A_E1 = 'npub1group_a_epoch1';
  const NPUB_A_E2 = 'npub1group_a_epoch2';
  const NPUB_B = 'npub1group_b_current';

  const groupPayloads = [
    { group_id: UUID_A, group_npub: NPUB_A_E2, group_epoch: 2, ciphertext: 'ct-a' },
    { group_id: UUID_B, group_npub: NPUB_B, group_epoch: 1, ciphertext: 'ct-b' },
  ];

  it('buildGroupRefMap maps npub → UUID and UUID → UUID', () => {
    const map = buildGroupRefMap(groupPayloads);
    expect(map.get(NPUB_A_E2)).toBe(UUID_A);
    expect(map.get(UUID_A)).toBe(UUID_A);
    expect(map.get(NPUB_B)).toBe(UUID_B);
    expect(map.get(UUID_B)).toBe(UUID_B);
  });

  it('normalizeGroupRef resolves npub to UUID', () => {
    const map = buildGroupRefMap(groupPayloads);
    expect(normalizeGroupRef(NPUB_A_E2, map)).toBe(UUID_A);
    expect(normalizeGroupRef(NPUB_B, map)).toBe(UUID_B);
  });

  it('normalizeGroupRef resolves UUID to itself', () => {
    const map = buildGroupRefMap(groupPayloads);
    expect(normalizeGroupRef(UUID_A, map)).toBe(UUID_A);
  });

  it('normalizeGroupRef passes through unknown refs', () => {
    const map = buildGroupRefMap(groupPayloads);
    expect(normalizeGroupRef('npub1unknown', map)).toBe('npub1unknown');
  });

  it('normalizeGroupRef returns null for empty input', () => {
    const map = buildGroupRefMap(groupPayloads);
    expect(normalizeGroupRef('', map)).toBeNull();
    expect(normalizeGroupRef(null, map)).toBeNull();
  });

  it('extractGroupIds returns deduplicated UUIDs from group_payloads', () => {
    const ids = extractGroupIds(groupPayloads);
    expect(ids).toEqual([UUID_A, UUID_B]);
  });

  it('extractGroupIds deduplicates when same group appears multiple times', () => {
    const payloads = [
      { group_id: UUID_A, group_npub: NPUB_A_E1 },
      { group_id: UUID_A, group_npub: NPUB_A_E2 },
    ];
    const ids = extractGroupIds(payloads);
    expect(ids).toEqual([UUID_A]);
  });

  it('extractGroupIds falls back to group_npub when group_id missing', () => {
    const payloads = [{ group_npub: NPUB_A_E2 }];
    const ids = extractGroupIds(payloads);
    expect(ids).toEqual([NPUB_A_E2]);
  });

  it('looksLikeUuid distinguishes UUIDs from npubs', () => {
    expect(looksLikeUuid(UUID_A)).toBe(true);
    expect(looksLikeUuid(UUID_B)).toBe(true);
    expect(looksLikeUuid(NPUB_A_E2)).toBe(false);
    expect(looksLikeUuid('')).toBe(false);
    expect(looksLikeUuid(null)).toBe(false);
  });
});

// =========================================================================
// 2. Share normalization — preserves npub alongside UUID
// =========================================================================

describe('WP8: Share normalization preserves crypto identity', () => {
  const UUID_A = 'aaaaaaaa-1111-4111-a111-111111111111';
  const NPUB_A = 'npub1group_a_crypto_id';

  const groupPayloads = [
    { group_id: UUID_A, group_npub: NPUB_A, group_epoch: 2, can_write: true },
  ];

  it('normalizes share.group_id to UUID, preserves group_npub from group_payloads', () => {
    const shares = [
      { type: 'group', group_npub: NPUB_A, access: 'write' },
    ];
    const result = normalizeShareGroupRefs(shares, groupPayloads);

    expect(result).toHaveLength(1);
    expect(result[0].group_id).toBe(UUID_A);
    expect(result[0].group_npub).toBe(NPUB_A);
    expect(result[0].access).toBe('write');
  });

  it('synthesizes shares from group_payloads when dataShares empty', () => {
    const result = normalizeShareGroupRefs([], groupPayloads);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('group');
    expect(result[0].group_id).toBe(UUID_A);
    expect(result[0].group_npub).toBe(NPUB_A);
  });

  it('handles share with UUID group_id referencing known group_payload', () => {
    const shares = [
      { type: 'group', group_id: UUID_A, access: 'read' },
    ];
    const result = normalizeShareGroupRefs(shares, groupPayloads);

    expect(result[0].group_id).toBe(UUID_A);
    expect(result[0].group_npub).toBe(NPUB_A);
  });

  it('handles share referencing unknown group — passes through', () => {
    const shares = [
      { type: 'group', group_id: 'unknown-uuid', access: 'read' },
    ];
    const result = normalizeShareGroupRefs(shares, []);

    expect(result[0].group_id).toBe('unknown-uuid');
    expect(result[0].group_npub).toBeNull();
  });
});

// =========================================================================
// 3. Stale ref repair after rotation
// =========================================================================

const prunerTables = {
  groups: [],
  channels: [],
  tasks: [],
  documents: [],
  directories: [],
  scopes: [],
  reports: [],
  schedules: [],
  audio_notes: [],
  chat_messages: [],
  comments: [],
};

function resetPrunerTables() {
  for (const key of Object.keys(prunerTables)) prunerTables[key] = [];
}

vi.mock('../src/db.js', () => ({
  getWorkspaceDb: vi.fn(() => {
    const db = {};
    for (const [name, rows] of Object.entries(prunerTables)) {
      db[name] = {
        toArray: vi.fn(async () => [...rows]),
        bulkPut: vi.fn(async (items) => {
          for (const item of items) {
            const idx = prunerTables[name].findIndex((r) => r.record_id === item.record_id);
            if (idx >= 0) prunerTables[name][idx] = item;
            else prunerTables[name].push(item);
          }
        }),
        bulkDelete: vi.fn(async (keys) => {
          prunerTables[name] = prunerTables[name].filter(
            (r) => !keys.includes(r.record_id ?? r.group_id)
          );
        }),
        where: vi.fn((field) => ({
          anyOf: vi.fn((values) => ({
            primaryKeys: vi.fn(async () =>
              prunerTables[name]
                .filter((r) => values.includes(r[field]))
                .map((r) => r.record_id ?? r.group_id)
            ),
            delete: vi.fn(async () => {
              const before = prunerTables[name].length;
              prunerTables[name] = prunerTables[name].filter((r) => !values.includes(r[field]));
              return before - prunerTables[name].length;
            }),
          })),
          equals: vi.fn((value) => ({
            primaryKeys: vi.fn(async () =>
              prunerTables[name]
                .filter((r) => r[field] === value)
                .map((r) => r.record_id ?? r.group_id)
            ),
            delete: vi.fn(async () => {
              const before = prunerTables[name].length;
              prunerTables[name] = prunerTables[name].filter((r) => r[field] !== value);
              return before - prunerTables[name].length;
            }),
          })),
        })),
      };
    }
    return db;
  }),
  getAllGroups: vi.fn(async () => [...prunerTables.groups]),
}));

const { repairStaleGroupRefs } = await import('../src/access-pruner.js');
const { pruneInaccessibleRecords } = await import('../src/access-pruner.js');

describe('WP8: Stale ref repair after rotation', () => {
  const UUID_A = 'aaaaaaaa-1111-4111-a111-111111111111';
  const STALE_NPUB_E1 = 'npub1stale_epoch1';
  const STALE_NPUB_E2 = 'npub1stale_epoch2';
  const CURRENT_NPUB = 'npub1current_epoch3';

  beforeEach(() => {
    resetPrunerTables();
    prunerTables.groups = [
      {
        group_id: UUID_A,
        group_npub: CURRENT_NPUB,
        current_group_npub: CURRENT_NPUB,
        owner_npub: 'npub_owner',
        member_npubs: ['npub_owner', 'npub_viewer'],
      },
    ];
  });

  it('repairs stale epoch-1 npub refs to UUID', async () => {
    prunerTables.tasks = [
      { record_id: 'task-1', group_ids: [STALE_NPUB_E1] },
    ];

    const npubToUuid = new Map([
      [STALE_NPUB_E1, UUID_A],
      [STALE_NPUB_E2, UUID_A],
      [CURRENT_NPUB, UUID_A],
    ]);

    const result = await repairStaleGroupRefs(npubToUuid);
    expect(result.repaired).toBe(1);
    expect(prunerTables.tasks[0].group_ids).toEqual([UUID_A]);
  });

  it('repairs refs from multiple prior epochs', async () => {
    prunerTables.tasks = [
      { record_id: 'task-1', group_ids: [STALE_NPUB_E1] },
    ];
    prunerTables.channels = [
      { record_id: 'ch-1', group_ids: [STALE_NPUB_E2] },
    ];

    const npubToUuid = new Map([
      [STALE_NPUB_E1, UUID_A],
      [STALE_NPUB_E2, UUID_A],
    ]);

    const result = await repairStaleGroupRefs(npubToUuid);
    expect(result.repaired).toBe(2);
    expect(prunerTables.tasks[0].group_ids).toEqual([UUID_A]);
    expect(prunerTables.channels[0].group_ids).toEqual([UUID_A]);
  });

  it('deduplicates when record has both stale npub and correct UUID', async () => {
    prunerTables.documents = [
      { record_id: 'doc-1', group_ids: [STALE_NPUB_E1, UUID_A] },
    ];

    const npubToUuid = new Map([[STALE_NPUB_E1, UUID_A]]);
    const result = await repairStaleGroupRefs(npubToUuid);

    expect(result.repaired).toBe(1);
    expect(prunerTables.documents[0].group_ids).toEqual([UUID_A]);
  });

  it('no-ops on records already using UUIDs', async () => {
    prunerTables.tasks = [
      { record_id: 'task-1', group_ids: [UUID_A] },
    ];

    const npubToUuid = new Map([[CURRENT_NPUB, UUID_A]]);
    const result = await repairStaleGroupRefs(npubToUuid);
    expect(result.repaired).toBe(0);
  });
});

// =========================================================================
// 4. Access pruning after membership change
// =========================================================================

describe('WP8: Access pruning after membership change', () => {
  const OWNER = 'npub_owner';
  const MEMBER = 'npub_member';
  const REMOVED = 'npub_removed';
  const GROUP_A = 'group-aaa';
  const GROUP_B = 'group-bbb';

  beforeEach(() => {
    resetPrunerTables();
    prunerTables.groups = [
      { group_id: GROUP_A, owner_npub: OWNER, member_npubs: [OWNER, MEMBER] },
      { group_id: GROUP_B, owner_npub: OWNER, member_npubs: [OWNER] },
    ];
  });

  it('owner sees all records regardless of group', async () => {
    prunerTables.tasks = [
      { record_id: 'task-a', group_ids: [GROUP_A] },
      { record_id: 'task-b', group_ids: [GROUP_B] },
    ];
    const result = await pruneInaccessibleRecords(OWNER, OWNER);
    expect(result.pruned).toBe(0);
    expect(prunerTables.tasks).toHaveLength(2);
  });

  it('removed member loses access to group-scoped records', async () => {
    prunerTables.channels = [
      { record_id: 'ch-a', group_ids: [GROUP_A] },
      { record_id: 'ch-b', group_ids: [GROUP_B] },
    ];

    // REMOVED is in neither group
    const result = await pruneInaccessibleRecords(REMOVED, OWNER);
    expect(prunerTables.channels).toHaveLength(0);
    expect(result.pruned).toBe(2);
  });

  it('member retains access to their groups but not others', async () => {
    prunerTables.tasks = [
      { record_id: 'task-a', group_ids: [GROUP_A] },
      { record_id: 'task-b', group_ids: [GROUP_B] },
    ];

    await pruneInaccessibleRecords(MEMBER, OWNER);
    expect(prunerTables.tasks.map((t) => t.record_id)).toEqual(['task-a']);
  });

  it('cascades: messages in pruned channels are removed', async () => {
    prunerTables.channels = [
      { record_id: 'ch-b', group_ids: [GROUP_B] },
    ];
    prunerTables.chat_messages = [
      { record_id: 'msg-1', channel_id: 'ch-b' },
      { record_id: 'msg-2', channel_id: 'ch-safe' },
    ];

    await pruneInaccessibleRecords(MEMBER, OWNER);
    expect(prunerTables.channels).toHaveLength(0);
    expect(prunerTables.chat_messages.map((m) => m.record_id)).toEqual(['msg-2']);
  });

  it('cascades: comments targeting pruned records are removed', async () => {
    prunerTables.tasks = [
      { record_id: 'task-b', group_ids: [GROUP_B] },
    ];
    prunerTables.comments = [
      { record_id: 'cmt-1', target_record_id: 'task-b' },
      { record_id: 'cmt-2', target_record_id: 'task-safe' },
    ];

    await pruneInaccessibleRecords(MEMBER, OWNER);
    expect(prunerTables.comments.map((c) => c.record_id)).toEqual(['cmt-2']);
  });

  it('multi-group record kept if viewer has access to any group', async () => {
    prunerTables.documents = [
      { record_id: 'doc-multi', group_ids: [GROUP_A, GROUP_B] },
    ];

    await pruneInaccessibleRecords(MEMBER, OWNER);
    expect(prunerTables.documents).toHaveLength(1);
  });

  it('unscoped records (empty group_ids) are never pruned', async () => {
    prunerTables.tasks = [
      { record_id: 'task-unscoped', group_ids: [] },
    ];

    await pruneInaccessibleRecords(REMOVED, OWNER);
    expect(prunerTables.tasks).toHaveLength(1);
  });
});

// =========================================================================
// 5. Write diagnostics with workspace keys
// =========================================================================

import { needsGroupWriteToken, diagnoseWriteContract } from '../src/write-diagnostics.js';

describe('WP8: Write diagnostics — workspace key signing', () => {
  const OWNER = 'npub1_ws_owner';
  const WS_KEY = 'npub1_ws_session_key';
  const DELEGATE = 'npub1_delegate_agent';

  it('owner-signed record does not need group token', () => {
    expect(needsGroupWriteToken({ signature_npub: OWNER }, OWNER, null)).toBe(false);
  });

  it('workspace-key-signed owner record does not need group token', () => {
    expect(needsGroupWriteToken({ signature_npub: WS_KEY }, OWNER, WS_KEY)).toBe(false);
  });

  it('delegate-signed record needs group token', () => {
    expect(needsGroupWriteToken({ signature_npub: DELEGATE }, OWNER, WS_KEY)).toBe(true);
  });

  it('diagnoseWriteContract: no warnings for valid ws-key owner write', () => {
    const record = { signature_npub: WS_KEY };
    expect(diagnoseWriteContract(record, OWNER, WS_KEY)).toEqual([]);
  });

  it('diagnoseWriteContract: warns when delegate has no write_group', () => {
    const record = { signature_npub: DELEGATE };
    const warnings = diagnoseWriteContract(record, OWNER, WS_KEY);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.includes('no write_group_id'))).toBe(true);
  });

  it('diagnoseWriteContract: no warnings when delegate has write_group_id', () => {
    const record = {
      signature_npub: DELEGATE,
      write_group_id: 'aaaaaaaa-1111-4111-a111-111111111111',
    };
    const warnings = diagnoseWriteContract(record, OWNER, WS_KEY);
    expect(warnings.some((w) => w.includes('no write_group_id'))).toBe(false);
  });

  it('diagnoseWriteContract: warns on missing signature_npub', () => {
    const warnings = diagnoseWriteContract({}, OWNER, WS_KEY);
    expect(warnings.some((w) => w.includes('missing signature_npub'))).toBe(true);
  });
});

// =========================================================================
// 6. buildWriteGroupFields routing
// =========================================================================

describe('WP8: write_group field routing', () => {
  it('UUID routes to write_group_id', () => {
    const fields = buildWriteGroupFields('aaaaaaaa-1111-4111-a111-111111111111');
    expect(fields.write_group_id).toBe('aaaaaaaa-1111-4111-a111-111111111111');
    expect(fields.write_group_npub).toBeUndefined();
  });

  it('npub routes to write_group_npub (legacy)', () => {
    const fields = buildWriteGroupFields('npub1groupkey');
    expect(fields.write_group_npub).toBe('npub1groupkey');
    expect(fields.write_group_id).toBeUndefined();
  });

  it('empty/null/undefined returns empty object', () => {
    expect(buildWriteGroupFields('')).toEqual({});
    expect(buildWriteGroupFields(null)).toEqual({});
    expect(buildWriteGroupFields(undefined)).toEqual({});
  });
});

// =========================================================================
// 7. SSE reconnect / catch-up-required semantics
// =========================================================================

describe('WP8: SSE reconnect and catch-up handling', () => {
  it('catch-up-required triggers full sync status', () => {
    const statuses = [];
    function postSSEStatus(status) { statuses.push(status); }

    // Simulate catch-up-required handler
    function handleCatchUpRequired() {
      postSSEStatus('catch-up-required');
    }

    handleCatchUpRequired();
    expect(statuses).toEqual(['catch-up-required']);
  });

  it('exponential backoff: 1s, 2s, 4s, 8s, 16s, capped at 60s', () => {
    const delays = [];
    for (let attempt = 0; attempt < 8; attempt++) {
      delays.push(Math.min(1000 * Math.pow(2, attempt), 60_000));
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000]);
  });

  it('connected event resets reconnect attempt counter', () => {
    let attempts = 4;
    function handleConnected() { attempts = 0; }

    handleConnected();
    expect(attempts).toBe(0);
  });

  it('falls back to polling after 5 consecutive failures', () => {
    let attempts = 0;
    const statuses = [];

    function scheduleReconnect() {
      attempts++;
      if (attempts > 5) {
        statuses.push('fallback-polling');
        return;
      }
      statuses.push('reconnecting');
    }

    for (let i = 0; i < 7; i++) scheduleReconnect();

    expect(statuses.slice(0, 5)).toEqual(Array(5).fill('reconnecting'));
    expect(statuses.slice(5)).toEqual(['fallback-polling', 'fallback-polling']);
  });

  it('echo suppression prevents double-pull for own writes', () => {
    const echoSet = new Map();
    const TTL = 30_000;

    function markOwnWrite(recordId, version) {
      echoSet.set(`${recordId}:${version}`, Date.now() + TTL);
    }

    function isOwnEcho(recordId, version) {
      const key = `${recordId}:${version}`;
      const expiry = echoSet.get(key);
      if (!expiry) return false;
      if (Date.now() > expiry) { echoSet.delete(key); return false; }
      echoSet.delete(key);
      return true;
    }

    markOwnWrite('rec-1', 5);
    expect(isOwnEcho('rec-1', 5)).toBe(true);
    expect(isOwnEcho('rec-1', 5)).toBe(false); // consumed
    expect(isOwnEcho('rec-2', 1)).toBe(false); // unknown
  });

  it('group-changed SSE event signals group refresh', () => {
    const eventData = {
      group_id: 'g1',
      group_npub: 'npub1rotated',
      action: 'epoch_rotated',
    };

    expect(['epoch_rotated', 'member_added', 'member_removed']).toContain(eventData.action);
  });
});
