import { describe, expect, it } from 'vitest';
import { parseSuperBasedToken } from '../src/superbased-token.js';

describe('parseSuperBasedToken', () => {
  it('parses v1 connection keys', () => {
    const token = btoa(JSON.stringify({
      type: 'superbased_connection',
      direct_https_url: 'https://sb4.otherstuff.studio',
      relay: 'wss://cvm.otherstuff.studio',
      app_npub: 'npub1app',
      service_npub: 'npub1service',
      workspace_owner_npub: 'npub1owner',
    }));

    expect(parseSuperBasedToken(token)).toEqual(expect.objectContaining({
      isValid: true,
      tokenType: 'connection_key_v1',
      httpUrl: 'https://sb4.otherstuff.studio',
      directHttpsUrl: 'https://sb4.otherstuff.studio',
      relayUrl: 'wss://cvm.otherstuff.studio',
      appNpub: 'npub1app',
      serverNpub: 'npub1service',
      serviceNpub: 'npub1service',
      workspaceOwnerNpub: 'npub1owner',
    }));
  });

  it('parses signed workspace tokens with service and workspace identity', () => {
    const token = btoa(JSON.stringify({
      kind: 30078,
      pubkey: 'f'.repeat(64),
      sig: 'sig',
      tags: [
        ['d', 'superbased-token'],
        ['service_npub', 'npub1service'],
        ['workspace_owner', 'npub1workspaceowner'],
        ['app_npub', 'npub1app'],
        ['relay', 'wss://cvm.otherstuff.studio'],
        ['backend_url', 'https://sb.wm21.otherstuff.ai'],
      ],
    }));

    expect(parseSuperBasedToken(token)).toEqual(expect.objectContaining({
      isValid: true,
      tokenType: 'workspace_token_v3',
      httpUrl: 'https://sb.wm21.otherstuff.ai',
      directHttpsUrl: 'https://sb.wm21.otherstuff.ai',
      relayUrl: 'wss://cvm.otherstuff.studio',
      serverNpub: 'npub1service',
      workspaceOwnerNpub: 'npub1workspaceowner',
      workspaceNpub: 'npub1workspaceowner',
      appNpub: 'npub1app',
      workspacePubkeyHex: 'f'.repeat(64),
    }));
  });

  it('rejects invalid tokens', () => {
    expect(parseSuperBasedToken('not-base64')).toEqual({ isValid: false });
  });
});
