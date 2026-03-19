export function resolveChannelLabel(channel, { sessionNpub, getParticipants, getSenderName }) {
  if (!channel) return '';

  const title = String(channel.title || '').trim();
  const isDirectMessage = /^DM:/i.test(title);
  if (title && !isDirectMessage) return title;

  const participants = getParticipants(channel);
  const others = participants.filter((npub) => npub !== sessionNpub);
  if (others.length === 1) return getSenderName(others[0]);
  if (others.length > 1) {
    return others.map((npub) => getSenderName(npub)).join(', ');
  }
  return title || String(channel.record_id || '').slice(0, 8);
}
