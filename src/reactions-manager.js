import {
  addPendingWrite,
  getChannelById,
  getCommentById,
  getDocumentById,
  getMessageById,
  getReactionByIdentity,
  getReactionsByTargets,
  getTaskById,
  upsertReaction,
} from './db.js';
import { outboundReaction } from './translators/reactions.js';
import { recordFamilyHash } from './translators/chat.js';
import {
  DEFAULT_REACTION_EMOJI,
  REACTION_EMOJI_OPTIONS,
  getReactionLabel,
  normalizeReactionEmoji,
  summarizeReactions,
} from './reactions.js';
import { getRecordWriteFieldsForStore } from './preferred-write-group.js';
import { toRaw } from './utils/state-helpers.js';

function targetKey(targetRecordFamilyHash, targetRecordId) {
  return `${String(targetRecordFamilyHash || '').trim()}::${String(targetRecordId || '').trim()}`;
}

function sameReactionList(left = [], right = []) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] || {};
    const b = right[index] || {};
    if ([
      'record_id',
      'target_record_id',
      'target_record_family_hash',
      'emoji',
      'reactor_npub',
      'record_state',
      'version',
      'updated_at',
    ].some((key) => String(a[key] ?? '') !== String(b[key] ?? ''))) return false;
  }
  return true;
}

function requireReactionTargetGroupIds(writeFields) {
  const rawGroupIds = toRaw(writeFields?.target_group_ids);
  const targetGroupIds = Array.isArray(rawGroupIds)
    ? [...new Set(rawGroupIds.map((value) => String(value || '').trim()).filter(Boolean))]
    : [];
  if (targetGroupIds.length === 0) {
    throw new Error('Reaction write is missing target group keys.');
  }
  return {
    ...writeFields,
    target_group_ids: targetGroupIds,
  };
}

