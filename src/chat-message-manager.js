/**
 * Chat message management methods extracted from app.js.
 *
 * The chatMessageManagerMixin object contains methods and getters that use `this`
 * (the Alpine store) and should be spread into the store definition via applyMixins.
 */

import {
  getMessagesByChannel,
  getMessageById,
  upsertMessage,
  upsertChannel,
  addPendingWrite,
  deleteChannelRuntimeState,
} from './db.js';
import { fetchRecordHistory } from './api.js';
import {
  outboundChatMessage,
  outboundChannel,
  recordFamilyHash,
} from './translators/chat.js';
import {
  rankMainFeedMessages,
  rankThreadReplies,
  resolveVisibleThreadReplyCount,
  sortMessagesByUpdatedAt,
} from './chat-order.js';
import {
  buildChatThreadFlowDispatchPreview,
  createChatThreadFlowDispatchState,
  getChatThreadFlowDispatchScopeSourceLabel,
  normalizeChatThreadFlowDispatchScopeAssignment,
  resolveChatThreadFlowDispatchScope,
  resolveChatThreadFlowDispatchThread,
} from './chat-thread-flow-dispatch.js';
import { buildStoredFlowKickoffScopeAssignment } from './task-flow-helpers.js';
import { UNSCOPED_TASK_BOARD_ID } from './task-board-state.js';
import { sameListBySignature } from './utils/state-helpers.js';
import { getRecordWriteFieldsForStore } from './preferred-write-group.js';

const chatDerivedCache = new WeakMap();

function scheduleUiNextTick(callback) {
  const nextTick = globalThis.Alpine?.nextTick;
  if (typeof nextTick === 'function') {
    nextTick(callback);
    return;
  }
  queueMicrotask(callback);
}

function getChatDerivedState(store) {
  const messages = Array.isArray(store?.messages) ? store.messages : [];
  const activeThreadId = store?.activeThreadId ?? null;
  const focusMessageId = store?.focusMessageId ?? null;
  const mainFeedVisibleCount = Math.max(
    0,
    Number(store?.mainFeedVisibleCount ?? store?.MAIN_FEED_PAGE_SIZE ?? 0) || 0,
  );
  const threadVisibleReplyCount = Math.max(0, Number(store?.threadVisibleReplyCount) || 0);

  const previous = chatDerivedCache.get(store);
  if (
    previous
    && previous.messages === messages
    && previous.activeThreadId === activeThreadId
    && previous.focusMessageId === focusMessageId
    && previous.mainFeedVisibleCount === mainFeedVisibleCount
    && previous.threadVisibleReplyCount === threadVisibleReplyCount
  ) {
    return previous.value;
  }

  const mainFeedMessages = rankMainFeedMessages(messages);
  const resolvedMainFeedVisibleCount = resolveVisibleThreadReplyCount(
    mainFeedMessages,
    mainFeedVisibleCount,
    focusMessageId,
  );
  const visibleMainFeedMessages = mainFeedMessages.slice(-resolvedMainFeedVisibleCount);
  const hiddenMainFeedCount = Math.max(0, mainFeedMessages.length - resolvedMainFeedVisibleCount);

  const threadMessages = activeThreadId ? rankThreadReplies(messages, activeThreadId) : [];
  const resolvedThreadVisibleReplyCount = resolveVisibleThreadReplyCount(
    threadMessages,
    threadVisibleReplyCount,
    focusMessageId,
  );
  const visibleThreadMessages = threadMessages.slice(-resolvedThreadVisibleReplyCount);
  const hiddenThreadReplyCount = Math.max(0, threadMessages.length - resolvedThreadVisibleReplyCount);

  const value = {
    mainFeedMessages,
    resolvedMainFeedVisibleCount,
    visibleMainFeedMessages,
    hiddenMainFeedCount,
    threadMessages,
    resolvedThreadVisibleReplyCount,
    visibleThreadMessages,
    hiddenThreadReplyCount,
  };

  chatDerivedCache.set(store, {
    messages,
    activeThreadId,
    focusMessageId,
    mainFeedVisibleCount,
    threadVisibleReplyCount,
    value,
  });

  return value;
}

// ---------------------------------------------------------------------------
// Mixin — methods and getters that use `this` (the Alpine store)
// ---------------------------------------------------------------------------

