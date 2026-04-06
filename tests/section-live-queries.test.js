import { describe, expect, it } from 'vitest';

import { getSectionLiveQueryPlan } from '../src/section-live-queries.js';

describe('section live query plan', () => {
  it('keeps only chat list and active detail subscriptions hot on the chat route', () => {
    const plan = getSectionLiveQueryPlan({
      workspaceOwnerNpub: 'npub-owner',
      navSection: 'chat',
      selectedChannelId: 'channel-1',
      applyAddressBookPeople() {},
    });

    expect(plan.shared).toEqual(['address-book']);
    expect(plan.workspace).toEqual(['ws:flows', 'chat:channels', 'chat:audio-notes']);
    expect(plan.detail).toEqual(['chat:messages:channel-1']);
  });

  it('switches task and report routes to their own workspace slices', () => {
    const taskPlan = getSectionLiveQueryPlan({
      workspaceOwnerNpub: 'npub-owner',
      navSection: 'tasks',
      activeTaskId: 'task-1',
      applyAddressBookPeople() {},
    });
    expect(taskPlan.workspace).toEqual(['ws:flows', 'tasks:tasks', 'tasks:scopes']);
    expect(taskPlan.detail).toEqual(['tasks:selected-task:task-1', 'tasks:comments:task-1']);

    const reportPlan = getSectionLiveQueryPlan({
      workspaceOwnerNpub: 'npub-owner',
      navSection: 'reports',
      selectedReportId: 'report-1',
      applyAddressBookPeople() {},
    });
    expect(reportPlan.workspace).toEqual(['ws:flows', 'reports:reports', 'reports:scopes']);
    expect(reportPlan.detail).toEqual(['reports:selected-report:report-1']);
  });

  it('keeps the flight deck route scoped to reports and scopes only', () => {
    const plan = getSectionLiveQueryPlan({
      workspaceOwnerNpub: 'npub-owner',
      navSection: 'status',
      applyAddressBookPeople() {},
    });

    expect(plan.shared).toEqual(['address-book']);
    expect(plan.workspace).toEqual(['ws:flows', 'status:reports', 'status:scopes', 'status:approvals']);
    expect(plan.detail).toEqual([]);
  });

  it('keeps doc comments cold until a document is open', () => {
    const browserPlan = getSectionLiveQueryPlan({
      workspaceOwnerNpub: 'npub-owner',
      navSection: 'docs',
      selectedDocType: null,
      selectedDocId: null,
      applyAddressBookPeople() {},
    });
    expect(browserPlan.workspace).toEqual(['ws:flows', 'docs:directories', 'docs:documents', 'docs:scopes']);
    expect(browserPlan.detail).toEqual([]);

    const detailPlan = getSectionLiveQueryPlan({
      workspaceOwnerNpub: 'npub-owner',
      navSection: 'docs',
      selectedDocType: 'document',
      selectedDocId: 'doc-1',
      applyAddressBookPeople() {},
    });
    expect(detailPlan.detail).toEqual(['docs:selected-doc:doc-1', 'docs:comments:doc-1']);
  });
});
