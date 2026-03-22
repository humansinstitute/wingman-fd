/**
 * Pure data-transform and comparison helpers extracted from app.js.
 */

/** Strip Alpine proxy wrappers so objects survive IndexedDB structured clone. */
export function toRaw(obj) {
  if (obj == null || typeof obj !== 'object') return obj;
  return JSON.parse(JSON.stringify(obj));
}

export function normalizeBackendUrl(url) {
  if (!url) return '';

  try {
    const parsed = new URL(url);
    const normalized = parsed.toString().replace(/\/+$/, '');

    if (typeof window === 'undefined') return normalized;

    const current = new URL(window.location.origin);

    if (
      parsed.hostname === current.hostname
      && parsed.pathname === '/'
      && parsed.port === '3100'
    ) {
      return current.origin;
    }

    return normalized;
  } catch {
    return String(url).trim().replace(/\/+$/, '');
  }
}

export function workspaceSettingsRecordId(workspaceOwnerNpub) {
  return `workspace-settings:${workspaceOwnerNpub}`;
}

export function storageObjectIdFromRef(value) {
  const match = String(value || '').trim().match(/^storage:\/\/([A-Za-z0-9-]+)$/);
  return match?.[1] || '';
}

export function storageImageCacheKey(objectId, backendUrl = '') {
  const normalizedObjectId = String(objectId || '').trim();
  const normalizedBackendUrl = String(backendUrl || '').trim().replace(/\/+$/, '');
  if (!normalizedObjectId) return '';
  return normalizedBackendUrl ? `${normalizedBackendUrl}::${normalizedObjectId}` : normalizedObjectId;
}

export function defaultRecordSignature(record) {
  return [
    String(record?.record_id || ''),
    String(record?.updated_at || ''),
    String(record?.version ?? ''),
    String(record?.record_state || ''),
    String(record?.sync_status || ''),
  ].join('|');
}

export function sameListBySignature(current = [], next = [], signatureFor = defaultRecordSignature) {
  if (current === next) return true;
  if (!Array.isArray(current) || !Array.isArray(next) || current.length !== next.length) return false;
  for (let index = 0; index < current.length; index += 1) {
    if (signatureFor(current[index]) !== signatureFor(next[index])) return false;
  }
  return true;
}

export function parseMarkdownBlocks(content) {
  const source = String(content || '').replace(/\r\n?/g, '\n');
  if (!source.trim()) return [];
  const lines = source.split('\n');
  const blocks = [];
  let currentLines = [];
  let startLine = 1;

  const flush = () => {
    if (currentLines.length === 0) return;
    const raw = currentLines.join('\n').trimEnd();
    if (!raw) {
      currentLines = [];
      return;
    }
    blocks.push({
      id: `block-${blocks.length}-${startLine}`,
      raw,
      start_line: startLine,
      end_line: startLine + currentLines.length - 1,
    });
    currentLines = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (!line.trim()) {
      flush();
      startLine = index + 2;
      continue;
    }
    if (currentLines.length === 0) startLine = index + 1;
    currentLines.push(line);
  }

  flush();
  return blocks;
}

export function assembleMarkdownBlocks(blocks = []) {
  return (blocks || [])
    .map((block) => String(block?.raw || '').trimEnd())
    .filter((raw) => raw.length > 0)
    .join('\n\n');
}
