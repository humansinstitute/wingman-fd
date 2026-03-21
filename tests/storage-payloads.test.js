import { describe, expect, it } from 'vitest';

import {
  buildStoragePrepareBody,
  normalizeStorageGroupIds,
  resolveStorageOwnership,
} from '../src/storage-payloads.js';

describe('storage payload helpers', () => {
  it('normalizes and deduplicates stable group ids', () => {
    expect(normalizeStorageGroupIds([' group-1 ', '', null, 'group-2', 'group-1']))
      .toEqual(['group-1', 'group-2']);
  });

  it('defaults owner_group_id to the first access group id', () => {
    expect(resolveStorageOwnership({ accessGroupIds: ['group-1', 'group-2'] })).toEqual({
      ownerGroupId: 'group-1',
      accessGroupIds: ['group-1', 'group-2'],
    });
  });

  it('ensures an explicit owner_group_id is included in access_group_ids', () => {
    expect(resolveStorageOwnership({
      ownerGroupId: 'group-2',
      accessGroupIds: ['group-1'],
    })).toEqual({
      ownerGroupId: 'group-2',
      accessGroupIds: ['group-2', 'group-1'],
    });
  });

  it('builds the Tower storage prepare body with stable group ids', () => {
    expect(buildStoragePrepareBody({
      ownerNpub: 'npub1workspace',
      ownerGroupId: 'group-2',
      accessGroupIds: ['group-1'],
      contentType: 'image/png',
      sizeBytes: 12,
      fileName: 'avatar.png',
      isPublic: true,
    })).toEqual({
      owner_npub: 'npub1workspace',
      owner_group_id: 'group-2',
      access_group_ids: ['group-2', 'group-1'],
      is_public: true,
      content_type: 'image/png',
      size_bytes: 12,
      file_name: 'avatar.png',
    });
  });
});
