import { describe, expect, it, vi } from 'vitest';
import { taskBoardStateMixin } from '../src/task-board-state.js';

describe('record link UI/context helpers', () => {
  it('surfaces source and deliverables ahead of generic references', () => {
    const sections = taskBoardStateMixin.getVisibleRecordLinkSections.call({}, {
      source_links: [{ type: 'task', id: 'task-source' }],
      references: [{ type: 'scope', id: 'scope-ref' }, { type: 'task', id: 'task-source' }],
      deliverable_links: [{ type: 'doc', id: 'doc-out', order: 1 }],
    });

    expect(sections.map((section) => section.kind)).toEqual(['source', 'deliverable', 'reference']);
    expect(sections[0].links[0].id).toBe('task-source');
    expect(sections[1].links[0].id).toBe('doc-out');
    expect(sections[2].links).toEqual([{ type: 'scope', id: 'scope-ref' }]);
  });

  it('derives subtask deliverables from reverse source links', () => {
    const parent = { record_id: 'task-parent', title: 'Parent task' };
    const store = {
      tasks: [
        parent,
        {
          record_id: 'task-child',
          title: 'Child task',
          source_links: [{ type: 'task', id: 'task-parent' }],
          record_state: 'active',
        },
      ],
    };

    const sections = taskBoardStateMixin.getVisibleRecordLinkSections.call(store, parent);

    expect(sections).toEqual([{
      kind: 'deliverable',
      label: 'Deliverables',
      links: [{ type: 'task', id: 'task-child' }],
    }]);
  });

  it('derives opportunity-created task deliverables from reverse source links', () => {
    const opportunity = { record_id: 'opp-1', title: 'Acme opportunity' };
    const store = {
      opportunities: [opportunity],
      tasks: [{
        record_id: 'task-from-opp',
        title: 'Follow up',
        source_links: [{ type: 'opportunity', id: 'opp-1' }],
        record_state: 'active',
      }],
    };

    const sections = taskBoardStateMixin.getVisibleRecordLinkSections.call(store, opportunity);

    expect(sections).toEqual([{
      kind: 'deliverable',
      label: 'Deliverables',
      links: [{ type: 'task', id: 'task-from-opp' }],
    }]);
  });

  it('routes visible record links through mention navigation', async () => {
    const store = {
      handleMentionNavigate: vi.fn(),
    };

    await taskBoardStateMixin.navigateReference.call(store, { type: 'doc', id: 'doc-1' });

    expect(store.handleMentionNavigate).toHaveBeenCalledWith('doc', 'doc-1');
  });

  it('hides unsupported link types so chips are not dead clicks', () => {
    const sections = taskBoardStateMixin.getVisibleRecordLinkSections.call({}, {
      references: [
        { type: 'task', id: 'task-1' },
        { type: 'schedule', id: 'schedule-1' },
      ],
    });

    expect(sections).toEqual([{
      kind: 'reference',
      label: 'References',
      links: [{ type: 'task', id: 'task-1' }],
    }]);
  });

  it('routes directory and report links directly when the store supports them', async () => {
    const store = {
      navigateToFolder: vi.fn(),
      refreshReports: vi.fn(async () => {}),
      navigateTo: vi.fn(),
      openReportModalById: vi.fn(),
      syncRoute: vi.fn(),
    };

    await taskBoardStateMixin.navigateReference.call(store, { type: 'directory', id: 'dir-1' });
    await taskBoardStateMixin.navigateReference.call(store, { type: 'report', id: 'report-1' });

    expect(store.navigateToFolder).toHaveBeenCalledWith('dir-1');
    expect(store.refreshReports).toHaveBeenCalledTimes(1);
    expect(store.navigateTo).toHaveBeenCalledWith('status', { syncRoute: false });
    expect(store.openReportModalById).toHaveBeenCalledWith('report-1');
    expect(store.syncRoute).toHaveBeenCalledTimes(1);
  });

  it('routes compound chat source links to the source thread', async () => {
    const store = {
      navigateTo: vi.fn(),
      selectChannel: vi.fn(async () => {}),
      openThread: vi.fn(),
      syncRoute: vi.fn(),
      startWorkspaceLiveQueries: vi.fn(),
      mobileNavOpen: true,
    };

    await taskBoardStateMixin.navigateReference.call(store, {
      type: 'chat',
      id: 'channel-1#root-1',
    });

    expect(store.navigateTo).toHaveBeenCalledWith('chat', { syncRoute: false });
    expect(store.selectChannel).toHaveBeenCalledWith('channel-1', { syncRoute: false });
    expect(store.openThread).toHaveBeenCalledWith('root-1', { scrollToLatest: false, syncRoute: false });
    expect(store.focusMessageId).toBe('root-1');
    expect(store.mobileNavOpen).toBe(false);
    expect(store.syncRoute).toHaveBeenCalled();
  });
});
