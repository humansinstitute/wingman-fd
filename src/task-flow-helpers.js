/**
 * Task ↔ Flow UX helpers.
 *
 * Pure functions — no Alpine `this` dependency — so they can be unit-tested
 * and consumed by both the Alpine store and tests.
 */

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
    isActiveRun: !!task.flow_run_id,
    flowRunId: task.flow_run_id ?? null,
    flowStep: task.flow_step ?? null,
  };
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
