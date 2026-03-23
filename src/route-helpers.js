export const KNOWN_PAGES = new Set([
  'notifications', 'status', 'tasks', 'calendar', 'schedules',
  'chat', 'docs', 'people', 'scopes', 'settings',
]);

export function pageToSection(page) {
  if (page === 'notifications' || page === 'status') return 'status';
  if (KNOWN_PAGES.has(page)) return page;
  return null;
}

export function parseRouteLocation(href) {
  if (typeof window === 'undefined' && !href) {
    return { section: 'chat', params: {}, workspaceSlug: null };
  }

  const url = new URL(href || window.location.href);
  const segments = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean);

  let workspaceSlug = null;
  let section = 'chat';

  if (segments.length === 0) {
    // Root path: /
  } else if (segments.length === 1) {
    // Either /<page> (backward compat) or /<slug> (workspace root)
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
      taskid: url.searchParams.get('taskid') || null,
      view: url.searchParams.get('view') || null,
    },
  };
}
