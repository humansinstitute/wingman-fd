export const CHAT_GET_IT_DONE_EXCERPT_LIMIT = 256;

export const CHAT_GET_IT_DONE_OUTPUT_TYPES = Object.freeze([
  { value: 'chat_response', label: 'Chat response' },
  { value: 'doc', label: 'Doc' },
  { value: 'task', label: 'Task' },
]);

export function createChatGetItDoneState() {
  return {
    showChatGetItDoneModal: false,
    chatGetItDoneOpenedAt: 0,
    chatGetItDoneSource: null,
    chatGetItDoneMessages: [],
    chatGetItDoneTitle: '',
    chatGetItDoneScopeId: null,
    chatGetItDoneScopeQuery: '',
    showChatGetItDoneScopePicker: false,
    chatGetItDoneAssigneeNpub: null,
    chatGetItDoneAssigneeQuery: '',
    showChatGetItDoneAssigneePicker: false,
    chatGetItDoneOutputType: 'chat_response',
    chatGetItDoneInstructions: '',
    chatGetItDoneSubmitting: false,
    chatGetItDoneError: null,
  };
}

function normalizeText(value) {
  return String(value || '').trim();
}

function senderLabel(message, senderLabelResolver) {
  return normalizeText(senderLabelResolver?.(message)) || normalizeText(message?.sender_npub) || 'Unknown sender';
}

export function buildChatGetItDoneExcerpt(messages = [], senderLabelResolver = null, limit = CHAT_GET_IT_DONE_EXCERPT_LIMIT) {
  const maxLength = Math.max(32, Number(limit) || CHAT_GET_IT_DONE_EXCERPT_LIMIT);
  const entries = [...(Array.isArray(messages) ? messages : [])]
    .reverse()
    .map((message) => `${senderLabel(message, senderLabelResolver)}: ${normalizeText(message?.body) || '[no text]'}`);
  const joined = entries.join('\n');
  if (joined.length <= maxLength) return joined;
  return `${joined.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function getChatGetItDoneOutputInstruction(outputType = 'chat_response') {
  if (outputType === 'doc') {
    return 'Create and attach the linked document deliverable.';
  }
  if (outputType === 'task') {
    return 'Create the follow-up task needed to complete this work.';
  }
  return 'Post the final response back into the source chat thread.';
}

export function buildChatGetItDoneTaskDescription({
  prompt,
  outputType = 'chat_response',
  extraInstructions = '',
  sourceUrl = '',
  messages = [],
  senderLabelResolver = null,
} = {}) {
  const cleanPrompt = normalizeText(prompt);
  const cleanInstructions = normalizeText(extraInstructions);
  const threadUrl = normalizeText(sourceUrl);
  const outputInstruction = getChatGetItDoneOutputInstruction(outputType);
  const excerpt = buildChatGetItDoneExcerpt(messages, senderLabelResolver);

  return [
    '## Request',
    cleanPrompt || 'Get this chat thread done.',
    '',
    '## Source',
    threadUrl ? `[Open source chat thread](${threadUrl})` : 'Source chat thread link unavailable.',
    '',
    '## Output',
    outputInstruction,
    '',
    '## Extra Instructions',
    cleanInstructions || 'None.',
    '',
    '## Latest Thread Excerpt',
    excerpt || 'No chat text available.',
  ].join('\n');
}
