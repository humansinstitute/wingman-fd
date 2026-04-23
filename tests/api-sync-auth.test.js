import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let workspaceSecret = null;
let workspaceNpub = null;
let sessionNpub = null;
const createNip98AuthHeaderMock = vi.fn(async (requestUrl, method) => `session ${method} ${requestUrl}`);
const createNip98AuthHeaderForSecretMock = vi.fn(async (requestUrl, method) => `workspace ${method} ${requestUrl}`);
const createGroupWriteAuthHeaderMock = vi.fn(async (groupRef) => `proof:${groupRef}`);

vi.mock('../src/auth/nostr.js', () => ({
  createNip98AuthHeader: createNip98AuthHeaderMock,
  createNip98AuthHeaderForSecret: createNip98AuthHeaderForSecretMock,
  localDecryptFromNpub: vi.fn(),
  localEncryptForNpub: vi.fn(() => 'ciphertext'),
  personalDecryptFromNpub: vi.fn(),
  personalEncryptForNpub: vi.fn(),
}));

vi.mock('../src/crypto/workspace-keys.js', () => ({
  getActiveWorkspaceKey: vi.fn(() => null),
  getActiveWorkspaceKeySecretForAuth: vi.fn(() => workspaceSecret),
  getActiveWorkspaceKeyNpub: vi.fn(() => workspaceNpub),
}));

vi.mock('../src/crypto/group-keys.js', () => ({
  createGroupWriteAuthHeader: createGroupWriteAuthHeaderMock,
  decryptPayloadForGroup: vi.fn(),
  encryptPayloadForGroup: vi.fn(),
  getActiveSessionNpub: vi.fn(() => sessionNpub),
  getGroupKey: vi.fn(() => null),
  getLoadedGroupKeyDiagnostics: vi.fn(() => ({})),
  hasGroupKey: vi.fn(() => false),
}));

