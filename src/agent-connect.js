import { nip19 } from 'nostr-tools';
import { APP_NPUB, DEFAULT_SUPERBASED_URL } from './app-identity.js';
import { buildSuperBasedConnectionToken, parseSuperBasedToken } from './superbased-token.js';

function trimUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function withPath(base, path) {
  const root = trimUrl(base);
  return root ? `${root}${path}` : '';
}

function appPubkeyHexFromNpub(appNpub) {
  if (!appNpub) return null;
  try {
    const decoded = nip19.decode(String(appNpub).trim());
    return decoded.type === 'npub' ? decoded.data : null;
  } catch {
    return null;
  }
}

export function buildAgentConnectPackage({
  windowOrigin = '',
  backendUrl = '',
  session = null,
  token = '',
} = {}) {
  const origin = trimUrl(windowOrigin);
  const currentBackendUrl = trimUrl(backendUrl || DEFAULT_SUPERBASED_URL);
  const parsed = token ? parseSuperBasedToken(token) : { isValid: false };
  const workspaceOwnerNpub = parsed.workspaceOwnerNpub || session?.npub || '';
  const appNpub = parsed.appNpub || APP_NPUB;
  const serviceNpub = parsed.serviceNpub || '';
  const relayUrls = parsed.relayUrls || [];
  const effectiveToken = token && parsed.isValid
    ? token
    : buildSuperBasedConnectionToken({
        directHttpsUrl: currentBackendUrl,
        serviceNpub,
        workspaceOwnerNpub,
        appNpub,
        relayUrls,
      });

  return {
    kind: 'coworker_agent_connect',
    version: 4,
    generated_at: new Date().toISOString(),
    guide_url: withPath(origin, '/agentconnect.md'),
    robots_url: withPath(origin, '/robots.txt'),
    service: {
      direct_https_url: currentBackendUrl,
      openapi_url: withPath(currentBackendUrl, '/openapi.json'),
      docs_url: withPath(currentBackendUrl, '/docs'),
      health_url: withPath(currentBackendUrl, '/health'),
      service_npub: serviceNpub || null,
      relay_urls: relayUrls,
    },
    workspace: {
      owner_npub: workspaceOwnerNpub || null,
      owner_pubkey: session?.pubkey || null,
    },
    app: {
      app_npub: appNpub || null,
      app_pubkey: appPubkeyHexFromNpub(appNpub),
    },
    connection_token: effectiveToken,
    notes: [
      'Use the guide_url for connection and record-shape instructions.',
      'Use the service.open_api/docs URLs to inspect the live SuperBased v4 API.',
      'Use the connection_token to configure another Coworker/agent session against this workspace.',
    ],
  };
}
