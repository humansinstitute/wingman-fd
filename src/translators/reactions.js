import { APP_NPUB, recordFamilyNamespace } from '../app-identity.js';
import { buildGroupPayloads, decryptRecordPayload, encryptOwnerPayload } from './record-crypto.js';
import { buildWriteGroupFields } from './group-refs.js';
import {
  REACTION_COLLECTION_SPACE,
  getReactionShortcode,
  isSupportedReactionEmoji,
} from '../reactions.js';

export function recordFamilyHash(collectionSpace) {
  return `${recordFamilyNamespace()}:${collectionSpace}`;
}

function assertSupportedTargetFamily(targetFamilyHash) {
  const family = String(targetFamilyHash || '').trim();
  if (!family.endsWith(':chat_message') && !family.endsWith(':comment')) {
    throw new Error(`Unsupported reaction target family: ${family || '(missing)'}`);
  }
  return family;
}

function assertSupportedEmoji(emoji) {
  const token = String(emoji || '').trim();
  if (!isSupportedReactionEmoji(token)) {
    throw new Error(`Unsupported reaction emoji: ${token || '(missing)'}`);
  }
  return token;
}

function requireTargetGroupIds(targetGroupIds) {
  const groupIds = [...new Set((targetGroupIds || [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))];
  if (groupIds.length === 0) {
    throw new Error('reaction target_group_ids are required');
  }
  return groupIds;
}

export async function inboundReaction(record) {
  const payload = await decryptRecordPayload(record);
  const data = payload.data ?? payload;
  const emoji = assertSupportedEmoji(data.emoji);

  return {
    record_id: record.record_id,
    owner_npub: record.owner_npub,
    target_record_id: String(data.target_record_id || '').trim() || null,
    target_record_family_hash: assertSupportedTargetFamily(data.target_record_family_hash),
    emoji,
    emoji_shortcode: data.emoji_shortcode || getReactionShortcode(emoji),
    reactor_npub: String(data.reactor_npub || record.signature_npub || record.owner_npub || '').trim() || null,
    sender_npub: record.signature_npub ?? record.owner_npub,
    record_state: data.record_state === 'deleted' ? 'deleted' : 'active',
    version: record.version ?? 1,
    created_at: record.created_at ?? record.updated_at ?? new Date().toISOString(),
    updated_at: record.updated_at ?? new Date().toISOString(),
  };
}

export async function outboundReaction({
  record_id,
  owner_npub,
  target_record_id,
  target_record_family_hash,
  emoji,
  reactor_npub,
  target_group_ids = [],
  version = 1,
  previous_version = 0,
  signature_npub = owner_npub,
  write_group_ref = null,
  record_state = 'active',
}) {
  const canonicalEmoji = assertSupportedEmoji(emoji);
  const targetFamilyHash = assertSupportedTargetFamily(target_record_family_hash);
  const reactorNpub = String(reactor_npub || signature_npub || owner_npub || '').trim();
  if (!reactorNpub) throw new Error('reaction reactor_npub is required');
  if (!String(target_record_id || '').trim()) throw new Error('reaction target_record_id is required');
  const groupIds = requireTargetGroupIds(target_group_ids);

  const innerPayload = {
    app_namespace: APP_NPUB,
    collection_space: REACTION_COLLECTION_SPACE,
    schema_version: 1,
    record_id,
    data: {
      target_record_id,
      target_record_family_hash: targetFamilyHash,
      emoji: canonicalEmoji,
      emoji_shortcode: getReactionShortcode(canonicalEmoji),
      reactor_npub: reactorNpub,
      record_state: record_state === 'deleted' ? 'deleted' : 'active',
    },
  };

  return {
    record_id,
    owner_npub,
    record_family_hash: recordFamilyHash(REACTION_COLLECTION_SPACE),
    version,
    previous_version,
    signature_npub,
    ...buildWriteGroupFields(write_group_ref),
    owner_payload: await encryptOwnerPayload(owner_npub, innerPayload),
    group_payloads: await buildGroupPayloads(groupIds, innerPayload),
  };
}
