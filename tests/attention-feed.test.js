import { describe, expect, it } from 'vitest';
import { buildAttentionFeed, summarizeAttentionFeed } from '../src/attention-feed.js';

const VIEWER = 'npub_viewer';
const AGENT = 'npub_agent';

function groupById(groups, id) {
  return groups.find((group) => group.id === id);
}

describe('buildAttentionFeed', () => {
  it('puts approvals and viewer-owned action into the needs-you lane', () => {
    const groups = buildAttentionFeed({
      session: { npub: VIEWER },
      pendingApprovals: [{
        record_id: 'approval-1',
        title: 'Ship release',
        brief: 'Release candidate needs approval',
        updated_at: '2026-05-05T08:00:00Z',
      }],
      tasks: [{
        record_id: 'task-1',
        title: 'Review homepage copy',
        state: 'review',
        owner_npub: VIEWER,
        assigned_to_npub: AGENT,
        updated_at: '2026-05-05T07:00:00Z',
      }],
    });

    expect(groupById(groups, 'needs_you').items.map((item) => item.title)).toEqual([
      'Ship release',
      'Review homepage copy',
    ]);
    expect(summarizeAttentionFeed(groups)).toBe('2 items need your attention.');
  });

  it('promotes mentions from recent comments into needs-you', () => {
    const groups = buildAttentionFeed({
      session: { npub: VIEWER },
      statusRecentChanges: [{
        id: 'task-comment:comment-1',
        recordTypeKey: 'comment',
        recordType: 'Comment',
        section: 'tasks',
        title: `Can ${VIEWER} check this?`,
        subtitle: 'Pete on Launch checklist',
        recordId: 'task-1',
        updatedAt: '2026-05-05T09:00:00Z',
        updatedTs: Date.parse('2026-05-05T09:00:00Z'),
        senderNpub: 'npub_pete',
      }],
    });

    const needsYou = groupById(groups, 'needs_you').items;
    expect(needsYou).toHaveLength(1);
    expect(needsYou[0]).toMatchObject({
      reason: 'You were mentioned',
      section: 'tasks',
      recordId: 'task-1',
    });
  });

  it('separates recent reports, changed work, and current-board next work', () => {
    const task = {
      record_id: 'task-2',
      title: 'Draft onboarding doc',
      state: 'ready',
      scope_id: 'scope-1',
      assigned_to_npub: AGENT,
      updated_at: '2026-05-05T06:00:00Z',
    };
    const groups = buildAttentionFeed({
      session: { npub: VIEWER },
      defaultAgentNpub: AGENT,
      tasks: [task],
      boardScopedTasks: [task],
      statusRecentChanges: [
        {
          id: 'report:report-1:1',
          recordTypeKey: 'report',
          recordType: 'Metric',
          section: 'status',
          title: 'Pipeline health',
          subtitle: 'Generated for Flight Deck',
          recordId: 'report-1',
          updatedAt: '2026-05-05T09:30:00Z',
          updatedTs: Date.parse('2026-05-05T09:30:00Z'),
        },
        {
          id: 'document:doc-1',
          recordTypeKey: 'doc',
          recordType: 'Doc',
          section: 'docs',
          title: 'Operating model',
          subtitle: 'Updated in Root',
          recordId: 'doc-1',
          docType: 'document',
          updatedAt: '2026-05-05T08:30:00Z',
          updatedTs: Date.parse('2026-05-05T08:30:00Z'),
        },
      ],
    });

    expect(groupById(groups, 'agent_updates').items.map((item) => item.title)).toContain('Pipeline health');
    expect(groupById(groups, 'agent_updates').items.map((item) => item.title)).toContain('Draft onboarding doc');
    expect(groupById(groups, 'changed_work').items.map((item) => item.title)).toEqual(['Operating model']);
    expect(groupById(groups, 'due_next').items.map((item) => item.title)).toEqual(['Draft onboarding doc']);
  });
});
