import { describe, expect, it } from 'vitest';
import {
  getEncryptableRecordGroupRefsForStore,
  getRecordWriteFieldsForStore,
  getStoreActorWritableGroupRefs,
  selectPreferredRecordWriteGroupRef,
} from '../src/preferred-write-group.js';

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

describe('generic record write group helpers', () => {
  it('selects the actor-prioritized writable group instead of stale private refs', () => {
    const result = selectPreferredRecordWriteGroupRef({
      write_group_id: 'group-private-creator',
      group_ids: ['group-private-creator', 'group-shared', 'group-external'],
      scope_policy_group_ids: ['group-private-creator', 'group-shared', 'group-external'],
      shares: [
        { type: 'group', group_id: 'group-private-creator', access: 'write' },
        { type: 'group', group_id: 'group-shared', access: 'write' },
        { type: 'group', group_id: 'group-external', access: 'write' },
      ],
    }, {
      allowedGroupIds: ['group-shared', 'group-external', 'group-private-creator'],
      hasKey: () => true,
    });

    expect(result).toBe('group-shared');
  });

  it('returns only actor-encryptable delivery groups after refreshing keys', async () => {
    let refreshed = false;
    const store = {
      async refreshGroups() {
        refreshed = true;
      },
    };
    const result = await getEncryptableRecordGroupRefsForStore(store, {
      group_ids: ['group-private-creator', 'group-shared'],
    }, {
      hasKey: (groupId) => groupId === 'group-shared',
    });

    expect(refreshed).toBe(true);
    expect(result).toEqual(['group-shared']);
  });

  it('ignores an explicit write ref that is not actor-encryptable', async () => {
    const result = await getRecordWriteFieldsForStore({
      getActorWritableGroupRefs: () => ['group-shared'],
    }, {
      group_ids: ['group-private-creator', 'group-shared'],
    }, {
      writeGroupRef: 'group-private-creator',
      hasKey: (groupId) => groupId === 'group-shared',
    });

    expect(result).toEqual({
      group_ids: ['group-shared'],
      write_group_ref: 'group-shared',
    });
  });
});
