import { APP_NPUB, recordFamilyNamespace } from '../app-identity.js';
import { buildGroupPayloads, decryptRecordPayload, encryptOwnerPayload } from './record-crypto.js';

export function recordFamilyHash(collectionSpace) {
  return `${recordFamilyNamespace()}:${collectionSpace}`;
}

// --- inbound ---

export async function inboundTask(record) {
  const payload = await decryptRecordPayload(record);
  const data = payload.data ?? payload;
  const groupIds = (record.group_payloads || []).map(gp => gp.group_npub);

  return {
    record_id:      record.record_id,
    owner_npub:     record.owner_npub,
    title:          data.title ?? '',
    description:    data.description ?? '',
    state:          data.state ?? 'new',
    priority:       data.priority ?? 'sand',
    parent_task_id: data.parent_task_id ?? null,
    board_group_id: data.board_group_id ?? null,
    scheduled_for:  data.scheduled_for ?? null,
    tags:           data.tags ?? '',
    scope_id:       data.scope_id ?? null,
    scope_product_id: data.scope_product_id ?? null,
    scope_project_id: data.scope_project_id ?? null,
    scope_deliverable_id: data.scope_deliverable_id ?? null,
    shares:         data.shares ?? [],
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
  scheduled_for = null,
  tags = '',
  scope_id = null,
  scope_product_id = null,
  scope_project_id = null,
  scope_deliverable_id = null,
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
      scheduled_for,
      tags,
      scope_id,
      scope_product_id,
      scope_project_id,
      scope_deliverable_id,
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
    write_group_npub: write_group_npub || undefined,
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
