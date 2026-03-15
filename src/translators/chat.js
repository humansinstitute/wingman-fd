import { APP_NPUB, recordFamilyNamespace } from '../app-identity.js';
import { buildGroupPayloads, decryptRecordPayload, encryptOwnerPayload } from './record-crypto.js';

/**
 * Chat translators — convert between V4 record envelopes and local Dexie rows.
 *
 * Encryption/decryption is stubbed — the ciphertext fields currently carry
 * plaintext JSON.  When real NIP-44 or group-key encryption lands, only these
 * two helpers need to change.
 */

// --- helpers ---

export function recordFamilyHash(collectionSpace) {
  return `${recordFamilyNamespace()}:${collectionSpace}`;
}

// --- inbound ---

/**
 * Turn a raw V4 record envelope into a local `channels` row.
 */
export async function inboundChannel(record) {
  const payload = await decryptRecordPayload(record);
  const data = payload.data ?? payload;
  const groupIds = (record.group_payloads || []).map(gp => gp.group_npub);
  const participantNpubs = Array.isArray(data.participant_npubs)
    ? data.participant_npubs
    : [record.owner_npub];

  return {
    record_id:        record.record_id,
    owner_npub:       record.owner_npub,
    title:            data.title ?? '',
    group_ids:        groupIds,
    participant_npubs: participantNpubs,
    scope_id:         data.scope_id ?? null,
    scope_product_id: data.scope_product_id ?? null,
    scope_project_id: data.scope_project_id ?? null,
    scope_deliverable_id: data.scope_deliverable_id ?? null,
    record_state:     data.record_state ?? 'active',
    version:          record.version ?? 1,
    updated_at:       record.updated_at ?? new Date().toISOString(),
  };
}

/**
 * Turn a raw V4 record envelope into a local `chat_messages` row.
 */
export async function inboundChatMessage(record) {
  const payload = await decryptRecordPayload(record);
  const data = payload.data ?? payload;

  return {
    record_id:        record.record_id,
    channel_id:       data.channel_id,
    parent_message_id: data.parent_message_id ?? null,
    body:             data.body ?? '',
    attachments:      Array.isArray(data.attachments) ? data.attachments : [],
    sender_npub:      record.signature_npub ?? record.owner_npub,
    sync_status:      'synced',
    record_state:     data.record_state ?? 'active',
    version:          record.version ?? 1,
    updated_at:       record.updated_at ?? new Date().toISOString(),
  };
}

// --- outbound ---

/**
 * Build a V4 record envelope for a new chat message.
 *
 * The channel's group_ids are copied into group_payloads so the backend
 * can fan the message out to all group members.
 */
export async function outboundChatMessage({
  record_id,
  owner_npub,
  channel_id,
  parent_message_id,
  body,
  attachments = [],
  channel_group_ids,
  write_group_npub = null,
  version = 1,
  previous_version = 0,
  signature_npub = owner_npub,
  record_state = 'active',
}) {
  const innerPayload = {
    app_namespace: APP_NPUB,
    collection_space: 'chat_message',
    schema_version: 1,
    record_id,
    data: {
      channel_id,
      parent_message_id: parent_message_id ?? null,
      body,
      attachments,
      record_state,
    },
  };

  return {
    record_id,
    owner_npub,
    record_family_hash: recordFamilyHash('chat_message'),
    version,
    previous_version,
    signature_npub: signature_npub,
    write_group_npub: write_group_npub || undefined,
    owner_payload: await encryptOwnerPayload(owner_npub, innerPayload),
    group_payloads: await buildGroupPayloads(channel_group_ids || [], innerPayload),
  };
}

/**
 * Build a V4 record envelope for a new channel.
 */
export async function outboundChannel({
  record_id,
  owner_npub,
  title,
  group_ids,
  participant_npubs = [],
  scope_id = null,
  scope_product_id = null,
  scope_project_id = null,
  scope_deliverable_id = null,
  version = 1,
  previous_version = 0,
  signature_npub = owner_npub,
  write_group_npub = null,
  record_state = 'active',
}) {
  const innerPayload = {
    app_namespace: APP_NPUB,
    collection_space: 'channel',
    schema_version: 1,
    record_id,
    data: {
      title,
      participant_npubs,
      scope_id,
      scope_product_id,
      scope_project_id,
      scope_deliverable_id,
      record_state,
    },
  };

  return {
    record_id,
    owner_npub,
    record_family_hash: recordFamilyHash('channel'),
    version,
    previous_version,
    signature_npub,
    write_group_npub: write_group_npub || undefined,
    owner_payload: await encryptOwnerPayload(owner_npub, innerPayload),
    group_payloads: await buildGroupPayloads(group_ids || [], innerPayload),
  };
}
