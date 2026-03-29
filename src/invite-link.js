/**
 * Invite-link helpers for Flight Deck.
 *
 * Extracts a ?token= connection token from a URL and returns the parsed
 * workspace bootstrap state needed to connect to the invited workspace.
 */

import { parseSuperBasedToken } from './superbased-token.js';
import { workspaceFromToken } from './workspaces.js';
import { normalizeBackendUrl } from './utils/state-helpers.js';

/**
 * Parse a URL for an invite ?token= parameter.
 *
 * Returns null when no valid invite token is present.
 * Otherwise returns { token, backendUrl, workspaceOwnerNpub, workspace, cleanUrl }.
 */
export function extractInviteToken(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }

  const token = url.searchParams.get('token');
  if (!token) return null;

  const parsed = parseSuperBasedToken(token);
  if (!parsed.isValid || !parsed.directHttpsUrl) return null;

  const workspace = workspaceFromToken(token);
  if (!workspace) return null;

  // Build a clean URL without the token param
  url.searchParams.delete('token');
  const cleanSearch = url.searchParams.toString();
  const cleanUrl = url.pathname + (cleanSearch ? '?' + cleanSearch : '') + url.hash;

  return {
    token,
    backendUrl: normalizeBackendUrl(parsed.directHttpsUrl),
    workspaceOwnerNpub: parsed.workspaceOwnerNpub || workspace.workspaceOwnerNpub || '',
    workspace,
    cleanUrl,
  };
}
