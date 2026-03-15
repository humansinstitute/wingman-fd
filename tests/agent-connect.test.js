import { describe, expect, it } from 'vitest';
import { buildAgentConnectPackage } from '../src/agent-connect.js';
import { parseSuperBasedToken } from '../src/superbased-token.js';

describe('buildAgentConnectPackage', () => {
  it('builds a v4 agent package with live service urls', () => {
    const pkg = buildAgentConnectPackage({
      windowOrigin: 'https://open-cap-rose.wm21.otherstuff.ai',
      backendUrl: 'https://sb4.otherstuff.studio',
      session: {
        npub: 'npub1owner',
        pubkey: 'a'.repeat(64),
      },
      token: btoa(JSON.stringify({
        type: 'superbased_connection',
        version: 2,
        direct_https_url: 'https://sb4.otherstuff.studio',
        service_npub: 'npub1service',
      })),
    });

    expect(pkg.kind).toBe('coworker_agent_connect');
    expect(pkg.service.direct_https_url).toBe('https://sb4.otherstuff.studio');
    expect(pkg.service.openapi_url).toBe('https://sb4.otherstuff.studio/openapi.json');
    expect(pkg.guide_url).toBe('https://open-cap-rose.wm21.otherstuff.ai/agentconnect.md');
    expect(pkg.workspace.owner_npub).toBe('npub1owner');
    expect(pkg.workspace.owner_pubkey).toBe('a'.repeat(64));
    expect(pkg.app.app_npub).toMatch(/^npub1/);
    expect(pkg.connection_token).toBeTruthy();
  });

  it('generates a connection token when one is not already present', () => {
    const pkg = buildAgentConnectPackage({
      windowOrigin: 'https://open-cap-rose.wm21.otherstuff.ai',
      backendUrl: 'https://sb4.otherstuff.studio',
      session: {
        npub: 'npub1owner',
        pubkey: 'b'.repeat(64),
      },
    });

    const parsed = parseSuperBasedToken(pkg.connection_token);
    expect(parsed.isValid).toBe(true);
    expect(parsed.directHttpsUrl).toBe('https://sb4.otherstuff.studio');
    expect(parsed.workspaceOwnerNpub).toBe('npub1owner');
    expect(parsed.appNpub).toMatch(/^npub1/);
  });
});
