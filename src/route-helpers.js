export const KNOWN_PAGES = new Set([
  'flight-deck', 'notifications', 'status', 'tasks', 'calendar', 'schedules',
  'chat', 'docs', 'reports', 'people', 'scopes', 'jobs', 'settings',
]);

export function pageToSection(page) {
  if (page === 'flight-deck' || page === 'notifications' || page === 'status') return 'status';
  if (KNOWN_PAGES.has(page)) return page;
  return null;
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
      token: url.searchParams.get('token') || null,
    },
  };
}
