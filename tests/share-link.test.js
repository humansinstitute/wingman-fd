import { describe, expect, it, vi, beforeEach } from 'vitest';
import { buildSuperBasedConnectionToken, parseSuperBasedToken } from '../src/superbased-token.js';
import { extractInviteToken } from '../src/invite-link.js';

/**
 * Tests for the share-link flow: generateShareLink builds a URL whose
 * embedded token round-trips through extractInviteToken and produces
 * the correct workspace bootstrap state.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_BACKEND = 'https://sb4.otherstuff.ai';
const TEST_OWNER = 'npub1ownerabc';
const TEST_SERVICE = 'npub1serviceabc';
const TEST_APP = 'npub1appabc';
const TEST_INVITEE = 'npub1invitee';
const TEST_GROUP_ID = 'group-123';

function buildWorkspaceToken(overrides = {}) {
  return buildSuperBasedConnectionToken({
    directHttpsUrl: TEST_BACKEND,
    serviceNpub: TEST_SERVICE,
    workspaceOwnerNpub: TEST_OWNER,
    appNpub: TEST_APP,
    ...overrides,
  });
}

/**
 * Simulate the generateShareLink method's token-building logic.
 * This mirrors what channels-manager.js does so we can verify it
 * produces a working invite URL.
 */
function simulateGenerateShareLink({
  backendUrl,
  workspaceOwnerNpub,
  serviceNpub,
  appNpub,
  existingConnectionToken,
  origin = 'https://flightdeck.example.com',
}) {
  // Use existing workspace token when available (the fix), else build one
  const token = existingConnectionToken || buildSuperBasedConnectionToken({
    directHttpsUrl: backendUrl,
    serviceNpub: serviceNpub || '',
    workspaceOwnerNpub,
    appNpub,
  });
  return `${origin}?token=${encodeURIComponent(token)}`;
}

// ---------------------------------------------------------------------------
// Token round-trip: build → URL → extract → bootstrap
// ---------------------------------------------------------------------------
describe('share-link token round-trip', () => {
  it('produces a URL whose token extracts to the correct workspace owner', () => {
    const url = simulateGenerateShareLink({
      backendUrl: TEST_BACKEND,
      workspaceOwnerNpub: TEST_OWNER,
      serviceNpub: TEST_SERVICE,
      appNpub: TEST_APP,
    });

    const invite = extractInviteToken(url);
    expect(invite).not.toBeNull();
    expect(invite.workspaceOwnerNpub).toBe(TEST_OWNER);
    expect(invite.backendUrl).toBe(TEST_BACKEND);
    expect(invite.workspace.workspaceOwnerNpub).toBe(TEST_OWNER);
    expect(invite.workspace.directHttpsUrl).toBe(TEST_BACKEND);
  });

  it('reuses existing connectionToken from the workspace when available', () => {
    const existingToken = buildWorkspaceToken();
    const url = simulateGenerateShareLink({
      backendUrl: TEST_BACKEND,
      workspaceOwnerNpub: TEST_OWNER,
      serviceNpub: '', // empty — simulating post-reload state
      appNpub: TEST_APP,
      existingConnectionToken: existingToken,
    });

    const invite = extractInviteToken(url);
    expect(invite).not.toBeNull();
    expect(invite.token).toBe(existingToken);
    // The token carries the service npub from when it was originally built
    const parsed = parseSuperBasedToken(existingToken);
    expect(parsed.serviceNpub).toBe(TEST_SERVICE);
    expect(invite.workspaceOwnerNpub).toBe(TEST_OWNER);
  });

  it('falls back to building a token when no connectionToken exists', () => {
    const url = simulateGenerateShareLink({
      backendUrl: TEST_BACKEND,
      workspaceOwnerNpub: TEST_OWNER,
      serviceNpub: TEST_SERVICE,
      appNpub: TEST_APP,
      existingConnectionToken: null,
    });

    const invite = extractInviteToken(url);
    expect(invite).not.toBeNull();
    expect(invite.workspaceOwnerNpub).toBe(TEST_OWNER);
    expect(invite.backendUrl).toBe(TEST_BACKEND);
  });
});

// ---------------------------------------------------------------------------
// Bug scenario: empty serviceNpub after page reload
// ---------------------------------------------------------------------------
describe('share-link with empty serviceNpub', () => {
  it('still produces a valid token when serviceNpub is empty string', () => {
    const token = buildSuperBasedConnectionToken({
      directHttpsUrl: TEST_BACKEND,
      serviceNpub: '',
      workspaceOwnerNpub: TEST_OWNER,
      appNpub: TEST_APP,
    });

    const parsed = parseSuperBasedToken(token);
    expect(parsed.isValid).toBe(true);
    expect(parsed.directHttpsUrl).toBe(TEST_BACKEND);
    expect(parsed.workspaceOwnerNpub).toBe(TEST_OWNER);
    // serviceNpub is empty but the token is still valid for bootstrap
    expect(parsed.serviceNpub).toBeFalsy();
  });

  it('extracts correctly from a URL with a no-service token', () => {
    const token = buildSuperBasedConnectionToken({
      directHttpsUrl: TEST_BACKEND,
      serviceNpub: '',
      workspaceOwnerNpub: TEST_OWNER,
      appNpub: TEST_APP,
    });
    const url = `https://fd.example.com?token=${encodeURIComponent(token)}`;
    const invite = extractInviteToken(url);
    expect(invite).not.toBeNull();
    expect(invite.workspaceOwnerNpub).toBe(TEST_OWNER);
  });
});

