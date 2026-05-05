/**
 * Task ↔ Flow UX helpers.
 *
 * Pure functions — no Alpine `this` dependency — so they can be unit-tested
 * and consumed by both the Alpine store and tests.
 */

function cloneJsonValue(value, fallback) {
  if (value == null) return fallback;
  return JSON.parse(JSON.stringify(value));
}

function normalizeNullableId(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

/**
 * Derive display info about a task's flow linkage.
 *
 * Returns `null` when the task has no flow association.
 * Otherwise returns an object distinguishing *reference-only* (flow_id set,
 * no flow_run_id) from *active run* (both flow_id and flow_run_id set).
 */
export function getTaskFlowInfo(task, flows) {
  if (!task || !task.flow_id) return null;

  const flow = Array.isArray(flows)
    ? flows.find((f) => f.record_id === task.flow_id)
    : null;

  return {
    flowId: task.flow_id,
    flowTitle: flow?.title ?? null,
    steps: Array.isArray(flow?.steps) ? [...flow.steps] : [],
    isActiveRun: !!task.flow_run_id,
    flowRunId: task.flow_run_id ?? null,
    flowStep: task.flow_step ?? null,
  };
}

/**
 * Find the task for a specific step in a flow run.
 */
export function findTaskForFlowRunStep(tasks, flowRunId, stepNumber) {
  if (!flowRunId || stepNumber == null) return null;
  const targetStep = Number(stepNumber);
  if (!Number.isFinite(targetStep)) return null;

  return Array.isArray(tasks)
    ? tasks.find((task) =>
      task?.record_state !== 'deleted'
      && task.flow_run_id === flowRunId
      && Number(task.flow_step) === targetStep,
    ) ?? null
    : null;
}

/**
 * Build a task patch that attaches a flow as a *reference* (not a run).
 *
 * Replaces any previous flow reference in the references array.
 */
export function buildAttachFlowPatch(flowId, existingReferences) {
  const refs = (existingReferences || []).filter((r) => r.type !== 'flow');
  refs.push({ type: 'flow', id: flowId });

  return {
    flow_id: flowId,
    flow_run_id: null,
    flow_step: null,
    references: refs,
  };
}

/**
 * Build a task patch that detaches any flow association.
 */
export function buildDetachFlowPatch(existingReferences) {
  const refs = (existingReferences || []).filter((r) => r.type !== 'flow');

  return {
    flow_id: null,
    flow_run_id: null,
    flow_step: null,
    references: refs,
  };
}

export function parseTaskTagList(tagsString) {
  return String(tagsString || '')
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
}

export function mergeTaskTags(existingTags, nextTags = []) {
  const merged = new Set(parseTaskTagList(existingTags));
  for (const tag of nextTags) {
    const normalized = String(tag || '').trim().toLowerCase();
    if (normalized) merged.add(normalized);
  }
  return [...merged].join(', ');
}

export function resolveFlowKickoffAssignee(defaultAgentNpub, botNpub) {
  const preferred = String(defaultAgentNpub || '').trim();
  if (preferred) return preferred;
  const fallback = String(botNpub || '').trim();
  return fallback || null;
}

export function buildStoredFlowKickoffScopeAssignment(flow = null) {
  if (!flow || typeof flow !== 'object') {
    return {
      scope_id: null,
      scope_l1_id: null,
      scope_l2_id: null,
      scope_l3_id: null,
      scope_l4_id: null,
      scope_l5_id: null,
      scope_policy_group_ids: null,
      group_ids: [],
      shares: [],
      write_group_ref: null,
    };
  }

  const groupIds = Array.isArray(flow.group_ids)
    ? flow.group_ids.map((groupId) => String(groupId || '').trim()).filter(Boolean)
    : [];
  const shares = Array.isArray(flow.shares)
    ? cloneJsonValue(flow.shares, []).filter(Boolean)
    : [];
  const scopePolicyGroupIds = Array.isArray(flow.scope_policy_group_ids)
    ? flow.scope_policy_group_ids.map((groupId) => String(groupId || '').trim()).filter(Boolean)
    : null;

  return {
    scope_id: normalizeNullableId(flow.scope_id),
    scope_l1_id: normalizeNullableId(flow.scope_l1_id),
    scope_l2_id: normalizeNullableId(flow.scope_l2_id),
    scope_l3_id: normalizeNullableId(flow.scope_l3_id),
    scope_l4_id: normalizeNullableId(flow.scope_l4_id),
    scope_l5_id: normalizeNullableId(flow.scope_l5_id),
    scope_policy_group_ids: scopePolicyGroupIds,
    group_ids: groupIds,
    shares,
    write_group_ref: normalizeNullableId(flow.board_group_id || groupIds[0] || null),
  };
}

export function buildFlowKickoffTaskRecord({
  taskId,
  ownerNpub,
  flow,
  description = '',
  createdAt = new Date().toISOString(),
  assignedToNpub = null,
  scopeAssignment = null,
  title = null,
} = {}) {
  const firstStepTitle = flow?.steps?.[0]?.title || '';
  const flowReferencePatch = buildAttachFlowPatch(flow?.record_id || null, []);
  const normalizedScopeAssignment = scopeAssignment || buildStoredFlowKickoffScopeAssignment(flow);

  return {
    record_id: taskId,
    owner_npub: ownerNpub,
    title: String(title || flow?.title || firstStepTitle || 'Untitled flow').trim() || 'Untitled flow',
    description: String(description || ''),
    state: 'new',
    priority: 'rock',
    parent_task_id: null,
    assigned_to_npub: assignedToNpub,
    tags: mergeTaskTags('', ['flow_kickoff']),
    predecessor_task_ids: null,
    ...flowReferencePatch,
    flow_step: null,
    source_links: flow?.record_id ? [{ type: 'flow', id: flow.record_id }] : [],
    deliverable_links: [],
    scope_id: normalizeNullableId(normalizedScopeAssignment.scope_id),
    scope_l1_id: normalizeNullableId(normalizedScopeAssignment.scope_l1_id),
    scope_l2_id: normalizeNullableId(normalizedScopeAssignment.scope_l2_id),
    scope_l3_id: normalizeNullableId(normalizedScopeAssignment.scope_l3_id),
    scope_l4_id: normalizeNullableId(normalizedScopeAssignment.scope_l4_id),
    scope_l5_id: normalizeNullableId(normalizedScopeAssignment.scope_l5_id),
    scope_policy_group_ids: cloneJsonValue(normalizedScopeAssignment.scope_policy_group_ids, null),
    board_group_id: normalizeNullableId(normalizedScopeAssignment.write_group_ref),
    shares: cloneJsonValue(normalizedScopeAssignment.shares, []),
    group_ids: cloneJsonValue(normalizedScopeAssignment.group_ids, []),
    sync_status: 'pending',
    record_state: 'active',
    version: 1,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

export function hasTaskTag(task, tag) {
  const normalizedTag = String(tag || '').trim().toLowerCase();
  if (!normalizedTag) return false;
  return parseTaskTagList(task?.tags).includes(normalizedTag);
}

export function isActiveFlowParentTask(task, subtasks = []) {
  if (!task?.flow_run_id || task?.parent_task_id || task?.record_state === 'deleted') {
    return false;
  }
  if (hasTaskTag(task, 'flow_parent')) return true;
  return Array.isArray(subtasks) && subtasks.some((subtask) =>
    subtask?.record_state !== 'deleted'
    && subtask?.parent_task_id === task.record_id
    && subtask?.flow_run_id === task.flow_run_id
  );
}

export function buildFlowKickoffDescription(flowDescription, runContext) {
  const desc = String(flowDescription || '').trim();
  const ctx = String(runContext || '').trim();

  if (!ctx) return desc;
  if (!desc) return ctx;

  return `${desc}\n\n---\n**Run context:** ${ctx}`;
}

/**
 * Merge optional user-provided run context into the first step's description.
 *
 * Used by startFlowRun to allow users to supply run-specific notes before
 * execution begins.
 */
export function buildFirstStepDescription(stepDescription, runContext) {
  const desc = (stepDescription || '').trim();
  const ctx = (runContext || '').trim();

  if (!ctx) return desc;
  if (!desc) return ctx;

  return `${desc}\n\n---\n**Run context:** ${ctx}`;
}
