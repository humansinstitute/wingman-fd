import { APP_NPUB, recordFamilyNamespace } from '../app-identity.js';
import { buildGroupPayloads, decryptRecordPayload, encryptOwnerPayload } from './record-crypto.js';
import { buildWriteGroupFields, looksLikeUuid } from './group-refs.js';

export function recordFamilyHash(collectionSpace) {
  return `${recordFamilyNamespace()}:${collectionSpace}`;
}

function normalizeDays(value) {
  if (Array.isArray(value)) return value.map((day) => String(day || '').trim().toLowerCase()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((day) => day.trim().toLowerCase()).filter(Boolean);
  return [];
}

export async function inboundSchedule(record) {
  const payload = await decryptRecordPayload(record);
  const data = payload.data ?? payload;
  const groupIds = (record.group_payloads || []).map((gp) => gp.group_id || gp.group_npub).filter(Boolean);

  return {
    record_id: record.record_id,
    owner_npub: record.owner_npub,
    title: data.title ?? '',
    description: data.description ?? '',
    time_start: data.time_start ?? '',
    time_end: data.time_end ?? '',
    days: normalizeDays(data.days ?? data.days_json),
    timezone: data.timezone ?? 'Australia/Perth',
    assigned_group_id: data.assigned_group_id ?? data.assigned_to_npub ?? null,
    active: data.active !== false && data.active !== 0,
    last_run: data.last_run ?? null,
    repeat: data.repeat ?? 'daily',
    shares: Array.isArray(data.shares) ? data.shares : [],
    group_ids: groupIds,
    sync_status: 'synced',
    record_state: data.record_state ?? 'active',
    version: record.version ?? 1,
    created_at: record.created_at ?? record.updated_at ?? new Date().toISOString(),
    updated_at: record.updated_at ?? new Date().toISOString(),
  };
}

export async function outboundSchedule({
  record_id,
  owner_npub,
  title,
  description = '',
  time_start = '',
  time_end = '',
  days = [],
  timezone = 'Australia/Perth',
  assigned_group_id = null,
  active = true,
  last_run = null,
  repeat = 'daily',
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
    collection_space: 'schedule',
    schema_version: 1,
    record_id,
    data: {
      title,
      description,
      time_start,
      time_end,
      days: normalizeDays(days),
      timezone,
      assigned_group_id,
      active: active !== false,
      last_run,
      repeat,
      shares,
      record_state,
    },
  };

  return {
    record_id,
    owner_npub,
    record_family_hash: recordFamilyHash('schedule'),
    version,
    previous_version,
    signature_npub,
    ...buildWriteGroupFields(write_group_ref),
    owner_payload: await encryptOwnerPayload(owner_npub, innerPayload),
    group_payloads: await buildGroupPayloads(group_ids || [], innerPayload),
  };
}
