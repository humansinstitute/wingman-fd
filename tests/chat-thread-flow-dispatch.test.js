import { describe, expect, it } from 'vitest';

import {
  buildChatThreadFlowDispatchPreview,
  getChatThreadFlowDispatchScopeSourceLabel,
  normalizeChatThreadFlowDispatchScopeAssignment,
  resolveChatThreadFlowDispatchScope,
  resolveChatThreadFlowDispatchThread,
} from '../src/chat-thread-flow-dispatch.js';

describe('resolveChatThreadFlowDispatchThread', () => {
  it('returns null when the clicked message does not exist', () => {
    expect(resolveChatThreadFlowDispatchThread([], 'missing-message')).toBeNull();
  });

  it('resolves a root message to a single-message thread', () => {
    const result = resolveChatThreadFlowDispatchThread([
      {
        record_id: 'root-1',
        channel_id: 'channel-1',
        parent_message_id: null,
        body: 'Root only',
        updated_at: '2026-04-21T10:00:00.000Z',
        record_state: 'active',
      },
    ], 'root-1');

    expect(result?.clickedMessage.record_id).toBe('root-1');
    expect(result?.threadRootMessage.record_id).toBe('root-1');
    expect(result?.threadMessages.map((message) => message.record_id)).toEqual(['root-1']);
  });

  it('resolves the canonical thread from the full channel message set', () => {
    const result = resolveChatThreadFlowDispatchThread([
      {
        record_id: 'root-1',
        channel_id: 'channel-1',
        parent_message_id: null,
        body: 'Root',
        updated_at: '2026-04-21T10:00:00.000Z',
        record_state: 'active',
      },
      {
        record_id: 'reply-1',
        channel_id: 'channel-1',
        parent_message_id: 'root-1',
        body: 'First reply',
        updated_at: '2026-04-21T10:05:00.000Z',
        record_state: 'active',
      },
      {
        record_id: 'reply-2',
        channel_id: 'channel-1',
        parent_message_id: 'root-1',
        body: 'Deleted reply',
        updated_at: '2026-04-21T10:06:00.000Z',
        record_state: 'deleted',
      },
      {
        record_id: 'reply-3',
        channel_id: 'channel-1',
        parent_message_id: 'root-1',
        body: 'Latest reply',
        updated_at: '2026-04-21T10:07:00.000Z',
        record_state: 'active',
      },
    ], 'reply-3');

    expect(result?.clickedMessage.record_id).toBe('reply-3');
    expect(result?.threadRootMessage.record_id).toBe('root-1');
    expect(result?.threadMessages.map((message) => message.record_id)).toEqual([
      'root-1',
      'reply-1',
      'reply-3',
    ]);
  });

  it('returns thread messages sorted oldest to newest by updated_at', () => {
    const result = resolveChatThreadFlowDispatchThread([
      {
        record_id: 'reply-2',
        channel_id: 'channel-1',
        parent_message_id: 'root-1',
        body: 'Second reply',
        updated_at: '2026-04-21T10:07:00.000Z',
        record_state: 'active',
      },
      {
        record_id: 'root-1',
        channel_id: 'channel-1',
        parent_message_id: null,
        body: 'Root',
        updated_at: '2026-04-21T10:00:00.000Z',
        record_state: 'active',
      },
      {
        record_id: 'reply-1',
        channel_id: 'channel-1',
        parent_message_id: 'root-1',
        body: 'First reply',
        updated_at: '2026-04-21T10:05:00.000Z',
        record_state: 'active',
      },
    ], 'reply-2');

    expect(result?.threadMessages.map((message) => message.record_id)).toEqual([
      'root-1',
      'reply-1',
      'reply-2',
    ]);
  });

  it('returns the same transcript whether the clicked message is the root or a reply', () => {
    const messages = [
      {
        record_id: 'root-1',
        channel_id: 'channel-1',
        parent_message_id: null,
        body: 'Root',
        updated_at: '2026-04-21T10:00:00.000Z',
        record_state: 'active',
      },
      {
        record_id: 'reply-1',
        channel_id: 'channel-1',
        parent_message_id: 'root-1',
        body: 'Reply',
        updated_at: '2026-04-21T10:05:00.000Z',
        record_state: 'active',
      },
    ];

    const rootResult = resolveChatThreadFlowDispatchThread(messages, 'root-1');
    const replyResult = resolveChatThreadFlowDispatchThread(messages, 'reply-1');

    expect(rootResult?.threadRootMessage.record_id).toBe('root-1');
    expect(replyResult?.threadRootMessage.record_id).toBe('root-1');
    expect(rootResult?.threadMessages.map((message) => message.record_id)).toEqual(
      replyResult?.threadMessages.map((message) => message.record_id),
    );
  });
});

