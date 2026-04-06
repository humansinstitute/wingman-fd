import { APP_NPUB, recordFamilyNamespace } from '../app-identity.js';
import { buildGroupPayloads, decryptRecordPayload, encryptOwnerPayload } from './record-crypto.js';
import { buildWriteGroupFields, buildGroupRefMap, normalizeGroupRef, extractGroupIds, normalizeShareGroupRefs } from './group-refs.js';

export function recordFamilyHash(collectionSpace) {
  return `${recordFamilyNamespace()}:${collectionSpace}`;
}

// --- inbound ---

export async function inboundTask(record) {
  const payload = await decryptRecordPayload(record);
  const data = payload.data ?? payload;
  const gp = record.group_payloads || [];
  const groupRefMap = buildGroupRefMap(gp);

  return {
    record_id:      record.record_id,
    owner_npub:     record.owner_npub,
    title:          data.title ?? '',
    description:    data.description ?? '',
    state:          data.state ?? 'new',
    priority:       data.priority ?? 'sand',
    parent_task_id: data.parent_task_id ?? null,
    board_group_id: normalizeGroupRef(data.board_group_id, groupRefMap),
    assigned_to_npub: data.assigned_to_npub ?? null,
    scheduled_for:  data.scheduled_for ?? null,
    tags:           data.tags ?? '',
    scope_id:       data.scope_id ?? null,
    scope_l1_id: data.scope_l1_id ?? null,
    scope_l2_id: data.scope_l2_id ?? null,
    scope_l3_id: data.scope_l3_id ?? null,
    scope_l4_id: data.scope_l4_id ?? null,
    scope_l5_id: data.scope_l5_id ?? null,
    scope_policy_group_ids: Array.isArray(data.scope_policy_group_ids) ? data.scope_policy_group_ids : null,
    predecessor_task_ids: Array.isArray(data.predecessor_task_ids) ? data.predecessor_task_ids : (data.predecessor_task_ids === undefined ? null : data.predecessor_task_ids),
    flow_id:        data.flow_id ?? null,
    flow_run_id:    data.flow_run_id ?? null,
    flow_step:      data.flow_step ?? null,
    references:     Array.isArray(data.references) ? data.references : [],
    shares:         normalizeShareGroupRefs(data.shares, gp),
    group_ids:      extractGroupIds(gp),
    sync_status:    'synced',
    record_state:   data.record_state ?? 'active',
    version:        record.version ?? 1,
    created_at:     record.created_at ?? record.updated_at ?? new Date().toISOString(),
    updated_at:     record.updated_at ?? new Date().toISOString(),
  };
}

// --- outbound ---

export async function outboundTask({
  record_id,
  owner_npub,
  title,
  description = '',
  state = 'new',
  priority = 'sand',
  parent_task_id = null,
  board_group_id = null,
  assigned_to_npub = null,
  scheduled_for = null,
  tags = '',
  predecessor_task_ids = null,
  flow_id = null,
  flow_run_id = null,
  flow_step = null,
  scope_id = null,
  scope_l1_id = null,
  scope_l2_id = null,
  scope_l3_id = null,
  scope_l4_id = null,
  scope_l5_id = null,
  scope_policy_group_ids = null,
  references = [],
  shares = [],
  group_ids = [],
  version = 1,
  previous_version = 0,
  signature_npub = owner_npub,
  write_group_ref = null,
  record_state = 'active',
}) {
  const innerPayload = {
    app_namespace: APP_NPUB,
    collection_space: 'task',
    schema_version: 1,
    record_id,
    data: {
      title,
      description,
      state,
      priority,
      parent_task_id,
      board_group_id,
      assigned_to_npub,
      scheduled_for,
      tags,
      predecessor_task_ids,
      flow_id,
      flow_run_id,
      flow_step,
      scope_id,
      scope_l1_id,
      scope_l2_id,
      scope_l3_id,
      scope_l4_id,
      scope_l5_id,
      scope_policy_group_ids,
      references,
      shares,
      record_state,
    },
  };

  return {
    record_id,
    owner_npub,
    record_family_hash: recordFamilyHash('task'),
    version,
    previous_version,
    signature_npub,
    ...buildWriteGroupFields(write_group_ref),
    owner_payload: await encryptOwnerPayload(owner_npub, innerPayload),
    group_payloads: await buildGroupPayloads(group_ids || [], innerPayload),
  };
}

