import { sortMessagesByUpdatedAt } from './chat-order.js';

export const CHAT_THREAD_FLOW_DISPATCH_MAX_DESCRIPTION_LENGTH = 20000;

const SCOPE_SOURCE_LABELS = {
  override: 'Manual override',
  flow: 'Flow scope',
  channel: 'Channel scope',
  none: 'No scope',
};

const DISPATCH_BRIEF = [
  'Review and action the source thread below. Treat the preserved provenance and',
  'literal transcript as the source of truth for what this kickoff task is asking',
  'for. Carry forward any concrete repo paths, artifact paths, acceptance',
  'criteria, and constraints already present in the conversation before',
  'dispatching downstream work.',
].join('\n');

function cloneJsonValue(value, fallback) {
  if (value == null) return fallback;
  return JSON.parse(JSON.stringify(value));
}

function normalizeNullableId(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function toMarkdownLiteral(value) {
  return value == null || value === '' ? 'null' : String(value);
}

function toBooleanLiteral(value) {
  return value ? 'true' : 'false';
}

function resolveMessageTimestamp(message) {
  const timestamp = String(message?.updated_at || '').trim();
  if (timestamp) return timestamp;
  return new Date(0).toISOString();
}

function resolveMessageBody(message) {
  return String(message?.body || '');
}

function resolveMessageAttachmentNote(message) {
  const attachments = Array.isArray(message?.attachments) ? message.attachments : [];
  if (attachments.length === 0) return '';
  return ` [attachments: ${attachments.length}]`;
}

function formatTranscriptEntry(message, senderLabel) {
  const label = String(senderLabel || message?.sender_npub || 'Unknown sender').trim() || 'Unknown sender';
  const messageId = String(message?.record_id || '').trim();
  return [
    `[${resolveMessageTimestamp(message)}] ${label} | ${messageId}${resolveMessageAttachmentNote(message)}`,
    resolveMessageBody(message),
  ].join('\n');
}

function renderTranscript(messages, senderLabelResolver) {
  return messages
    .map((message) => formatTranscriptEntry(message, senderLabelResolver?.(message)))
    .join('\n\n');
}

function buildDescriptionSkeleton({
  dispatchedAt,
  flowId,
  flowTitle,
  scopeSource,
  resolvedScopeId,
  truncated,
  omittedMessageCount,
  workspaceOwnerNpub,
  channelId,
  threadRootMessageId,
  clickedMessageId,
  threadMessageCount,
  channelScopeId,
  flowScopeId,
  launchNotes,
  sourceSurface,
  transcript,
}) {
  return [
    '## Dispatch Request',
    '- dispatch_type: flow',
    '- dispatched_from: flight_deck_chat',
    `- dispatched_at: ${dispatchedAt}`,
    `- selected_flow_id: ${toMarkdownLiteral(flowId)}`,
    `- selected_flow_title: ${toMarkdownLiteral(flowTitle)}`,
    `- source_surface: ${toMarkdownLiteral(sourceSurface)}`,
    `- scope_resolution: ${toMarkdownLiteral(scopeSource)}`,
    `- resolved_scope_id: ${toMarkdownLiteral(resolvedScopeId)}`,
    `- transcript_truncated: ${toBooleanLiteral(truncated)}`,
    `- omitted_message_count: ${Math.max(0, Number(omittedMessageCount) || 0)}`,
    '',
    '## Source Provenance',
    `- workspace_owner_npub: ${toMarkdownLiteral(workspaceOwnerNpub)}`,
    `- channel_id: ${toMarkdownLiteral(channelId)}`,
    `- thread_id: ${toMarkdownLiteral(threadRootMessageId)}`,
    `- clicked_message_id: ${toMarkdownLiteral(clickedMessageId)}`,
    `- thread_message_count: ${Math.max(0, Number(threadMessageCount) || 0)}`,
    `- channel_scope_id: ${toMarkdownLiteral(channelScopeId)}`,
    `- flow_scope_id: ${toMarkdownLiteral(flowScopeId)}`,
    '',
    '## Launch Notes',
    String(launchNotes || '').trim() || 'None.',
    '',
    '## Dispatch Brief',
    DISPATCH_BRIEF,
    '',
    '## Thread Transcript',
    '~~~text',
    transcript,
    '~~~',
  ].join('\n');
}

function buildTruncatedTranscript(messages, senderLabelResolver, requiredIds, maxDescriptionLength, descriptionInput) {
  const orderedMessages = Array.isArray(messages) ? messages : [];
  const requiredMessageIds = new Set(requiredIds.filter(Boolean));
  const requiredMessages = orderedMessages.filter((message) => requiredMessageIds.has(message.record_id));
  const optionalMessages = [...orderedMessages]
    .reverse()
    .filter((message) => !requiredMessageIds.has(message.record_id));

  let includedIds = new Set(requiredMessages.map((message) => message.record_id));
  let omittedMessageCount = Math.max(0, orderedMessages.length - includedIds.size);
  let transcriptMessages = orderedMessages.filter((message) => includedIds.has(message.record_id));
  let description = buildDescriptionSkeleton({
    ...descriptionInput,
    truncated: omittedMessageCount > 0,
    omittedMessageCount,
    threadMessageCount: orderedMessages.length,
    transcript: renderTranscript(transcriptMessages, senderLabelResolver),
  });

  for (const candidate of optionalMessages) {
    const nextIncludedIds = new Set(includedIds);
    nextIncludedIds.add(candidate.record_id);
    const nextTranscriptMessages = orderedMessages.filter((message) => nextIncludedIds.has(message.record_id));
    const nextOmittedMessageCount = Math.max(0, orderedMessages.length - nextIncludedIds.size);
    const nextDescription = buildDescriptionSkeleton({
      ...descriptionInput,
      truncated: nextOmittedMessageCount > 0,
      omittedMessageCount: nextOmittedMessageCount,
      threadMessageCount: orderedMessages.length,
      transcript: renderTranscript(nextTranscriptMessages, senderLabelResolver),
    });
    if (nextDescription.length > maxDescriptionLength && nextOmittedMessageCount > 0) {
      continue;
    }
    includedIds = nextIncludedIds;
    omittedMessageCount = nextOmittedMessageCount;
    transcriptMessages = nextTranscriptMessages;
    description = nextDescription;
  }

  return {
    description,
    transcriptTruncated: omittedMessageCount > 0,
    omittedMessageCount,
    transcriptMessages,
  };
}

export function createChatThreadFlowDispatchState() {
  return {
    showChatThreadFlowDispatchModal: false,
    chatThreadFlowDispatchOpenedAt: 0,
    chatThreadFlowDispatchSource: null,
    chatThreadFlowDispatchMessages: [],
    chatThreadFlowDispatchSelectedFlowId: null,
    chatThreadFlowDispatchManualScopeId: null,
    chatThreadFlowDispatchResolvedScopeId: null,
    chatThreadFlowDispatchResolvedScopeAssignment: null,
    chatThreadFlowDispatchScopeSource: 'none',
    chatThreadFlowDispatchLaunchNotes: '',
    chatThreadFlowDispatchPreview: '',
    chatThreadFlowDispatchDirty: false,
    chatThreadFlowDispatchPreviewStale: false,
    chatThreadFlowDispatchLoading: false,
    chatThreadFlowDispatchSubmitting: false,
    chatThreadFlowDispatchError: null,
  };
}

export function getChatThreadFlowDispatchScopeSourceLabel(scopeSource) {
  return SCOPE_SOURCE_LABELS[scopeSource] || SCOPE_SOURCE_LABELS.none;
}

export function resolveChatThreadFlowDispatchScope({
  manualScopeId = null,
  flowScopeId = null,
  channelScopeId = null,
} = {}) {
  const overrideId = normalizeNullableId(manualScopeId);
  if (overrideId) {
    return {
      resolvedScopeId: overrideId,
      scopeSource: 'override',
    };
  }

  const selectedFlowScopeId = normalizeNullableId(flowScopeId);
  if (selectedFlowScopeId) {
    return {
      resolvedScopeId: selectedFlowScopeId,
      scopeSource: 'flow',
    };
  }

  const selectedChannelScopeId = normalizeNullableId(channelScopeId);
  if (selectedChannelScopeId) {
    return {
      resolvedScopeId: selectedChannelScopeId,
      scopeSource: 'channel',
    };
  }

  return {
    resolvedScopeId: null,
    scopeSource: 'none',
  };
}

export function normalizeChatThreadFlowDispatchScopeAssignment(assignment = null) {
  if (!assignment || typeof assignment !== 'object') {
    return {
      scope_id: null,
      scope_l1_id: null,
      scope_l2_id: null,
      scope_l3_id: null,
      scope_l4_id: null,
      scope_l5_id: null,
      scope_policy_group_ids: null,
      group_ids: [],
      shares: [],
      write_group_ref: null,
    };
  }

  const groupIds = Array.isArray(assignment.group_ids)
    ? assignment.group_ids.map((groupId) => String(groupId || '').trim()).filter(Boolean)
    : [];
  const shares = Array.isArray(assignment.shares) ? cloneJsonValue(assignment.shares, []) : [];
  const scopePolicyGroupIds = Array.isArray(assignment.scope_policy_group_ids)
    ? assignment.scope_policy_group_ids.map((groupId) => String(groupId || '').trim()).filter(Boolean)
    : null;
  const writeGroupRef = normalizeNullableId(
    assignment.write_group_ref
    || assignment.board_group_id
    || groupIds[0]
    || null,
  );

  return {
    scope_id: normalizeNullableId(assignment.scope_id),
    scope_l1_id: normalizeNullableId(assignment.scope_l1_id),
    scope_l2_id: normalizeNullableId(assignment.scope_l2_id),
    scope_l3_id: normalizeNullableId(assignment.scope_l3_id),
    scope_l4_id: normalizeNullableId(assignment.scope_l4_id),
    scope_l5_id: normalizeNullableId(assignment.scope_l5_id),
    scope_policy_group_ids: scopePolicyGroupIds,
    group_ids: groupIds,
    shares,
    write_group_ref: writeGroupRef,
  };
}

export function resolveChatThreadFlowDispatchThread(messages = [], recordId = null) {
  const liveMessages = Array.isArray(messages)
    ? messages.filter((message) => message?.record_state !== 'deleted')
    : [];
  const clickedMessageId = normalizeNullableId(recordId);
  if (!clickedMessageId) return null;

  const messageById = new Map(liveMessages.map((message) => [message.record_id, message]));
  const clickedMessage = messageById.get(clickedMessageId) || null;
  if (!clickedMessage) return null;

  const threadRootMessageId = normalizeNullableId(clickedMessage.parent_message_id) || clickedMessage.record_id;
  const threadRootMessage = messageById.get(threadRootMessageId) || null;
  if (!threadRootMessage) return null;

  const threadMessages = sortMessagesByUpdatedAt(
    liveMessages.filter((message) =>
      message.record_id === threadRootMessageId
      || message.parent_message_id === threadRootMessageId,
    ),
  );

  return {
    clickedMessage,
    threadRootMessage,
    threadMessages,
  };
}

export function buildChatThreadFlowDispatchPreview({
  channelId,
  channelScopeId = null,
  clickedMessageId,
  dispatchedAt,
  flowId,
  flowScopeId = null,
  flowTitle,
  launchNotes = '',
  messages = [],
  resolvedScopeId = null,
  scopeSource = 'none',
  senderLabelResolver = null,
  sourceSurface = 'main_feed',
  threadRootMessageId,
  workspaceOwnerNpub = null,
  maxDescriptionLength = CHAT_THREAD_FLOW_DISPATCH_MAX_DESCRIPTION_LENGTH,
} = {}) {
  const orderedMessages = sortMessagesByUpdatedAt(Array.isArray(messages) ? messages : []);
  const requiredIds = [
    normalizeNullableId(threadRootMessageId),
    normalizeNullableId(clickedMessageId),
  ];

  return buildTruncatedTranscript(
    orderedMessages,
    senderLabelResolver,
    requiredIds,
    Math.max(1000, Number(maxDescriptionLength) || CHAT_THREAD_FLOW_DISPATCH_MAX_DESCRIPTION_LENGTH),
    {
      dispatchedAt: String(dispatchedAt || new Date().toISOString()),
      flowId: normalizeNullableId(flowId),
      flowTitle: String(flowTitle || '').trim() || null,
      scopeSource,
      resolvedScopeId: normalizeNullableId(resolvedScopeId),
      workspaceOwnerNpub: normalizeNullableId(workspaceOwnerNpub),
      channelId: normalizeNullableId(channelId),
      threadRootMessageId: normalizeNullableId(threadRootMessageId),
      clickedMessageId: normalizeNullableId(clickedMessageId),
      channelScopeId: normalizeNullableId(channelScopeId),
      flowScopeId: normalizeNullableId(flowScopeId),
      launchNotes,
      sourceSurface,
    },
  );
}