describe('resolveChatThreadFlowDispatchScope', () => {
  it('uses manual override before flow and channel scope', () => {
    expect(resolveChatThreadFlowDispatchScope({
      manualScopeId: 'scope-override',
      flowScopeId: 'scope-flow',
      channelScopeId: 'scope-channel',
    })).toEqual({
      resolvedScopeId: 'scope-override',
      scopeSource: 'override',
    });
  });

  it('uses flow scope before channel scope', () => {
    expect(resolveChatThreadFlowDispatchScope({
      manualScopeId: null,
      flowScopeId: 'scope-flow',
      channelScopeId: 'scope-channel',
    })).toEqual({
      resolvedScopeId: 'scope-flow',
      scopeSource: 'flow',
    });
  });

  it('uses channel scope when no flow scope exists', () => {
    expect(resolveChatThreadFlowDispatchScope({
      manualScopeId: null,
      flowScopeId: null,
      channelScopeId: 'scope-channel',
    })).toEqual({
      resolvedScopeId: 'scope-channel',
      scopeSource: 'channel',
    });
  });

  it('returns none when no scope exists', () => {
    expect(resolveChatThreadFlowDispatchScope()).toEqual({
      resolvedScopeId: null,
      scopeSource: 'none',
    });
  });
});

describe('normalizeChatThreadFlowDispatchScopeAssignment', () => {
  it('normalizes null input into an empty scope payload', () => {
    expect(normalizeChatThreadFlowDispatchScopeAssignment(null)).toEqual({
      scope_id: null,
      scope_l1_id: null,
      scope_l2_id: null,
      scope_l3_id: null,
      scope_l4_id: null,
      scope_l5_id: null,
      scope_policy_group_ids: null,
      group_ids: [],
      shares: [],
      write_group_ref: null,
    });
  });

  it('preserves group ids, shares, scope-policy groups, and explicit write_group_ref', () => {
    expect(normalizeChatThreadFlowDispatchScopeAssignment({
      scope_id: 'scope-1',
      scope_l1_id: 'scope-1',
      scope_l2_id: 'scope-2',
      scope_policy_group_ids: ['g1', 'g2'],
      group_ids: ['g1', 'g2'],
      shares: [{ type: 'group', group_npub: 'g1', access: 'write' }],
      write_group_ref: 'g-explicit',
    })).toEqual({
      scope_id: 'scope-1',
      scope_l1_id: 'scope-1',
      scope_l2_id: 'scope-2',
      scope_l3_id: null,
      scope_l4_id: null,
      scope_l5_id: null,
      scope_policy_group_ids: ['g1', 'g2'],
      group_ids: ['g1', 'g2'],
      shares: [{ type: 'group', group_npub: 'g1', access: 'write' }],
      write_group_ref: 'g-explicit',
    });
  });

  it('normalizes write-group selection from board_group_id', () => {
    expect(normalizeChatThreadFlowDispatchScopeAssignment({
      scope_id: 'scope-1',
      scope_l1_id: 'scope-1',
      scope_policy_group_ids: ['g1'],
      group_ids: ['g1', 'g2'],
      shares: [{ type: 'group', group_npub: 'g1' }],
      board_group_id: 'g2',
    })).toMatchObject({
      scope_id: 'scope-1',
      scope_l1_id: 'scope-1',
      scope_policy_group_ids: ['g1'],
      group_ids: ['g1', 'g2'],
      write_group_ref: 'g2',
    });
  });

  it('falls back to the first group_id when no explicit write-group metadata exists', () => {
    expect(normalizeChatThreadFlowDispatchScopeAssignment({
      scope_id: 'scope-1',
      group_ids: ['g-primary', 'g-secondary'],
      shares: [],
    })).toMatchObject({
      scope_id: 'scope-1',
      group_ids: ['g-primary', 'g-secondary'],
      write_group_ref: 'g-primary',
    });
  });
});

