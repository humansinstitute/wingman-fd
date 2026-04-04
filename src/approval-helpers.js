// approval-helpers.js — rendering helpers for the approval detail modal

/**
 * Escape HTML special characters to prevent XSS when using x-html.
 */
export function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// UUID v4 pattern (case-insensitive, word-bounded)
const UUID_RE = /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/gi;

/**
 * Render brief text as HTML with clickable links for any embedded UUIDs that
 * match known tasks or documents.
 *
 * @param {string} brief - raw brief text from the approval record
 * @param {Array} tasks - array of task objects with {record_id, title}
 * @param {Array} documents - array of document objects with {record_id, title}
 * @returns {string} safe HTML string
 */
export function renderBriefHtml(brief, tasks, documents) {
  if (!brief) return 'No brief provided.';

  const taskMap = new Map((tasks || []).map((t) => [t.record_id, t]));
  const docMap = new Map((documents || []).map((d) => [d.record_id, d]));

  const escaped = escapeHtml(brief);

  return escaped.replace(UUID_RE, (match, uuid) => {
    const task = taskMap.get(uuid);
    if (task) {
      const label = escapeHtml(task.title || uuid.slice(0, 12) + '...');
      return `<a href="#" class="approval-ref-link approval-ref-task" data-ref-type="task" data-ref-id="${uuid}">${label}</a>`;
    }
    const doc = docMap.get(uuid);
    if (doc) {
      const label = escapeHtml(doc.title || uuid.slice(0, 12) + '...');
      return `<a href="#" class="approval-ref-link approval-ref-doc" data-ref-type="doc" data-ref-id="${uuid}">${label}</a>`;
    }
    return match; // leave unresolved UUIDs as plain text
  });
}

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
