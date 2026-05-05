export function normalizeChannelOrder(order = [], channels = []) {
  const channelIds = (Array.isArray(channels) ? channels : [])
    .map((channel) => String(channel?.record_id || '').trim())
    .filter(Boolean);
  const channelIdSet = new Set(channelIds);
  const seen = new Set();
  const normalized = [];

  for (const id of Array.isArray(order) ? order : []) {
    const clean = String(id || '').trim();
    if (!clean || !channelIdSet.has(clean) || seen.has(clean)) continue;
    seen.add(clean);
    normalized.push(clean);
  }

  for (const id of channelIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }

  return normalized;
}

export function sortChannelsByOrder(channels = [], order = []) {
  const input = Array.isArray(channels) ? channels : [];
  const rank = new Map(normalizeChannelOrder(order, input).map((id, index) => [id, index]));
  return input
    .map((channel, index) => ({ channel, index }))
    .sort((left, right) => {
      const leftRank = rank.has(left.channel?.record_id) ? rank.get(left.channel.record_id) : Number.MAX_SAFE_INTEGER;
      const rightRank = rank.has(right.channel?.record_id) ? rank.get(right.channel.record_id) : Number.MAX_SAFE_INTEGER;
      return leftRank - rightRank || left.index - right.index;
    })
    .map((entry) => entry.channel);
}

export function moveChannelInOrder(order = [], channels = [], sourceId = '', targetId = '') {
  const source = String(sourceId || '').trim();
  const target = String(targetId || '').trim();
  const normalized = normalizeChannelOrder(order, channels);
  if (!source || !target || source === target) return normalized;

  const sourceIndex = normalized.indexOf(source);
  const targetIndex = normalized.indexOf(target);
  if (sourceIndex < 0 || targetIndex < 0) return normalized;

  const next = [...normalized];
  const [item] = next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, item);
  return next;
}
