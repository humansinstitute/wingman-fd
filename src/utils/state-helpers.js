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

const BLOCK_DOCUMENT_FORMAT = 'block_document_v1';

function makeBlockId(index, startLine) {
  return `block-${index}-${startLine}`;
}

function blockText(block) {
  return String(block?.raw ?? block?.text ?? '').trimEnd();
}

export function normalizeDocumentBlocks(blocks = [], fallbackContent = '') {
  const sourceBlocks = Array.isArray(blocks) ? blocks : [];
  if (sourceBlocks.length === 0 && String(fallbackContent || '').trim()) {
    return parseMarkdownBlocks(fallbackContent);
  }

  let line = 1;
  return sourceBlocks
    .map((block, index) => {
      const raw = blockText(block);
      if (!raw) return null;
      const lineCount = raw.split('\n').length;
      const normalized = {
        id: String(block?.id || '').trim() || makeBlockId(index, line),
        type: String(block?.type || '').trim() || 'markdown',
        raw,
        text: raw,
        attrs: block?.attrs && typeof block.attrs === 'object' && !Array.isArray(block.attrs)
          ? { ...block.attrs }
          : {},
        start_line: line,
        end_line: line + lineCount - 1,
      };
      line += lineCount + 1;
      return normalized;
    })
    .filter(Boolean);
}

export function createDocumentBlock(raw = '', options = {}) {
  const text = String(raw || '').trimEnd();
  const id = String(options.id || '').trim()
    || (globalThis.crypto?.randomUUID ? `blk_${globalThis.crypto.randomUUID()}` : `blk_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  return {
    id,
    type: String(options.type || '').trim() || 'markdown',
    raw: text,
    text,
    attrs: options.attrs && typeof options.attrs === 'object' && !Array.isArray(options.attrs)
      ? { ...options.attrs }
      : {},
  };
}

export function serializeDocumentBlocks(blocks = []) {
  return normalizeDocumentBlocks(blocks).map((block) => ({
    id: block.id,
    type: block.type || 'markdown',
    text: blockText(block),
    attrs: block.attrs && typeof block.attrs === 'object' && !Array.isArray(block.attrs)
      ? { ...block.attrs }
      : {},
  }));
}

export function documentBlocksToMarkdown(blocks = []) {
  return normalizeDocumentBlocks(blocks)
    .map((block) => blockText(block))
    .filter((raw) => raw.length > 0)
    .join('\n\n');
}

export function parseMarkdownBlocks(content, options = {}) {
  const source = String(content || '').replace(/\r\n?/g, '\n');
  if (!source.trim()) return [];
  const lines = source.split('\n');
  const blocks = [];
  let currentLines = [];
  let startLine = 1;
  const previousBlocks = Array.isArray(options?.previousBlocks) ? options.previousBlocks : [];

  const flush = () => {
    if (currentLines.length === 0) return;
    const raw = currentLines.join('\n').trimEnd();
    if (!raw) {
      currentLines = [];
      return;
    }
    const previous = previousBlocks[blocks.length] || null;
    blocks.push({
      id: String(previous?.id || '').trim() || makeBlockId(blocks.length, startLine),
      type: String(previous?.type || '').trim() || 'markdown',
      raw,
      text: raw,
      attrs: previous?.attrs && typeof previous.attrs === 'object' && !Array.isArray(previous.attrs)
        ? { ...previous.attrs }
        : {},
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
  return documentBlocksToMarkdown(blocks);
}

export function buildDocumentContentModel(blocks = []) {
  const normalizedBlocks = normalizeDocumentBlocks(blocks);
  return {
    content: documentBlocksToMarkdown(normalizedBlocks),
    content_format: BLOCK_DOCUMENT_FORMAT,
    content_blocks: serializeDocumentBlocks(normalizedBlocks),
  };
}

export { BLOCK_DOCUMENT_FORMAT };
