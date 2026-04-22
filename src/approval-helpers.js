// approval-helpers.js — rendering helpers for the approval detail modal

const ARTIFACT_TYPE_ALIASES = {
  doc: 'document',
  docs: 'document',
  task_ref: 'task',
  doc_ref: 'document',
};

export function normalizeArtifactType(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  const suffix = raw.includes(':') ? raw.split(':').pop() : raw;
  return ARTIFACT_TYPE_ALIASES[suffix] || suffix;
}

export function normalizeArtifactRef(ref) {
  const source = ref && typeof ref === 'object'
    ? ref
    : { record_id: String(ref || '').trim() };
  const recordId = String(
    source.record_id
    ?? source.recordId
    ?? source.id
    ?? source.ref_id
    ?? source.target_record_id
    ?? ''
  ).trim();
  const recordFamilyHash = String(
    source.record_family_hash
    ?? source.recordFamilyHash
    ?? source.family_hash
    ?? source.record_family
    ?? source.family
    ?? ''
  ).trim();
  const type = normalizeArtifactType(
    source.type
    ?? source.record_type
    ?? source.recordType
    ?? source.family_type
    ?? source.familyType
    ?? recordFamilyHash
  ) || 'unknown';
  const fallbackTitle = String(source.title ?? source.label ?? source.name ?? '').trim() || null;
  const artifactKey = String(
    source.artifact_key
    ?? source.key
    ?? `${type}:${recordId || recordFamilyHash || fallbackTitle || 'unknown'}`
  ).trim();

  return {
    ...source,
    record_id: recordId,
    record_family_hash: recordFamilyHash,
    type,
    title: fallbackTitle,
    artifact_key: artifactKey,
  };
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
  const normalized = normalizeArtifactRef(ref);
  const task = normalized.record_id
    ? (tasks || []).find((candidate) => candidate.record_id === normalized.record_id)
    : null;
  const doc = normalized.record_id
    ? (documents || []).find((candidate) => candidate.record_id === normalized.record_id)
    : null;

  if (normalized.type === 'task' && task) {
    return { ...normalized, type: 'task', title: task.title || normalized.title, resolved: true };
  }
  if (normalized.type === 'document' && doc) {
    return { ...normalized, type: 'document', title: doc.title || normalized.title, resolved: true };
  }
  if (task) {
    return { ...normalized, type: 'task', title: task.title || normalized.title, resolved: true };
  }
  if (doc) {
    return { ...normalized, type: 'document', title: doc.title || normalized.title, resolved: true };
  }
  return { ...normalized, title: normalized.title || null, resolved: false };
}
