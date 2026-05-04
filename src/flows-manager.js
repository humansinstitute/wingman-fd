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
import {
  outboundFlow,
  recordFamilyHash as flowFamilyHash,
} from './translators/flows.js';
import {
  outboundApproval,
  recordFamilyHash as approvalFamilyHash,
} from './translators/approvals.js';
import { outboundTask } from './translators/tasks.js';
import { outboundComment } from './translators/comments.js';
import { recordFamilyHash } from './translators/chat.js';
import { toRaw, parseMarkdownBlocks } from './utils/state-helpers.js';
import {
  buildFlowKickoffTaskRecord,
  buildFlowKickoffDescription,
  buildStoredFlowKickoffScopeAssignment,
  resolveFlowKickoffAssignee,
} from './task-flow-helpers.js';
import { normalizeArtifactRef, resolveArtifactRef } from './approval-helpers.js';
import { commentBelongsToDocBlock } from './doc-comment-anchors.js';
import { renderMarkdownToHtml } from './markdown.js';
import {
  getRecordWriteFieldsForStore,
} from './preferred-write-group.js';
import {
  ALL_TASK_BOARD_ID,
  RECENT_TASK_BOARD_ID,
  UNSCOPED_TASK_BOARD_ID,
} from './task-board-state.js';
import { isTaskUnscoped } from './task-board-scopes.js';

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
    formSteps:      JSON.parse(JSON.stringify(normalizeFlowSteps(f.steps))),
    formNextFlowId: f.next_flow_id || null,
    formScopeId:    f.scope_id || normalizeStoredFlowScopeId(selectedBoardId),
  };
}

export function normalizeStoredFlowScopeId(scopeId) {
  const normalized = String(scopeId || '').trim();
  if (
    !normalized
    || normalized === ALL_TASK_BOARD_ID
    || normalized === RECENT_TASK_BOARD_ID
    || normalized === UNSCOPED_TASK_BOARD_ID
  ) {
    return null;
  }
  return normalized;
}

function filterScopedFlowRecords(records, selectedBoardId, scopesMap = new Map()) {
  const scopeId = String(selectedBoardId || '').trim();
  const liveRecords = Array.isArray(records)
    ? records.filter((record) => record?.record_state !== 'deleted')
    : [];
  if (!scopeId || scopeId === ALL_TASK_BOARD_ID || scopeId === RECENT_TASK_BOARD_ID) {
    return liveRecords;
  }
  if (scopeId === UNSCOPED_TASK_BOARD_ID) {
    return liveRecords.filter((record) => isTaskUnscoped(record, scopesMap));
  }
  return liveRecords.filter((record) => record?.scope_id === scopeId);
}

export function pendingApprovals(approvals) {
  return approvals.filter((a) => a.status === 'pending' && !isArchivedApproval(a));
}

export function approvalsByFlowRun(approvals, flowRunId) {
  if (!flowRunId) return [];
  return approvals.filter((a) => a.flow_run_id === flowRunId && !isArchivedApproval(a));
}

export function isArchivedApproval(approval) {
  return approval?.record_state === 'deleted'
    || approval?.record_state === 'archived'
    || approval?.status === 'archived';
}

export function formatApprovalStatus(status) {
  const labels = {
    pending: 'Pending',
    approved: 'Approved',
    rejected: 'Rejected',
    needs_revision: 'Needs Revision',
    archived: 'Archived',
  };
  return labels[status] || status || '';
}

