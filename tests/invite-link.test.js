import { describe, expect, it } from 'vitest';

import { parseRouteLocation } from '../src/route-helpers.js';
import { extractInviteToken } from '../src/invite-link.js';
import { buildSuperBasedConnectionToken } from '../src/superbased-token.js';

// ---------------------------------------------------------------------------
// Helper: build a valid connection token for test URLs
// ---------------------------------------------------------------------------
function buildTestToken(overrides = {}) {
  return buildSuperBasedConnectionToken({
    directHttpsUrl: 'https://sb4.otherstuff.ai',
    serviceNpub: 'npub1service',
    workspaceOwnerNpub: 'npub1workspace',
    appNpub: 'npub1app',
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// parseRouteLocation — ?token= extraction
// ---------------------------------------------------------------------------
describe('parseRouteLocation extracts token param', () => {
  const base = 'http://localhost:5173';

  it('returns token from query string', () => {
    const token = buildTestToken();
    const route = parseRouteLocation(`${base}/be-free/tasks?token=${encodeURIComponent(token)}`);
    expect(route.params.token).toBe(token);
    expect(route.section).toBe('tasks');
    expect(route.workspaceSlug).toBe('be-free');
  });

  it('returns null when no token param is present', () => {
    const route = parseRouteLocation(`${base}/be-free/tasks?scopeid=abc`);
    expect(route.params.token).toBeNull();
  });

  it('returns token even at the root path', () => {
    const token = buildTestToken();
    const route = parseRouteLocation(`${base}/?token=${encodeURIComponent(token)}`);
    expect(route.params.token).toBe(token);
    expect(route.section).toBe('status');
    expect(route.workspaceSlug).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractInviteToken — parses and applies URL token to bootstrap state
// ---------------------------------------------------------------------------
describe('extractInviteToken', () => {
  it('returns null when no token param exists', () => {
    const result = extractInviteToken('http://localhost:5173/be-free/tasks');
    expect(result).toBeNull();
  });

  it('returns null for an invalid/malformed token', () => {
    const result = extractInviteToken('http://localhost:5173/?token=garbage');
    expect(result).toBeNull();
  });

  it('parses a valid connection token and returns workspace fields', () => {
    const token = buildTestToken();
    const url = `http://localhost:5173/be-free/tasks?token=${encodeURIComponent(token)}`;
    const result = extractInviteToken(url);

    expect(result).not.toBeNull();
    expect(result.token).toBe(token);
    expect(result.backendUrl).toBe('https://sb4.otherstuff.ai');
    expect(result.workspaceOwnerNpub).toBe('npub1workspace');
    expect(result.workspace).not.toBeNull();
    expect(result.workspace.workspaceOwnerNpub).toBe('npub1workspace');
    expect(result.workspace.directHttpsUrl).toBe('https://sb4.otherstuff.ai');
    expect(result.workspace.connectionToken).toBe(token);
  });

  it('returns cleanUrl without the token param', () => {
    const token = buildTestToken();
    const url = `http://localhost:5173/be-free/tasks?token=${encodeURIComponent(token)}&scopeid=abc`;
    const result = extractInviteToken(url);

    expect(result.cleanUrl).not.toContain('token=');
    expect(result.cleanUrl).toContain('scopeid=abc');
    expect(result.cleanUrl).toContain('/be-free/tasks');
  });

  it('strips token cleanly when it is the only param', () => {
    const token = buildTestToken();
    const url = `http://localhost:5173/be-free/tasks?token=${encodeURIComponent(token)}`;
    const result = extractInviteToken(url);

    expect(result.cleanUrl).toBe('/be-free/tasks');
    expect(result.cleanUrl).not.toContain('?');
  });

  it('returns null for a token without a directHttpsUrl', () => {
    // Build a token that decodes but has no URL
    const tokenPayload = btoa(JSON.stringify({
      type: 'superbased_connection',
      version: 2,
    }));
    const url = `http://localhost:5173/?token=${encodeURIComponent(tokenPayload)}`;
    const result = extractInviteToken(url);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Integration: extractInviteToken overrides existing workspace state
// ---------------------------------------------------------------------------
describe('invite token overrides existing workspace', () => {
  it('returns workspace owner even when state already has a different workspace', () => {
    const token = buildTestToken({ workspaceOwnerNpub: 'npub1invited' });
    const url = `http://localhost:5173/?token=${encodeURIComponent(token)}`;
    const result = extractInviteToken(url);

    // The invite must force-select the invited workspace, not defer to existing state
    expect(result.workspaceOwnerNpub).toBe('npub1invited');
    expect(result.workspace.workspaceOwnerNpub).toBe('npub1invited');
  });
});
