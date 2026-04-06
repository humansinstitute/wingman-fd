// approval-helpers.js — rendering helpers for the approval detail modal

/**
 * Resolve an artifact_ref to a typed object with a human-readable title.
 *
 * @param {{record_id: string, record_family_hash: string}} ref
 * @param {Array} tasks
 * @param {Array} documents
 * @returns {{record_id: string, record_family_hash: string, type: string, title: string|null, resolved: boolean}}
 */
export function resolveArtifactRef(ref, tasks, documents) {
  const familyType = (ref.record_family_hash || '').split(':').pop();

  if (familyType === 'task') {
    const task = (tasks || []).find((t) => t.record_id === ref.record_id);
    return { ...ref, type: 'task', title: task?.title || null, resolved: !!task };
  }
  if (familyType === 'document') {
    const doc = (documents || []).find((d) => d.record_id === ref.record_id);
    return { ...ref, type: 'document', title: doc?.title || null, resolved: !!doc };
  }
  return { ...ref, type: familyType || 'unknown', title: null, resolved: false };
}
