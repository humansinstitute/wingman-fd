import { APP_NPUB, recordFamilyNamespace } from '../app-identity.js';
import { buildGroupPayloads, decryptRecordPayload, encryptOwnerPayload } from './record-crypto.js';
import { buildWriteGroupFields, extractGroupIds, normalizeShareGroupRefs } from './group-refs.js';

export const OPPORTUNITY_STAGE_OPTIONS = Object.freeze([
  'speculation',
  'outreach',
  'lead',
  'qualified',
  'proposal',
  'won',
  'lost',
  'abandoned',
]);

function normalizeLinkObjects(value, key) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const links = [];
  for (const item of value) {
    const normalized = item && typeof item === 'object'
      ? item
      : { [key]: String(item || '').trim() };
    const id = String(normalized?.[key] || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    links.push({
      ...normalized,
      [key]: id,
      primary: normalized?.primary === true,
    });
  }
  return links;
}

function normalizeStage(value) {
  const stage = String(value || '').trim().toLowerCase();
  return OPPORTUNITY_STAGE_OPTIONS.includes(stage) ? stage : 'speculation';
}

export function recordFamilyHash(collectionSpace) {
  return `${recordFamilyNamespace()}:${collectionSpace}`;
}

export async function inboundOpportunity(record) {
  const payload = await decryptRecordPayload(record);
  const data = payload.data ?? payload;
  const gp = record.group_payloads || [];

  return {
    record_id: record.record_id,
    owner_npub: record.owner_npub,
    title: data.title ?? '',
    description: data.description ?? '',
    stage: normalizeStage(data.stage),
    opportunity_type: data.opportunity_type ?? '',
    responsible_npub: data.responsible_npub ?? null,
    person_links: normalizeLinkObjects(data.person_links, 'person_id'),
    organisation_links: normalizeLinkObjects(data.organisation_links, 'organisation_id'),
    task_links: normalizeLinkObjects(data.task_links, 'task_id'),
    expected_value: Number.isFinite(Number(data.expected_value)) ? Number(data.expected_value) : null,
    currency: data.currency ?? '',
    expected_close_at: data.expected_close_at ?? null,
    source: data.source ?? '',
    origin_opportunity_id: data.origin_opportunity_id ?? null,
    scope_id: data.scope_id ?? null,
    scope_l1_id: data.scope_l1_id ?? null,
    scope_l2_id: data.scope_l2_id ?? null,
    scope_l3_id: data.scope_l3_id ?? null,
    scope_l4_id: data.scope_l4_id ?? null,
    scope_l5_id: data.scope_l5_id ?? null,
    shares: normalizeShareGroupRefs(data.shares, gp),
    group_ids: extractGroupIds(gp),
    sync_status: 'synced',
    record_state: data.record_state ?? 'active',
    version: record.version ?? 1,
    created_at: record.created_at ?? record.updated_at ?? new Date().toISOString(),
    updated_at: record.updated_at ?? new Date().toISOString(),
  };
}

export async function outboundOpportunity({
  record_id,
  owner_npub,
  title,
  description = '',
  stage = 'speculation',
  opportunity_type = '',
  responsible_npub = null,
  person_links = [],
  organisation_links = [],
  task_links = [],
  expected_value = null,
  currency = '',
  expected_close_at = null,
  source = '',
  origin_opportunity_id = null,
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
    collection_space: 'opportunity',
    schema_version: 1,
    record_id,
    data: {
      title,
      description,
      stage: normalizeStage(stage),
      opportunity_type,
      responsible_npub,
      person_links: normalizeLinkObjects(person_links, 'person_id'),
      organisation_links: normalizeLinkObjects(organisation_links, 'organisation_id'),
      task_links: normalizeLinkObjects(task_links, 'task_id'),
      expected_value: Number.isFinite(Number(expected_value)) ? Number(expected_value) : null,
      currency,
      expected_close_at,
      source,
      origin_opportunity_id,
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
    record_family_hash: recordFamilyHash('opportunity'),
    version,
    previous_version,
    signature_npub,
    ...buildWriteGroupFields(write_group_ref),
    owner_payload: await encryptOwnerPayload(owner_npub, innerPayload),
    group_payloads: await buildGroupPayloads(group_ids || [], innerPayload),
  };
}
