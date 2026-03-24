/**
 * Jobs manager mixin — CRUD for job definitions and runs via the Wingman harness API.
 *
 * Endpoints (on workspaceHarnessUrl):
 *   GET    /api/jobs/definitions
 *   POST   /api/jobs/definitions
 *   PUT    /api/jobs/definitions/:id
 *   DELETE /api/jobs/definitions/:id
 *   GET    /api/jobs/runs
 *   POST   /api/jobs/dispatch/:jobId
 *   POST   /api/jobs/runs/:id/stop
 */

import { createNip98AuthHeader } from './auth/nostr.js';

const JOBS_FETCH_TIMEOUT_MS = 15_000;

async function harnessSignedFetch(harnessUrl, path, { method = 'GET', body } = {}) {
  const requestUrl = `${harnessUrl.replace(/\/+$/, '')}${path}`;
  const headers = {
    Authorization: await createNip98AuthHeader(requestUrl, method, body ?? null),
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const resp = await fetch(requestUrl, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(JOBS_FETCH_TIMEOUT_MS),
  });
  return resp;
}

async function harnessJson(harnessUrl, path, options) {
  const resp = await harnessSignedFetch(harnessUrl, path, options);
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Jobs API ${resp.status}: ${text}`);
  }
  return resp.json();
}

export const jobsManagerMixin = {
  // --- Jobs definitions ---

  async loadJobDefinitions() {
    if (!this.workspaceHarnessUrl) {
      this.jobDefinitions = [];
      return;
    }
    this.jobsLoading = true;
    this.jobsError = null;
    try {
      const data = await harnessJson(this.workspaceHarnessUrl, '/api/jobs/definitions');
      this.jobDefinitions = Array.isArray(data) ? data : (data.definitions || []);
    } catch (err) {
      this.jobsError = `Failed to load jobs: ${err.message}`;
      this.jobDefinitions = [];
    } finally {
      this.jobsLoading = false;
    }
  },

  async createJobDefinition() {
    this.jobsError = null;
    const id = this.newJobId.trim();
    const name = this.newJobName.trim();
    const workerPrompt = this.newJobWorkerPrompt.trim();
    const managerPrompt = this.newJobManagerPrompt.trim();
    const managerGoal = this.newJobManagerGoal.trim();
    const managerDir = this.newJobManagerDir.trim();
    const checkInterval = parseInt(this.newJobCheckInterval, 10) || 300;

    if (!id || !name) {
      this.jobsError = 'Job ID and Name are required.';
      return;
    }

    try {
      await harnessJson(this.workspaceHarnessUrl, '/api/jobs/definitions', {
        method: 'POST',
        body: {
          id,
          name,
          worker_prompt: workerPrompt,
          manager_prompt: managerPrompt,
          manager_goal: managerGoal,
          manager_dir: managerDir,
          check_interval: checkInterval,
          enabled: true,
        },
      });
      this.jobsSuccess = `Job "${name}" created.`;
      setTimeout(() => (this.jobsSuccess = null), 3000);
      this.resetNewJobForm();
      this.showNewJobModal = false;
      await this.loadJobDefinitions();
    } catch (err) {
      this.jobsError = `Failed to create job: ${err.message}`;
    }
  },

  async updateJobDefinition(id, updates) {
    this.jobsError = null;
    try {
      await harnessJson(this.workspaceHarnessUrl, `/api/jobs/definitions/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: updates,
      });
      this.jobsSuccess = `Job "${id}" updated.`;
      setTimeout(() => (this.jobsSuccess = null), 3000);
      await this.loadJobDefinitions();
    } catch (err) {
      this.jobsError = `Failed to update job: ${err.message}`;
    }
  },

  async deleteJobDefinition(id) {
    this.jobsError = null;
    try {
      await harnessSignedFetch(this.workspaceHarnessUrl, `/api/jobs/definitions/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      this.jobsSuccess = `Job "${id}" deleted.`;
      setTimeout(() => (this.jobsSuccess = null), 3000);
      await this.loadJobDefinitions();
    } catch (err) {
      this.jobsError = `Failed to delete job: ${err.message}`;
    }
  },

  async toggleJobEnabled(id) {
    const job = this.jobDefinitions.find((j) => j.id === id);
    if (!job) return;
    await this.updateJobDefinition(id, { enabled: !job.enabled });
  },

  // --- Job runs ---

  async loadJobRuns() {
    if (!this.workspaceHarnessUrl) {
      this.jobRuns = [];
      return;
    }
    this.jobRunsLoading = true;
    this.jobsError = null;
    try {
      let path = '/api/jobs/runs';
      const params = new URLSearchParams();
      if (this.jobRunsFilterJobId) params.set('job_id', this.jobRunsFilterJobId);
      if (this.jobRunsFilterStatus) params.set('status', this.jobRunsFilterStatus);
      const qs = params.toString();
      if (qs) path += `?${qs}`;
      const data = await harnessJson(this.workspaceHarnessUrl, path);
      this.jobRuns = Array.isArray(data) ? data : (data.runs || []);
    } catch (err) {
      this.jobsError = `Failed to load runs: ${err.message}`;
      this.jobRuns = [];
    } finally {
      this.jobRunsLoading = false;
    }
  },

  async dispatchJob(jobId) {
    this.jobsError = null;
    const goal = (this.dispatchGoal || '').trim();
    try {
      const result = await harnessJson(this.workspaceHarnessUrl, `/api/jobs/dispatch/${encodeURIComponent(jobId)}`, {
        method: 'POST',
        body: { goal: goal || undefined },
      });
      this.jobsSuccess = `Job "${jobId}" dispatched (run ${(result.id || '').slice(0, 8)}).`;
      setTimeout(() => (this.jobsSuccess = null), 3000);
      this.dispatchGoal = '';
      this.showDispatchModal = false;
      this.dispatchJobId = null;
      await this.loadJobRuns();
    } catch (err) {
      this.jobsError = `Failed to dispatch job: ${err.message}`;
    }
  },

  async stopJobRun(runId) {
    this.jobsError = null;
    try {
      await harnessJson(this.workspaceHarnessUrl, `/api/jobs/runs/${encodeURIComponent(runId)}/stop`, {
        method: 'POST',
      });
      this.jobsSuccess = `Run ${runId.slice(0, 8)} stopped.`;
      setTimeout(() => (this.jobsSuccess = null), 3000);
      await this.loadJobRuns();
    } catch (err) {
      this.jobsError = `Failed to stop run: ${err.message}`;
    }
  },

  // --- UI helpers ---

  openNewJobModal() {
    this.resetNewJobForm();
    this.showNewJobModal = true;
  },

  closeNewJobModal() {
    this.showNewJobModal = false;
    this.resetNewJobForm();
  },

  resetNewJobForm() {
    this.newJobId = '';
    this.newJobName = '';
    this.newJobWorkerPrompt = '';
    this.newJobManagerPrompt = '';
    this.newJobManagerGoal = '';
    this.newJobManagerDir = '';
    this.newJobCheckInterval = '300';
  },

  openDispatchModal(jobId) {
    this.dispatchJobId = jobId;
    this.dispatchGoal = '';
    this.showDispatchModal = true;
  },

  closeDispatchModal() {
    this.showDispatchModal = false;
    this.dispatchJobId = null;
    this.dispatchGoal = '';
  },

  openEditJobModal(id) {
    const job = this.jobDefinitions.find((j) => j.id === id);
    if (!job) return;
    this.editingJobId = id;
    this.editJobName = job.name || '';
    this.editJobWorkerPrompt = job.worker_prompt || '';
    this.editJobManagerPrompt = job.manager_prompt || '';
    this.editJobManagerGoal = job.manager_goal || '';
    this.editJobManagerDir = job.manager_dir || '';
    this.editJobCheckInterval = String(job.check_interval ?? 300);
    this.showEditJobModal = true;
  },

  closeEditJobModal() {
    this.showEditJobModal = false;
    this.editingJobId = null;
  },

  async saveEditJob() {
    if (!this.editingJobId) return;
    await this.updateJobDefinition(this.editingJobId, {
      name: this.editJobName.trim(),
      worker_prompt: this.editJobWorkerPrompt.trim(),
      manager_prompt: this.editJobManagerPrompt.trim(),
      manager_goal: this.editJobManagerGoal.trim(),
      manager_dir: this.editJobManagerDir.trim(),
      check_interval: parseInt(this.editJobCheckInterval, 10) || 300,
    });
    this.closeEditJobModal();
  },

  get jobsTab() {
    return this._jobsTab || 'definitions';
  },

  set jobsTab(val) {
    this._jobsTab = val;
    if (val === 'definitions') this.loadJobDefinitions();
    if (val === 'runs') this.loadJobRuns();
  },

  jobRunStatusClass(status) {
    if (status === 'running' || status === 'starting') return 'state-active';
    if (status === 'complete') return 'state-done';
    if (status === 'failed') return 'state-new';
    if (status === 'stopped') return 'state-archived';
    return '';
  },

  formatJobDuration(run) {
    if (!run.created_at) return '-';
    const start = new Date(run.created_at);
    const end = run.updated_at ? new Date(run.updated_at) : new Date();
    const diffMs = end - start;
    if (diffMs < 60000) return `${Math.round(diffMs / 1000)}s`;
    if (diffMs < 3600000) return `${Math.round(diffMs / 60000)}m`;
    return `${(diffMs / 3600000).toFixed(1)}h`;
  },
};
