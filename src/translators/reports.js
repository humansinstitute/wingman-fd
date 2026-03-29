import { APP_NPUB, recordFamilyNamespace } from '../app-identity.js';
import { buildGroupPayloads, decryptRecordPayload, encryptOwnerPayload } from './record-crypto.js';
import { buildWriteGroupFields } from './group-refs.js';

export function recordFamilyHash(collectionSpace) {
  return `${recordFamilyNamespace()}:${collectionSpace}`;
}

function normalizeScope(scope = {}) {
  const nextScope = scope && typeof scope === 'object' && !Array.isArray(scope) ? scope : {};
  return {
    id: nextScope.id ?? null,
    level: nextScope.level ?? null,
    l1_id: nextScope.l1_id ?? null,
    l2_id: nextScope.l2_id ?? null,
    l3_id: nextScope.l3_id ?? null,
    l4_id: nextScope.l4_id ?? null,
    l5_id: nextScope.l5_id ?? null,
  };
}

function normalizeMetadata(metadata = {}, recordState = 'active') {
  const nextMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
  return {
    title: String(nextMetadata.title || '').trim(),
    generated_at: nextMetadata.generated_at ?? null,
    record_state: nextMetadata.record_state ?? recordState,
    surface: nextMetadata.surface ?? null,
    scope: normalizeScope(nextMetadata.scope),
  };
}

function normalizePayloadObject(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  return payload;
}

export async function inboundReport(record) {
  const payload = await decryptRecordPayload(record);
  const metadata = normalizeMetadata(payload.metadata, 'active');
  const declaration = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? payload.data
    : {};
  const groupIds = (record.group_payloads || []).map((gp) => gp.group_id || gp.group_npub).filter(Boolean);

  return {
    record_id: record.record_id,
    owner_npub: record.owner_npub,
    title: metadata.title || '',
    surface: metadata.surface ?? null,
    generated_at: metadata.generated_at ?? record.updated_at ?? new Date().toISOString(),
    metadata,
    declaration_type: declaration.declaration_type ?? 'text',
    payload: normalizePayloadObject(declaration.payload),
    scope_id: metadata.scope.id ?? null,
    scope_level: metadata.scope.level ?? null,
    scope_l1_id: metadata.scope.l1_id ?? null,
    scope_l2_id: metadata.scope.l2_id ?? null,
    scope_l3_id: metadata.scope.l3_id ?? null,
    scope_l4_id: metadata.scope.l4_id ?? null,
    scope_l5_id: metadata.scope.l5_id ?? null,
    group_ids: groupIds,
    sync_status: 'synced',
    record_state: metadata.record_state ?? 'active',
    version: record.version ?? 1,
    created_at: record.created_at ?? record.updated_at ?? new Date().toISOString(),
    updated_at: record.updated_at ?? new Date().toISOString(),
  };
}

export async function outboundReport({
  record_id,
  owner_npub,
  metadata = {},
  data = {},
  title = '',
  generated_at = null,
  surface = null,
  scope = null,
  declaration_type = 'text',
  payload = {},
  group_ids = [],
  version = 1,
  previous_version = 0,
  signature_npub = owner_npub,
  write_group_npub = null,
  record_state = 'active',
}) {
  const nextMetadata = normalizeMetadata({
    ...metadata,
    title: metadata?.title ?? title,
    generated_at: metadata?.generated_at ?? generated_at,
    surface: metadata?.surface ?? surface,
    scope: metadata?.scope ?? scope,
    record_state: metadata?.record_state ?? record_state,
  }, record_state);

  const nextData = {
    declaration_type: data?.declaration_type ?? declaration_type,
    payload: normalizePayloadObject(data?.payload ?? payload),
  };

  const innerPayload = {
    app_namespace: APP_NPUB,
    collection_space: 'report',
    schema_version: 1,
    record_id,
    metadata: nextMetadata,
    data: nextData,
  };

  return {
    record_id,
    owner_npub,
    record_family_hash: recordFamilyHash('report'),
    version,
    previous_version,
    signature_npub,
    ...buildWriteGroupFields(write_group_npub),
    owner_payload: await encryptOwnerPayload(owner_npub, innerPayload),
    group_payloads: await buildGroupPayloads(group_ids || [], innerPayload),
  };
}