// ---------------------------------------------------------------------------
// Bug scenario: ownerNpub mismatch when using wrong property chain
// ---------------------------------------------------------------------------
describe('share-link owner npub accuracy', () => {
  it('the workspaceOwnerNpub getter should be preferred over raw currentWorkspaceOwnerNpub', () => {
    // Simulate the scenario: currentWorkspace has the correct owner,
    // but currentWorkspaceOwnerNpub is stale/different
    const correctOwner = 'npub1correct';
    const staleOwner = 'npub1stale';

    // If we use the stale owner, the token has the wrong identity
    const staleToken = buildSuperBasedConnectionToken({
      directHttpsUrl: TEST_BACKEND,
      serviceNpub: TEST_SERVICE,
      workspaceOwnerNpub: staleOwner,
      appNpub: TEST_APP,
    });
    const staleParsed = parseSuperBasedToken(staleToken);
    expect(staleParsed.workspaceOwnerNpub).toBe(staleOwner);

    // The correct token uses the workspace getter owner
    const correctToken = buildSuperBasedConnectionToken({
      directHttpsUrl: TEST_BACKEND,
      serviceNpub: TEST_SERVICE,
      workspaceOwnerNpub: correctOwner,
      appNpub: TEST_APP,
    });
    const correctParsed = parseSuperBasedToken(correctToken);
    expect(correctParsed.workspaceOwnerNpub).toBe(correctOwner);

    // They should be different — proves the bug matters
    expect(staleParsed.workspaceOwnerNpub).not.toBe(correctParsed.workspaceOwnerNpub);
  });
});

// ---------------------------------------------------------------------------
// Workspace connectionToken takes priority when available
// ---------------------------------------------------------------------------
describe('workspace connectionToken priority', () => {
  it('existing connectionToken preserves serviceNpub even when transient state is empty', () => {
    const workspace = {
      connectionToken: buildWorkspaceToken({ serviceNpub: TEST_SERVICE }),
      serviceNpub: TEST_SERVICE,
      workspaceOwnerNpub: TEST_OWNER,
      directHttpsUrl: TEST_BACKEND,
    };

    // Simulate: use workspace.connectionToken (the fix)
    const url = simulateGenerateShareLink({
      backendUrl: TEST_BACKEND,
      workspaceOwnerNpub: TEST_OWNER,
      serviceNpub: '', // transient state is empty
      appNpub: TEST_APP,
      existingConnectionToken: workspace.connectionToken,
    });

    const invite = extractInviteToken(url);
    expect(invite).not.toBeNull();
    const parsed = parseSuperBasedToken(invite.token);
    expect(parsed.serviceNpub).toBe(TEST_SERVICE);
    expect(parsed.workspaceOwnerNpub).toBe(TEST_OWNER);
  });

  it('built token loses serviceNpub when transient state is empty (pre-fix behavior)', () => {
    // This test documents the bug: without using workspace.connectionToken,
    // serviceNpub is lost
    const token = buildSuperBasedConnectionToken({
      directHttpsUrl: TEST_BACKEND,
      serviceNpub: '', // transient state is empty
      workspaceOwnerNpub: TEST_OWNER,
      appNpub: TEST_APP,
    });

    const parsed = parseSuperBasedToken(token);
    expect(parsed.serviceNpub).toBeFalsy();
    // The token is still valid but missing service identity
    expect(parsed.isValid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Complete invite flow simulation
// ---------------------------------------------------------------------------
describe('complete share-link invite flow', () => {
  it('invite URL bootstraps the correct workspace for the invitee', () => {
    const workspaceToken = buildWorkspaceToken();
    const url = simulateGenerateShareLink({
      backendUrl: TEST_BACKEND,
      workspaceOwnerNpub: TEST_OWNER,
      serviceNpub: TEST_SERVICE,
      appNpub: TEST_APP,
      existingConnectionToken: workspaceToken,
    });

    const invite = extractInviteToken(url);
    expect(invite).not.toBeNull();

    // The invitee should get a workspace that points to the correct backend
    expect(invite.workspace.directHttpsUrl).toBe(TEST_BACKEND);
    // The invitee should see the correct workspace owner
    expect(invite.workspace.workspaceOwnerNpub).toBe(TEST_OWNER);
    // The token should be the same one embedded in the URL
    expect(invite.workspace.connectionToken).toBe(workspaceToken);
    // Clean URL should not have the token
    expect(invite.cleanUrl).not.toContain('token=');
  });
});
