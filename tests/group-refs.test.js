import { describe, expect, it } from 'vitest';

import {
  buildDurableWriteGroupFields,
  buildWriteGroupFields,
  looksLikeUuid,
  requireGroupIdRef,
  resolveGroupIdRef,
} from '../src/translators/group-refs.js';

describe('group ref helpers', () => {
  it('detects UUID group refs', () => {
    expect(looksLikeUuid('3fa85f64-5717-4562-b3fc-2c963f66afa6')).toBe(true);
    expect(looksLikeUuid('npub1grouprefexample')).toBe(false);
  });

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

  it('resolves legacy group npubs to stable groupId values when a ref map is supplied', () => {
    const map = new Map([
      ['npub1grouprefexample', '3fa85f64-5717-4562-b3fc-2c963f66afa6'],
      ['3fa85f64-5717-4562-b3fc-2c963f66afa6', '3fa85f64-5717-4562-b3fc-2c963f66afa6'],
    ]);

    expect(resolveGroupIdRef('npub1grouprefexample', map)).toBe('3fa85f64-5717-4562-b3fc-2c963f66afa6');
    expect(requireGroupIdRef('npub1grouprefexample', map)).toBe('3fa85f64-5717-4562-b3fc-2c963f66afa6');
    expect(buildDurableWriteGroupFields('npub1grouprefexample', map)).toEqual({
      write_group_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    });
  });

  it('rejects accidental durable groupNpub references when no groupId mapping exists', () => {
    expect(resolveGroupIdRef('npub1grouprefexample', new Map())).toBeNull();
    expect(() => requireGroupIdRef('npub1grouprefexample', new Map())).toThrow(/groupId UUID/);
  });
});
