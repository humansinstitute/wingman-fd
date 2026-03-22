import { APP_NPUB } from './app-identity.js';
import { buildSuperBasedConnectionToken, parseSuperBasedToken } from './superbased-token.js';

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function firstOwnValue(obj, keys) {
  for (const key of keys) {
    if (hasOwn(obj, key)) return { found: true, value: obj[key] };
  }
  return { found: false, value: undefined };
}

export function slugify(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'workspace';
}

function sanitizeOptionalString(value) {
  if (value == null) return null;
  const trimmed = String(value || '').trim();
  return trimmed || null;
}

function sanitizeRelayUrls(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry || '').trim()).filter(Boolean);
}

export function normalizeWorkspaceEntry(raw = {}) {
  const token = String(raw.connectionToken || raw.connection_token || '').trim();
  const parsedToken = token ? parseSuperBasedToken(token) : { isValid: false };
  const workspaceOwnerNpub = String(
    raw.workspaceOwnerNpub
    || raw.workspace_owner_npub
    || raw.owner_npub
    || parsedToken.workspaceOwnerNpub
    || ''
  ).trim();
  if (!workspaceOwnerNpub) return null;

  const directHttpsUrl = String(
    raw.directHttpsUrl
    || raw.direct_https_url
    || raw.backendUrl
    || raw.httpUrl
    || parsedToken.directHttpsUrl
    || ''
  ).trim();
  const serviceNpub = String(raw.serviceNpub || raw.service_npub || parsedToken.serviceNpub || '').trim() || null;
  const appNpub = String(raw.appNpub || raw.app_npub || parsedToken.appNpub || APP_NPUB || '').trim() || null;
  const relayUrls = sanitizeRelayUrls(raw.relayUrls ?? raw.relay_urls ?? parsedToken.relayUrls);
  const name = String(
    raw.name
    ?? raw.workspace_name
    ?? raw.workspaceName
    ?? ''
  ).trim();
  const description = String(
    raw.description
    ?? raw.workspace_description
    ?? raw.workspaceDescription
    ?? ''
  ).trim();
  const avatarUrl = sanitizeOptionalString(
    raw.avatarUrl
    ?? raw.avatar_url
    ?? raw.workspace_avatar_url
    ?? raw.workspaceAvatarUrl
    ?? null,
  );

  const connectionToken = token
    || buildSuperBasedConnectionToken({
      directHttpsUrl,
      serviceNpub,
      workspaceOwnerNpub,
      appNpub,
      relayUrls,
    });

  const slug = String(raw.slug || '').trim() || slugify(name);

  return {
    workspaceOwnerNpub,
    name,
    slug,
    description,
    avatarUrl,
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

function normalizeWorkspacePatch(raw = {}) {
  const normalized = normalizeWorkspaceEntry(raw);
  if (!normalized) return null;

  const patch = { workspaceOwnerNpub: normalized.workspaceOwnerNpub };
  const fieldMap = [
    [['name', 'workspace_name', 'workspaceName'], 'name'],
    [['slug'], 'slug'],
    [['description', 'workspace_description', 'workspaceDescription'], 'description'],
    [['avatarUrl', 'avatar_url', 'workspace_avatar_url', 'workspaceAvatarUrl'], 'avatarUrl'],
    [['directHttpsUrl', 'direct_https_url', 'backendUrl', 'httpUrl'], 'directHttpsUrl'],
    [['serviceNpub', 'service_npub'], 'serviceNpub'],
    [['appNpub', 'app_npub'], 'appNpub'],
    [['defaultGroupNpub', 'default_group_npub'], 'defaultGroupNpub'],
    [['defaultGroupId', 'default_group_id'], 'defaultGroupId'],
    [['privateGroupNpub', 'private_group_npub'], 'privateGroupNpub'],
    [['privateGroupId', 'private_group_id'], 'privateGroupId'],
    [['creatorNpub', 'creator_npub'], 'creatorNpub'],
    [['wrappedWorkspaceNsec', 'wrapped_workspace_nsec'], 'wrappedWorkspaceNsec'],
    [['wrappedByNpub', 'wrapped_by_npub'], 'wrappedByNpub'],
    [['connectionToken', 'connection_token'], 'connectionToken'],
  ];

  for (const [keys, normalizedKey] of fieldMap) {
    if (firstOwnValue(raw, keys).found) patch[normalizedKey] = normalized[normalizedKey];
  }
  if (firstOwnValue(raw, ['relayUrls', 'relay_urls']).found) patch.relayUrls = normalized.relayUrls;

  return patch;
}

export function mergeWorkspaceEntries(existing = [], incoming = []) {
  const next = new Map();
  for (const entry of existing) {
    const normalized = normalizeWorkspaceEntry(entry);
    if (normalized) next.set(normalized.workspaceOwnerNpub, normalized);
  }
  for (const entry of incoming) {
    const patch = normalizeWorkspacePatch(entry);
    if (!patch) continue;
    const current = next.get(patch.workspaceOwnerNpub) || {};
    const merged = normalizeWorkspaceEntry({
      ...current,
      ...patch,
    });
    if (merged) next.set(merged.workspaceOwnerNpub, merged);
  }
  return [...next.values()];
}

export function findWorkspaceBySlug(workspaces, slug) {
  if (!slug || !Array.isArray(workspaces)) return null;
  return workspaces.find((w) => w.slug === slug) || null;
}

export function workspaceFromToken(token, extras = {}) {
  const parsed = parseSuperBasedToken(token);
  if (!parsed?.isValid || !parsed?.directHttpsUrl) return null;
  const workspaceOwnerNpub = String(parsed.workspaceOwnerNpub || extras.workspaceOwnerNpub || '').trim();
  if (!workspaceOwnerNpub) return null;

  const workspace = {
    workspaceOwnerNpub,
    directHttpsUrl: parsed.directHttpsUrl,
    serviceNpub: parsed.serviceNpub,
    appNpub: parsed.appNpub,
    relayUrls: parsed.relayUrls || [],
    connectionToken: token,
  };

  const name = String(parsed.workspaceName || extras.name || '').trim();
  if (name) workspace.name = name;

  const description = String(extras.description || '').trim();
  if (description) workspace.description = description;

  return workspace;
}
