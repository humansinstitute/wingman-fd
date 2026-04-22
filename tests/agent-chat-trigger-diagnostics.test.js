import { describe, expect, it } from 'vitest';
import {
  findAgentChatTriggerTargetGroup,
  evaluateAgentChatTargetMemberKeys,
} from '../src/workspace-manager.js';

describe('findAgentChatTriggerTargetGroup', () => {
  const groups = [
    { group_id: 'group-1', group_npub: 'npub1group1', name: 'Group One' },
    { group_id: 'group-2', group_npub: 'npub1group2', name: 'Group Two' },
  ];

  it('matches by stable group id', () => {
    expect(findAgentChatTriggerTargetGroup(groups, { target_group_id: 'group-2' })).toEqual(groups[1]);
  });

  it('matches by group npub when needed', () => {
    expect(findAgentChatTriggerTargetGroup(groups, { target_group_npub: 'npub1group1' })).toEqual(groups[0]);
  });
});

describe('evaluateAgentChatTargetMemberKeys', () => {
  const targetGroup = {
    group_id: 'group-1',
    group_npub: 'npub1group1',
    current_epoch: 3,
  };

  it('reports healthy when current epoch keys are present', () => {
    const result = evaluateAgentChatTargetMemberKeys(targetGroup, [
      { group_id: 'group-1', group_npub: 'npub1group1', key_version: 3 },
    ]);

    expect(result.status).toBe('healthy');
    expect(result.latest_key_version).toBe(3);
  });

  it('reports missing when no matching wrapped key exists', () => {
    const result = evaluateAgentChatTargetMemberKeys(targetGroup, [
      { group_id: 'group-other', group_npub: 'npub1other', key_version: 3 },
    ]);

    expect(result.status).toBe('missing');
    expect(result.relevant_key_count).toBe(0);
  });

  it('reports stale when only older epochs are present', () => {
    const result = evaluateAgentChatTargetMemberKeys(targetGroup, [
      { group_id: 'group-1', group_npub: 'npub1group1', key_version: 2 },
    ]);

    expect(result.status).toBe('stale');
    expect(result.latest_key_version).toBe(2);
    expect(result.current_epoch).toBe(3);
  });
});