describe('buildChatThreadFlowDispatchPreview', () => {
  it('renders the required headings in order and wraps the transcript in a text fence', () => {
    const preview = buildChatThreadFlowDispatchPreview({
      channelId: 'channel-1',
      channelScopeId: 'scope-channel',
      clickedMessageId: 'reply-1',
      dispatchedAt: '2026-04-21T13:28:21.377Z',
      flowId: 'flow-1',
      flowScopeId: 'scope-flow',
      flowTitle: 'Dispatch Flow',
      launchNotes: 'Ship this in the current repo.',
      messages: [
        {
          record_id: 'root-1',
          body: 'First message',
          sender_npub: 'npub1root',
          updated_at: '2026-04-21T13:28:21.377Z',
        },
        {
          record_id: 'reply-1',
          parent_message_id: 'root-1',
          body: 'Second message',
          sender_npub: 'npub1reply',
          updated_at: '2026-04-21T13:30:21.377Z',
          attachments: [{ id: 'attachment-1' }, { id: 'attachment-2' }],
        },
      ],
      resolvedScopeId: 'scope-flow',
      scopeSource: 'flow',
      senderLabelResolver: (message) => message.sender_npub === 'npub1root' ? 'Pete' : 'Mini',
      sourceSurface: 'thread_reply',
      threadRootMessageId: 'root-1',
      workspaceOwnerNpub: 'npub1owner',
    });

    const sectionOrder = [
      '## Dispatch Request',
      '## Source Provenance',
      '## Launch Notes',
      '## Dispatch Brief',
      '## Thread Transcript',
    ].map((section) => preview.description.indexOf(section));

    expect(sectionOrder.every((position) => position >= 0)).toBe(true);
    expect(sectionOrder).toEqual([...sectionOrder].sort((left, right) => left - right));
    expect(preview.description).toContain('Ship this in the current repo.');
    expect(preview.description).toContain('[2026-04-21T13:28:21.377Z] Pete | root-1');
    expect(preview.description).toContain('First message');
    expect(preview.description).toContain('[2026-04-21T13:30:21.377Z] Mini | reply-1 [attachments: 2]');
    expect(preview.description).toContain('Second message');
    expect(preview.description).toContain('transcript_truncated: false');
    expect(preview.description).toContain('scope_resolution: flow');
    expect(preview.description).toContain('~~~text');
    expect(preview.description.trimEnd().endsWith('~~~')).toBe(true);
  });

  it('renders None. when launch notes are blank', () => {
    const preview = buildChatThreadFlowDispatchPreview({
      channelId: 'channel-1',
      clickedMessageId: 'root-1',
      flowId: 'flow-1',
      flowTitle: 'Dispatch Flow',
      launchNotes: '   ',
      messages: [
        {
          record_id: 'root-1',
          body: 'Only message',
          sender_npub: 'npub1root',
          updated_at: '2026-04-21T13:28:21.377Z',
        },
      ],
      threadRootMessageId: 'root-1',
    });

    expect(preview.description).toContain('## Launch Notes\nNone.');
  });

  it('truncates long threads while preserving the root and clicked message', () => {
    const messages = [
      {
        record_id: 'root-1',
        body: 'Root message',
        sender_npub: 'npub1root',
        updated_at: '2026-04-21T13:28:21.377Z',
      },
      {
        record_id: 'reply-1',
        parent_message_id: 'root-1',
        body: 'A'.repeat(600),
        sender_npub: 'npub1reply1',
        updated_at: '2026-04-21T13:29:21.377Z',
      },
      {
        record_id: 'reply-2',
        parent_message_id: 'root-1',
        body: 'Clicked reply',
        sender_npub: 'npub1reply2',
        updated_at: '2026-04-21T13:30:21.377Z',
      },
      {
        record_id: 'reply-3',
        parent_message_id: 'root-1',
        body: 'B'.repeat(600),
        sender_npub: 'npub1reply3',
        updated_at: '2026-04-21T13:31:21.377Z',
      },
    ];

    const preview = buildChatThreadFlowDispatchPreview({
      channelId: 'channel-1',
      clickedMessageId: 'reply-2',
      flowId: 'flow-1',
      flowTitle: 'Dispatch Flow',
      messages,
      senderLabelResolver: (message) => message.sender_npub,
      threadRootMessageId: 'root-1',
      maxDescriptionLength: 1200,
    });

    expect(preview.transcriptTruncated).toBe(true);
    expect(preview.omittedMessageCount).toBeGreaterThan(0);
    expect(preview.description).toContain('Root message');
    expect(preview.description).toContain('Clicked reply');
  });
});

describe('getChatThreadFlowDispatchScopeSourceLabel', () => {
  it('returns the user-facing scope source labels', () => {
    expect(getChatThreadFlowDispatchScopeSourceLabel('override')).toBe('Manual override');
    expect(getChatThreadFlowDispatchScopeSourceLabel('flow')).toBe('Flow scope');
    expect(getChatThreadFlowDispatchScopeSourceLabel('channel')).toBe('Channel scope');
    expect(getChatThreadFlowDispatchScopeSourceLabel('none')).toBe('No scope');
  });
});
