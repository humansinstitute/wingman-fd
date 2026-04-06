import { APP_NPUB, recordFamilyNamespace } from '../app-identity.js';
import { buildGroupPayloads, decryptRecordPayload, encryptOwnerPayload } from './record-crypto.js';
import { buildWriteGroupFields, buildGroupRefMap, extractGroupIds, normalizeShareGroupRefs } from './group-refs.js';

export function recordFamilyHash(collectionSpace) {
  return `${recordFamilyNamespace()}:${collectionSpace}`;
}

// --- inbound ---

export async function inboundOrganisation(record) {
  const payload = await decryptRecordPayload(record);
  const data = payload.data ?? payload;
  const gp = record.group_payloads || [];

  return {
    record_id:            record.record_id,
    owner_npub:           record.owner_npub,
    title:                data.title ?? '',
    description:          data.description ?? '',
    positioning:          data.positioning ?? '',
    contacts:             Array.isArray(data.contacts) ? data.contacts : [],
    person_links:         Array.isArray(data.person_links) ? data.person_links : [],
    augment_please:       data.augment_please ?? false,
    tags:                 data.tags ?? '',
    scope_id:             data.scope_id ?? null,
    scope_l1_id:          data.scope_l1_id ?? null,
    scope_l2_id:          data.scope_l2_id ?? null,
    scope_l3_id:          data.scope_l3_id ?? null,
    scope_l4_id:          data.scope_l4_id ?? null,
    scope_l5_id:          data.scope_l5_id ?? null,
    shares:               normalizeShareGroupRefs(data.shares, gp),
    group_ids:            extractGroupIds(gp),
    sync_status:          'synced',
    record_state:         data.record_state ?? 'active',
    version:              record.version ?? 1,
    created_at:           record.created_at ?? record.updated_at ?? new Date().toISOString(),
    updated_at:           record.updated_at ?? new Date().toISOString(),
  };
}

// --- outbound ---

export async function outboundOrganisation({
  record_id,
  owner_npub,
  title,
  description = '',
  positioning = '',
  contacts = [],
  person_links = [],
  augment_please = false,
  tags = '',
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
    collection_space: 'organisation',
    schema_version: 1,
    record_id,
    data: {
      title,
      description,
      positioning,
      contacts,
      person_links,
      augment_please,
      tags,
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
    record_family_hash: recordFamilyHash('organisation'),
    version,
    previous_version,
    signature_npub,
    ...buildWriteGroupFields(write_group_ref),
    owner_payload: await encryptOwnerPayload(owner_npub, innerPayload),
    group_payloads: await buildGroupPayloads(group_ids || [], innerPayload),
  };
}
