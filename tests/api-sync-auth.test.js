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
}));

vi.mock('../src/crypto/workspace-keys.js', () => ({
  getActiveWorkspaceKeySecretForAuth: vi.fn(() => workspaceSecret),
  getActiveWorkspaceKeyNpub: vi.fn(() => workspaceNpub),
}));

vi.mock('../src/crypto/group-keys.js', () => ({
  createGroupWriteAuthHeader: createGroupWriteAuthHeaderMock,
  getActiveSessionNpub: vi.fn(() => sessionNpub),
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
});
