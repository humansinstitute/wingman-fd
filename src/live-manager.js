export function getLiveDrawerMode(viewportWidth = 1024) {
  return Number(viewportWidth) <= 768 ? 'mobile' : 'desktop';
}

export function resolveLiveRelatedRecords({ session, tasks = [], flows = [] } = {}) {
  const metadata = session?.metadata || {};
  const taskIds = Array.isArray(metadata.taskIds) ? metadata.taskIds : [];
  const selectedTasks = taskIds.length
    ? (Array.isArray(tasks) ? tasks : []).filter((task) => taskIds.includes(task?.record_id))
    : [];
  const flow = (Array.isArray(flows) ? flows : []).find((item) => item?.record_id === metadata.flowId) || null;
  const flowRunId = metadata.flowRunId || null;
  const binding = metadata.bindingType && metadata.bindingId
    ? { type: metadata.bindingType, id: metadata.bindingId }
    : null;

  return {
    tasks: selectedTasks,
    flow,
    flowRunId,
    binding,
  };
}

export const liveManagerMixin = {
  get selectedLiveSession() {
    const sessions = Array.isArray(this.liveSessions) ? this.liveSessions : [];
    if (sessions.length === 0) return null;
    const selectedId = String(this.liveSelectedSessionId || '').trim();
    if (!selectedId) return sessions[0];
    return sessions.find((session) => session?.id === selectedId) || sessions[0];
  },

  get selectedLiveNightWatchReports() {
    const selectedSessionId = this.selectedLiveSession?.id || this.liveSelectedSessionId || null;
    if (!selectedSessionId) return [];
    const reports = Array.isArray(this.liveNightWatchReports) ? this.liveNightWatchReports : [];
    return reports.filter((report) => {
      const reportSessionId = report?.sessionId || report?.session_id || report?.session?.id || null;
      return reportSessionId === selectedSessionId;
    });
  },

  openLiveDrawer() {
    this.liveDrawerOpen = true;
  },

  closeLiveDrawer() {
    this.liveDrawerOpen = false;
  },

  openLiveNightWatchReportModal(reportId = '') {
    this.liveSelectedNightWatchReportId = String(reportId || '');
    this.liveNightWatchReportModalOpen = true;
  },

  closeLiveNightWatchReportModal() {
    this.liveNightWatchReportModalOpen = false;
    this.liveSelectedNightWatchReportId = '';
  },

  toggleLiveNightWatch() {
    return null;
  },
};
