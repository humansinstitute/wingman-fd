function messageUpdatedAtMs(message) {
  const ts = Date.parse(String(message?.updated_at || ''));
  return Number.isFinite(ts) ? ts : 0;
}

export function compareMessagesByUpdatedAt(a, b) {
  const diff = messageUpdatedAtMs(a) - messageUpdatedAtMs(b);
  if (diff !== 0) return diff;
  return String(a?.record_id || '').localeCompare(String(b?.record_id || ''));
}

export function sortMessagesByUpdatedAt(messages) {
  return [...messages].sort(compareMessagesByUpdatedAt);
}

export function rankMainFeedMessages(messages) {
  const latestByThreadId = new Map();

  for (const message of messages) {
    const threadId = message?.parent_message_id || message?.record_id;
    if (!threadId) continue;
    const nextTs = messageUpdatedAtMs(message);
    const currentTs = latestByThreadId.get(threadId) ?? 0;
    if (nextTs >= currentTs) latestByThreadId.set(threadId, nextTs);
  }

  return messages
    .filter((message) => !message.parent_message_id)
    .sort((a, b) => {
      const latestDiff = (latestByThreadId.get(a.record_id) ?? messageUpdatedAtMs(a))
        - (latestByThreadId.get(b.record_id) ?? messageUpdatedAtMs(b));
      if (latestDiff !== 0) return latestDiff;
      return compareMessagesByUpdatedAt(a, b);
    });
}

export function rankThreadReplies(messages, parentMessageId) {
  return sortMessagesByUpdatedAt(
    messages.filter((message) => message.parent_message_id === parentMessageId)
  );
}
