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

/**
 * Resolve pending storage images in rendered HTML to actual URLs.
 *
 * Finds all `<img … data-storage-object-id="ID" …>` tags that lack a `src`
 * and calls `resolverFn(objectId)` to obtain the URL. On success the `src` is
 * injected and the `md-storage-image-pending` class is removed. On failure the
 * tag is kept but marked with `md-storage-image-error`.
 *
 * @param {string} html  Rendered HTML string from `renderMarkdownToHtml`.
 * @param {(objectId: string) => Promise<string>} resolverFn  Async function
 *   that returns a URL for a given storage object ID.
 * @returns {Promise<string>} The HTML with storage images hydrated.
 */
export async function hydrateStorageImageMarkup(html, resolverFn) {
  if (!html) return html || '';

  // Match <img …data-storage-object-id="VALUE"…> tags that have no src attribute
  const storageImgRe = /<img\b([^>]*?)data-storage-object-id="([^"]+)"([^>]*?)\/?\s*>/g;
  const matches = [];
  let match;
  while ((match = storageImgRe.exec(html)) !== null) {
    // Only process if there is no src already set
    const fullTag = match[0];
    if (/\bsrc="/.test(fullTag)) continue;
    matches.push({ fullTag, objectId: match[2] });
  }

  if (matches.length === 0) return html;

  // Resolve all images concurrently
  const resolutions = await Promise.allSettled(
    matches.map(async ({ objectId }) => ({
      objectId,
      url: await resolverFn(objectId),
    })),
  );

  let result = html;
  for (let i = 0; i < matches.length; i++) {
    const { fullTag } = matches[i];
    const resolution = resolutions[i];

    if (resolution.status === 'fulfilled' && resolution.value.url) {
      const safeUrl = String(resolution.value.url).replace(/"/g, '&quot;');
      const hydrated = fullTag
        .replace('md-storage-image-pending', '')
        .replace(/class="([^"]*)\s*"/, 'class="$1"')
        .replace('<img ', `<img src="${safeUrl}" `);
      result = result.replace(fullTag, hydrated);
    } else {
      // Mark as error
      const errored = fullTag
        .replace('md-storage-image-pending', 'md-storage-image-error');
      result = result.replace(fullTag, errored);
    }
  }

  return result;
}