export function approvalStatusColor(status) {
  const colors = {
    pending: '#fbbf24',
    approved: '#34d399',
    rejected: '#f87171',
    needs_revision: '#a78bfa',
    archived: '#94a3b8',
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

function normalizeArtifactsExpected(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
}

function normalizeWhitelist(value) {
  if (!Array.isArray(value)) return null;
  const next = value.map((item) => String(item || '').trim()).filter(Boolean);
  return next.length > 0 ? next : null;
}

function inferStepType(step) {
  if (step?.type === 'job_dispatch' || step?.type === 'approval') return step.type;
  if (!step) return 'job_dispatch';

  const hasDispatchFields = [
    step.job_type,
    step.goals,
    step.manager_guidance,
    step.worker_guidance,
    step.directory_override,
  ].some((value) => String(value || '').trim() !== '');
  if (hasDispatchFields) return 'job_dispatch';

  const mode = step.approver_mode ?? step.approval_mode;
  if (mode === 'manual' || mode === 'agent') return 'approval';
  if (step.description || step.brief_template || step.whitelist_approvers || step.approver_whitelist) {
    return 'approval';
  }
  return 'job_dispatch';
}

function normalizeWorkInstruction(step) {
  return String(step?.instruction || step?.goals || step?.description || '').trim();
}

function normalizeLegacyDispatchField(value) {
  return String(value || '').trim();
}

function normalizeApprovalDescription(step) {
  return String(step?.description || step?.instruction || step?.goals || '').trim();
}

/**
 * Normalize a step into the canonical authored flow shape while accepting
 * legacy dispatch-specific fields.
 */
export function normalizeStepType(step) {
  if (!step) return step;

  const type = inferStepType(step);
  if (type === 'approval') {
    return {
      step_number: step.step_number,
      title: step.title || '',
      type: 'approval',
      description: normalizeApprovalDescription(step),
      brief_template: String(step.brief_template || '').trim(),
      approver_mode: (step.approver_mode ?? step.approval_mode) === 'agent' ? 'agent' : 'manual',
      whitelist_approvers: normalizeWhitelist(step.whitelist_approvers ?? step.approver_whitelist),
      artifacts_expected: normalizeArtifactsExpected(step.artifacts_expected),
    };
  }

  const instruction = normalizeWorkInstruction(step);
  return {
    step_number: step.step_number,
    title: step.title || '',
    type: 'job_dispatch',
    instruction,
    job_type: normalizeLegacyDispatchField(step.job_type),
    goals: normalizeLegacyDispatchField(step.goals) || instruction,
    manager_guidance: normalizeLegacyDispatchField(step.manager_guidance),
    worker_guidance: normalizeLegacyDispatchField(step.worker_guidance),
    directory_override: normalizeLegacyDispatchField(step.directory_override),
    artifacts_expected: normalizeArtifactsExpected(step.artifacts_expected),
  };
}

export function normalizeFlowSteps(steps) {
  return Array.isArray(steps) ? steps.map((step) => normalizeStepType(step)) : [];
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
    instruction: '',
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

export function normalizeApproverToken(value) {
  const token = String(value || '').trim();
  if (!token) return '';
  if (token.startsWith('npub1') || token.startsWith('group:')) return token;
  return '';
}

export function mergeApproverTokens(existing = [], additions = []) {
  const unique = [...new Set(
    [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(additions) ? additions : [])]
      .map((value) => normalizeApproverToken(value))
      .filter(Boolean),
  )];
  return unique.length > 0 ? unique : null;
}

export function removeApproverToken(existing = [], target) {
  const normalizedTarget = normalizeApproverToken(target);
  if (!normalizedTarget) {
    return Array.isArray(existing) && existing.length > 0 ? [...existing] : null;
  }
  const next = (Array.isArray(existing) ? existing : [])
    .map((value) => normalizeApproverToken(value))
    .filter((value) => value && value !== normalizedTarget);
  return next.length > 0 ? next : null;
}

// ---------------------------------------------------------------------------
// Mixin — applied to Alpine store via applyMixins()
// ---------------------------------------------------------------------------

export const flowsManagerMixin = {
  // --- apply / refresh from Dexie ---

  applyFlows(flows) {
    const next = (Array.isArray(flows) ? flows : []).filter(
      (f) => f.record_state !== 'deleted',
    ).map((flow) => ({
      ...flow,
      steps: normalizeFlowSteps(flow.steps),
    }));
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

  isFlowDetailEditing() {
    return this.flowDetailMode === 'edit';
  },

  getFlowCheckoutPolicyConfig() {
    if (typeof this.getCheckoutEditPolicyConfig === 'function') {
      return this.getCheckoutEditPolicyConfig('flow');
    }
    const baseConfig = this.recordCheckoutPolicyConfig || {};
    return {
      recordFamilyHashes: {
        ...(baseConfig.recordFamilyHashes || {}),
      },
      familySuffixes: {
        ...(baseConfig.familySuffixes || {}),
        flow: 'checkout_required',
      },
    };
  },

  getApprovalCheckoutPolicyConfig() {
    if (typeof this.getCheckoutEditPolicyConfig === 'function') {
      return this.getCheckoutEditPolicyConfig('approval');
    }
    const baseConfig = this.recordCheckoutPolicyConfig || {};
    return {
      recordFamilyHashes: {
        ...(baseConfig.recordFamilyHashes || {}),
      },
      familySuffixes: {
        ...(baseConfig.familySuffixes || {}),
        approval: 'checkout_required',
      },
    };
  },

  openFlowEditor(flowId = null) {
    this.editingFlowId = flowId || null;
    this.showFlowEditor = true;
    this.flowDetailMode = flowId ? 'view' : 'edit';
    this.flowEditOriginal = null;
    this.flowCheckoutPending = false;
  },

  closeFlowEditor(options = {}) {
    const original = this.flowEditOriginal;
    if (this.isFlowDetailEditing?.() && original?.record_id) {
      void this.releaseLockManagedCheckout?.(original, flowFamilyHash('flow'), {
        reportError: false,
        force: true,
        checkoutPolicyConfig: this.getFlowCheckoutPolicyConfig(),
      });
    }
    this.showFlowEditor = false;
    this.editingFlowId = null;
    this.flowDetailMode = 'view';
    this.flowEditOriginal = null;
    this.flowCheckoutPending = false;
    if (options.syncRoute === true) this.syncRoute?.();
  },

  async enterFlowEditMode() {
    if (!this.editingFlowId || !this.session?.npub || this.flowCheckoutPending) return false;
    const flow = this.flows.find((entry) => entry.record_id === this.editingFlowId)
      || await getFlowById(this.editingFlowId);
    if (!flow) return false;
    const checkoutPolicyConfig = this.getFlowCheckoutPolicyConfig();
    this.flowCheckoutPending = true;
    try {
      await this.ensureLockManagedCheckout?.(flow, flowFamilyHash('flow'), {
        intent: 'edit',
        checkoutPolicyConfig,
      });
      this.flowEditOriginal = toRaw(flow);
      this.flowDetailMode = 'edit';
      this.error = '';
      return true;
    } catch (error) {
      this.flowDetailMode = 'view';
      if (error?.userMessage) this.error = error.userMessage;
      return false;
    } finally {
      this.flowCheckoutPending = false;
    }
  },

  async cancelFlowEdit() {
    if (!this.editingFlowId) return;
    const original = this.flows.find((entry) => entry.record_id === this.editingFlowId)
      || this.flowEditOriginal
      || null;
    if (original?.record_id) {
      await this.releaseLockManagedCheckout?.(original, flowFamilyHash('flow'), {
        reportError: false,
        force: true,
        checkoutPolicyConfig: this.getFlowCheckoutPolicyConfig(),
      });
    }
    this.flowDetailMode = 'view';
    this.flowEditOriginal = null;
  },

  // --- computed helpers ---

  get flowsByScope() {
    return filterScopedFlowRecords(this.flows, this.selectedBoardId, this.scopesMap);
  },

  get pendingApprovalsByScope() {
    return filterScopedFlowRecords(pendingApprovals(this.approvals), this.selectedBoardId, this.scopesMap);
  },

  get approvalHistory() {
    let list = this.approvals.filter((a) => !isArchivedApproval(a));
    if (this.approvalHistoryScope === 'scope') {
      list = filterScopedFlowRecords(list, this.selectedBoardId, this.scopesMap);
    }
    list.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
    return list.slice(0, 100);
  },

  normalizeStoredFlowScopeId(scopeId) {
    return normalizeStoredFlowScopeId(scopeId);
  },

  get filteredApprovalHistory() {
    const q = (this.approvalHistoryFilter || '').toLowerCase().trim();
    if (!q) return this.approvalHistory;
    return this.approvalHistory.filter((a) =>
      (a.title || '').toLowerCase().includes(q) ||
      (a.brief || '').toLowerCase().includes(q),
    );
  },

  async addFlowStepApprover(step, suggestionOrToken) {
    if (!step) return false;
    const token = normalizeApproverToken(
      typeof suggestionOrToken === 'string'
        ? suggestionOrToken
        : suggestionOrToken?.token || suggestionOrToken?.npub,
    );
    if (!token) return false;

    const next = mergeApproverTokens(step.whitelist_approvers, [token]);
    if ((step.whitelist_approvers || []).length === (next || []).length) return false;
    step.whitelist_approvers = next;

    if (token.startsWith('npub1')) {
      this.resolveChatProfile?.(token);
      await this.rememberPeople?.([token], 'flow-approver');
    }
    return true;
  },

  async consumeFlowStepApproverQuery(step, query, suggestion = null) {
    if (!step) return false;

    const rawTokens = parseTagList(query)
      .map((value) => normalizeApproverToken(value))
      .filter(Boolean);
    if (rawTokens.length > 0) {
      let added = false;
      for (const token of rawTokens) {
        const appended = await this.addFlowStepApprover(step, token);
        added = appended || added;
      }
      return added;
    }

    if (suggestion?.token || suggestion?.npub) {
      return this.addFlowStepApprover(step, suggestion);
    }

    return false;
  },

  removeFlowStepApprover(step, token) {
    if (!step) return;
    step.whitelist_approvers = removeApproverToken(step.whitelist_approvers, token);
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
      const normalized = normalizeArtifactRef(ref);
      if (normalized.record_id && !names[normalized.record_id]) ids.add(normalized.record_id);
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
      const normalized = normalizeArtifactRef(ref);
      const cached = this.approvalLinkedNames[normalized.record_id];
      if (cached) {
        return {
          ...normalized,
          type: cached.type || normalized.type || 'unknown',
          title: cached.title || normalized.title,
          resolved: true,
        };
      }
      return resolveArtifactRef(normalized, this.tasks, this.documents);
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
      const normalized = normalizeArtifactRef(ref);
      if (!normalized.record_id) continue;
      const cached = this.approvalLinkedNames[normalized.record_id];
      const type = cached?.type || normalized.type || 'unknown';
      // Skip artifact refs that duplicate a task_id already listed
      if (type === 'task' && (approval?.task_ids || []).includes(normalized.record_id)) continue;
      items.push({
        id: normalized.record_id,
        type,
        title: cached?.title || normalized.title || normalized.record_id.slice(0, 12) + '…',
        artifact_key: normalized.artifact_key,
      });
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

    const targetWriteFields = await getRecordWriteFieldsForStore(this, record, {
      label: 'Approval preview comment write',
    });
    const envelope = await outboundComment({
      ...localRow,
      target_group_ids: targetWriteFields.group_ids,
      signature_npub: this.signingNpub,
      write_group_ref: targetWriteFields.write_group_ref,
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
      steps: toRaw(normalizeFlowSteps(steps)),
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

    const writeFields = await getRecordWriteFieldsForStore(this, localRow, {
      label: 'Flow write',
      writeGroupRef: write_group_ref,
    });
    const envelope = await outboundFlow({
      ...localRow,
      group_ids: writeFields.group_ids,
      signature_npub: this.signingNpub,
      write_group_ref: writeFields.write_group_ref,
    });

    await addPendingWrite({
      record_id: recordId,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });

    await this.flushAndBackgroundSync();
    return recordId;
  },

  async updateFlow(flowId, patch = {}, options = {}) {
    const flow = this.flows.find((f) => f.record_id === flowId);
    if (!flow || !this.session?.npub) return null;
    if (!options.allowWithoutCheckout && !this.isFlowDetailEditing?.()) {
      this.error = 'Click Edit before changing this flow.';
      return null;
    }

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
      steps: patch.steps !== undefined ? toRaw(normalizeFlowSteps(patch.steps)) : flow.steps,
      group_ids: resolvedGroupIds,
      shares: resolvedShares,
      scope_policy_group_ids: scopePolicyGroupIds,
      version: nextVersion,
      sync_status: 'pending',
      updated_at: new Date().toISOString(),
    });

    await upsertFlow(updated);
    this.flows = this.flows.map((f) => f.record_id === flowId ? updated : f);

    const writeFields = await getRecordWriteFieldsForStore(this, updated, {
      label: 'Flow write',
    });
    const envelope = await outboundFlow({
      ...updated,
      group_ids: writeFields.group_ids,
      previous_version: flow.version ?? 1,
      signature_npub: this.signingNpub,
      write_group_ref: writeFields.write_group_ref,
    });
    const checkoutPolicyConfig = options.checkoutPolicyConfig || this.getFlowCheckoutPolicyConfig();
    const managedEnvelope = typeof this.attachCheckoutRequiredCheckoutToEnvelope === 'function'
      ? await this.attachCheckoutRequiredCheckoutToEnvelope(updated, envelope, {
        intent: options.intent || 'edit',
        checkoutPolicyConfig,
      })
      : envelope;

    await addPendingWrite({
      record_id: flowId,
      record_family_hash: managedEnvelope.record_family_hash,
      envelope: managedEnvelope,
      checkout_policy_config: checkoutPolicyConfig,
    });

    const flushResult = await this.flushAndBackgroundSync();
    if ((flushResult?.pushed ?? 0) > 0) {
      this.clearLockManagedCheckoutSession?.(updated.record_id, flowFamilyHash('flow'));
      this.flowDetailMode = 'view';
      this.flowEditOriginal = null;
    }
    return updated;
  },

  async deleteFlow(flowId) {
    const flow = this.flows.find((f) => f.record_id === flowId);
    if (!flow || !this.session?.npub) return;
    const checkoutPolicyConfig = this.getFlowCheckoutPolicyConfig();
    try {
      await this.ensureLockManagedCheckout?.(flow, flowFamilyHash('flow'), {
        intent: 'delete',
        checkoutPolicyConfig,
      });
    } catch (error) {
      if (error?.userMessage) this.error = error.userMessage;
      return;
    }

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

    const writeFields = await getRecordWriteFieldsForStore(this, updated, {
      label: 'Flow delete',
    });
    const envelope = await outboundFlow({
      ...updated,
      group_ids: writeFields.group_ids,
      previous_version: flow.version ?? 1,
      signature_npub: this.signingNpub,
      write_group_ref: writeFields.write_group_ref,
    });
    const managedEnvelope = typeof this.attachCheckoutRequiredCheckoutToEnvelope === 'function'
      ? await this.attachCheckoutRequiredCheckoutToEnvelope(updated, envelope, {
        intent: 'delete',
        checkoutPolicyConfig,
      })
      : envelope;

    await addPendingWrite({
      record_id: flowId,
      record_family_hash: managedEnvelope.record_family_hash,
      envelope: managedEnvelope,
      checkout_policy_config: checkoutPolicyConfig,
    });

    const flushResult = await this.flushAndBackgroundSync();
    if ((flushResult?.pushed ?? 0) > 0) {
      this.clearLockManagedCheckoutSession?.(updated.record_id, flowFamilyHash('flow'));
    }
  },

  // --- manual flow start ---

  async startFlowRun(flowId, runContext = '') {
    const flow = this.flows.find((f) => f.record_id === flowId);
    if (!flow || !this.session?.npub) return null;
    if (!Array.isArray(flow.steps) || flow.steps.length === 0) return null;

    const taskId = crypto.randomUUID();
    const now = new Date().toISOString();
    const ownerNpub = this.workspaceOwnerNpub;
    const dispatchBotNpub = resolveFlowKickoffAssignee(this.defaultAgentNpub, this.botNpub);
    const task = buildFlowKickoffTaskRecord({
      taskId,
      ownerNpub,
      flow,
      description: buildFlowKickoffDescription(flow.description, runContext),
      createdAt: now,
      assignedToNpub: dispatchBotNpub,
      scopeAssignment: buildStoredFlowKickoffScopeAssignment(flow),
    });

    await upsertTask(task);
    this.tasks = [...this.tasks, task];

    const writeFields = await getRecordWriteFieldsForStore(this, task, {
      label: 'Flow kickoff task write',
    });
    const envelope = await outboundTask({
      ...task,
      group_ids: writeFields.group_ids,
      signature_npub: this.signingNpub,
      write_group_ref: writeFields.write_group_ref,
    });

    await addPendingWrite({
      record_id: taskId,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });

    await this.flushAndBackgroundSync();
    return { task_id: taskId, flow_run_id: null };
  },

  async startChatThreadFlowDispatch({
    flowId,
    resolvedScopeId = undefined,
    scopeSource = null,
    resolvedScopeAssignment = null,
    kickoffDescription = '',
  } = {}) {
    const flow = this.flows.find((entry) => entry.record_id === flowId);
    if (!flow || !this.session?.npub) return null;
    if (!Array.isArray(flow.steps) || flow.steps.length === 0) return null;

    const taskId = crypto.randomUUID();
    const now = new Date().toISOString();
    const ownerNpub = this.workspaceOwnerNpub;
    const dispatchBotNpub = resolveFlowKickoffAssignee(this.defaultAgentNpub, this.botNpub);
    let scopeAssignment = resolvedScopeAssignment;
    if (!scopeAssignment) {
      if (scopeSource === 'none' || (scopeSource == null && resolvedScopeId === null)) {
        scopeAssignment = buildStoredFlowKickoffScopeAssignment(null);
      } else {
        scopeAssignment = buildStoredFlowKickoffScopeAssignment(flow);
      }
    }
    const task = buildFlowKickoffTaskRecord({
      taskId,
      ownerNpub,
      flow,
      description: String(kickoffDescription || '').trim(),
      createdAt: now,
      assignedToNpub: dispatchBotNpub,
      scopeAssignment,
    });

    await upsertTask(task);
    this.tasks = [...this.tasks, task];

    const writeFields = await getRecordWriteFieldsForStore(this, task, {
      label: 'Chat thread flow task write',
    });
    const envelope = await outboundTask({
      ...task,
      group_ids: writeFields.group_ids,
      signature_npub: this.signingNpub,
      write_group_ref: writeFields.write_group_ref,
    });

    await addPendingWrite({
      record_id: taskId,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });

    await this.flushAndBackgroundSync();
    return { task_id: taskId, flow_run_id: null };
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
    if (!updated) return null;

    // Move linked tasks to done
    if (Array.isArray(approval.task_ids)) {
      for (const taskId of approval.task_ids) {
        await this.applyTaskPatch(taskId, { state: 'done' }, {
          silent: true,
          sync: true,
          checkoutPolicyConfig: null,
          intent: 'approval_approve',
        });
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
    try {
      await this.ensureLockManagedCheckout?.(approval, approvalFamilyHash('approval'), {
        intent: 'edit',
        checkoutPolicyConfig: this.getApprovalCheckoutPolicyConfig(),
      });
    } catch (error) {
      if (error?.userMessage) this.error = error.userMessage;
      return null;
    }

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

    const taskWriteFields = await getRecordWriteFieldsForStore(this, revisionTask, {
      label: 'Revision task write',
    });
    const taskEnvelope = await outboundTask({
      ...revisionTask,
      group_ids: taskWriteFields.group_ids,
      signature_npub: this.signingNpub,
      write_group_ref: taskWriteFields.write_group_ref,
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
    if (!updated) return null;
    await this.flushAndBackgroundSync();
    return updated;
  },

  async archiveApproval(approvalId, decisionNote = null) {
    const approval = this.approvals.find((a) => a.record_id === approvalId);
    if (!approval || !this.session?.npub) return null;

    const now = new Date().toISOString();
    const updated = await this._patchApproval(approval, {
      status: 'archived',
      record_state: 'archived',
      approved_by: this.session.npub,
      approved_at: now,
      decision_note: decisionNote || approval.decision_note || null,
    });
    if (!updated) return null;

    if (Array.isArray(approval.task_ids)) {
      for (const taskId of approval.task_ids) {
        await this.applyTaskPatch(taskId, { state: 'archive' }, {
          silent: true,
          sync: true,
          checkoutPolicyConfig: null,
          intent: 'approval_archive',
        });
      }
    }

    return updated;
  },

  async deleteApproval(approvalId, options = {}) {
    const approval = this.approvals.find((a) => a.record_id === approvalId);
    if (!approval || !this.session?.npub) return null;

    const now = new Date().toISOString();
    const nextVersion = (approval.version ?? 1) + 1;
    const updated = toRaw({
      ...approval,
      record_state: 'deleted',
      sync_status: 'pending',
      version: nextVersion,
      updated_at: now,
    });

    await upsertApproval(updated);
    this.approvals = this.approvals.filter((a) => a.record_id !== approvalId);

    if (this.activeApprovalId === approvalId) {
      this.activeApprovalId = null;
      this.showApprovalDetail = false;
      this.approvalPreviewRecord = null;
      this.approvalPreviewBlocks = [];
      this.approvalPreviewComments = [];
      this.approvalPreviewExpanded = false;
    }

    const envelope = await outboundApproval({
      ...updated,
      group_ids: [],
      previous_version: approval.version ?? 1,
      signature_npub: this.signingNpub,
      write_group_ref: null,
    });

    await addPendingWrite({
      record_id: approval.record_id,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });

    if (options.flush !== false) {
      await this.flushAndBackgroundSync();
    }
    return updated;
  },

  async deletePendingApprovalsByScope() {
    const approvals = [...this.pendingApprovalsByScope];
    if (approvals.length === 0) return 0;
    for (const approval of approvals) {
      await this.deleteApproval(approval.record_id, { flush: false });
    }
    await this.flushAndBackgroundSync();
    return approvals.length;
  },

  async _patchApproval(approval, patch) {
    const checkoutPolicyConfig = this.getApprovalCheckoutPolicyConfig();
    if (approval?.record_id) {
      try {
        await this.ensureLockManagedCheckout?.(approval, approvalFamilyHash('approval'), {
          intent: 'edit',
          checkoutPolicyConfig,
        });
      } catch (error) {
        if (error?.userMessage) this.error = error.userMessage;
        return null;
      }
    }
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

    const writeFields = await getRecordWriteFieldsForStore(this, updated, {
      label: 'Approval write',
    });
    const envelope = await outboundApproval({
      ...updated,
      group_ids: writeFields.group_ids,
      previous_version: approval.version ?? 1,
      signature_npub: this.signingNpub,
      write_group_ref: writeFields.write_group_ref,
    });
    const managedEnvelope = typeof this.attachCheckoutRequiredCheckoutToEnvelope === 'function'
      ? await this.attachCheckoutRequiredCheckoutToEnvelope(updated, envelope, {
        intent: 'edit',
        checkoutPolicyConfig,
      })
      : envelope;

    await addPendingWrite({
      record_id: approval.record_id,
      record_family_hash: managedEnvelope.record_family_hash,
      envelope: managedEnvelope,
      checkout_policy_config: checkoutPolicyConfig,
    });

    const flushResult = await this.flushAndBackgroundSync();
    if ((flushResult?.pushed ?? 0) > 0) {
      this.clearLockManagedCheckoutSession?.(updated.record_id, approvalFamilyHash('approval'));
    }
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

    const writeFields = await getRecordWriteFieldsForStore(this, localRow, {
      label: 'Approval write',
      writeGroupRef: write_group_ref,
    });
    const envelope = await outboundApproval({
      ...localRow,
      group_ids: writeFields.group_ids,
      signature_npub: this.signingNpub,
      write_group_ref: writeFields.write_group_ref,
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
