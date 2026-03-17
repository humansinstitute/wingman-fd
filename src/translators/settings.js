import { APP_NPUB, recordFamilyNamespace } from '../app-identity.js';
import { buildGroupPayloads, decryptRecordPayload, encryptOwnerPayload } from './record-crypto.js';
import { buildWriteGroupFields } from './group-refs.js';

export function recordFamilyHash(collectionSpace) {
  return `${recordFamilyNamespace()}:${collectionSpace}`;
}

export function normalizeHarnessUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';

  try {
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    const parsed = new URL(candidate);
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export async function inboundWorkspaceSettings(record) {
  const payload = await decryptRecordPayload(record);
  const data = payload.data ?? payload;
  const workspaceOwnerNpub = String(data.workspace_owner_npub || record.owner_npub || '').trim();

  return {
    workspace_owner_npub: workspaceOwnerNpub,
    record_id: record.record_id,
    owner_npub: record.owner_npub,
    wingman_harness_url: normalizeHarnessUrl(data.wingman_harness_url),
    group_ids: (record.group_payloads || []).map((groupPayload) => groupPayload.group_id || groupPayload.group_npub),
    sync_status: 'synced',
    record_state: data.record_state ?? 'active',
    version: record.version ?? 1,
    updated_at: record.updated_at ?? new Date().toISOString(),
  };
}

export async function outboundWorkspaceSettings({
  record_id,
  owner_npub,
  workspace_owner_npub = owner_npub,
  wingman_harness_url = '',
  group_ids = [],
  version = 1,
  previous_version = 0,
  signature_npub = owner_npub,
  write_group_npub = null,
  record_state = 'active',
}) {
  const innerPayload = {
    app_namespace: APP_NPUB,
    collection_space: 'settings',
    schema_version: 1,
    record_id,
    data: {
      workspace_owner_npub,
      wingman_harness_url: normalizeHarnessUrl(wingman_harness_url),
      record_state,
    },
  };

  return {
    record_id,
    owner_npub,
    record_family_hash: recordFamilyHash('settings'),
    version,
    previous_version,
    signature_npub,
    ...buildWriteGroupFields(write_group_npub),
    owner_payload: await encryptOwnerPayload(owner_npub, innerPayload),
    group_payloads: await buildGroupPayloads(group_ids || [], innerPayload),
  };
}
