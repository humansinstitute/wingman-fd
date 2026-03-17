import { recordFamilyHash } from './chat.js';
import { APP_NPUB } from '../app-identity.js';
import { buildGroupPayloads as buildEncryptedGroupPayloads, decryptRecordPayload, encryptOwnerPayload } from './record-crypto.js';
import { buildWriteGroupFields } from './group-refs.js';

function normalizeShares(dataShares = [], groupPayloads = []) {
  if (Array.isArray(dataShares) && dataShares.length > 0) {
    return dataShares.map((share) => ({
      type: share.type === 'person' ? 'person' : 'group',
      key: share.key ?? (share.type === 'person' ? share.person_npub : (share.group_id || share.group_npub)),
      access: share.access === 'write' ? 'write' : 'read',
      label: share.label ?? '',
      person_npub: share.person_npub ?? null,
      group_npub: share.group_id ?? share.group_npub ?? null,
      via_group_npub: share.via_group_id ?? share.via_group_npub ?? null,
      inherited: share.inherited === true,
      inherited_from_directory_id: share.inherited_from_directory_id ?? null,
    }));
  }

  return groupPayloads.map((payload) => ({
    type: 'group',
    key: payload.group_id || payload.group_npub,
    access: payload.write ? 'write' : 'read',
    label: '',
    person_npub: null,
    group_npub: payload.group_id || payload.group_npub,
    via_group_npub: null,
    inherited: false,
    inherited_from_directory_id: null,
  }));
}

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
    shares: normalizeShares(data.shares, record.group_payloads || []),
    group_ids: (record.group_payloads || []).map((payload) => payload.group_id || payload.group_npub),
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
  shares = [],
  version = 1,
  previous_version = 0,
  signature_npub = owner_npub,
  write_group_npub = null,
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
    ...buildWriteGroupFields(write_group_npub),
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
    scope_product_id: data.scope_product_id ?? null,
    scope_project_id: data.scope_project_id ?? null,
    scope_deliverable_id: data.scope_deliverable_id ?? null,
    shares: normalizeShares(data.shares, record.group_payloads || []),
    group_ids: (record.group_payloads || []).map((payload) => payload.group_id || payload.group_npub),
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
  scope_product_id = null,
  scope_project_id = null,
  scope_deliverable_id = null,
  shares = [],
  version = 1,
  previous_version = 0,
  signature_npub = owner_npub,
  write_group_npub = null,
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
    record_family_hash: recordFamilyHash('document'),
    version,
    previous_version,
    signature_npub,
    ...buildWriteGroupFields(write_group_npub),
    owner_payload: await encryptOwnerPayload(owner_npub, innerPayload),
    group_payloads: await buildGroupPayloads(innerPayload, shares),
  };
}
