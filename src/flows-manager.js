/**
 * Flow and approval management methods for the Alpine store.
 *
 * Pure utility functions are exported individually for testing.
 * The flowsManagerMixin object contains methods that use `this` (the Alpine store).
 */

import {
  upsertFlow,
  getFlowById,
  getFlowsByScope,
  getFlowsByOwner,
  upsertApproval,
  getApprovalById,
  getApprovalsByScope,
  getApprovalsByStatus,
  upsertTask,
  addPendingWrite,
} from './db.js';
import { outboundFlow } from './translators/flows.js';
import { outboundApproval } from './translators/approvals.js';
import { outboundTask } from './translators/tasks.js';
import { toRaw } from './utils/state-helpers.js';

// ---------------------------------------------------------------------------
// Pure utility functions (no `this` dependency)
// ---------------------------------------------------------------------------

/**
 * Build form state for the flow editor from a flow object.
 *
 * Extracted so that the same logic is used by both Alpine init() and
 * the $watch that re-populates fields when the editor re-opens after
 * a hard refresh (where init() already ran with no flow selected).
 */
export function buildFlowEditorForm(flow, selectedBoardId) {
  const f = flow || {};
  return {
    formTitle:      f.title || '',
    formDescription: f.description || '',
    formSteps:      Array.isArray(f.steps) ? JSON.parse(JSON.stringify(f.steps)) : [],
    formNextFlowId: f.next_flow_id || null,
    formScopeId:    f.scope_id || selectedBoardId || null,
  };
}

export function pendingApprovals(approvals) {
  return approvals.filter((a) => a.status === 'pending' && a.record_state !== 'deleted');
}

export function approvalsByFlowRun(approvals, flowRunId) {
  if (!flowRunId) return [];
  return approvals.filter((a) => a.flow_run_id === flowRunId && a.record_state !== 'deleted');
}

export function formatApprovalStatus(status) {
  const labels = {
    pending: 'Pending',
    approved: 'Approved',
    rejected: 'Rejected',
    needs_revision: 'Needs Revision',
  };
  return labels[status] || status || '';
}

export function approvalStatusColor(status) {
  const colors = {
    pending: '#fbbf24',
    approved: '#34d399',
    rejected: '#f87171',
    needs_revision: '#a78bfa',
  };
  return colors[status] || '#9ca3af';
}

export function confidenceLabel(score) {
  if (score == null) return '';
  return `${Math.round(score * 100)}%`;
}

// ---------------------------------------------------------------------------
// Step type helpers
// ---------------------------------------------------------------------------

export function isJobDispatchStep(step) {
  return step?.type === 'job_dispatch';
}

export function isApprovalStep(step) {
  return step?.type === 'approval';
}

/**
 * Normalize a step to have an explicit `type` field.
 * Legacy steps (no type) are mapped based on approval_mode:
 *   - approval_mode 'auto' → job_dispatch (auto-advance means agent work)
 *   - approval_mode 'manual'|'agent' → approval
 *   - no approval_mode → job_dispatch
 */
export function normalizeStepType(step) {
  if (!step) return step;
  if (step.type === 'job_dispatch' || step.type === 'approval') return step;

  // Legacy migration
  const mode = step.approval_mode;
  if (mode === 'auto' || !mode) {
    return {
      step_number: step.step_number,
      title: step.title || '',
      type: 'job_dispatch',
      job_type: '',
      goals: step.instruction || '',
      manager_guidance: '',
      worker_guidance: '',
      directory_override: '',
      artifacts_expected: step.artifacts_expected || [],
    };
  }

  // manual or agent → approval type
  return {
    step_number: step.step_number,
    title: step.title || '',
    type: 'approval',
    description: step.instruction || '',
    brief_template: '',
    approver_mode: mode,
    whitelist_approvers: step.whitelist_approvers || null,
    artifacts_expected: step.artifacts_expected || [],
  };
}

/**
 * Create a blank step of the given type.
 */
export function defaultStepForType(type, stepNumber) {
  if (type === 'approval') {
    return {
      step_number: stepNumber,
      title: '',
      type: 'approval',
      description: '',
      brief_template: '',
      approver_mode: 'manual',
      whitelist_approvers: null,
      artifacts_expected: [],
    };
  }
  // default: job_dispatch
  return {
    step_number: stepNumber,
    title: '',
    type: 'job_dispatch',
    job_type: '',
    goals: '',
    manager_guidance: '',
    worker_guidance: '',
    directory_override: '',
    artifacts_expected: [],
  };
}

