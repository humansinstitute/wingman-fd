export const REACTION_COLLECTION_SPACE = 'reaction';

export const REACTION_EMOJI_OPTIONS = Object.freeze([
  { emoji: 'thumbs_up', shortcode: ':thumbs_up:', label: String.fromCodePoint(0x1f44d) },
  { emoji: 'smile', shortcode: ':smile:', label: String.fromCodePoint(0x1f604) },
  { emoji: 'heart', shortcode: ':heart:', label: String.fromCodePoint(0x2764, 0xfe0f) },
  { emoji: 'eyes', shortcode: ':eyes:', label: String.fromCodePoint(0x1f440) },
  { emoji: 'party', shortcode: ':party:', label: String.fromCodePoint(0x1f389) },
]);

export const DEFAULT_REACTION_EMOJI = 'thumbs_up';

const REACTION_OPTION_BY_EMOJI = Object.freeze(
  Object.fromEntries(REACTION_EMOJI_OPTIONS.map((option) => [option.emoji, option]))
);

export function normalizeReactionEmoji(value) {
  const token = String(value || '').trim();
  return REACTION_OPTION_BY_EMOJI[token] ? token : DEFAULT_REACTION_EMOJI;
}

export function isSupportedReactionEmoji(value) {
  return Boolean(REACTION_OPTION_BY_EMOJI[String(value || '').trim()]);
}

export function getReactionOption(emoji) {
  return REACTION_OPTION_BY_EMOJI[normalizeReactionEmoji(emoji)];
}

export function getReactionShortcode(emoji) {
  return getReactionOption(emoji).shortcode;
}

export function getReactionLabel(emoji) {
  return getReactionOption(emoji).label;
}

export function summarizeReactions(reactions = [], currentUserNpub = '') {
  const currentUser = String(currentUserNpub || '').trim();
  const grouped = new Map();

  for (const reaction of Array.isArray(reactions) ? reactions : []) {
    if (!reaction || reaction.record_state === 'deleted') continue;
    const emoji = normalizeReactionEmoji(reaction.emoji);
    const reactorNpub = String(reaction.reactor_npub || reaction.sender_npub || '').trim();
    if (!reactorNpub) continue;
    if (!grouped.has(emoji)) {
      grouped.set(emoji, {
        emoji,
        emoji_shortcode: getReactionShortcode(emoji),
        count: 0,
        reacted_by_me: false,
        reactor_npubs: [],
      });
    }
    const summary = grouped.get(emoji);
    if (summary.reactor_npubs.includes(reactorNpub)) continue;
    summary.reactor_npubs.push(reactorNpub);
    summary.count += 1;
    if (currentUser && reactorNpub === currentUser) summary.reacted_by_me = true;
  }

  const order = new Map(REACTION_EMOJI_OPTIONS.map((option, index) => [option.emoji, index]));
  return [...grouped.values()].sort((left, right) => {
    if (left.reacted_by_me !== right.reacted_by_me) return left.reacted_by_me ? -1 : 1;
    if (left.count !== right.count) return right.count - left.count;
    return (order.get(left.emoji) ?? 999) - (order.get(right.emoji) ?? 999);
  });
}
