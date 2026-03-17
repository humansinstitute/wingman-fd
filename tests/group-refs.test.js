import { describe, expect, it } from 'vitest';

import { buildWriteGroupFields, looksLikeUuid } from '../src/translators/group-refs.js';

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
});