describe('api sync auth and owner-write detection', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    workspaceSecret = null;
    workspaceNpub = null;
    sessionNpub = null;
    createNip98AuthHeaderMock.mockClear();
    createNip98AuthHeaderForSecretMock.mockClear();
    createGroupWriteAuthHeaderMock.mockClear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('skips group proofs when session user IS the owner_npub', async () => {
    workspaceSecret = new Uint8Array(32).fill(7);
    workspaceNpub = 'npub1workspacekey';
    // Session user matches owner_npub — owner write, no group proof needed
    sessionNpub = 'npub1realowner';

    const fetchMock = vi.fn(async (_requestUrl, options) => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        auth: options.headers.Authorization,
        body: JSON.parse(options.body),
      }),
      text: async () => '',
    }));
    globalThis.fetch = fetchMock;

    const api = await import('../src/api.js');
    api.setBaseUrl('https://sb.example');

    const result = await api.syncRecords({
      owner_npub: 'npub1realowner',
      records: [{
        record_id: 'rec-1',
        owner_npub: 'npub1realowner',
        signature_npub: 'npub1workspacekey',
        write_group_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      }],
    });

    expect(createNip98AuthHeaderForSecretMock).toHaveBeenCalledTimes(1);
    expect(createNip98AuthHeaderMock).not.toHaveBeenCalled();
    expect(createGroupWriteAuthHeaderMock).not.toHaveBeenCalled();
    expect(result.body.group_write_tokens).toEqual({});
    expect(result.auth).toContain('workspace POST https://sb.example/api/v4/records/sync');
  });

  it('generates group proofs when session user is NOT the owner_npub (workspace service identity)', async () => {
    workspaceSecret = new Uint8Array(32).fill(7);
    workspaceNpub = 'npub1workspacekey';
    // owner_npub is a workspace service identity — no user's npub matches it
    sessionNpub = 'npub1collaborator';

    const fetchMock = vi.fn(async (_requestUrl, options) => ({
      ok: true,
      status: 200,
      json: async () => ({ body: JSON.parse(options.body) }),
      text: async () => '',
    }));
    globalThis.fetch = fetchMock;

    const api = await import('../src/api.js');
    api.setBaseUrl('https://sb.example');

    const result = await api.syncRecords({
      owner_npub: 'npub1workspaceservicekey',
      records: [{
        record_id: 'rec-2',
        owner_npub: 'npub1workspaceservicekey',
        signature_npub: 'npub1workspacekey',
        write_group_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      }],
    });

    expect(createGroupWriteAuthHeaderMock).toHaveBeenCalledWith(
      '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      'https://sb.example/api/v4/records/sync',
      'POST',
      {
        owner_npub: 'npub1workspaceservicekey',
        records: [{
          record_id: 'rec-2',
          owner_npub: 'npub1workspaceservicekey',
          signature_npub: 'npub1workspacekey',
          write_group_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        }],
      },
    );
    expect(result.body.group_write_tokens).toEqual({
      '3fa85f64-5717-4562-b3fc-2c963f66afa6': 'proof:3fa85f64-5717-4562-b3fc-2c963f66afa6',
    });
  });

  it('uses the active workspace key as viewer_npub for record history reads', async () => {
    workspaceSecret = new Uint8Array(32).fill(7);
    workspaceNpub = 'npub1workspacekey';
    sessionNpub = 'npub1collaborator';

    const fetchMock = vi.fn(async (requestUrl) => ({
      ok: true,
      status: 200,
      json: async () => ({ requestUrl }),
      text: async () => '',
    }));
    globalThis.fetch = fetchMock;

    const api = await import('../src/api.js');
    api.setBaseUrl('https://sb.example');

    const result = await api.fetchRecordHistory({
      record_id: 'rec-1',
      owner_npub: 'npub1owner',
      viewer_npub: 'npub1collaborator',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://sb.example/api/v4/records/rec-1/history?owner_npub=npub1owner&viewer_npub=npub1workspacekey'
    );
    expect(result.requestUrl).toBe(
      'https://sb.example/api/v4/records/rec-1/history?owner_npub=npub1owner&viewer_npub=npub1workspacekey'
    );
  });

  it('uses the active workspace key as viewer_npub for record pulls', async () => {
    workspaceSecret = new Uint8Array(32).fill(7);
    workspaceNpub = 'npub1workspacekey';
    sessionNpub = 'npub1collaborator';

    const fetchMock = vi.fn(async (requestUrl) => ({
      ok: true,
      status: 200,
      json: async () => ({ requestUrl, records: [] }),
      text: async () => '',
    }));
    globalThis.fetch = fetchMock;

    const api = await import('../src/api.js');
    api.setBaseUrl('https://sb.example');

    const result = await api.fetchRecords({
      owner_npub: 'npub1owner',
      viewer_npub: 'npub1collaborator',
      record_family_hash: 'family-1',
      since: '2026-04-22T00:00:00.000Z',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://sb.example/api/v4/records?owner_npub=npub1owner&viewer_npub=npub1workspacekey&record_family_hash=family-1&since=2026-04-22T00%3A00%3A00.000Z'
    );
    expect(result.requestUrl).toBe(
      'https://sb.example/api/v4/records?owner_npub=npub1owner&viewer_npub=npub1workspacekey&record_family_hash=family-1&since=2026-04-22T00%3A00%3A00.000Z'
    );
  });

  it('uses the active workspace key as viewer_npub for heartbeat checks', async () => {
    workspaceSecret = new Uint8Array(32).fill(7);
    workspaceNpub = 'npub1workspacekey';
    sessionNpub = 'npub1collaborator';

    const fetchMock = vi.fn(async (_requestUrl, options) => ({
      ok: true,
      status: 200,
      json: async () => ({ body: JSON.parse(options.body) }),
      text: async () => '',
    }));
    globalThis.fetch = fetchMock;

    const api = await import('../src/api.js');
    api.setBaseUrl('https://sb.example');

    const result = await api.fetchHeartbeat({
      owner_npub: 'npub1owner',
      viewer_npub: 'npub1collaborator',
      family_cursors: { task: 'cursor-1' },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.body).toEqual({
      owner_npub: 'npub1owner',
      viewer_npub: 'npub1workspacekey',
      family_cursors: { task: 'cursor-1' },
    });
  });

  it('registers workspace keys with real-user auth even when workspace auth is active', async () => {
    workspaceSecret = new Uint8Array(32).fill(7);
    workspaceNpub = 'npub1workspacekey';
    sessionNpub = 'npub1collaborator';

    const fetchMock = vi.fn(async (_requestUrl, options) => ({
      ok: true,
      status: 201,
      json: async () => ({
        auth: options.headers.Authorization,
        body: JSON.parse(options.body),
      }),
      text: async () => '',
    }));
    globalThis.fetch = fetchMock;

    const api = await import('../src/api.js');
    api.setBaseUrl('https://sb.example');

    const result = await api.registerWorkspaceKey({
      workspace_owner_npub: 'npub1owner',
      ws_key_npub: 'npub1workspacekey',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://sb.example/api/v4/user/workspace-keys');
    expect(createNip98AuthHeaderMock).toHaveBeenCalledWith(
      'https://sb.example/api/v4/user/workspace-keys',
      'POST',
      {
        workspace_owner_npub: 'npub1owner',
        ws_key_npub: 'npub1workspacekey',
      },
    );
    expect(createNip98AuthHeaderForSecretMock).not.toHaveBeenCalled();
    expect(result.auth).toContain('session POST https://sb.example/api/v4/user/workspace-keys');
    expect(result.body).toEqual({
      workspace_owner_npub: 'npub1owner',
      ws_key_npub: 'npub1workspacekey',
    });
  });
});
