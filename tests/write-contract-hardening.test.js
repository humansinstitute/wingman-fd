import { describe, it, expect } from 'vitest';

/**
 * WP3 Write Contract Hardening — Flight Deck
 *
 * Tests for:
 * 1. syncRecords owner-write detection with workspace session keys
 * 2. Translator write_group_ref param produces correct wire format
 * 3. diagnoseWriteContract catches signer/group mismatches
 */

import { needsGroupWriteToken, diagnoseWriteContract } from '../src/write-diagnostics.js';
import { buildWriteGroupFields } from '../src/translators/group-refs.js';

// ---------------------------------------------------------------------------
// 1. syncRecords — workspace-key-aware owner-write detection
// ---------------------------------------------------------------------------

describe('syncRecords owner-write detection', () => {
  const OWNER = 'npub1_owner_real';
  const WS_KEY = 'npub1_workspace_session_key';
  const OTHER_SIGNER = 'npub1_other_member';

  it('recognizes direct owner signature (legacy, no workspace key)', () => {
    const record = { signature_npub: OWNER };
    expect(needsGroupWriteToken(record, OWNER, null)).toBe(false);
  });

  it('recognizes workspace-key-signed owner record when signing_npub provided', () => {
    const record = { signature_npub: WS_KEY };
    expect(needsGroupWriteToken(record, OWNER, WS_KEY)).toBe(false);
  });

  it('requires group token for non-owner signer', () => {
    const record = { signature_npub: OTHER_SIGNER };
    expect(needsGroupWriteToken(record, OWNER, WS_KEY)).toBe(true);
  });

  it('requires group token when workspace key not provided and signer ≠ owner', () => {
    const record = { signature_npub: WS_KEY };
    expect(needsGroupWriteToken(record, OWNER, null)).toBe(true);
  });

  it('handles whitespace in npub fields', () => {
    const record = { signature_npub: '  ' + WS_KEY + '  ' };
    expect(needsGroupWriteToken(record, OWNER, WS_KEY)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Translator write_group_ref param → correct wire format
// ---------------------------------------------------------------------------

describe('write_group_ref param routing via buildWriteGroupFields', () => {
  it('UUID ref routes to write_group_id', () => {
    const fields = buildWriteGroupFields('3fa85f64-5717-4562-b3fc-2c963f66afa6');
    expect(fields).toEqual({ write_group_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6' });
    expect(fields.write_group_npub).toBeUndefined();
  });

  it('npub ref routes to write_group_npub (legacy fallback)', () => {
    const fields = buildWriteGroupFields('npub1groupkey');
    expect(fields).toEqual({ write_group_npub: 'npub1groupkey' });
    expect(fields.write_group_id).toBeUndefined();
  });

  it('empty/null ref returns empty object', () => {
    expect(buildWriteGroupFields('')).toEqual({});
    expect(buildWriteGroupFields(null)).toEqual({});
    expect(buildWriteGroupFields(undefined)).toEqual({});
  });

  it('board_group_id (UUID) passed as write_group_ref produces write_group_id', () => {
    const boardGroupId = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
    const fields = buildWriteGroupFields(boardGroupId);
    expect(fields.write_group_id).toBe(boardGroupId);
    expect(fields.write_group_npub).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. diagnoseWriteContract — signer/group mismatch warnings
// ---------------------------------------------------------------------------

describe('diagnoseWriteContract', () => {
  const OWNER = 'npub1_owner';
  const WS_KEY = 'npub1_ws_key';

  it('returns no warnings for valid owner write', () => {
    const record = { signature_npub: OWNER };
    expect(diagnoseWriteContract(record, OWNER, null)).toEqual([]);
  });

  it('returns no warnings for valid workspace-key owner write', () => {
    const record = { signature_npub: WS_KEY };
    expect(diagnoseWriteContract(record, OWNER, WS_KEY)).toEqual([]);
  });

  it('warns when non-owner write has no write_group', () => {
    const record = { signature_npub: 'npub1_other' };
    const warnings = diagnoseWriteContract(record, OWNER, WS_KEY);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some(w => w.includes('no write_group_id'))).toBe(true);
  });

  it('warns when signature_npub is missing', () => {
    const record = {};
    const warnings = diagnoseWriteContract(record, OWNER, WS_KEY);
    expect(warnings.some(w => w.includes('missing signature_npub'))).toBe(true);
  });

  it('returns no warnings for valid non-owner write with write_group_id', () => {
    const record = {
      signature_npub: 'npub1_other',
      write_group_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    };
    const warnings = diagnoseWriteContract(record, OWNER, WS_KEY);
    expect(warnings.some(w => w.includes('no write_group_id'))).toBe(false);
  });
});
