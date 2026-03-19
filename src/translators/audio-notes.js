import { APP_NPUB, recordFamilyNamespace } from '../app-identity.js';
import { buildGroupPayloads, decryptRecordPayload, encryptOwnerPayload } from './record-crypto.js';
import { buildWriteGroupFields } from './group-refs.js';

export function recordFamilyHash(collectionSpace) {
  return `${recordFamilyNamespace()}:${collectionSpace}`;
}

export async function inboundAudioNote(record) {
  const payload = await decryptRecordPayload(record);
  const data = payload.data ?? payload;
  const groupIds = (record.group_payloads || []).map((gp) => gp.group_id || gp.group_npub);

  return {
    record_id: record.record_id,
    owner_npub: record.owner_npub,
    target_record_id: data.target_record_id ?? null,
    target_record_family_hash: data.target_record_family_hash ?? null,
    title: data.title ?? 'Voice note',
    storage_object_id: data.storage_object_id ?? null,
    mime_type: data.mime_type ?? 'audio/webm;codecs=opus',
    duration_seconds: Number.isFinite(Number(data.duration_seconds)) ? Number(data.duration_seconds) : null,
    size_bytes: Number.isFinite(Number(data.size_bytes)) ? Number(data.size_bytes) : 0,
    media_encryption: data.media_encryption ?? null,
    waveform_preview: Array.isArray(data.waveform_preview) ? data.waveform_preview : [],
    transcript_status: data.transcript_status ?? 'pending',
    transcript_preview: data.transcript_preview ?? null,
    transcript: data.transcript ?? null,
    summary: data.summary ?? null,
    sender_npub: record.signature_npub ?? record.owner_npub,
    group_ids: groupIds,
    sync_status: 'synced',
    record_state: data.record_state ?? 'active',
    version: record.version ?? 1,
    created_at: record.created_at ?? record.updated_at ?? new Date().toISOString(),
    updated_at: record.updated_at ?? new Date().toISOString(),
  };
}

export async function outboundAudioNote({
  record_id,
  owner_npub,
  target_record_id = null,
  target_record_family_hash = null,
  title = 'Voice note',
  storage_object_id,
  mime_type = 'audio/webm;codecs=opus',
  duration_seconds = null,
  size_bytes = 0,
  media_encryption = null,
  waveform_preview = [],
  transcript_status = 'pending',
  transcript_preview = null,
  transcript = null,
  summary = null,
  target_group_ids = [],
  version = 1,
  previous_version = 0,
  signature_npub = owner_npub,
  write_group_npub = null,
  record_state = 'active',
}) {
  const innerPayload = {
    app_namespace: APP_NPUB,
    collection_space: 'audio_note',
    schema_version: 1,
    record_id,
    data: {
      target_record_id,
      target_record_family_hash,
      title,
      storage_object_id,
      mime_type,
      duration_seconds,
      size_bytes,
      media_encryption,
      waveform_preview,
      transcript_status,
      transcript_preview,
      transcript,
      summary,
      record_state,
    },
  };

  return {
    record_id,
    owner_npub,
    record_family_hash: recordFamilyHash('audio_note'),
    version,
    previous_version,
    signature_npub,
    ...buildWriteGroupFields(write_group_npub),
    owner_payload: await encryptOwnerPayload(owner_npub, innerPayload),
    group_payloads: await buildGroupPayloads(target_group_ids || [], innerPayload),
  };
}
