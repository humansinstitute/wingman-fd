const MENTION_TOKEN_RE = /@\[.*?\]\(mention:(\w+):([^)]+)\)/g;

export const RECORD_LINK_KINDS = Object.freeze({
  source: 'source',
  reference: 'reference',
  deliverable: 'deliverable',
});

function normalizeKind(value, fallback = RECORD_LINK_KINDS.reference) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === RECORD_LINK_KINDS.source) return RECORD_LINK_KINDS.source;
  if (normalized === RECORD_LINK_KINDS.deliverable) return RECORD_LINK_KINDS.deliverable;
  return fallback;
}

export function normalizeRecordLinkType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'document') return 'doc';
  return normalized;
}

export function normalizeRecordLink(link, fallbackKind = RECORD_LINK_KINDS.reference) {
  if (!link || typeof link !== 'object') return null;
  const type = normalizeRecordLinkType(link.type || link.record_type || link.family || link.family_id);
  const id = String(link.id || link.record_id || link.target_record_id || '').trim();
  if (!type || !id || type === 'person') return null;
  const kind = normalizeKind(link.kind || link.link_type || link.relationship, fallbackKind);
  const order = Number.isFinite(Number(link.order)) ? Number(link.order) : null;
  return order == null ? { type, id } : { type, id, order };
}

export function recordLinkKey(link) {
  const normalized = normalizeRecordLink(link);
  return normalized ? `${normalized.type}:${normalized.id}` : '';
}

export function normalizeRecordLinkList(links, fallbackKind = RECORD_LINK_KINDS.reference) {
  const input = Array.isArray(links)
    ? links
    : (links && typeof links === 'object' ? [links] : []);
  const seen = new Set();
  const output = [];
  for (const item of input) {
    const link = normalizeRecordLink(item, fallbackKind);
    const key = recordLinkKey(link);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(link);
  }
  if (fallbackKind === RECORD_LINK_KINDS.deliverable) {
    return output.sort((a, b) => {
      const left = Number.isFinite(Number(a.order)) ? Number(a.order) : Number.MAX_SAFE_INTEGER;
      const right = Number.isFinite(Number(b.order)) ? Number(b.order) : Number.MAX_SAFE_INTEGER;
      if (left !== right) return left - right;
      return recordLinkKey(a).localeCompare(recordLinkKey(b));
    });
  }
  return output;
}

export function mergeRecordLinkLists(...lists) {
  const seen = new Set();
  const output = [];
  for (const links of lists) {
    for (const link of normalizeRecordLinkList(links)) {
      const key = recordLinkKey(link);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      output.push(link);
    }
  }
  return output;
}

export function normalizeRecordLinkFields(data = {}) {
  const sourceLinks = normalizeRecordLinkList(
    data.source_links ?? data.sources ?? data.source ?? [],
    RECORD_LINK_KINDS.source,
  );
  const deliverableLinks = normalizeRecordLinkList(
    data.deliverable_links ?? data.deliverables ?? [],
    RECORD_LINK_KINDS.deliverable,
  );
  const references = normalizeRecordLinkList(
    data.references ?? [],
    RECORD_LINK_KINDS.reference,
  );
  return {
    source_links: sourceLinks,
    references,
    deliverable_links: deliverableLinks,
  };
}

export function buildRecordLinkPayload(record = {}) {
  return normalizeRecordLinkFields(record);
}

export function parseRecordReferencesFromText(text) {
  if (!text) return [];
  const refs = [];
  const seen = new Set();
  const re = new RegExp(MENTION_TOKEN_RE.source, 'g');
  let match;
  while ((match = re.exec(text)) !== null) {
    const type = normalizeRecordLinkType(match[1]);
    const id = String(match[2] || '').trim();
    if (!type || !id || type === 'person') continue;
    const key = `${type}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    refs.push({ type, id });
  }
  return refs;
}

export function buildVisibleRecordLinkSections(record = {}) {
  const links = normalizeRecordLinkFields(record);
  const sourceLinks = links.source_links;
  const primarySource = sourceLinks[0] ? [sourceLinks[0]] : [];
  const primarySourceKey = primarySource[0] ? recordLinkKey(primarySource[0]) : '';
  const deliverableKeys = new Set(links.deliverable_links.map(recordLinkKey));
  const referenceLinks = mergeRecordLinkLists(
    links.references,
    sourceLinks.slice(1),
  ).filter((link) => {
    const key = recordLinkKey(link);
    return key && key !== primarySourceKey && !deliverableKeys.has(key);
  });

  return [
    primarySource.length > 0 ? { kind: 'source', label: 'Source', links: primarySource } : null,
    links.deliverable_links.length > 0 ? { kind: 'deliverable', label: 'Deliverables', links: links.deliverable_links } : null,
    referenceLinks.length > 0 ? { kind: 'reference', label: 'References', links: referenceLinks } : null,
  ].filter(Boolean);
}
