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
  getAllApprovals,
  upsertTask,
  getTaskById,
  getDocumentById,
  getCommentsByTarget,
  upsertComment,
  addPendingWrite,
} from './db.js';
import { outboundFlow } from './translators/flows.js';
import { outboundApproval } from './translators/approvals.js';
import { outboundTask } from './translators/tasks.js';
import { outboundComment } from './translators/comments.js';
import { recordFamilyHash } from './translators/chat.js';
import { toRaw, parseMarkdownBlocks } from './utils/state-helpers.js';
import { buildFirstStepDescription } from './task-flow-helpers.js';
import { resolveArtifactRef } from './approval-helpers.js';
import { commentBelongsToDocBlock } from './doc-comment-anchors.js';
import { renderMarkdownToHtml } from './markdown.js';

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
// Tag list helpers (whitelist_approvers, artifacts_expected UI binding)
// ---------------------------------------------------------------------------

/**
 * Parse a comma-separated string into a trimmed array, filtering empties.
 */
export function parseTagList(str) {
  if (!str) return [];
  return str.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Format an array into a comma-separated display string.
 */
export function formatTagList(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return '';
  return arr.join(', ');
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
    this.approvals = await getAllApprovals();
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

  get approvalHistory() {
    let list = this.approvals.filter((a) => a.record_state !== 'deleted');
    if (this.approvalHistoryScope === 'scope') {
      const scopeId = this.selectedBoardId;
      if (scopeId) list = list.filter((a) => a.scope_id === scopeId);
    }
    list.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
    return list.slice(0, 100);
  },

  get filteredApprovalHistory() {
    const q = (this.approvalHistoryFilter || '').toLowerCase().trim();
    if (!q) return this.approvalHistory;
    return this.approvalHistory.filter((a) =>
      (a.title || '').toLowerCase().includes(q) ||
      (a.brief || '').toLowerCase().includes(q),
    );
  },

  // --- approval rendering helpers (used by the detail modal template) ---

  /** Point-lookup linked task/doc names from Dexie and cache in approvalLinkedNames. */
  async resolveApprovalLinkedNames(approval) {
    if (!approval) return;
    const names = { ...this.approvalLinkedNames };
    const ids = new Set();

    for (const taskId of (approval.task_ids || [])) {
      if (!names[taskId]) ids.add(taskId);
    }
    for (const ref of (approval.artifact_refs || [])) {
      if (ref.record_id && !names[ref.record_id]) ids.add(ref.record_id);
    }
    if (ids.size === 0) return;

    const lookups = [...ids].map(async (id) => {
      const task = await getTaskById(id);
      if (task) {
        names[id] = { title: task.title || 'Untitled task', state: task.state || 'unknown' };
        return;
      }
      const doc = await getDocumentById(id);
      if (doc) {
        names[id] = { title: doc.title || 'Untitled document', type: 'document' };
        return;
      }
      names[id] = { title: id.slice(0, 12) + '…', state: 'not found' };
    });
    await Promise.all(lookups);
    this.approvalLinkedNames = names;
  },

  /** Get cached display name for a linked record. */
  linkedName(id) {
    return this.approvalLinkedNames[id] || null;
  },

  approvalBriefHtml(approval) {
    return renderMarkdownToHtml(approval?.brief) || 'No brief provided.';
  },

  resolvedArtifacts(approval) {
    return (approval?.artifact_refs || []).map((ref) => {
      const cached = this.approvalLinkedNames[ref.record_id];
      if (cached) {
        const familyType = (ref.record_family_hash || '').split(':').pop();
        return { ...ref, type: cached.type || familyType || 'unknown', title: cached.title, resolved: true };
      }
      return resolveArtifactRef(ref, this.tasks, this.documents);
    });
  },

  navigateToArtifact(ref) {
    this.showApprovalDetail = false;
    if (ref.type === 'task') {
      this.navSection = 'tasks';
      this.mobileNavOpen = false;
      this.openTaskDetail(ref.record_id);
    } else if (ref.type === 'document') {
      this.navSection = 'docs';
      this.mobileNavOpen = false;
      this.openDoc(ref.record_id);
    }
  },

  navigateToLinkedTask(taskId) {
    this.showApprovalDetail = false;
    this.navSection = 'tasks';
    this.mobileNavOpen = false;
    this.openTaskDetail(taskId);
  },

  handleBriefLinkClick(event) {
    const link = event.target.closest('.mention-link');
    if (!link) return;
    // Close the approval modal — the global mention-link click handler
    // in app.js initDocCommentConnector will handle the actual navigation.
    this.showApprovalDetail = false;
  },

  // --- approval preview pane (desktop two-column) ---

  /** Build a flat list of all linked items for the preview pane pagination. */
  approvalPreviewItems(approval) {
    const items = [];
    for (const taskId of (approval?.task_ids || [])) {
      const cached = this.approvalLinkedNames[taskId];
      items.push({ id: taskId, type: 'task', title: cached?.title || taskId.slice(0, 12) + '…' });
    }
    for (const ref of (approval?.artifact_refs || [])) {
      const familyType = (ref.record_family_hash || '').split(':').pop();
      const cached = this.approvalLinkedNames[ref.record_id];
      const type = cached?.type || familyType || 'unknown';
      // Skip artifact refs that duplicate a task_id already listed
      if (type === 'task' && (approval?.task_ids || []).includes(ref.record_id)) continue;
      items.push({ id: ref.record_id, type, title: cached?.title || ref.record_id.slice(0, 12) + '…' });
    }
    return items;
  },

  /** Load a linked item into the preview pane by index. */
  async loadApprovalPreview(approval, index) {
    const items = this.approvalPreviewItems(approval);
    if (!items.length) {
      this.approvalPreviewRecord = null;
      this.approvalPreviewComments = [];
      return;
    }
    const clamped = Math.max(0, Math.min(index, items.length - 1));
    this.approvalPreviewIndex = clamped;
    const item = items[clamped];
    if (!item) return;

    let record = null;
    let previewType = null;
    if (item.type === 'task') {
      record = await getTaskById(item.id);
      if (record) previewType = 'task';
    } else if (item.type === 'document') {
      record = await getDocumentById(item.id);
      if (record) previewType = 'document';
    } else {
      // Try task first, then doc
      record = await getTaskById(item.id);
      if (record) { previewType = 'task'; }
      else {
        record = await getDocumentById(item.id);
        if (record) previewType = 'document';
      }
    }

    this.approvalPreviewType = previewType;
    this.approvalPreviewRecord = record;
    this.approvalPreviewComments = [];
    this.approvalPreviewCommentBody = '';

    if (record) {
      const comments = await getCommentsByTarget(record.record_id);
      this.approvalPreviewComments = comments || [];
    }
  },

  /** Parse preview content into blocks for line-anchored comments (documents only). */
  get approvalPreviewBlocks() {
    if (this.approvalPreviewType !== 'document') return [];
    const content = this.approvalPreviewRecord?.content || '';
    if (!content) return [];
    return parseMarkdownBlocks(content);
  },

  /** Get root comments (not replies) anchored to a specific block. */
  getPreviewCommentsForBlock(block) {
    return this.approvalPreviewComments
      .filter((c) => !c.parent_comment_id && c.record_state !== 'deleted' && commentBelongsToDocBlock(c, block))
      .sort((a, b) => String(a.updated_at || '').localeCompare(String(b.updated_at || '')));
  },

  /** Get comments not anchored to any block (legacy or general). */
  get previewUnanchoredComments() {
    const blocks = this.approvalPreviewBlocks;
    return this.approvalPreviewComments
      .filter((c) => !c.parent_comment_id && c.record_state !== 'deleted')
      .filter((c) => !blocks.some((block) => commentBelongsToDocBlock(c, block)))
      .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  },

  /** Start composing a comment anchored to a block. */
  startPreviewBlockComment(block) {
    this.approvalPreviewAnchorLine = block.start_line || 1;
    this.approvalPreviewCommentBody = '';
    // Focus the textarea after Alpine tick
    this.$nextTick?.(() => {
      const ta = document.querySelector('.approval-preview-comment-add textarea');
      if (ta) ta.focus();
    });
  },

  /** Add a comment to the currently previewed record. */
  async addApprovalPreviewComment() {
    const body = String(this.approvalPreviewCommentBody || '').trim();
    const record = this.approvalPreviewRecord;
    if (!body || !record || !this.session?.npub) return;

    const now = new Date().toISOString();
    const commentId = crypto.randomUUID();
    const ownerNpub = this.workspaceOwnerNpub;
    const targetFamilyHash = this.approvalPreviewType === 'document'
      ? recordFamilyHash('document')
      : recordFamilyHash('task');

    const localRow = {
      record_id: commentId,
      owner_npub: ownerNpub,
      target_record_id: record.record_id,
      target_record_family_hash: targetFamilyHash,
      parent_comment_id: null,
      anchor_line_number: this.approvalPreviewAnchorLine || 1,
      comment_status: 'open',
      body,
      attachments: [],
      sender_npub: this.session.npub,
      record_state: 'active',
      version: 1,
      created_at: now,
      updated_at: now,
    };

    await upsertComment(localRow);
    this.approvalPreviewComments = [...this.approvalPreviewComments, localRow];
    this.approvalPreviewCommentBody = '';
    this.approvalPreviewAnchorLine = null;

    const envelope = await outboundComment({
      ...localRow,
      target_group_ids: toRaw(record.group_ids ?? []),
      signature_npub: this.signingNpub,
      write_group_ref: record.board_group_id || record.group_ids?.[0] || null,
    });
    await addPendingWrite({
      record_id: commentId,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });
    await this.flushAndBackgroundSync();
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
    let scopePolicyGroupIds = null;
    if (scope_id && typeof this.getScopeShareGroupIds === 'function') {
      const scope = this.scopesMap?.get(scope_id);
      if (scope) {
        const scopeGroupIds = this.getScopeShareGroupIds(scope);
        if (scopeGroupIds.length > 0) {
          resolvedGroupIds = scopeGroupIds;
          scopePolicyGroupIds = scopeGroupIds;
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
      scope_policy_group_ids: scopePolicyGroupIds,
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

    const effectiveScopeId = patch.scope_id !== undefined ? patch.scope_id : flow.scope_id;
    let resolvedGroupIds = toRaw(patch.group_ids ?? flow.group_ids ?? []);
    let resolvedShares = toRaw(patch.shares ?? flow.shares ?? []);
    let scopePolicyGroupIds = toRaw(patch.scope_policy_group_ids ?? flow.scope_policy_group_ids ?? null);
    if (effectiveScopeId && typeof this.getScopeShareGroupIds === 'function') {
      const scope = this.scopesMap?.get(effectiveScopeId);
      if (scope) {
        const patchedRecord = {
          ...flow,
          ...patch,
          group_ids: resolvedGroupIds,
          shares: resolvedShares,
          scope_policy_group_ids: scopePolicyGroupIds,
        };
        const previousScopeGroupIds = patch.scope_id !== undefined && flow.scope_id && flow.scope_id !== effectiveScopeId
          ? this.getResolvedScopePolicyGroupIds(flow.scope_id)
          : [];
        const rebuilt = this.buildScopedPolicyRepairPatch(patchedRecord, {
          scopeId: effectiveScopeId,
          previousScopeGroupIds,
          fallbackPolicyGroupIds: flow.group_ids || [],
        });
        resolvedGroupIds = rebuilt.group_ids;
        resolvedShares = rebuilt.shares;
        scopePolicyGroupIds = rebuilt.scope_policy_group_ids;
      }
    } else {
      scopePolicyGroupIds = null;
    }

    const updated = toRaw({
      ...flow,
      ...patch,
      group_ids: resolvedGroupIds,
      shares: resolvedShares,
      scope_policy_group_ids: scopePolicyGroupIds,
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

  async startFlowRun(flowId, runContext = '') {
    const flow = this.flows.find((f) => f.record_id === flowId);
    if (!flow || !this.session?.npub) return null;
    if (!Array.isArray(flow.steps) || flow.steps.length === 0) return null;

    const firstStep = flow.steps[0];
    const flowRunId = crypto.randomUUID();
    const taskId = crypto.randomUUID();
    const now = new Date().toISOString();
    const ownerNpub = this.workspaceOwnerNpub;

    const stepDesc = firstStep.goals || firstStep.description || firstStep.instruction || '';
    const task = {
      record_id: taskId,
      owner_npub: ownerNpub,
      title: firstStep.title || flow.title,
      description: buildFirstStepDescription(stepDesc, runContext),
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
      scope_policy_group_ids: toRaw(flow.scope_policy_group_ids || null),
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
      scope_policy_group_ids: toRaw(approval.scope_policy_group_ids || null),
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
    const effectiveScopeId = patch.scope_id !== undefined ? patch.scope_id : approval.scope_id;
    let resolvedGroupIds = toRaw(patch.group_ids ?? approval.group_ids ?? []);
    let resolvedShares = toRaw(patch.shares ?? approval.shares ?? []);
    let scopePolicyGroupIds = toRaw(patch.scope_policy_group_ids ?? approval.scope_policy_group_ids ?? null);
    if (effectiveScopeId && typeof this.getScopeShareGroupIds === 'function') {
      const rebuilt = this.buildScopedPolicyRepairPatch({
        ...approval,
        ...patch,
        group_ids: resolvedGroupIds,
        shares: resolvedShares,
        scope_policy_group_ids: scopePolicyGroupIds,
      }, {
        scopeId: effectiveScopeId,
        previousScopeGroupIds: patch.scope_id !== undefined && approval.scope_id && approval.scope_id !== effectiveScopeId
          ? this.getResolvedScopePolicyGroupIds(approval.scope_id)
          : [],
        fallbackPolicyGroupIds: approval.group_ids || [],
      });
      resolvedGroupIds = rebuilt.group_ids;
      resolvedShares = rebuilt.shares;
      scopePolicyGroupIds = rebuilt.scope_policy_group_ids;
    } else {
      scopePolicyGroupIds = null;
    }
    const updated = toRaw({
      ...approval,
      ...patch,
      group_ids: resolvedGroupIds,
      shares: resolvedShares,
      scope_policy_group_ids: scopePolicyGroupIds,
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

    let resolvedGroupIds = toRaw(group_ids);
    let resolvedShares = [];
    let scopePolicyGroupIds = null;
    if (scope_id && typeof this.getScopeShareGroupIds === 'function') {
      const scope = this.scopesMap?.get(scope_id);
      if (scope) {
        const scopeGroupIds = this.getScopeShareGroupIds(scope);
        if (scopeGroupIds.length > 0) {
          resolvedGroupIds = scopeGroupIds;
          scopePolicyGroupIds = scopeGroupIds;
          resolvedShares = typeof this.buildScopeDefaultShares === 'function'
            ? this.buildScopeDefaultShares(scopeGroupIds)
            : [];
        }
      }
    }

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
      scope_policy_group_ids: scopePolicyGroupIds,
      shares: resolvedShares,
      group_ids: resolvedGroupIds,
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
};
