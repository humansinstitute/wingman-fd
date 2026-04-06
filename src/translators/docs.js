import { recordFamilyHash } from './chat.js';
import { APP_NPUB } from '../app-identity.js';
import { buildGroupPayloads as buildEncryptedGroupPayloads, decryptRecordPayload, encryptOwnerPayload } from './record-crypto.js';
import { buildWriteGroupFields, extractGroupIds, normalizeShareGroupRefs } from './group-refs.js';

async function buildGroupPayloads(payload, shares = []) {
  const byGroup = new Map();

  for (const share of shares) {
    const groupNpub = share.type === 'person'
      ? (share.via_group_npub || share.group_npub)
      : share.group_npub;
    if (!groupNpub) continue;

    const existing = byGroup.get(groupNpub);
    const canWrite = share.access === 'write' || existing?.write === true;
    byGroup.set(groupNpub, canWrite);
  }

  return buildEncryptedGroupPayloads([...byGroup.keys()], payload, byGroup);
}

export async function inboundDirectory(record) {
  const payload = await decryptRecordPayload(record);
  const data = payload.data ?? payload;

  return {
    record_id: record.record_id,
    owner_npub: record.owner_npub,
    title: data.title ?? 'Untitled directory',
    parent_directory_id: data.parent_directory_id ?? null,
    scope_id: data.scope_id ?? null,
    scope_l1_id: data.scope_l1_id ?? null,
    scope_l2_id: data.scope_l2_id ?? null,
    scope_l3_id: data.scope_l3_id ?? null,
    scope_l4_id: data.scope_l4_id ?? null,
    scope_l5_id: data.scope_l5_id ?? null,
    scope_policy_group_ids: Array.isArray(data.scope_policy_group_ids) ? data.scope_policy_group_ids : null,
    shares: normalizeShareGroupRefs(data.shares, record.group_payloads || []),
    group_ids: extractGroupIds(record.group_payloads || []),
    sync_status: 'synced',
    record_state: data.record_state ?? 'active',
    version: record.version ?? 1,
    updated_at: record.updated_at ?? new Date().toISOString(),
  };
}

export async function outboundDirectory({
  record_id,
  owner_npub,
  title,
  parent_directory_id = null,
  scope_id = null,
  scope_l1_id = null,
  scope_l2_id = null,
  scope_l3_id = null,
  scope_l4_id = null,
  scope_l5_id = null,
  scope_policy_group_ids = null,
  shares = [],
  version = 1,
  previous_version = 0,
  signature_npub = owner_npub,
  write_group_ref = null,
  record_state = 'active',
}) {
  const innerPayload = {
    app_namespace: APP_NPUB,
    collection_space: 'directory',
    schema_version: 1,
    record_id,
    data: {
      title,
      parent_directory_id,
      scope_id,
      scope_l1_id,
      scope_l2_id,
      scope_l3_id,
      scope_l4_id,
      scope_l5_id,
      scope_policy_group_ids,
      shares,
      record_state,
    },
  };

  return {
    record_id,
    owner_npub,
    record_family_hash: recordFamilyHash('directory'),
    version,
    previous_version,
    signature_npub,
    ...buildWriteGroupFields(write_group_ref),
    owner_payload: await encryptOwnerPayload(owner_npub, innerPayload),
    group_payloads: await buildGroupPayloads(innerPayload, shares),
  };
}

export async function inboundDocument(record) {
  const payload = await decryptRecordPayload(record);
  const data = payload.data ?? payload;

  return {
    record_id: record.record_id,
    owner_npub: record.owner_npub,
    title: data.title ?? 'Untitled document',
    content: data.content ?? '',
    parent_directory_id: data.parent_directory_id ?? null,
    scope_id: data.scope_id ?? null,
    scope_l1_id: data.scope_l1_id ?? null,
    scope_l2_id: data.scope_l2_id ?? null,
    scope_l3_id: data.scope_l3_id ?? null,
    scope_l4_id: data.scope_l4_id ?? null,
    scope_l5_id: data.scope_l5_id ?? null,
    scope_policy_group_ids: Array.isArray(data.scope_policy_group_ids) ? data.scope_policy_group_ids : null,
    shares: normalizeShareGroupRefs(data.shares, record.group_payloads || []),
    group_ids: extractGroupIds(record.group_payloads || []),
    sync_status: 'synced',
    record_state: data.record_state ?? 'active',
    version: record.version ?? 1,
    updated_at: record.updated_at ?? new Date().toISOString(),
  };
}

export async function outboundDocument({
  record_id,
  owner_npub,
  title,
  content,
  parent_directory_id = null,
  scope_id = null,
  scope_l1_id = null,
  scope_l2_id = null,
  scope_l3_id = null,
  scope_l4_id = null,
  scope_l5_id = null,
  scope_policy_group_ids = null,
  shares = [],
  version = 1,
  previous_version = 0,
  signature_npub = owner_npub,
  write_group_ref = null,
  record_state = 'active',
}) {
  const innerPayload = {
    app_namespace: APP_NPUB,
    collection_space: 'document',
    schema_version: 1,
    record_id,
    data: {
      title,
      content,
      parent_directory_id,
      scope_id,
      scope_l1_id,
      scope_l2_id,
      scope_l3_id,
      scope_l4_id,
      scope_l5_id,
      scope_policy_group_ids,
      shares,
      record_state,
    },
  };

  return {
    record_id,
    owner_npub,
    record_family_hash: recordFamilyHash('document'),
    version,
    previous_version,
    signature_npub,
    ...buildWriteGroupFields(write_group_ref),
    owner_payload: await encryptOwnerPayload(owner_npub, innerPayload),
    group_payloads: await buildGroupPayloads(innerPayload, shares),
  };
}
