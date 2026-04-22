import { APP_NPUB, recordFamilyNamespace } from '../app-identity.js';
import { buildGroupPayloads, decryptRecordPayload, encryptOwnerPayload } from './record-crypto.js';
import { buildWriteGroupFields, extractGroupIds } from './group-refs.js';

function clean(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

export function recordFamilyHash(collectionSpace) {
  return `${recordFamilyNamespace()}:${collectionSpace}`;
}

export async function inboundAgentChatTrigger(record) {
  const payload = await decryptRecordPayload(record);
  const data = payload.data ?? payload;
  const workspaceOwnerNpub = clean(data.workspace_owner_npub) || clean(record.owner_npub) || '';

  return {
    workspace_owner_npub: workspaceOwnerNpub,
    record_id: clean(record.record_id) || '',
    owner_npub: clean(record.owner_npub) || '',
    type: clean(data.type) || 'agent_chat_trigger_v1',
    enabled: data.enabled !== false,
    scope: clean(data.scope) || 'workspace',
    target_group_id: clean(data.target_group_id),
    target_group_npub: clean(data.target_group_npub),
    group_ids: extractGroupIds(record.group_payloads),
    sync_status: 'synced',
    record_state: clean(data.record_state) || 'active',
    version: Number(record.version || 1),
    updated_at: clean(data.updated_at) || clean(record.updated_at) || new Date().toISOString(),
  };
}

export async function outboundAgentChatTrigger({
  record_id,
  owner_npub,
  workspace_owner_npub = owner_npub,
  enabled = true,
  scope = 'workspace',
  target_group_id = null,
  target_group_npub = null,
  group_ids = [],
  version = 1,
  previous_version = 0,
  signature_npub = owner_npub,
  write_group_ref = null,
  record_state = 'active',
  updated_at = new Date().toISOString(),
}) {
  const innerPayload = {
    app_namespace: APP_NPUB,
    collection_space: 'agent_chat_trigger',
    schema_version: 1,
    record_id,
    data: {
      workspace_owner_npub,
      type: 'agent_chat_trigger_v1',
      enabled: enabled !== false,
      scope: clean(scope) || 'workspace',
      target_group_id: clean(target_group_id),
      target_group_npub: clean(target_group_npub),
      updated_at,
      record_state,
    },
  };

  return {
    record_id,
    owner_npub,
    record_family_hash: recordFamilyHash('agent_chat_trigger'),
    version,
    previous_version,
    signature_npub,
    ...buildWriteGroupFields(write_group_ref),
    owner_payload: await encryptOwnerPayload(owner_npub, innerPayload),
    group_payloads: await buildGroupPayloads(group_ids || [], innerPayload),
  };
}
