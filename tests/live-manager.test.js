import { describe, expect, it } from 'vitest';

import {
  getLiveDrawerMode,
  liveManagerMixin,
  resolveLiveRelatedRecords,
} from '../src/live-manager.js';

function createStore(overrides = {}) {
  const store = {
    liveSessions: [],
    liveSelectedSessionId: '',
    liveDrawerOpen: false,
    liveNightWatchReports: [],
    liveNightWatchReportModalOpen: false,
    liveSelectedNightWatchReportId: '',
    tasks: [],
    flows: [],
    ...overrides,
  };

  const descriptors = Object.getOwnPropertyDescriptors(liveManagerMixin);
  for (const [key, desc] of Object.entries(descriptors)) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) continue;
    Object.defineProperty(store, key, desc);
  }

  return store;
}

describe('live manager', () => {
  it('defaults the selected session to the first live session when no explicit id is set', () => {
    const store = createStore({
      liveSessions: [
        { id: 'session-1', metadata: {} },
        { id: 'session-2', metadata: {} },
      ],
    });

    expect(store.selectedLiveSession).toEqual({ id: 'session-1', metadata: {} });
  });

  it('toggles the drawer open and closed', () => {
    const store = createStore();

    store.openLiveDrawer();
    expect(store.liveDrawerOpen).toBe(true);

    store.closeLiveDrawer();
    expect(store.liveDrawerOpen).toBe(false);
  });

  it('uses a mobile drawer mode for narrow viewports and desktop otherwise', () => {
    expect(getLiveDrawerMode(640)).toBe('mobile');
    expect(getLiveDrawerMode(1280)).toBe('desktop');
  });

  it('resolves task, flow, flow-run, and binding context from session metadata', () => {
    expect(resolveLiveRelatedRecords({
      session: {
        id: 'session-1',
        metadata: {
          taskIds: ['task-1'],
          flowId: 'flow-1',
          flowRunId: 'run-1',
          bindingType: 'task',
          bindingId: 'task-1',
        },
      },
      tasks: [
        { record_id: 'task-1', title: 'Selected task' },
        { record_id: 'task-2', title: 'Other task' },
      ],
      flows: [
        { record_id: 'flow-1', title: 'Drawer flow' },
      ],
    })).toEqual({
      tasks: [
        { record_id: 'task-1', title: 'Selected task' },
      ],
      flow: { record_id: 'flow-1', title: 'Drawer flow' },
      flowRunId: 'run-1',
      binding: { type: 'task', id: 'task-1' },
    });
  });

  it('filters Night Watch reports to the selected session', () => {
    const store = createStore({
      liveSelectedSessionId: 'session-2',
      liveNightWatchReports: [
        { id: 'report-1', sessionId: 'session-1' },
        { id: 'report-2', sessionId: 'session-2' },
      ],
    });

    expect(store.selectedLiveNightWatchReports).toEqual([
      { id: 'report-2', sessionId: 'session-2' },
    ]);
  });

  it('opens and closes the Night Watch report modal for a chosen report', () => {
    const store = createStore();

    store.openLiveNightWatchReportModal('report-1');
    expect(store.liveNightWatchReportModalOpen).toBe(true);
    expect(store.liveSelectedNightWatchReportId).toBe('report-1');

    store.closeLiveNightWatchReportModal();
    expect(store.liveNightWatchReportModalOpen).toBe(false);
    expect(store.liveSelectedNightWatchReportId).toBe('');
  });
});