// ---------------------------------------------------------------------------
// Mixin — applied to Alpine store via applyMixins()
// ---------------------------------------------------------------------------

export const flowsManagerMixin = {
  // --- apply / refresh from Dexie ---

  applyFlows(flows) {
    const next = (Array.isArray(flows) ? flows : []).filter(
      (f) => f.record_state !== 'deleted',
    );
    this.flows = next;
  },

  async refreshFlows() {
    const ownerNpub = this.workspaceOwnerNpub;
    if (!ownerNpub) return;
    const rows = await getFlowsByOwner(ownerNpub);
    this.applyFlows(rows);
  },

  async refreshApprovals() {
    const ownerNpub = this.workspaceOwnerNpub;
    if (!ownerNpub) return;
    const allApprovals = await getApprovalsByStatus('pending');
    const approved = await getApprovalsByStatus('approved');
    const rejected = await getApprovalsByStatus('rejected');
    const revision = await getApprovalsByStatus('needs_revision');
    this.approvals = [...allApprovals, ...approved, ...rejected, ...revision];
  },

  // --- computed helpers ---

  get flowsByScope() {
    const scopeId = this.selectedBoardId;
    if (!scopeId) return this.flows;
    return this.flows.filter((f) => f.scope_id === scopeId);
  },

  get pendingApprovalsByScope() {
    const scopeId = this.selectedBoardId;
    const pending = pendingApprovals(this.approvals);
    if (!scopeId) return pending;
    return pending.filter((a) => a.scope_id === scopeId);
  },

  // --- flow CRUD ---

  async createFlow({ title, description = '', steps = [], next_flow_id = null, scope_id = null, scope_l1_id = null, scope_l2_id = null, scope_l3_id = null, scope_l4_id = null, scope_l5_id = null, group_ids = [], write_group_ref = null }) {
    if (!title || !this.session?.npub) return null;

    const now = new Date().toISOString();
    const recordId = crypto.randomUUID();
    const ownerNpub = this.workspaceOwnerNpub;

    // Derive group_ids and shares from scope (same pattern as docs/tasks)
    let resolvedGroupIds = toRaw(group_ids);
    let shares = [];
    if (scope_id && typeof this.getScopeShareGroupIds === 'function') {
      const scope = this.scopesMap?.get(scope_id);
      if (scope) {
        const scopeGroupIds = this.getScopeShareGroupIds(scope);
        if (scopeGroupIds.length > 0) {
          resolvedGroupIds = scopeGroupIds;
          shares = typeof this.buildScopeDefaultShares === 'function'
            ? this.buildScopeDefaultShares(scopeGroupIds)
            : [];
        }
      }
    }

    const localRow = {
      record_id: recordId,
      owner_npub: ownerNpub,
      title,
      description,
      steps,
      next_flow_id,
      scope_id,
      scope_l1_id,
      scope_l2_id,
      scope_l3_id,
      scope_l4_id,
      scope_l5_id,
      shares,
      group_ids: resolvedGroupIds,
      sync_status: 'pending',
      record_state: 'active',
      version: 1,
      created_at: now,
      updated_at: now,
    };

    await upsertFlow(localRow);
    this.flows = [...this.flows, localRow];

    const envelope = await outboundFlow({
      ...localRow,
      signature_npub: this.signingNpub,
      write_group_ref: write_group_ref || resolvedGroupIds?.[0] || null,
    });

    await addPendingWrite({
      record_id: recordId,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });

    await this.flushAndBackgroundSync();
    return recordId;
  },

  async updateFlow(flowId, patch = {}) {
    const flow = this.flows.find((f) => f.record_id === flowId);
    if (!flow || !this.session?.npub) return null;

    const nextVersion = (flow.version ?? 1) + 1;

    // If scope changed, recompute group_ids and shares from new scope
    const effectiveScopeId = patch.scope_id !== undefined ? patch.scope_id : flow.scope_id;
    let resolvedGroupIds = toRaw(patch.group_ids ?? flow.group_ids ?? []);
    let resolvedShares = toRaw(patch.shares ?? flow.shares ?? []);
    if (effectiveScopeId && typeof this.getScopeShareGroupIds === 'function') {
      const scope = this.scopesMap?.get(effectiveScopeId);
      if (scope) {
        const scopeGroupIds = this.getScopeShareGroupIds(scope);
        if (scopeGroupIds.length > 0) {
          resolvedGroupIds = scopeGroupIds;
          resolvedShares = typeof this.buildScopeDefaultShares === 'function'
            ? this.buildScopeDefaultShares(scopeGroupIds)
            : resolvedShares;
        }
      }
    }

    const updated = toRaw({
      ...flow,
      ...patch,
      group_ids: resolvedGroupIds,
      shares: resolvedShares,
      version: nextVersion,
      sync_status: 'pending',
      updated_at: new Date().toISOString(),
    });

    await upsertFlow(updated);
    this.flows = this.flows.map((f) => f.record_id === flowId ? updated : f);

    const envelope = await outboundFlow({
      ...updated,
      previous_version: flow.version ?? 1,
      signature_npub: this.signingNpub,
      write_group_ref: updated.group_ids?.[0] || null,
    });

    await addPendingWrite({
      record_id: flowId,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });

    await this.flushAndBackgroundSync();
    return updated;
  },

  async deleteFlow(flowId) {
    const flow = this.flows.find((f) => f.record_id === flowId);
    if (!flow || !this.session?.npub) return;

    const nextVersion = (flow.version ?? 1) + 1;
    const updated = toRaw({
      ...flow,
      record_state: 'deleted',
      version: nextVersion,
      sync_status: 'pending',
      updated_at: new Date().toISOString(),
    });

    await upsertFlow(updated);
    this.flows = this.flows.filter((f) => f.record_id !== flowId);

    const envelope = await outboundFlow({
      ...updated,
      previous_version: flow.version ?? 1,
      signature_npub: this.signingNpub,
      write_group_ref: flow.group_ids?.[0] || null,
    });

    await addPendingWrite({
      record_id: flowId,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });

    await this.flushAndBackgroundSync();
  },

  // --- manual flow start ---

  async startFlowRun(flowId) {
    const flow = this.flows.find((f) => f.record_id === flowId);
    if (!flow || !this.session?.npub) return null;
    if (!Array.isArray(flow.steps) || flow.steps.length === 0) return null;

    const firstStep = flow.steps[0];
    const flowRunId = crypto.randomUUID();
    const taskId = crypto.randomUUID();
    const now = new Date().toISOString();
    const ownerNpub = this.workspaceOwnerNpub;

    const task = {
      record_id: taskId,
      owner_npub: ownerNpub,
      title: firstStep.title || flow.title,
      description: firstStep.goals || firstStep.description || firstStep.instruction || '',
      state: 'ready',
      priority: 'rock',
      parent_task_id: null,
      flow_id: flowId,
      flow_run_id: flowRunId,
      flow_step: firstStep.step_number,
      predecessor_task_ids: null,
      scope_id: flow.scope_id || null,
      scope_l1_id: flow.scope_l1_id || null,
      scope_l2_id: flow.scope_l2_id || null,
      scope_l3_id: flow.scope_l3_id || null,
      scope_l4_id: flow.scope_l4_id || null,
      scope_l5_id: flow.scope_l5_id || null,
      shares: [],
      group_ids: toRaw(flow.group_ids || []),
      sync_status: 'pending',
      record_state: 'active',
      version: 1,
      created_at: now,
      updated_at: now,
    };

    await upsertTask(task);
    this.tasks = [...this.tasks, task];

    const envelope = await outboundTask({
      ...task,
      signature_npub: this.signingNpub,
      write_group_ref: task.group_ids?.[0] || null,
    });

    await addPendingWrite({
      record_id: taskId,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });

    await this.flushAndBackgroundSync();
    return { task_id: taskId, flow_run_id: flowRunId };
  },

  // --- approval actions ---

  async approveApproval(approvalId, decisionNote = null) {
    const approval = this.approvals.find((a) => a.record_id === approvalId);
    if (!approval || !this.session?.npub) return null;

    const now = new Date().toISOString();
    const patch = {
      status: 'approved',
      approved_by: this.session.npub,
      approved_at: now,
      decision_note: decisionNote,
    };

    const updated = await this._patchApproval(approval, patch);

    // Move linked tasks to done
    if (Array.isArray(approval.task_ids)) {
      for (const taskId of approval.task_ids) {
        await this.applyTaskPatch(taskId, { state: 'done' }, { silent: true, sync: true });
      }
    }

    return updated;
  },

  async rejectApproval(approvalId, decisionNote = null) {
    const approval = this.approvals.find((a) => a.record_id === approvalId);
    if (!approval || !this.session?.npub) return null;

    const patch = {
      status: 'rejected',
      approved_by: this.session.npub,
      approved_at: new Date().toISOString(),
      decision_note: decisionNote,
    };

    return this._patchApproval(approval, patch);
  },

  async improveApproval(approvalId, decisionNote = '') {
    const approval = this.approvals.find((a) => a.record_id === approvalId);
    if (!approval || !this.session?.npub) return null;

    // Create a revision task
    const revisionTaskId = crypto.randomUUID();
    const now = new Date().toISOString();
    const ownerNpub = this.workspaceOwnerNpub;

    const revisionTask = {
      record_id: revisionTaskId,
      owner_npub: ownerNpub,
      title: `Revision: ${approval.title}`,
      description: decisionNote || 'Please revise based on feedback.',
      state: 'ready',
      priority: 'rock',
      parent_task_id: null,
      flow_id: approval.flow_id,
      flow_run_id: approval.flow_run_id,
      flow_step: approval.flow_step,
      predecessor_task_ids: null,
      scope_id: approval.scope_id,
      scope_l1_id: approval.scope_l1_id,
      scope_l2_id: approval.scope_l2_id,
      scope_l3_id: approval.scope_l3_id,
      scope_l4_id: approval.scope_l4_id,
      scope_l5_id: approval.scope_l5_id,
      shares: [],
      group_ids: toRaw(approval.group_ids || []),
      sync_status: 'pending',
      record_state: 'active',
      version: 1,
      created_at: now,
      updated_at: now,
    };

    await upsertTask(revisionTask);
    this.tasks = [...this.tasks, revisionTask];

    const taskEnvelope = await outboundTask({
      ...revisionTask,
      signature_npub: this.signingNpub,
      write_group_ref: revisionTask.group_ids?.[0] || null,
    });

    await addPendingWrite({
      record_id: revisionTaskId,
      record_family_hash: taskEnvelope.record_family_hash,
      envelope: taskEnvelope,
    });

    // Update approval
    const patch = {
      status: 'needs_revision',
      approved_by: this.session.npub,
      approved_at: now,
      decision_note: decisionNote,
      revision_task_id: revisionTaskId,
    };

    const updated = await this._patchApproval(approval, patch);
    await this.flushAndBackgroundSync();
    return updated;
  },

  async _patchApproval(approval, patch) {
    const nextVersion = (approval.version ?? 1) + 1;
    const updated = toRaw({
      ...approval,
      ...patch,
      version: nextVersion,
      sync_status: 'pending',
      updated_at: new Date().toISOString(),
    });

    await upsertApproval(updated);
    this.approvals = this.approvals.map((a) =>
      a.record_id === approval.record_id ? updated : a
    );

    const envelope = await outboundApproval({
      ...updated,
      previous_version: approval.version ?? 1,
      signature_npub: this.signingNpub,
      write_group_ref: updated.group_ids?.[0] || null,
    });

    await addPendingWrite({
      record_id: approval.record_id,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });

    await this.flushAndBackgroundSync();
    return updated;
  },

  // --- standalone approval creation ---

  async createApproval({ title, flow_id = null, flow_run_id = null, flow_step = null, task_ids = [], approval_mode = 'manual', brief = '', confidence_score = null, artifact_refs = [], scope_id = null, scope_l1_id = null, scope_l2_id = null, scope_l3_id = null, scope_l4_id = null, scope_l5_id = null, group_ids = [], write_group_ref = null }) {
    if (!title || !this.session?.npub) return null;

    const now = new Date().toISOString();
    const recordId = crypto.randomUUID();
    const ownerNpub = this.workspaceOwnerNpub;

    const localRow = {
      record_id: recordId,
      owner_npub: ownerNpub,
      title,
      flow_id,
      flow_run_id,
      flow_step,
      task_ids,
      status: 'pending',
      approval_mode,
      brief,
      confidence_score,
      approved_by: null,
      approved_at: null,
      decision_note: null,
      agent_review_by: null,
      agent_review_note: null,
      artifact_refs,
      revision_task_id: null,
      scope_id,
      scope_l1_id,
      scope_l2_id,
      scope_l3_id,
      scope_l4_id,
      scope_l5_id,
      shares: [],
      group_ids: toRaw(group_ids),
      sync_status: 'pending',
      record_state: 'active',
      version: 1,
      created_at: now,
      updated_at: now,
    };

    await upsertApproval(localRow);
    this.approvals = [...this.approvals, localRow];

    const envelope = await outboundApproval({
      ...localRow,
      signature_npub: this.signingNpub,
      write_group_ref: write_group_ref || group_ids?.[0] || null,
    });

    await addPendingWrite({
      record_id: recordId,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });

    await this.flushAndBackgroundSync();
    return recordId;
  },
};
