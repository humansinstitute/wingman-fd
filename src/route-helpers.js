export const KNOWN_PAGES = new Set([
  'flight-deck', 'notifications', 'status', 'tasks', 'calendar', 'schedules',
  'chat', 'docs', 'reports', 'people', 'scopes', 'jobs', 'settings',
]);

export function pageToSection(page) {
  if (page === 'flight-deck' || page === 'notifications' || page === 'status') return 'status';
  if (KNOWN_PAGES.has(page)) return page;
  return null;
}

/**
 * Build a section URL that always carries scopeid when present.
 * @param {object} opts
 * @param {string} [opts.workspaceSlug] - workspace slug for the path prefix
 * @param {string} opts.section - target section (tasks, chat, docs, etc.)
 * @param {string|null} [opts.scopeid] - active scope to preserve across navigation
 * @param {object} [opts.params] - additional query params (channelid, taskid, etc.)
 * @returns {string} pathname + search string
 */
export function buildSectionUrl({ workspaceSlug, section, scopeid, params } = {}) {
  const page = section === 'status' ? 'flight-deck' : section;
  const pathname = workspaceSlug ? `/${workspaceSlug}/${page}` : `/${page}`;

  const searchParams = new URLSearchParams();
  if (scopeid) searchParams.set('scopeid', scopeid);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value) searchParams.set(key, value);
    }
  }

  const search = searchParams.toString();
  return search ? `${pathname}?${search}` : pathname;
}

export function parseRouteLocation(href) {
  if (typeof window === 'undefined' && !href) {
    return { section: 'status', params: {}, workspaceSlug: null };
  }

  const url = new URL(href || window.location.href);
  const segments = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean);

  let workspaceSlug = null;
  let section = 'status';

  if (segments.length === 0) {
    // Root path: /
  } else if (segments.length === 1) {
    // Either /<page> (canonical or backward compat) or /<slug> (workspace root)
    const mapped = pageToSection(segments[0]);
    if (mapped) {
      section = mapped;
    } else {
      workspaceSlug = segments[0];
    }
  } else {
    // /<slug>/<page>
    workspaceSlug = segments[0];
    const mapped = pageToSection(segments[1]);
    if (mapped) section = mapped;
  }

  return {
    section,
    workspaceSlug,
    params: {
      channelid: url.searchParams.get('channelid') || null,
      threadid: url.searchParams.get('threadid') || null,
      folderid: url.searchParams.get('folderid') || null,
      docid: url.searchParams.get('docid') || null,
      versioning: url.searchParams.get('versioning') || null,
      commentid: url.searchParams.get('commentid') || null,
      scopeid: url.searchParams.get('scopeid') || null,
      descendants: url.searchParams.get('descendants') || null,
      groupid: url.searchParams.get('groups') || url.searchParams.get('groupid') || null,
      reportid: url.searchParams.get('reportid') || null,
      taskid: url.searchParams.get('taskid') || null,
      view: url.searchParams.get('view') || null,
      workspacekey: url.searchParams.get('workspacekey') || null,
      token: url.searchParams.get('token') || null,
    },
  };
}