export const reactionsManagerMixin = {
  get reactionEmojiOptions() {
    return REACTION_EMOJI_OPTIONS;
  },

  reactionTargetFamilyHash(collectionSpace) {
    return recordFamilyHash(collectionSpace);
  },

  reactionLabel(emoji) {
    return getReactionLabel(emoji);
  },

  reactionPickerKey(targetRecordFamilyHash, targetRecordId) {
    return targetKey(targetRecordFamilyHash, targetRecordId);
  },

  isReactionPickerOpen(targetRecordFamilyHash, targetRecordId) {
    return this.reactionPickerTargetKey === this.reactionPickerKey(targetRecordFamilyHash, targetRecordId);
  },

  toggleReactionPicker(targetRecordFamilyHash, targetRecordId) {
    const key = this.reactionPickerKey(targetRecordFamilyHash, targetRecordId);
    this.reactionPickerTargetKey = this.reactionPickerTargetKey === key ? '' : key;
  },

  closeReactionPicker() {
    this.reactionPickerTargetKey = '';
  },

  applyReactions(reactions = []) {
    const nextReactions = (Array.isArray(reactions) ? reactions : [])
      .slice()
      .sort((a, b) => String(a.updated_at || '').localeCompare(String(b.updated_at || '')));
    if (!sameReactionList(this.reactionRows, nextReactions)) {
      this.reactionRows = nextReactions;
    }

    const reactorNpubs = [...new Set(nextReactions
      .map((reaction) => reaction.reactor_npub || reaction.sender_npub)
      .filter(Boolean))];
    if (typeof this.resolveChatProfile === 'function') {
      reactorNpubs.forEach((npub) => this.resolveChatProfile(npub));
    }
  },

  patchReactionLocal(nextReaction) {
    const index = this.reactionRows.findIndex((reaction) => reaction.record_id === nextReaction.record_id);
    if (index >= 0) {
      this.reactionRows.splice(index, 1, { ...this.reactionRows[index], ...nextReaction });
      return;
    }
    this.reactionRows = [...this.reactionRows, nextReaction]
      .sort((a, b) => String(a.updated_at || '').localeCompare(String(b.updated_at || '')));
  },

  getReactionsForTarget(targetRecordId, targetRecordFamilyHash) {
    const targetId = String(targetRecordId || '').trim();
    const familyHash = String(targetRecordFamilyHash || '').trim();
    if (!targetId || !familyHash) return [];
    return this.reactionRows.filter((reaction) =>
      reaction.target_record_id === targetId
      && reaction.target_record_family_hash === familyHash
    );
  },

  getReactionSummary(targetRecordId, targetRecordFamilyHash) {
    return summarizeReactions(
      this.getReactionsForTarget(targetRecordId, targetRecordFamilyHash),
      this.session?.npub,
    );
  },

  async refreshReactionsForVisibleTargets() {
    const chatFamilyHash = recordFamilyHash('chat_message');
    const commentFamilyHash = recordFamilyHash('comment');
    const chatTargetIds = [...new Set((this.messages || [])
      .map((message) => message.record_id)
      .filter(Boolean))];
    const commentTargetIds = [...new Set([
      ...(this.taskComments || []).map((comment) => comment.record_id),
      ...(this.docComments || []).map((comment) => comment.record_id),
    ].filter(Boolean))];

    const [messageReactions, commentReactions] = await Promise.all([
      getReactionsByTargets(chatTargetIds, chatFamilyHash),
      getReactionsByTargets(commentTargetIds, commentFamilyHash),
    ]);
    this.applyReactions([...messageReactions, ...commentReactions]);
  },

  findLocalCommentForReaction(commentId) {
    const id = String(commentId || '').trim();
    if (!id) return null;
    return [
      ...(this.taskComments || []),
      ...(this.docComments || []),
      ...(this.opportunityComments || []),
    ].find((comment) => comment.record_id === id) || null;
  },

  async resolveReactionWriteFields(targetRecordId, targetRecordFamilyHash) {
    const targetId = String(targetRecordId || '').trim();
    const familyHash = String(targetRecordFamilyHash || '').trim();
    if (!targetId || !familyHash) throw new Error('Reaction target is missing.');

    if (familyHash.endsWith(':chat_message')) {
      const message = (this.messages || []).find((item) => item.record_id === targetId)
        || await getMessageById(targetId);
      if (!message?.channel_id) throw new Error('Reaction target message was not found.');
      const channel = (this.channels || []).find((item) => item.record_id === message.channel_id)
        || await getChannelById(message.channel_id);
      if (!channel) throw new Error('Reaction target channel was not found.');
      const fields = await getRecordWriteFieldsForStore(this, channel, {
        label: 'Chat reaction write',
      });
      return {
        owner_npub: channel.owner_npub || this.workspaceOwnerNpub || this.session?.npub,
        target_group_ids: fields.group_ids,
        write_group_ref: fields.write_group_ref,
      };
    }

    if (familyHash.endsWith(':comment')) {
      const comment = this.findLocalCommentForReaction(targetId) || await getCommentById(targetId);
      if (!comment) throw new Error('Reaction target comment was not found.');
      const commentTargetFamily = String(comment.target_record_family_hash || '').trim();

      if (commentTargetFamily.endsWith(':task')) {
        const task = (this.tasks || []).find((item) => item.record_id === comment.target_record_id)
          || await getTaskById(comment.target_record_id);
        if (!task) throw new Error('Reaction target task was not found.');
        const fields = await this.getTaskWriteFieldsForWrite(task);
        return {
          owner_npub: comment.owner_npub || task.owner_npub || this.workspaceOwnerNpub || this.session?.npub,
          target_group_ids: fields.group_ids,
          write_group_ref: fields.write_group_ref,
        };
      }

      if (commentTargetFamily.endsWith(':document')) {
        const doc = this.selectedDocument?.record_id === comment.target_record_id
          ? this.selectedDocument
          : ((this.documents || []).find((item) => item.record_id === comment.target_record_id)
            || await getDocumentById(comment.target_record_id));
        if (!doc) throw new Error('Reaction target document was not found.');
        const groupIds = await this.getEncryptableDocCommentGroupIdsForWrite(doc);
        if (groupIds == null) throw new Error(this.error || 'Document reaction write is missing group keys.');
        return {
          owner_npub: comment.owner_npub || doc.owner_npub || this.workspaceOwnerNpub || this.session?.npub,
          target_group_ids: toRaw(groupIds),
          write_group_ref: this.getPreferredDocWriteGroupRef(doc),
        };
      }
    }

    throw new Error('Unsupported reaction target.');
  },

  async toggleReaction(targetRecordId, targetRecordFamilyHash, emoji = DEFAULT_REACTION_EMOJI) {
    this.error = null;
    const targetId = String(targetRecordId || '').trim();
    const familyHash = String(targetRecordFamilyHash || '').trim();
    const reactorNpub = String(this.session?.npub || '').trim();
    if (!targetId || !familyHash || !reactorNpub) return;

    try {
      const canonicalEmoji = normalizeReactionEmoji(emoji);
      const writeFields = requireReactionTargetGroupIds(
        await this.resolveReactionWriteFields(targetId, familyHash),
      );
      const existing = await getReactionByIdentity({
        target_record_family_hash: familyHash,
        target_record_id: targetId,
        emoji: canonicalEmoji,
        reactor_npub: reactorNpub,
      });
      const previousVersion = Number(existing?.version ?? 0) || 0;
      const nextState = existing?.record_state === 'active' ? 'deleted' : 'active';
      const now = new Date().toISOString();
      const reaction = {
        record_id: existing?.record_id || crypto.randomUUID(),
        owner_npub: writeFields.owner_npub || this.workspaceOwnerNpub || reactorNpub,
        target_record_id: targetId,
        target_record_family_hash: familyHash,
        emoji: canonicalEmoji,
        emoji_shortcode: REACTION_EMOJI_OPTIONS.find((option) => option.emoji === canonicalEmoji)?.shortcode || ':thumbs_up:',
        reactor_npub: reactorNpub,
        sender_npub: this.signingNpub || reactorNpub,
        record_state: nextState,
        version: previousVersion + 1,
        created_at: existing?.created_at || now,
        updated_at: now,
      };

      await upsertReaction(reaction);
      this.patchReactionLocal(reaction);

      const envelope = await outboundReaction({
        ...reaction,
        previous_version: previousVersion,
        target_group_ids: writeFields.target_group_ids,
        write_group_ref: writeFields.write_group_ref,
        signature_npub: this.signingNpub,
      });
      await addPendingWrite({
        record_id: reaction.record_id,
        record_family_hash: envelope.record_family_hash,
        envelope,
      });
      this.closeReactionPicker();
      await this.flushAndBackgroundSync();
    } catch (error) {
      this.error = error?.message || 'Failed to update reaction.';
    }
  },
};
