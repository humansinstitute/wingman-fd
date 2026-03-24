import { APP_NPUB, recordFamilyNamespace } from '../app-identity.js';
import { buildGroupPayloads, decryptRecordPayload, encryptOwnerPayload } from './record-crypto.js';
import { buildWriteGroupFields } from './group-refs.js';

export function recordFamilyHash(collectionSpace) {
  return `${recordFamilyNamespace()}:${collectionSpace}`;
}

function buildGroupRefMap(groupPayloads = []) {
  const map = new Map();
  for (const payload of groupPayloads || []) {
    const stableId = payload?.group_id || payload?.group_npub || null;
    if (!stableId) continue;
    if (payload?.group_npub) map.set(payload.group_npub, stableId);
    if (payload?.group_id) map.set(payload.group_id, payload.group_id);
  }
  return map;
}

function normalizeGroupRef(groupRef, groupRefMap) {
  const value = String(groupRef || '').trim();
  if (!value) return null;
  return groupRefMap.get(value) || value;
}

function normalizeShares(dataShares = [], groupPayloads = []) {
  const groupRefMap = buildGroupRefMap(groupPayloads);

  if (!Array.isArray(dataShares) || dataShares.length === 0) return [];

  return dataShares.map((share) => {
    const type = share?.type === 'person' ? 'person' : 'group';
    const groupRef = normalizeGroupRef(share?.group_id || share?.group_npub, groupRefMap);
    const viaGroupRef = normalizeGroupRef(share?.via_group_id || share?.via_group_npub, groupRefMap);
    const key = share?.key
      ?? (type === 'person' ? share?.person_npub : groupRef);

    return {
      type,
      key,
      access: share?.access === 'write' ? 'write' : 'read',
      label: share?.label ?? '',
      person_npub: share?.person_npub ?? null,
      group_npub: groupRef,
      via_group_npub: viaGroupRef,
      inherited: share?.inherited === true,
      inherited_from_directory_id: share?.inherited_from_directory_id ?? null,
    };
  });
}

// --- inbound ---

export async function inboundTask(record) {
  const payload = await decryptRecordPayload(record);
  const data = payload.data ?? payload;
  const groupRefMap = buildGroupRefMap(record.group_payloads || []);
  const groupIds = (record.group_payloads || []).map((gp) => gp.group_id || gp.group_npub);

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
    scope_product_id: data.scope_product_id ?? null,
    scope_project_id: data.scope_project_id ?? null,
    scope_deliverable_id: data.scope_deliverable_id ?? null,
    references:     Array.isArray(data.references) ? data.references : [],
    shares:         normalizeShares(data.shares, record.group_payloads || []),
    group_ids:      groupIds,
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
  scope_id = null,
  scope_product_id = null,
  scope_project_id = null,
  scope_deliverable_id = null,
  references = [],
  shares = [],
  group_ids = [],
  version = 1,
  previous_version = 0,
  signature_npub = owner_npub,
  write_group_npub = null,
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
      scope_id,
      scope_product_id,
      scope_project_id,
      scope_deliverable_id,
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
    ...buildWriteGroupFields(write_group_npub),
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
