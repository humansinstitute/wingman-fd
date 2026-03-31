import { describe, expect, it } from 'vitest';

import { slugify, findWorkspaceBySlug, normalizeWorkspaceEntry } from '../src/workspaces.js';
import { parseRouteLocation } from '../src/route-helpers.js';

describe('slugify', () => {
  it('converts a workspace name to a URL-safe slug', () => {
    expect(slugify('Be Free')).toBe('be-free');
  });

  it('handles accented characters', () => {
    expect(slugify('Café Résumé')).toBe('cafe-resume');
  });

  it('strips leading/trailing hyphens', () => {
    expect(slugify('--hello--')).toBe('hello');
  });

  it('collapses multiple non-alpha chars', () => {
    expect(slugify('My  !!  Workspace')).toBe('my-workspace');
  });

  it('returns "workspace" for empty/blank input', () => {
    expect(slugify('')).toBe('workspace');
    expect(slugify('   ')).toBe('workspace');
    expect(slugify(null)).toBe('workspace');
    expect(slugify(undefined)).toBe('workspace');
  });

  it('handles purely numeric names', () => {
    expect(slugify('123')).toBe('123');
  });
});

describe('normalizeWorkspaceEntry slug field', () => {
  it('derives slug from name when no slug provided', () => {
    const ws = normalizeWorkspaceEntry({
      workspace_owner_npub: 'npub1test',
      name: 'Be Free',
    });
    expect(ws.slug).toBe('be-free');
  });

  it('preserves explicit slug when provided', () => {
    const ws = normalizeWorkspaceEntry({
      workspace_owner_npub: 'npub1test',
      name: 'Be Free',
      slug: 'my-custom-slug',
    });
    expect(ws.slug).toBe('my-custom-slug');
  });

  it('falls back to "workspace" when name is empty and no slug', () => {
    const ws = normalizeWorkspaceEntry({
      workspace_owner_npub: 'npub1test',
    });
    expect(ws.slug).toBe('workspace');
  });
});

describe('findWorkspaceBySlug', () => {
  const workspaces = [
    normalizeWorkspaceEntry({ workspace_owner_npub: 'npub1a', name: 'Be Free' }),
    normalizeWorkspaceEntry({ workspace_owner_npub: 'npub1b', name: 'Other Stuff' }),
  ];

  it('finds a workspace by its slug', () => {
    const found = findWorkspaceBySlug(workspaces, 'be-free');
    expect(found).not.toBeNull();
    expect(found.workspaceOwnerNpub).toBe('npub1a');
  });

  it('finds the second workspace', () => {
    const found = findWorkspaceBySlug(workspaces, 'other-stuff');
    expect(found).not.toBeNull();
    expect(found.workspaceOwnerNpub).toBe('npub1b');
  });

  it('returns null for unknown slug', () => {
    expect(findWorkspaceBySlug(workspaces, 'nope')).toBeNull();
  });

  it('returns null for empty/null slug', () => {
    expect(findWorkspaceBySlug(workspaces, '')).toBeNull();
    expect(findWorkspaceBySlug(workspaces, null)).toBeNull();
  });

  it('returns null for non-array workspaces', () => {
    expect(findWorkspaceBySlug(null, 'be-free')).toBeNull();
  });
});

describe('parseRouteLocation', () => {
  const base = 'http://localhost:5173';

  it('parses root / as flight deck with no slug', () => {
    const route = parseRouteLocation(`${base}/`);
    expect(route.section).toBe('status');
    expect(route.workspaceSlug).toBeNull();
  });

  it('parses bare /<page> as backward compat (no slug)', () => {
    const route = parseRouteLocation(`${base}/tasks`);
    expect(route.section).toBe('tasks');
    expect(route.workspaceSlug).toBeNull();
  });

  it('parses /<slug>/<page> correctly', () => {
    const route = parseRouteLocation(`${base}/be-free/tasks`);
    expect(route.section).toBe('tasks');
    expect(route.workspaceSlug).toBe('be-free');
  });

  it('maps flight-deck page to status section', () => {
    const route = parseRouteLocation(`${base}/be-free/flight-deck`);
    expect(route.section).toBe('status');
    expect(route.workspaceSlug).toBe('be-free');
  });

  it('maps notifications page to status section', () => {
    const route = parseRouteLocation(`${base}/be-free/notifications`);
    expect(route.section).toBe('status');
    expect(route.workspaceSlug).toBe('be-free');
  });

  it('parses /<slug> alone as workspace root with flight deck default', () => {
    const route = parseRouteLocation(`${base}/be-free`);
    expect(route.workspaceSlug).toBe('be-free');
    expect(route.section).toBe('status');
  });

  it('extracts query params alongside slug', () => {
    const route = parseRouteLocation(`${base}/be-free/tasks?scopeid=abc&taskid=xyz`);
    expect(route.workspaceSlug).toBe('be-free');
    expect(route.section).toBe('tasks');
    expect(route.params.scopeid).toBe('abc');
    expect(route.params.taskid).toBe('xyz');
  });

  it('extracts workspace identity hints alongside slug', () => {
    const route = parseRouteLocation(
      `${base}/be-free/chat?workspacekey=${encodeURIComponent('service:npub1ai::workspace:npub1ws')}&channelid=chan-1`,
    );
    expect(route.workspaceSlug).toBe('be-free');
    expect(route.section).toBe('chat');
    expect(route.params.workspacekey).toBe('service:npub1ai::workspace:npub1ws');
    expect(route.params.channelid).toBe('chan-1');
  });

  it('extracts report query params alongside slug', () => {
    const route = parseRouteLocation(`${base}/be-free/reports?scopeid=abc&reportid=report-1`);
    expect(route.workspaceSlug).toBe('be-free');
    expect(route.section).toBe('reports');
    expect(route.params.scopeid).toBe('abc');
    expect(route.params.reportid).toBe('report-1');
  });

  it('parses all known page sections', () => {
    const pages = ['chat', 'tasks', 'calendar', 'schedules', 'docs', 'reports', 'people', 'scopes', 'settings'];
    for (const page of pages) {
      const route = parseRouteLocation(`${base}/my-ws/${page}`);
      expect(route.workspaceSlug).toBe('my-ws');
      expect(route.section).toBe(page);
    }
  });

  it('parses bare /notifications as status section (backward compat)', () => {
    const route = parseRouteLocation(`${base}/notifications`);
    expect(route.section).toBe('status');
    expect(route.workspaceSlug).toBeNull();
  });

  it('treats unknown single segment as workspace slug', () => {
    const route = parseRouteLocation(`${base}/my-company`);
    expect(route.workspaceSlug).toBe('my-company');
    expect(route.section).toBe('status');
  });

  it('handles trailing slashes', () => {
    const route = parseRouteLocation(`${base}/be-free/docs/`);
    expect(route.workspaceSlug).toBe('be-free');
    expect(route.section).toBe('docs');
  });
});
