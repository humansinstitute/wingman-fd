import { Marked } from 'marked';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeUrl(rawHref, allowedProtocols = []) {
  const href = String(rawHref ?? '').trim();
  if (!href) return null;

  try {
    const url = new URL(href);
    return allowedProtocols.includes(url.protocol) ? url.href : null;
  } catch {
    const lowerHref = href.toLowerCase();
    return allowedProtocols.some((protocol) => lowerHref.startsWith(protocol)) ? href : null;
  }
}

function buildStorageImageMarkup(altText, objectId) {
  const safeAlt = escapeHtml(altText);
  const safeObjectId = escapeHtml(objectId);
  return `<span class="md-storage-image-wrap"><img class="md-storage-image md-storage-image-pending" data-storage-object-id="${safeObjectId}" alt="${safeAlt}" loading="lazy" /><span class="md-storage-image-label">${safeAlt}</span></span>`;
}

function buildRemoteImageMarkup(altText, href, title) {
  const safeAlt = escapeHtml(altText);
  const safeHref = escapeHtml(href);
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
  return `<span class="md-storage-image-wrap"><img class="md-storage-image" src="${safeHref}" alt="${safeAlt}" loading="lazy"${titleAttr} /><span class="md-storage-image-label">${safeAlt}</span></span>`;
}

const markdown = new Marked({
  async: false,
  breaks: true,
  gfm: true,
});

const renderer = new markdown.Renderer();

renderer.html = ({ text }) => escapeHtml(text);

renderer.link = function ({ href, title, tokens }) {
  const mentionHref = sanitizeUrl(href, ['mention:']);
  if (mentionHref) {
    const label = this.parser.parseInline(tokens);
    const parts = mentionHref.replace(/^mention:/, '').split(':');
    const mentionType = parts[0] || 'unknown';
    const mentionId = parts.slice(1).join(':');
    const safeId = escapeHtml(mentionId);
    return `<a href="#" class="mention-link mention-link-${escapeHtml(mentionType)}" data-mention-type="${escapeHtml(mentionType)}" data-mention-id="${safeId}">@${label}</a>`;
  }
  const safeHref = sanitizeUrl(href, ['file:', 'http:', 'https:', 'mailto:', 'nostr:']);
  const label = this.parser.parseInline(tokens);
  if (!safeHref) return label;
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
  return `<a href="${escapeHtml(safeHref)}" target="_blank" rel="noopener noreferrer"${titleAttr}>${label}</a>`;
};

renderer.image = function ({ href, title, text }) {
  const safeStorageHref = sanitizeUrl(href, ['storage:']);
  if (safeStorageHref) {
    return buildStorageImageMarkup(text, safeStorageHref.slice('storage://'.length));
  }

  const safeRemoteHref = sanitizeUrl(href, ['http:', 'https:']);
  if (safeRemoteHref) {
    return buildRemoteImageMarkup(text, safeRemoteHref, title);
  }

  const safeLinkHref = sanitizeUrl(href, ['file:', 'http:', 'https:']);
  if (!safeLinkHref) return escapeHtml(text);
  const label = escapeHtml(text || href);
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
  return `<a href="${escapeHtml(safeLinkHref)}" target="_blank" rel="noopener noreferrer"${titleAttr}>${label}</a>`;
};

renderer.checkbox = ({ checked }) => `<input type="checkbox" disabled ${checked ? 'checked' : ''} />`;

markdown.use({ renderer });

export function renderMarkdownToHtml(source) {
  const normalized = String(source ?? '').replace(/\r\n?/g, '\n');
  if (!normalized) return '';
  const rendered = markdown.parse(normalized, { async: false });
  return typeof rendered === 'string' ? rendered : '';
}