export const chatMessageManagerMixin = {

  // --- computed getters ---

  get selectedChannel() {
    return this.channels.find(c => c.record_id === this.selectedChannelId) ?? null;
  },

  get mainFeedMessages() {
    return getChatDerivedState(this).mainFeedMessages;
  },

  get resolvedMainFeedVisibleCount() {
    return getChatDerivedState(this).resolvedMainFeedVisibleCount;
  },

  get visibleMainFeedMessages() {
    return getChatDerivedState(this).visibleMainFeedMessages;
  },

  get hiddenMainFeedCount() {
    return getChatDerivedState(this).hiddenMainFeedCount;
  },

  get hasMoreMainFeedMessages() {
    return this.hiddenMainFeedCount > 0;
  },

  get showMainFeedLoadMoreControl() {
    return this.hasMoreMainFeedMessages;
  },

  get threadMessages() {
    return getChatDerivedState(this).threadMessages;
  },

  get resolvedThreadVisibleReplyCount() {
    return getChatDerivedState(this).resolvedThreadVisibleReplyCount;
  },

  get visibleThreadMessages() {
    return getChatDerivedState(this).visibleThreadMessages;
  },

  get hiddenThreadReplyCount() {
    return getChatDerivedState(this).hiddenThreadReplyCount;
  },

  get hasMoreThreadMessages() {
    return this.hiddenThreadReplyCount > 0;
  },

  get chatThreadFlowDispatchSelectedFlow() {
    return this.flows.find((flow) => flow.record_id === this.chatThreadFlowDispatchSelectedFlowId) ?? null;
  },

  get chatThreadFlowDispatchSourceChannel() {
    const channelId = this.chatThreadFlowDispatchSource?.channelId || null;
    return this.channels.find((channel) => channel.record_id === channelId) ?? null;
  },

  get chatThreadFlowDispatchResolvedScopeLabel() {
    if (!this.chatThreadFlowDispatchResolvedScopeId) return 'No scope';
    return this.getTaskBoardOptionLabel(this.chatThreadFlowDispatchResolvedScopeId) || this.chatThreadFlowDispatchResolvedScopeId;
  },

  get chatThreadFlowDispatchScopeSourceLabel() {
    return getChatThreadFlowDispatchScopeSourceLabel(this.chatThreadFlowDispatchScopeSource);
  },

  get chatThreadFlowDispatchCanSubmit() {
    if (this.chatThreadFlowDispatchLoading || this.chatThreadFlowDispatchSubmitting) return false;
    if (!this.chatThreadFlowDispatchSelectedFlowId) return false;
    if (!this.chatThreadFlowDispatchSource?.channelId) return false;
    if (this.chatThreadFlowDispatchMessages.length === 0) return false;
    return String(this.chatThreadFlowDispatchPreview || '').trim().length > 0;
  },

  // --- scroll anchoring ---

  scheduleChatFeedScrollToBottom(retries = 3) {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    scheduleUiNextTick(() => {
      if (this.chatFeedScrollFrame) window.cancelAnimationFrame(this.chatFeedScrollFrame);
      this.chatFeedScrollFrame = window.requestAnimationFrame(() => {
        this.chatFeedScrollFrame = null;
        const feed = document.querySelector('[data-chat-feed]');
        if (!feed) return;
        if (feed.scrollHeight <= feed.clientHeight && retries > 0) {
          this.scheduleChatFeedScrollToBottom(retries - 1);
          return;
        }
        feed.scrollTop = feed.scrollHeight;
        this.updateChatFeedLoadMoreVisibility(feed);
      });
    });
  },

  scheduleThreadRepliesScrollToBottom() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    scheduleUiNextTick(() => {
      if (this.threadRepliesScrollFrame) window.cancelAnimationFrame(this.threadRepliesScrollFrame);
      this.threadRepliesScrollFrame = window.requestAnimationFrame(() => {
        this.threadRepliesScrollFrame = null;
        const replies = document.querySelector('[data-thread-replies]');
        if (!replies) return;
        replies.scrollTop = replies.scrollHeight;
      });
    });
  },

  // --- composer autosize ---

  autosizeComposer(textarea) {
    if (!textarea || typeof window === 'undefined') return;
    const styles = window.getComputedStyle(textarea);
    const lineHeight = parseFloat(styles.lineHeight) || 20;
    const paddingY = (parseFloat(styles.paddingTop) || 0) + (parseFloat(styles.paddingBottom) || 0);
    const borderY = (parseFloat(styles.borderTopWidth) || 0) + (parseFloat(styles.borderBottomWidth) || 0);
    const minHeight = parseFloat(styles.minHeight) || ((lineHeight * 3) + paddingY + borderY);
    const maxHeight = (lineHeight * this.COMPOSER_MAX_LINES) + paddingY + borderY;

    textarea.style.height = 'auto';
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight);
    textarea.style.height = `${Math.max(nextHeight, 0)}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  },

  scheduleComposerAutosize(context) {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    scheduleUiNextTick(() => {
      const textarea = document.querySelector(`[data-chat-composer="${context}"]`);
      if (!textarea) return;
      this.autosizeComposer(textarea);
    });
  },

  updateChatFeedLoadMoreVisibility(feed) {
    const nextFeed = feed && typeof feed.scrollTop === 'number'
      ? feed
      : (typeof document !== 'undefined' ? document.querySelector('[data-chat-feed]') : null);
    if (!nextFeed) return;
    this.chatFeedNearTop = nextFeed.scrollTop <= 96;
  },

  // --- messages ---

  async applyMessages(messages = [], options = {}) {
    const nextMessages = sortMessagesByUpdatedAt(Array.isArray(messages) ? messages : []);
    const messagesChanged = !sameListBySignature(this.messages, nextMessages);
    const chatFeedAnchor = messagesChanged
      ? this.captureScrollAnchor({
        containerSelector: '[data-chat-feed]',
        itemSelector: '[data-message-id]',
        itemAttribute: 'data-message-id',
      })
      : null;
    const threadRepliesAnchor = messagesChanged
      ? this.captureScrollAnchor({
        containerSelector: '[data-thread-replies]',
        itemSelector: '[data-thread-message-id]',
        itemAttribute: 'data-thread-message-id',
      })
      : null;

    if (messagesChanged) {
      this.messages = nextMessages;
    }

    // Resolve sender profiles for display without writing back to Dexie.
    // rememberPeople writes to the address book which triggers reactive
    // cascades when called from a liveQuery handler.
    if (typeof this.resolveChatProfile === 'function') {
      const senderNpubs = [...new Set(nextMessages.map((m) => m.sender_npub).filter(Boolean))];
      for (const npub of senderNpubs) {
        this.resolveChatProfile(npub);
      }
    }

    if (
      this.activeThreadId
      && !nextMessages.some((message) => message.record_id === this.activeThreadId || message.parent_message_id === this.activeThreadId)
    ) {
      this.closeThread({ syncRoute: false });
    }

    this.syncChatPreviewState();
    this.scheduleChatPreviewMeasurement();
    this.scheduleStorageImageHydration();
    if (typeof this.refreshReactionsForVisibleTargets === 'function') {
      this.refreshReactionsForVisibleTargets().catch(() => {});
    }

    const shouldScrollChatToLatest = options.scrollToLatest === true || this.pendingChatScrollToLatest || chatFeedAnchor?.atBottom;
    const shouldScrollThreadToLatest = options.scrollThreadToLatest === true || this.pendingThreadScrollToLatest || threadRepliesAnchor?.atBottom;

    if (shouldScrollChatToLatest) this.scheduleChatFeedScrollToBottom();
    else if (chatFeedAnchor) {
      this.restoreScrollAnchor(chatFeedAnchor);
      this.updateChatFeedLoadMoreVisibility();
    }

    if (shouldScrollThreadToLatest) this.scheduleThreadRepliesScrollToBottom();
    else if (threadRepliesAnchor) this.restoreScrollAnchor(threadRepliesAnchor);

    this.pendingChatScrollToLatest = false;
    this.pendingThreadScrollToLatest = false;
  },

  async refreshMessages(options = {}) {
    if (!this.selectedChannelId) {
      await this.applyMessages([], { scrollToLatest: false });
      return;
    }
    await this.applyMessages(await getMessagesByChannel(this.selectedChannelId), options);
  },

  patchMessageLocal(nextMessage) {
    const index = this.messages.findIndex((item) => item.record_id === nextMessage.record_id);
    if (index >= 0) {
      this.messages.splice(index, 1, { ...this.messages[index], ...nextMessage });
      this.syncChatPreviewState();
      this.scheduleChatPreviewMeasurement();
      this.scheduleStorageImageHydration();
      return;
    }
    this.messages = sortMessagesByUpdatedAt([...this.messages, nextMessage]);
    this.syncChatPreviewState();
    this.scheduleChatPreviewMeasurement();
    this.scheduleStorageImageHydration();
  },

  async setMessageSyncStatus(recordId, syncStatus) {
    const message = this.messages.find((item) => item.record_id === recordId)
      ?? await getMessageById(recordId);
    if (!message) return;
    const updated = {
      ...message,
      sync_status: syncStatus,
    };
    await upsertMessage(updated);
    this.patchMessageLocal(updated);
  },

  // --- thread lifecycle ---

  openThread(recordId, options = {}) {
    this.activeThreadId = recordId;
    this.threadInput = '';
    this.threadVisibleReplyCount = this.THREAD_REPLY_PAGE_SIZE;
    this.pendingThreadScrollToLatest = options.scrollToLatest !== false;
    if (this.pendingThreadScrollToLatest) this.scheduleThreadRepliesScrollToBottom();
    if (options.syncRoute !== false) this.syncRoute();
  },

  cycleThreadSize() {
    this.threadSize =
      this.threadSize === 'default'
        ? 'wide'
        : this.threadSize === 'wide'
          ? 'full'
          : 'default';
  },

  closeThread(options = {}) {
    this.activeThreadId = null;
    this.threadInput = '';
    this.threadVisibleReplyCount = this.THREAD_REPLY_PAGE_SIZE;
    this.threadSize = 'default';
    this.pendingThreadScrollToLatest = false;
    if (options.syncRoute !== false) this.syncRoute();
  },

  showMoreThreadMessages() {
    const anchor = this.captureScrollAnchor({
      containerSelector: '[data-thread-replies]',
      itemSelector: '[data-thread-message-id]',
      itemAttribute: 'data-thread-message-id',
    });
    this.threadVisibleReplyCount += this.THREAD_REPLY_PAGE_SIZE;
    this.restoreScrollAnchor(anchor);
  },

  showMoreMainFeedMessages() {
    const anchor = this.captureScrollAnchor({
      containerSelector: '[data-chat-feed]',
      itemSelector: '[data-message-id]',
      itemAttribute: 'data-message-id',
    });
    this.mainFeedVisibleCount += this.MAIN_FEED_PAGE_SIZE;
    this.restoreScrollAnchor(anchor);
    this.updateChatFeedLoadMoreVisibility();
  },

  getThreadParentMessage() {
    if (!this.activeThreadId) return null;
    return this.messages.find(msg => msg.record_id === this.activeThreadId) ?? null;
  },

  getThreadReplyCount(recordId) {
    return this.messages.filter(msg => msg.parent_message_id === recordId).length;
  },

  // --- chat preview truncation ---

  isChatMessageExpanded(recordId) {
    return this.expandedChatMessageIds.includes(recordId);
  },

  isChatMessageTruncated(recordId) {
    return this.truncatedChatMessageIds.includes(recordId);
  },

  toggleChatMessageExpanded(recordId) {
    if (!recordId) return;
    if (this.isChatMessageExpanded(recordId)) {
      this.expandedChatMessageIds = this.expandedChatMessageIds.filter((id) => id !== recordId);
    } else {
      this.expandedChatMessageIds = [...this.expandedChatMessageIds, recordId];
    }
    this.scheduleChatPreviewMeasurement();
  },

  syncChatPreviewState() {
    const validIds = new Set(this.visibleMainFeedMessages.map((message) => message.record_id));
    this.expandedChatMessageIds = this.expandedChatMessageIds.filter((id) => validIds.has(id));
    this.truncatedChatMessageIds = this.truncatedChatMessageIds.filter((id) => validIds.has(id));
  },

  scheduleChatPreviewMeasurement() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    scheduleUiNextTick(() => {
      if (this.chatPreviewMeasureFrame) window.cancelAnimationFrame(this.chatPreviewMeasureFrame);
      this.chatPreviewMeasureFrame = window.requestAnimationFrame(() => {
        this.chatPreviewMeasureFrame = null;
        const previews = [...document.querySelectorAll('[data-chat-preview-id]')];
        const nextTruncatedIds = [];

        for (const preview of previews) {
          const recordId = String(preview.dataset.chatPreviewId || '').trim();
          if (!recordId) continue;
          const styles = window.getComputedStyle(preview);
          const lineHeight = parseFloat(styles.lineHeight);
          const maxLines = Number(preview.dataset.chatPreviewMaxLines || this.MESSAGE_PREVIEW_MAX_LINES);
          if (!Number.isFinite(lineHeight) || lineHeight <= 0 || !Number.isFinite(maxLines) || maxLines <= 0) continue;
          if ((preview.scrollHeight - (lineHeight * maxLines)) > 1) nextTruncatedIds.push(recordId);
        }

        this.truncatedChatMessageIds = [...new Set(nextTruncatedIds)];
      });
    });
  },

  // --- send / create / delete ---

  async createBotDm(targetNpubInput = null) {
    this.error = null;
    const ownerNpub = this.workspaceOwnerNpub;
    const memberNpub = this.session?.npub;
    const targetNpub = String(targetNpubInput || this.botNpub || '').trim();
    if (!ownerNpub || !memberNpub || !targetNpub) {
      this.error = 'Sign in and set bot npub first';
      return;
    }
    if (!this.backendUrl) {
      this.error = 'Set backend URL first';
      return;
    }

    try {
      const targetLabel = this.getSenderName?.(targetNpub) || 'bot';
      const name = `DM: ${memberNpub.slice(0, 12)}… + ${targetLabel}`;
      const group = await this.createEncryptedGroup(name, [targetNpub]);
      const groupId = group.group_id;
      await this.rememberPeople([memberNpub, targetNpub], 'chat');

      const channelId = crypto.randomUUID();
      const channelRow = {
        record_id: channelId,
        owner_npub: ownerNpub,
        title: name,
        group_ids: [groupId],
        participant_npubs: [memberNpub, targetNpub],
        record_state: 'active',
        version: 1,
        updated_at: new Date().toISOString(),
      };

      await upsertChannel(channelRow);

      const envelope = await outboundChannel({
        record_id: channelId,
        owner_npub: ownerNpub,
        title: name,
        group_ids: [groupId],
        participant_npubs: [memberNpub, targetNpub],
        record_state: 'active',
        signature_npub: this.signingNpub,
        write_group_ref: groupId,
      });

      await addPendingWrite({
        record_id: channelId,
        record_family_hash: recordFamilyHash('channel'),
        envelope,
      });

      await this.flushAndBackgroundSync();
      await this.selectChannel(channelId, { syncRoute: false });
    } catch (e) {
      this.error = e.message;
    }
  },

  async deleteSelectedChannel() {
    this.error = null;
    const channel = this.selectedChannel;
    if (!channel) {
      this.error = 'Select a channel first';
      return;
    }

    if (!this.channelDeleteConfirmArmed) {
      this.channelDeleteConfirmArmed = true;
      return;
    }

    try {
      const now = new Date().toISOString();
      const fallbackNextChannelId = this.channels.find((item) => item.record_id !== channel.record_id)?.record_id ?? null;
      const ownerNpub = channel.owner_npub || this.workspaceOwnerNpub;
      let latestTowerVersion = 0;
      this.showChannelSettingsModal = false;

      if (channel.record_id && ownerNpub && this.workspaceOwnerNpub && this.session?.npub && this.backendUrl) {
        const result = await fetchRecordHistory({
          record_id: channel.record_id,
          owner_npub: this.workspaceOwnerNpub,
          viewer_npub: this.session.npub,
        });
        latestTowerVersion = (Array.isArray(result?.versions) ? result.versions : []).reduce((latest, current) => {
          const version = Number(current?.version ?? 0) || 0;
          return version > latest ? version : latest;
        }, 0);
      }

      if (latestTowerVersion > 0) {
        const nextVersion = latestTowerVersion + 1;
        await upsertChannel({
          ...channel,
          record_state: 'deleted',
          version: nextVersion,
          updated_at: now,
        });

        const channelWriteFields = await getRecordWriteFieldsForStore(this, channel, {
          label: 'Channel write',
        });
        const envelope = await outboundChannel({
          record_id: channel.record_id,
          owner_npub: ownerNpub,
          title: channel.title,
          group_ids: channelWriteFields.group_ids,
          participant_npubs: channel.participant_npubs ?? [],
          version: nextVersion,
          previous_version: latestTowerVersion,
          record_state: 'deleted',
          signature_npub: this.signingNpub,
          write_group_ref: channelWriteFields.write_group_ref,
        });

        await addPendingWrite({
          record_id: channel.record_id,
          record_family_hash: recordFamilyHash('channel'),
          envelope,
        });
      } else {
        await deleteChannelRuntimeState(channel.record_id);
      }

      this.channels = this.channels.filter((item) => item.record_id !== channel.record_id);
      this.selectedChannelId = fallbackNextChannelId;
      this.closeThread();
      await this.refreshMessages({ scrollToLatest: true });

      if (latestTowerVersion > 0) {
        await this.flushAndBackgroundSync();
      }
      await this.refreshChannels();
      this.selectedChannelId = this.selectedChannelId ?? this.channels[0]?.record_id ?? null;
      await this.refreshMessages({ scrollToLatest: true });
      this.channelDeleteConfirmArmed = false;
    } catch (error) {
      this.channelDeleteConfirmArmed = false;
      this.error = error?.message || 'Failed to delete channel';
    }
  },

  async sendMessage() {
    this.error = null;
    const drafts = [...this.messageAudioDrafts];
    if (this.messageImageUploadCount > 0 || this.containsInlineImageUploadToken(this.messageInput)) {
      this.error = 'Wait for image upload to finish.';
      return;
    }
    if (!this.messageInput.trim() && drafts.length === 0) return;
    if (!this.selectedChannelId) {
      this.error = 'Select a channel first';
      return;
    }

    const channel = this.selectedChannel;
    if (!channel) {
      this.error = 'Channel not found';
      return;
    }

    const msgId = crypto.randomUUID();
    const now = new Date().toISOString();
    const body = this.messageInput.trim();
    const channelWriteFields = await getRecordWriteFieldsForStore(this, channel, {
      label: 'Chat message write',
    });
    const { attachments } = await this.materializeAudioDrafts({
      drafts,
      target_record_id: msgId,
      target_record_family_hash: recordFamilyHash('chat_message'),
      target_group_ids: channelWriteFields.group_ids,
      write_group_ref: channelWriteFields.write_group_ref,
    });

    const localRow = {
      record_id: msgId,
      channel_id: this.selectedChannelId,
      parent_message_id: null,
      body,
      attachments,
      sender_npub: this.session?.npub,
      sync_status: 'pending',
      record_state: 'active',
      version: 1,
      updated_at: now,
    };

    await upsertMessage(localRow);
    this.patchMessageLocal(localRow);
    this.scheduleChatFeedScrollToBottom();
    this.messageInput = '';
    this.messageAudioDrafts = [];
    this.scheduleComposerAutosize('message');

    try {
      const envelope = await outboundChatMessage({
        record_id: msgId,
        owner_npub: channel.owner_npub || this.workspaceOwnerNpub || this.session?.npub,
        channel_id: this.selectedChannelId,
        parent_message_id: null,
        body,
        attachments,
        channel_group_ids: channelWriteFields.group_ids,
        write_group_ref: channelWriteFields.write_group_ref,
        signature_npub: this.signingNpub,
      });

      await addPendingWrite({
        record_id: msgId,
        record_family_hash: recordFamilyHash('chat_message'),
        envelope,
      });

      this._fireMentionTriggers(body, `chat #${channel.label || channel.record_id}`, {
        channelId: this.selectedChannelId,
      });
      await this.flushAndBackgroundSync();
    } catch (error) {
      await this.setMessageSyncStatus(msgId, 'failed');
      this.error = error?.message || 'Failed to sync message';
    }
  },

  async sendThreadReply() {
    this.error = null;
    const drafts = [...this.threadAudioDrafts];
    if (this.threadImageUploadCount > 0 || this.containsInlineImageUploadToken(this.threadInput)) {
      this.error = 'Wait for image upload to finish.';
      return;
    }
    if (!this.threadInput.trim() && drafts.length === 0) return;
    if (!this.activeThreadId || !this.selectedChannelId) {
      this.error = 'Open a thread first';
      return;
    }

    const channel = this.selectedChannel;
    if (!channel) {
      this.error = 'Channel not found';
      return;
    }

    const msgId = crypto.randomUUID();
    const now = new Date().toISOString();
    const body = this.threadInput.trim();
    const channelWriteFields = await getRecordWriteFieldsForStore(this, channel, {
      label: 'Chat reply write',
    });
    const { attachments } = await this.materializeAudioDrafts({
      drafts,
      target_record_id: msgId,
      target_record_family_hash: recordFamilyHash('chat_message'),
      target_group_ids: channelWriteFields.group_ids,
      write_group_ref: channelWriteFields.write_group_ref,
    });

    const localRow = {
      record_id: msgId,
      channel_id: this.selectedChannelId,
      parent_message_id: this.activeThreadId,
      body,
      attachments,
      sender_npub: this.session?.npub,
      sync_status: 'pending',
      record_state: 'active',
      version: 1,
      updated_at: now,
    };
    await upsertMessage(localRow);
    this.patchMessageLocal(localRow);
    this.scheduleThreadRepliesScrollToBottom();
    this.threadInput = '';
    this.threadAudioDrafts = [];
    this.scheduleComposerAutosize('thread');

    try {
      const envelope = await outboundChatMessage({
        record_id: msgId,
        owner_npub: channel.owner_npub || this.workspaceOwnerNpub || this.session?.npub,
        channel_id: this.selectedChannelId,
        parent_message_id: this.activeThreadId,
        body,
        attachments,
        channel_group_ids: channelWriteFields.group_ids,
        write_group_ref: channelWriteFields.write_group_ref,
        signature_npub: this.signingNpub,
      });

      await addPendingWrite({
        record_id: msgId,
        record_family_hash: recordFamilyHash('chat_message'),
        envelope,
      });

      this._fireMentionTriggers(body, `chat #${channel.label || channel.record_id}`, {
        channelId: this.selectedChannelId,
      });
      await this.flushAndBackgroundSync();
    } catch (error) {
      await this.setMessageSyncStatus(msgId, 'failed');
      this.error = error?.message || 'Failed to sync reply';
    }
  },

  // --- message actions menu ---

  openMessageActionsMenu(recordId) {
    this.messageActionsMenuId = recordId;
  },

  closeMessageActionsMenu() {
    this.messageActionsMenuId = null;
  },

  isMessageActionsMenuOpen(recordId) {
    return this.messageActionsMenuId === recordId;
  },

  toggleMessageActionsMenu(recordId) {
    if (this.messageActionsMenuId === recordId) {
      this.messageActionsMenuId = null;
    } else {
      this.messageActionsMenuId = recordId;
    }
  },

  async openChatThreadFlowDispatch(recordId, sourceSurface = 'main_feed') {
    this.error = null;
    console.info('Chat thread flow dispatch requested:', {
      recordId,
      sourceSurface,
      selectedChannelId: this.selectedChannelId,
    });
    this.closeMessageActionsMenu();
    Object.assign(this, createChatThreadFlowDispatchState());
    this.showChatThreadFlowDispatchModal = true;
    this.chatThreadFlowDispatchOpenedAt = Date.now();
    this.chatThreadFlowDispatchLoading = true;

    try {
      const resolved = this.resolveDispatchThread(recordId);
      if (!resolved) {
        throw new Error('Unable to resolve the selected chat thread.');
      }
      const sourceChannel = resolved.sourceChannel || this.selectedChannel;
      if (!sourceChannel?.record_id) {
        throw new Error('Unable to resolve the source channel for this thread.');
      }

      this.chatThreadFlowDispatchSource = {
        channelId: sourceChannel.record_id,
        clickedMessageId: resolved.clickedMessage.record_id,
        threadRootMessageId: resolved.threadRootMessage.record_id,
        sourceSurface,
        dispatchedAt: new Date().toISOString(),
      };
      this.chatThreadFlowDispatchMessages = resolved.threadMessages;
      this.chatThreadFlowDispatchError = null;
      this.syncChatThreadFlowDispatchScopeResolution();
    } catch (error) {
      console.error('Chat thread flow dispatch init failed:', {
        error,
        recordId,
        sourceSurface,
        selectedChannelId: this.selectedChannelId,
      });
      this.chatThreadFlowDispatchError = error?.message || 'Unable to prepare chat thread dispatch.';
      this.error = this.chatThreadFlowDispatchError;
    } finally {
      this.chatThreadFlowDispatchLoading = false;
    }
  },

  closeChatThreadFlowDispatch() {
    Object.assign(this, createChatThreadFlowDispatchState());
  },

  handleChatThreadFlowDispatchOverlayClick() {
    const openedAt = Number(this.chatThreadFlowDispatchOpenedAt || 0);
    if (openedAt > 0 && (Date.now() - openedAt) < 250) {
      return;
    }
    this.closeChatThreadFlowDispatch();
  },

  resolveDispatchThread(recordId) {
    const resolved = resolveChatThreadFlowDispatchThread(this.messages, recordId);
    if (!resolved) return null;
    return {
      ...resolved,
      sourceChannel: this.channels.find((channel) => channel.record_id === resolved.clickedMessage.channel_id) || this.selectedChannel || null,
    };
  },

  syncChatThreadFlowDispatchScopeResolution() {
    const flow = this.chatThreadFlowDispatchSelectedFlow;
    const sourceChannel = this.chatThreadFlowDispatchSourceChannel;
    const flowScopeId = flow?.scope_id ?? null;
    const channelScopeId = sourceChannel?.scope_id ?? null;
    const { resolvedScopeId, scopeSource } = resolveChatThreadFlowDispatchScope({
      manualScopeId: this.chatThreadFlowDispatchManualScopeId,
      flowScopeId,
      channelScopeId,
    });

    let assignment = null;
    if (scopeSource === 'flow') {
      assignment = buildStoredFlowKickoffScopeAssignment(flow);
    } else if (scopeSource === 'override' || scopeSource === 'channel') {
      assignment = normalizeChatThreadFlowDispatchScopeAssignment(
        this.buildTaskBoardAssignment(resolvedScopeId, null),
      );
    } else {
      assignment = normalizeChatThreadFlowDispatchScopeAssignment(
        this.buildTaskBoardAssignment(UNSCOPED_TASK_BOARD_ID, null),
      );
    }

    this.chatThreadFlowDispatchResolvedScopeId = resolvedScopeId;
    this.chatThreadFlowDispatchScopeSource = scopeSource;
    this.chatThreadFlowDispatchResolvedScopeAssignment = assignment;
    return assignment;
  },

  handleChatThreadFlowDispatchInputsChanged() {
    this.syncChatThreadFlowDispatchScopeResolution();
    if (this.chatThreadFlowDispatchDirty) {
      this.chatThreadFlowDispatchPreviewStale = true;
      return;
    }
    this.regenerateChatThreadFlowDispatchPreview();
  },

  regenerateChatThreadFlowDispatchPreview() {
    const source = this.chatThreadFlowDispatchSource;
    const flow = this.chatThreadFlowDispatchSelectedFlow;
    this.syncChatThreadFlowDispatchScopeResolution();

    if (!source?.channelId || !flow?.record_id || this.chatThreadFlowDispatchMessages.length === 0) {
      this.chatThreadFlowDispatchPreview = '';
      this.chatThreadFlowDispatchDirty = false;
      this.chatThreadFlowDispatchPreviewStale = false;
      return '';
    }

    const preview = buildChatThreadFlowDispatchPreview({
      channelId: source.channelId,
      channelScopeId: this.chatThreadFlowDispatchSourceChannel?.scope_id ?? null,
      clickedMessageId: source.clickedMessageId,
      dispatchedAt: source.dispatchedAt || new Date().toISOString(),
      flowId: flow.record_id,
      flowScopeId: flow.scope_id ?? null,
      flowTitle: flow.title || 'Untitled flow',
      launchNotes: this.chatThreadFlowDispatchLaunchNotes,
      messages: this.chatThreadFlowDispatchMessages,
      resolvedScopeId: this.chatThreadFlowDispatchResolvedScopeId,
      scopeSource: this.chatThreadFlowDispatchScopeSource,
      senderLabelResolver: (message) => this.getSenderName?.(message?.sender_npub) || message?.sender_npub || 'Unknown sender',
      sourceSurface: source.sourceSurface || 'main_feed',
      threadRootMessageId: source.threadRootMessageId,
      workspaceOwnerNpub: this.workspaceOwnerNpub,
    }).description;

    this.chatThreadFlowDispatchPreview = preview;
    this.chatThreadFlowDispatchDirty = false;
    this.chatThreadFlowDispatchPreviewStale = false;
    return preview;
  },

  markChatThreadFlowDispatchPreviewEdited() {
    this.chatThreadFlowDispatchDirty = true;
  },

  async submitChatThreadFlowDispatch() {
    this.error = null;
    this.chatThreadFlowDispatchError = null;
    if (!this.chatThreadFlowDispatchCanSubmit) {
      this.chatThreadFlowDispatchError = 'Select a flow and confirm the preview before dispatching.';
      this.error = this.chatThreadFlowDispatchError;
      return null;
    }

    const source = this.chatThreadFlowDispatchSource;
    this.chatThreadFlowDispatchSubmitting = true;
    try {
      const result = await this.startChatThreadFlowDispatch({
        flowId: this.chatThreadFlowDispatchSelectedFlowId,
        resolvedScopeId: this.chatThreadFlowDispatchResolvedScopeId,
        resolvedScopeAssignment: this.chatThreadFlowDispatchResolvedScopeAssignment,
        scopeSource: this.chatThreadFlowDispatchScopeSource,
        channelId: source.channelId,
        clickedMessageId: source.clickedMessageId,
        threadRootMessageId: source.threadRootMessageId,
        sourceSurface: source.sourceSurface,
        launchNotes: this.chatThreadFlowDispatchLaunchNotes,
        kickoffDescription: String(this.chatThreadFlowDispatchPreview || '').trim(),
      });
      if (!result) {
        throw new Error('Failed to create the kickoff task for this flow dispatch.');
      }
      this.closeChatThreadFlowDispatch();
      return result;
    } catch (error) {
      console.error('Chat thread flow dispatch submit failed:', {
        error,
        flowId: this.chatThreadFlowDispatchSelectedFlowId,
        source,
      });
      this.chatThreadFlowDispatchError = error?.message || 'Failed to create the kickoff task for this flow dispatch.';
      this.error = this.chatThreadFlowDispatchError;
      return null;
    } finally {
      this.chatThreadFlowDispatchSubmitting = false;
    }
  },

  inspectMessageSyncStatus(recordId) {
    const message = this.messages.find((m) => m.record_id === recordId);
    const body = message?.body || '';
    const label = body.length > 50 ? body.slice(0, 50) + '...' : (body || 'Chat message');
    this.messageActionsMenuId = null;
    this.openRecordStatusModal({
      familyId: 'chat_message',
      recordId,
      label,
    });
  },

  async deleteActiveThread() {
    this.error = null;
    const parent = this.getThreadParentMessage();
    if (!parent || !this.selectedChannelId) {
      this.error = 'Open a thread first';
      return;
    }

    if (typeof window !== 'undefined') {
      const confirmed = window.confirm('Delete this thread and its replies?');
      if (!confirmed) return;
    }

    const channel = this.selectedChannel;
    const threadMessages = [parent, ...this.threadMessages];
    const channelWriteFields = await getRecordWriteFieldsForStore(this, channel, {
      label: 'Chat thread delete',
    });

    for (const message of threadMessages) {
      const nextVersion = (message.version ?? 1) + 1;
      await upsertMessage({
        ...message,
        record_state: 'deleted',
        sync_status: 'pending',
        version: nextVersion,
        updated_at: new Date().toISOString(),
      });

      const envelope = await outboundChatMessage({
        record_id: message.record_id,
        owner_npub: channel?.owner_npub || this.workspaceOwnerNpub || message.sender_npub,
        channel_id: message.channel_id,
        parent_message_id: message.parent_message_id,
        body: message.body,
        channel_group_ids: channelWriteFields.group_ids,
        write_group_ref: channelWriteFields.write_group_ref,
        version: nextVersion,
        previous_version: message.version ?? 1,
        signature_npub: this.signingNpub,
        record_state: 'deleted',
      });

      await addPendingWrite({
        record_id: message.record_id,
        record_family_hash: recordFamilyHash('chat_message'),
        envelope,
      });
    }

    await this.flushAndBackgroundSync();
    this.closeThread();
    await this.refreshMessages();
  },
};