// --- helpers ---

const STATE_ORDER = { new: 0, ready: 1, in_progress: 2, review: 3, done: 4 };

export function computeParentState(subtasks) {
  if (!subtasks || subtasks.length === 0) return 'new';
  let minOrder = 4;
  for (const st of subtasks) {
    const state = st.state === 'archive' ? 'done' : st.state;
    const order = STATE_ORDER[state] ?? 0;
    if (order < minOrder) minOrder = order;
  }
  const match = Object.entries(STATE_ORDER).find(([, v]) => v === minOrder);
  return match ? match[0] : 'new';
}

export function stateColor(state) {
  const colors = {
    new: '#9ca3af',
    ready: '#f87171',
    in_progress: '#a78bfa',
    review: '#fbbf24',
    done: '#34d399',
    archive: '#34d399',
  };
  return colors[state] || '#9ca3af';
}

export function formatStateLabel(state) {
  if (!state) return '';
  if (state === 'in_progress') return 'In Progress';
  if (state === 'review') return 'Review';
  if (state === 'archive') return 'Archived';
  return state.charAt(0).toUpperCase() + state.slice(1);
}

export function parseTags(tagsString) {
  if (!tagsString) return [];
  return tagsString.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
}

const MENTION_TOKEN_RE = /@\[.*?\]\(mention:(\w+):([^)]+)\)/g;

export function parseReferencesFromDescription(description) {
  if (!description) return [];
  const seen = new Set();
  const refs = [];
  let match;
  const re = new RegExp(MENTION_TOKEN_RE.source, 'g');
  while ((match = re.exec(description)) !== null) {
    const type = match[1];
    const id = match[2];
    if (type === 'person') continue;
    const key = `${type}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ type, id });
  }
  return refs;
}

// --- flow reference linkage ---

const RUN_FLOW_RE = /^run\s+flow:\s*(.+)/i;

export function parseFlowReferenceFromText(text) {
  if (!text) return null;
  const firstLine = text.split('\n')[0];
  const match = RUN_FLOW_RE.exec(firstLine.trim());
  if (!match) return null;
  const flowTitle = match[1].trim();
  if (!flowTitle) return null;
  return { flowTitle };
}

export function resolveFlowLinkage({ title, description, references, flows }) {
  const refs = [...(references || [])];
  const titleParsed = parseFlowReferenceFromText(title);
  const isRunIntent = !!titleParsed;

  // Try to resolve flow_id from title "Run Flow: X" pattern
  let resolvedFlowId = null;
  if (titleParsed && Array.isArray(flows)) {
    const match = flows.find(
      (f) => f.title && f.title.toLowerCase() === titleParsed.flowTitle.toLowerCase()
    );
    if (match) {
      resolvedFlowId = match.record_id;
      // Add reference if not already present
      const alreadyReferenced = refs.some(
        (r) => r.type === 'flow' && r.id === match.record_id
      );
      if (!alreadyReferenced) {
        refs.push({ type: 'flow', id: match.record_id });
      }
    }
  }

  // Fall back: resolve flow_id from existing references of type=flow
  if (!resolvedFlowId) {
    const flowRef = refs.find((r) => r.type === 'flow');
    if (flowRef && Array.isArray(flows)) {
      const match = flows.find((f) => f.record_id === flowRef.id);
      if (match) resolvedFlowId = match.record_id;
    }
  }

  return {
    flow_id: resolvedFlowId,
    // Only generate run context when the task title explicitly initiates a flow run
    flow_run_id: resolvedFlowId && isRunIntent ? crypto.randomUUID() : null,
    flow_step: resolvedFlowId && isRunIntent ? 1 : null,
    references: resolvedFlowId ? refs : references || [],
  };
}
