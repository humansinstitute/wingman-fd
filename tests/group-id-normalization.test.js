import { describe, it, expect, vi } from 'vitest';

import {
  looksLikeUuid,
  buildWriteGroupFields,
  buildGroupRefMap,
  normalizeGroupRef,
  normalizeShareGroupRefs,
  extractGroupIds,
} from '../src/translators/group-refs.js';

// ---------------------------------------------------------------------------
// looksLikeUuid (existing)
// ---------------------------------------------------------------------------

describe('looksLikeUuid', () => {
  it('accepts valid v4 UUIDs', () => {
    expect(looksLikeUuid('3fa85f64-5717-4562-b3fc-2c963f66afa6')).toBe(true);
  });
  it('rejects npub strings', () => {
    expect(looksLikeUuid('npub1abc')).toBe(false);
  });
  it('rejects empty / null', () => {
    expect(looksLikeUuid('')).toBe(false);
    expect(looksLikeUuid(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildGroupRefMap — maps npub→UUID, UUID→UUID
// ---------------------------------------------------------------------------

describe('buildGroupRefMap', () => {
  it('maps group_npub to group_id when both present', () => {
    const map = buildGroupRefMap([
      { group_id: 'uuid-1', group_npub: 'npub_old', group_epoch: 2 },
    ]);
    expect(map.get('npub_old')).toBe('uuid-1');
    expect(map.get('uuid-1')).toBe('uuid-1');
  });

  it('uses group_npub as identity when group_id is absent', () => {
    const map = buildGroupRefMap([
      { group_npub: 'npub_legacy' },
    ]);
    expect(map.get('npub_legacy')).toBe('npub_legacy');
  });

  it('handles empty array', () => {
    const map = buildGroupRefMap([]);
    expect(map.size).toBe(0);
  });

  it('handles null/undefined payloads', () => {
    expect(buildGroupRefMap(null).size).toBe(0);
    expect(buildGroupRefMap(undefined).size).toBe(0);
  });

  it('handles multiple payloads with different epochs mapping to same group_id', () => {
    const map = buildGroupRefMap([
      { group_id: 'uuid-1', group_npub: 'npub_epoch1', group_epoch: 1 },
      { group_id: 'uuid-1', group_npub: 'npub_epoch2', group_epoch: 2 },
    ]);
    expect(map.get('npub_epoch1')).toBe('uuid-1');
    expect(map.get('npub_epoch2')).toBe('uuid-1');
    expect(map.get('uuid-1')).toBe('uuid-1');
  });
});

// ---------------------------------------------------------------------------
// normalizeGroupRef — resolves a single ref through the map
// ---------------------------------------------------------------------------

describe('normalizeGroupRef', () => {
  const map = buildGroupRefMap([
    { group_id: 'uuid-1', group_npub: 'npub_old', group_epoch: 2 },
  ]);

  it('resolves stale npub to UUID', () => {
    expect(normalizeGroupRef('npub_old', map)).toBe('uuid-1');
  });

  it('passes through UUID unchanged', () => {
    expect(normalizeGroupRef('uuid-1', map)).toBe('uuid-1');
  });

  it('passes through unknown ref unchanged', () => {
    expect(normalizeGroupRef('npub_unknown', map)).toBe('npub_unknown');
  });

  it('returns null for empty/falsy', () => {
    expect(normalizeGroupRef('', map)).toBeNull();
    expect(normalizeGroupRef(null, map)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractGroupIds — extracts stable group_ids from group_payloads
// ---------------------------------------------------------------------------

describe('extractGroupIds', () => {
  it('prefers group_id over group_npub', () => {
    const ids = extractGroupIds([
      { group_id: 'uuid-1', group_npub: 'npub_old' },
      { group_id: 'uuid-2', group_npub: 'npub_old2' },
    ]);
    expect(ids).toEqual(['uuid-1', 'uuid-2']);
  });

  it('falls back to group_npub when group_id is missing', () => {
    const ids = extractGroupIds([
      { group_npub: 'npub_legacy' },
    ]);
    expect(ids).toEqual(['npub_legacy']);
  });

  it('deduplicates when same group_id appears in multiple payloads', () => {
    const ids = extractGroupIds([
      { group_id: 'uuid-1', group_npub: 'npub_epoch1' },
      { group_id: 'uuid-1', group_npub: 'npub_epoch2' },
    ]);
    expect(ids).toEqual(['uuid-1']);
  });

  it('returns empty array for empty/null payloads', () => {
    expect(extractGroupIds([])).toEqual([]);
    expect(extractGroupIds(null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// normalizeShareGroupRefs — resolves share group refs to stable UUIDs
// ---------------------------------------------------------------------------

describe('normalizeShareGroupRefs', () => {
  const groupPayloads = [
    { group_id: 'uuid-1', group_npub: 'npub_old_epoch1', group_epoch: 1 },
    { group_id: 'uuid-2', group_npub: 'npub_old_epoch2', group_epoch: 3 },
  ];

  it('resolves stale group_npub in shares to UUID via group_id field', () => {
    const shares = [
      { type: 'group', group_npub: 'npub_old_epoch1', access: 'write' },
    ];
    const result = normalizeShareGroupRefs(shares, groupPayloads);
    expect(result[0].group_id).toBe('uuid-1');
    expect(result[0].key).toBe('uuid-1');
  });

  it('preserves existing group_id when already a UUID', () => {
    const shares = [
      { type: 'group', group_id: 'uuid-2', group_npub: 'npub_old_epoch2', access: 'read' },
    ];
    const result = normalizeShareGroupRefs(shares, groupPayloads);
    expect(result[0].group_id).toBe('uuid-2');
  });

  it('resolves via_group ref to UUID', () => {
    const shares = [
      { type: 'person', person_npub: 'npub_person', via_group_npub: 'npub_old_epoch1', access: 'write' },
    ];
    const result = normalizeShareGroupRefs(shares, groupPayloads);
    expect(result[0].via_group_id).toBe('uuid-1');
  });

  it('synthesizes shares from group_payloads when dataShares is empty', () => {
    const result = normalizeShareGroupRefs([], groupPayloads);
    expect(result).toHaveLength(2);
    expect(result[0].group_id).toBe('uuid-1');
    expect(result[1].group_id).toBe('uuid-2');
    expect(result[0].type).toBe('group');
  });

  it('returns empty array when both inputs are empty', () => {
    const result = normalizeShareGroupRefs([], []);
    expect(result).toEqual([]);
  });

  it('handles person shares with key preserved', () => {
    const shares = [
      { type: 'person', person_npub: 'npub_person', key: 'npub_person', access: 'read' },
    ];
    const result = normalizeShareGroupRefs(shares, groupPayloads);
    expect(result[0].key).toBe('npub_person');
    expect(result[0].type).toBe('person');
  });
});

// ---------------------------------------------------------------------------
// buildWriteGroupFields (existing behavior preserved)
// ---------------------------------------------------------------------------

describe('buildWriteGroupFields', () => {
  it('serializes UUID refs into write_group_id', () => {
    expect(buildWriteGroupFields('3fa85f64-5717-4562-b3fc-2c963f66afa6')).toEqual({
      write_group_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    });
  });

  it('serializes non-UUID refs into write_group_npub', () => {
    expect(buildWriteGroupFields('npub1grouprefexample')).toEqual({
      write_group_npub: 'npub1grouprefexample',
    });
  });

  it('returns empty object for empty input', () => {
    expect(buildWriteGroupFields('')).toEqual({});
    expect(buildWriteGroupFields(null)).toEqual({});
  });
});
