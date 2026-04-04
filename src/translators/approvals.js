import { APP_NPUB, recordFamilyNamespace } from '../app-identity.js';
import { buildGroupPayloads, decryptRecordPayload, encryptOwnerPayload } from './record-crypto.js';
import { buildWriteGroupFields, extractGroupIds, normalizeShareGroupRefs } from './group-refs.js';

export function recordFamilyHash(collectionSpace) {
  return `${recordFamilyNamespace()}:${collectionSpace}`;
}

// --- inbound ---

export async function inboundApproval(record) {
  const payload = await decryptRecordPayload(record);
  const data = payload.data ?? payload;
  const gp = record.group_payloads || [];

  return {
    record_id:          record.record_id,
    owner_npub:         record.owner_npub,
    title:              data.title ?? '',
    flow_id:            data.flow_id ?? null,
    flow_run_id:        data.flow_run_id ?? null,
    flow_step:          data.flow_step ?? null,
    task_ids:           Array.isArray(data.task_ids) ? data.task_ids : [],
    status:             data.status ?? 'pending',
    approval_mode:      data.approval_mode ?? 'manual',
    brief:              data.brief ?? '',
    confidence_score:   data.confidence_score ?? null,
    approved_by:        data.approved_by ?? null,
    approved_at:        data.approved_at ?? null,
    decision_note:      data.decision_note ?? null,
    agent_review_by:    data.agent_review_by ?? null,
    agent_review_note:  data.agent_review_note ?? null,
    artifact_refs:      Array.isArray(data.artifact_refs) ? data.artifact_refs : [],
    revision_task_id:   data.revision_task_id ?? null,
    scope_id:           data.scope_id ?? null,
    scope_l1_id:        data.scope_l1_id ?? null,
    scope_l2_id:        data.scope_l2_id ?? null,
    scope_l3_id:        data.scope_l3_id ?? null,
    scope_l4_id:        data.scope_l4_id ?? null,
    scope_l5_id:        data.scope_l5_id ?? null,
    shares:             normalizeShareGroupRefs(data.shares, gp),
    group_ids:          extractGroupIds(gp),
    sync_status:        'synced',
    record_state:       data.record_state ?? 'active',
    version:            record.version ?? 1,
    created_at:         record.created_at ?? record.updated_at ?? new Date().toISOString(),
    updated_at:         record.updated_at ?? new Date().toISOString(),
  };
}

// --- outbound ---

export async function outboundApproval({
  record_id,
  owner_npub,
  title,
  flow_id = null,
  flow_run_id = null,
  flow_step = null,
  task_ids = [],
  status = 'pending',
  approval_mode = 'manual',
  brief = '',
  confidence_score = null,
  approved_by = null,
  approved_at = null,
  decision_note = null,
  agent_review_by = null,
  agent_review_note = null,
  artifact_refs = [],
  revision_task_id = null,
  scope_id = null,
  scope_l1_id = null,
  scope_l2_id = null,
  scope_l3_id = null,
  scope_l4_id = null,
  scope_l5_id = null,
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
    collection_space: 'approval',
    schema_version: 1,
    record_id,
    data: {
      title,
      flow_id,
      flow_run_id,
      flow_step,
      task_ids,
      status,
      approval_mode,
      brief,
      confidence_score,
      approved_by,
      approved_at,
      decision_note,
      agent_review_by,
      agent_review_note,
      artifact_refs,
      revision_task_id,
      scope_id,
      scope_l1_id,
      scope_l2_id,
      scope_l3_id,
      scope_l4_id,
      scope_l5_id,
      shares,
      record_state,
    },
  };

  return {
    record_id,
    owner_npub,
    record_family_hash: recordFamilyHash('approval'),
    version,
    previous_version,
    signature_npub,
    ...buildWriteGroupFields(write_group_ref),
    owner_payload: await encryptOwnerPayload(owner_npub, innerPayload),
    group_payloads: await buildGroupPayloads(group_ids || [], innerPayload),
  };
}
