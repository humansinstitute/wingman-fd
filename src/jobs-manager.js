export const jobsManagerMixin = {
  get jobsTab() {
    return this._jobsTab === 'runs' ? 'runs' : 'definitions';
  },

  set jobsTab(value) {
    this._jobsTab = value === 'runs' ? 'runs' : 'definitions';
  },

  setJobsUnavailable(message = 'Jobs are unavailable in this build.') {
    this.jobsError = message;
    this.jobsSuccess = null;
  },

  clearJobsNotice() {
    this.jobsError = null;
    this.jobsSuccess = null;
  },

  async loadJobDefinitions() {
    this.jobDefinitions = [];
    this.jobsLoading = false;
    this.setJobsUnavailable();
  },

  async loadJobRuns() {
    this.jobRuns = [];
    this.jobRunsLoading = false;
    this.setJobsUnavailable();
  },

  openNewJobModal() {
    this.clearJobsNotice();
    this.showNewJobModal = true;
  },

  closeNewJobModal() {
    this.showNewJobModal = false;
  },

  openEditJobModal(jobId = null) {
    this.clearJobsNotice();
    this.editingJobId = jobId;
    this.showEditJobModal = true;
  },

  closeEditJobModal() {
    this.showEditJobModal = false;
    this.editingJobId = null;
  },

  openDispatchModal(jobId = null) {
    this.clearJobsNotice();
    this.dispatchJobId = jobId;
    this.showDispatchModal = true;
  },

  closeDispatchModal() {
    this.showDispatchModal = false;
    this.dispatchJobId = null;
    this.dispatchGoal = '';
  },

  async createJobDefinition() {
    this.setJobsUnavailable();
  },

  async saveEditJob() {
    this.setJobsUnavailable();
  },

  async dispatchJob() {
    this.setJobsUnavailable();
  },

  async toggleJobEnabled() {
    this.setJobsUnavailable();
  },

  async deleteJobDefinition() {
    this.setJobsUnavailable();
  },

  async stopJobRun() {
    this.setJobsUnavailable();
  },

  jobRunStatusClass(status) {
    if (status === 'running' || status === 'starting') return 'state-active';
    if (status === 'complete') return 'state-done';
    if (status === 'failed') return 'state-new';
    if (status === 'stopped') return 'state-archived';
    return 'state-ready';
  },

  formatJobDuration(run) {
    const started = Date.parse(run?.created_at || run?.started_at || '');
    const ended = Date.parse(run?.finished_at || run?.completed_at || '');
    if (!Number.isFinite(started)) return '-';
    const endTs = Number.isFinite(ended) ? ended : Date.now();
    const seconds = Math.max(0, Math.round((endTs - started) / 1000));
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  },
};
