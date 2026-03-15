import { nip19, verifyEvent } from 'nostr-tools';

function encodeBase64Json(value) {
  const json = JSON.stringify(value);
  if (typeof btoa === 'function') return btoa(json);
  if (typeof Buffer !== 'undefined') return Buffer.from(json, 'utf8').toString('base64');
  throw new Error('No base64 encoder available');
}

function isHexPubkey(value) {
  return /^[0-9a-f]{64}$/i.test(String(value || '').trim());
}

function encodeHexToNpub(pubkeyHex) {
  if (!isHexPubkey(pubkeyHex)) return null;
  try {
    return nip19.npubEncode(String(pubkeyHex).toLowerCase());
  } catch {
    return null;
  }
}

function decodeNpubToHex(npub) {
  if (!npub) return null;
  try {
    const decoded = nip19.decode(String(npub).trim());
    return decoded.type === 'npub' ? decoded.data : null;
  } catch {
    return null;
  }
}

function firstTagValue(tags, names) {
  for (const name of names) {
    const tag = tags.find((entry) => entry[0] === name && entry[1]);
    if (tag?.[1]) return tag[1];
  }
  return null;
}

function allTagValues(tags, names) {
  return tags
    .filter((entry) => names.includes(entry[0]) && entry[1])
    .map((entry) => entry[1]);
}

function firstObjectValue(obj, keys) {
  for (const key of keys) {
    const value = obj?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function objectRelayUrls(obj) {
  if (Array.isArray(obj?.relays)) {
    return obj.relays
      .filter((value) => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean);
  }

  const relay = firstObjectValue(obj, ['relay', 'relay_url']);
  return relay ? [relay] : [];
}

function normalizeTokenShape(tokenType, rawEvent, values) {
  const relayUrls = values.relayUrls ?? [];
  const serverNpub = values.serverNpub ?? null;
  const serverPubkeyHex = values.serverPubkeyHex ?? decodeNpubToHex(serverNpub);
  const workspaceOwnerNpub = values.workspaceOwnerNpub ?? values.workspaceNpub ?? null;
  const workspacePubkeyHex = values.workspacePubkeyHex ?? decodeNpubToHex(workspaceOwnerNpub);
  const workspaceNpub = workspaceOwnerNpub ?? encodeHexToNpub(workspacePubkeyHex);
  const appNpub = values.appNpub ?? null;
  const appPubkeyHex = values.appPubkeyHex ?? decodeNpubToHex(appNpub);
  const httpUrl = values.httpUrl ?? values.directHttpsUrl ?? null;

  return {
    rawEvent,
    tokenType,
    isValid: values.isValid === true,
    serverNpub,
    serverPubkeyHex,
    serviceNpub: serverNpub,
    servicePubkeyHex: serverPubkeyHex,
    workspaceOwnerNpub,
    workspaceNpub,
    workspacePubkeyHex,
    workspaceName: values.workspaceName ?? null,
    appNpub,
    appPubkeyHex,
    relayUrl: relayUrls[0] || null,
    relayUrls,
    httpUrl,
    directHttpsUrl: httpUrl,
    inviteId: values.inviteId ?? null,
  };
}

export function parseSuperBasedToken(tokenBase64) {
  try {
    const decodedJson = atob(String(tokenBase64 || '').trim());
    const parsed = JSON.parse(decodedJson);

    if (Array.isArray(parsed?.tags)) {
      const tags = parsed.tags;
      const hasAttestationTag = Boolean(tags.find((tag) => tag[0] === 'attestation'));
      const hasTokenMarker = firstTagValue(tags, ['d']) === 'superbased-token';
      const signatureValid = typeof parsed?.sig === 'string' && typeof parsed?.pubkey === 'string'
        ? verifyEvent(parsed)
        : false;

      return normalizeTokenShape('workspace_token_v3', parsed, {
        isValid: signatureValid || hasAttestationTag || hasTokenMarker,
        serverNpub: firstTagValue(tags, ['service_npub', 'server_npub', 'server', 'service']),
        serverPubkeyHex: firstTagValue(tags, ['server_pubkey', 'service_pubkey']),
        workspaceOwnerNpub: firstTagValue(tags, ['workspace_owner_npub', 'workspace_owner', 'workspace']),
        workspacePubkeyHex: isHexPubkey(parsed.pubkey) ? parsed.pubkey : null,
        workspaceName: firstTagValue(tags, ['workspace_name']),
        appNpub: firstTagValue(tags, ['app_npub', 'app']),
        appPubkeyHex: firstTagValue(tags, ['app_pubkey']),
        relayUrls: allTagValues(tags, ['relay']),
        directHttpsUrl: firstTagValue(tags, ['direct_https_url', 'backend_url', 'http', 'https', 'url', 'direct_http', 'direct_https']),
        inviteId: firstTagValue(tags, ['invite']),
      });
    }

    if (parsed?.type === 'superbased_connection') {
      const relayUrls = objectRelayUrls(parsed);
      const httpUrl = firstObjectValue(parsed, [
        'direct_https_url',
        'backend_url',
        'http',
        'https',
        'url',
        'direct_url',
      ]);
      const serverNpub = firstObjectValue(parsed, ['service_npub', 'server_npub']);
      const serverPubkeyHex = firstObjectValue(parsed, ['server_pubkey', 'service_pubkey']);

      return normalizeTokenShape(
        `connection_key_v${parsed.version || 1}`,
        parsed,
        {
          isValid: Boolean(httpUrl),
          serverNpub,
          serverPubkeyHex,
          workspaceOwnerNpub: firstObjectValue(parsed, ['workspace_owner_npub', 'workspace_npub']),
          workspacePubkeyHex: firstObjectValue(parsed, ['workspace_pubkey']),
          workspaceName: firstObjectValue(parsed, ['workspace_name']),
          appNpub: firstObjectValue(parsed, ['app_npub']),
          appPubkeyHex: firstObjectValue(parsed, ['app_pubkey']),
          relayUrls,
          directHttpsUrl: httpUrl,
          inviteId: firstObjectValue(parsed, ['invite_id', 'invite']),
        },
      );
    }

    return { isValid: false };
  } catch {
    return { isValid: false };
  }
}

export function buildSuperBasedConnectionToken({
  directHttpsUrl,
  serviceNpub,
  workspaceOwnerNpub,
  appNpub,
  relayUrls = [],
}) {
  const payload = {
    type: 'superbased_connection',
    version: 2,
    direct_https_url: String(directHttpsUrl || '').trim(),
  };

  if (serviceNpub) payload.service_npub = String(serviceNpub).trim();
  if (workspaceOwnerNpub) payload.workspace_owner_npub = String(workspaceOwnerNpub).trim();
  if (appNpub) payload.app_npub = String(appNpub).trim();

  const relays = Array.isArray(relayUrls)
    ? relayUrls.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  if (relays.length === 1) payload.relay = relays[0];
  if (relays.length > 1) payload.relays = relays;

  return encodeBase64Json(payload);
}
