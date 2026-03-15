import { APP_NPUB } from './app-identity.js';
import { buildSuperBasedConnectionToken, parseSuperBasedToken } from './superbased-token.js';

export function normalizeWorkspaceEntry(raw = {}) {
  const workspaceOwnerNpub = String(
    raw.workspaceOwnerNpub
    || raw.workspace_owner_npub
    || raw.owner_npub
    || ''
  ).trim();
  if (!workspaceOwnerNpub) return null;

  const directHttpsUrl = String(
    raw.directHttpsUrl
    || raw.direct_https_url
    || raw.backendUrl
    || raw.httpUrl
    || ''
  ).trim();
  const serviceNpub = String(raw.serviceNpub || raw.service_npub || '').trim() || null;
  const appNpub = String(raw.appNpub || raw.app_npub || APP_NPUB || '').trim() || null;
  const relayUrls = Array.isArray(raw.relayUrls)
    ? raw.relayUrls.map((value) => String(value || '').trim()).filter(Boolean)
    : [];

  const connectionToken = raw.connectionToken
    || raw.connection_token
    || buildSuperBasedConnectionToken({
      directHttpsUrl,
      serviceNpub,
      workspaceOwnerNpub,
      appNpub,
      relayUrls,
    });

  return {
    workspaceOwnerNpub,
    name: String(raw.name || '').trim() || 'Untitled workspace',
    description: String(raw.description || '').trim(),
    directHttpsUrl,
    serviceNpub,
    appNpub,
    relayUrls,
    defaultGroupNpub: String(raw.defaultGroupNpub || raw.default_group_npub || '').trim() || null,
    defaultGroupId: String(raw.defaultGroupId || raw.default_group_id || '').trim() || null,
    privateGroupNpub: String(raw.privateGroupNpub || raw.private_group_npub || '').trim() || null,
    privateGroupId: String(raw.privateGroupId || raw.private_group_id || '').trim() || null,
    creatorNpub: String(raw.creatorNpub || raw.creator_npub || '').trim() || null,
    wrappedWorkspaceNsec: String(raw.wrappedWorkspaceNsec || raw.wrapped_workspace_nsec || '').trim() || null,
    wrappedByNpub: String(raw.wrappedByNpub || raw.wrapped_by_npub || '').trim() || null,
    connectionToken,
  };
}

export function mergeWorkspaceEntries(existing = [], incoming = []) {
  const next = new Map();
  for (const entry of existing) {
    const normalized = normalizeWorkspaceEntry(entry);
    if (normalized) next.set(normalized.workspaceOwnerNpub, normalized);
  }
  for (const entry of incoming) {
    const normalized = normalizeWorkspaceEntry(entry);
    if (!normalized) continue;
    next.set(normalized.workspaceOwnerNpub, {
      ...(next.get(normalized.workspaceOwnerNpub) || {}),
      ...normalized,
    });
  }
  return [...next.values()];
}

export function workspaceFromToken(token, extras = {}) {
  const parsed = parseSuperBasedToken(token);
  if (!parsed?.isValid || !parsed?.directHttpsUrl) return null;
  return normalizeWorkspaceEntry({
    workspaceOwnerNpub: parsed.workspaceOwnerNpub || extras.workspaceOwnerNpub,
    name: extras.name || '',
    description: extras.description || '',
    directHttpsUrl: parsed.directHttpsUrl,
    serviceNpub: parsed.serviceNpub,
    appNpub: parsed.appNpub,
    relayUrls: parsed.relayUrls || [],
    connectionToken: token,
  });
}
