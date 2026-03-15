import { APP_NPUB, recordFamilyNamespace } from '../app-identity.js';
import { buildGroupPayloads, decryptRecordPayload, encryptOwnerPayload } from './record-crypto.js';

export function recordFamilyHash(collectionSpace) {
  return `${recordFamilyNamespace()}:${collectionSpace}`;
}

// --- inbound ---

export async function inboundComment(record) {
  const payload = await decryptRecordPayload(record);
  const data = payload.data ?? payload;

  return {
    record_id:                record.record_id,
    owner_npub:               record.owner_npub,
    target_record_id:         data.target_record_id ?? null,
    target_record_family_hash: data.target_record_family_hash ?? null,
    parent_comment_id:        data.parent_comment_id ?? null,
    anchor_line_number:       Number.isFinite(Number(data.anchor_line_number)) ? Number(data.anchor_line_number) : null,
    comment_status:           data.comment_status === 'resolved' ? 'resolved' : 'open',
    body:                     data.body ?? '',
    attachments:              Array.isArray(data.attachments) ? data.attachments : [],
    sender_npub:              record.signature_npub ?? record.owner_npub,
    record_state:             data.record_state ?? 'active',
    version:                  record.version ?? 1,
    created_at:               record.created_at ?? record.updated_at ?? new Date().toISOString(),
    updated_at:               record.updated_at ?? new Date().toISOString(),
  };
}

// --- outbound ---

export async function outboundComment({
  record_id,
  owner_npub,
  target_record_id,
  target_record_family_hash,
  parent_comment_id = null,
  anchor_line_number = null,
  comment_status = 'open',
  body,
  attachments = [],
  target_group_ids = [],
  version = 1,
  previous_version = 0,
  signature_npub = owner_npub,
  write_group_npub = null,
  record_state = 'active',
}) {
  const innerPayload = {
    app_namespace: APP_NPUB,
    collection_space: 'comment',
    schema_version: 1,
    record_id,
    data: {
      target_record_id,
      target_record_family_hash,
      parent_comment_id,
      anchor_line_number,
      comment_status,
      body,
      attachments,
      record_state,
    },
  };

  return {
    record_id,
    owner_npub,
    record_family_hash: recordFamilyHash('comment'),
    version,
    previous_version,
    signature_npub,
    write_group_npub: write_group_npub || undefined,
    owner_payload: await encryptOwnerPayload(owner_npub, innerPayload),
    group_payloads: await buildGroupPayloads(target_group_ids || [], innerPayload),
  };
}
