import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/auth/nostr.js', () => ({
  createNip98AuthHeader: vi.fn(async (requestUrl, method) => `NIP98 ${method} ${requestUrl}`),
  createNip98AuthHeaderForSecret: vi.fn(async (requestUrl, method) => `NIP98-SECRET ${method} ${requestUrl}`),
}));

vi.mock('../src/crypto/workspace-keys.js', () => ({
  getActiveWorkspaceKeySecretForAuth: vi.fn(() => null),
  getActiveWorkspaceKeyNpub: vi.fn(() => null),
}));

vi.mock('../src/crypto/group-keys.js', () => ({
  createGroupWriteAuthHeader: vi.fn(async (groupRef) => `proof:${groupRef}`),
  getActiveSessionNpub: vi.fn(() => null),
}));

describe('fetchWorkspaceKeyMappings route', () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.window = { location: { origin: 'https://tower.example' } };
  });

  afterEach(() => {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('calls /api/v4/user/workspace-key-mappings with query param, not nested resource path', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ mappings: [] }),
      text: async () => JSON.stringify({ mappings: [] }),
    }));
    globalThis.fetch = fetchMock;

    const api = await import('../src/api.js');
    api.setBaseUrl('https://sb.example');
    await api.fetchWorkspaceKeyMappings('npub1owner');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0];
    expect(calledUrl).toBe(
      'https://sb.example/api/v4/user/workspace-key-mappings?workspace_owner_npub=npub1owner'
    );
  });

  it('does NOT use the old /workspaces/:owner/key-mappings path', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ mappings: [] }),
      text: async () => JSON.stringify({ mappings: [] }),
    }));
    globalThis.fetch = fetchMock;

    const api = await import('../src/api.js');
    api.setBaseUrl('https://sb.example');
    await api.fetchWorkspaceKeyMappings('npub1owner');

    const calledUrl = fetchMock.mock.calls[0][0];
    expect(calledUrl).not.toContain('/workspaces/npub1owner/key-mappings');
  });

  it('encodes special characters in the owner npub', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ mappings: [] }),
      text: async () => JSON.stringify({ mappings: [] }),
    }));
    globalThis.fetch = fetchMock;

    const api = await import('../src/api.js');
    api.setBaseUrl('https://sb.example');
    await api.fetchWorkspaceKeyMappings('npub1owner+test');

    const calledUrl = fetchMock.mock.calls[0][0];
    expect(calledUrl).toContain('workspace_owner_npub=npub1owner%2Btest');
  });
});
