import { describe, expect, it } from 'vitest';
import { getStoreActorWritableGroupRefs } from '../src/preferred-write-group.js';

describe('getStoreActorWritableGroupRefs', () => {
  it('prioritizes shared groups before the viewer private group', () => {
    const refs = getStoreActorWritableGroupRefs({
      session: { npub: 'npub1viewer' },
      workspaceOwnerNpub: 'npub1workspace_service',
      groups: [
        {
          group_id: 'group-private-viewer',
          private_member_npub: 'npub1viewer',
          member_npubs: ['npub1viewer'],
        },
        {
          group_id: 'group-shared-a',
          member_npubs: ['npub1viewer', 'npub1other'],
        },
        {
          group_id: 'group-shared-b',
          member_npubs: ['npub1viewer'],
        },
      ],
    });

    expect(refs).toEqual([
      'group-shared-a',
      'group-shared-b',
      'group-private-viewer',
    ]);
  });
});
