/**
 * Profile/identity display helpers extracted from app.js.
 */

export function getShortNpub(npub) {
  const value = String(npub || '');
  if (value.length <= 13) return value;
  return `${value.slice(0, 7)}...${value.slice(-6)}`;
}

export function getInitials(label) {
  const cleaned = String(label || '').trim();
  if (!cleaned) return '?';
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
  }
  return cleaned.slice(0, 2).toUpperCase();
}
