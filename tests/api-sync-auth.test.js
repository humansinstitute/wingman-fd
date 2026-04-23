import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let workspaceSecret = null;
let workspaceNpub = null;
let sessionNpub = null;
let groupKeys = new Map();
const createNip98AuthHeaderMock = vi.fn(async (requestUrl, method) => `session ${method} ${requestUrl}`);
const createNip98AuthHeaderForSecretMock = vi.fn(async (requestUrl, method) => `workspace ${method} ${requestUrl}`);

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
  decryptPayloadForGroup: vi.fn(),
  encryptPayloadForGroup: vi.fn(),
  getActiveSessionNpub: vi.fn(() => sessionNpub),
  getGroupKey: vi.fn((groupRef) => groupKeys.get(groupRef) || null),
  getLoadedGroupKeyDiagnostics: vi.fn(() => ({})),
  hasGroupKey: vi.fn(() => false),
}));

async function sha256Hex(input) {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function jsonPayloadHash(value) {
  return sha256Hex(JSON.stringify(value));
}

function decodeNostrAuthEvent(header) {
  return JSON.parse(atob(String(header || '').replace(/^Nostr\s+/, '')));
}

function eventTag(event, tagName) {
  return (event.tags || []).find((tag) => tag[0] === tagName)?.[1] || null;
}

describe('api sync auth and owner-write detection', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    workspaceSecret = null;
    workspaceNpub = null;
    sessionNpub = null;
    groupKeys = new Map();
    createNip98AuthHeaderMock.mockClear();
    createNip98AuthHeaderForSecretMock.mockClear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('skips group proofs for direct owner signatures', async () => {
    workspaceSecret = new Uint8Array(32).fill(7);
    workspaceNpub = 'npub1workspacekey';
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
        signature_npub: 'npub1realowner',
        write_group_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      }],
    });

    expect(createNip98AuthHeaderForSecretMock).toHaveBeenCalledTimes(1);
    expect(createNip98AuthHeaderMock).not.toHaveBeenCalled();
    expect(result.body.group_write_tokens).toEqual({});
    expect(result.body.owner_npub).toBe('npub1realowner');
    expect(result.body.workspace_service_npub).toBe('npub1realowner');
    expect(result.body.user_npub).toBe('npub1realowner');
    expect(result.body.viewer_npub).toBe('npub1realowner');
    expect(result.body.signer_npub).toBe('npub1workspacekey');
    expect(result.body.workspace_user_key_npub).toBe('npub1workspacekey');
    expect(result.body.ws_key_npub).toBe('npub1workspacekey');
    expect(result.auth).toContain('workspace POST https://sb.example/api/v4/records/sync');
  });

  it('builds sync requests with canonical identity fields and group write proof payloads', async () => {
    workspaceSecret = new Uint8Array(32).fill(7);
    workspaceNpub = 'npub1workspacekey';
    sessionNpub = 'npub1collaborator';
    const writeGroupId = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
    groupKeys.set(writeGroupId, {
      group_id: writeGroupId,
      group_npub: 'npub1groupkey',
      key_version: 1,
      secret: new Uint8Array(32).fill(8),
    });

    const fetchMock = vi.fn(async (_requestUrl, options) => ({
      ok: true,
      status: 200,
      json: async () => ({ body: JSON.parse(options.body) }),
      text: async () => '',
    }));
    globalThis.fetch = fetchMock;

    const api = await import('../src/api.js');
    api.setBaseUrl('https://sb.example');

    const record = {
      record_id: 'rec-2',
      owner_npub: 'npub1workspaceservicekey',
      signature_npub: 'npub1workspacekey',
      write_group_id: writeGroupId,
    };
    const result = await api.syncRecords({
      owner_npub: 'npub1workspaceservicekey',
      records: [record],
    });

    const expectedProofBody = {
      owner_npub: 'npub1workspaceservicekey',
      workspace_service_npub: 'npub1workspaceservicekey',
      user_npub: 'npub1collaborator',
      actor_npub: 'npub1collaborator',
      viewer_npub: 'npub1collaborator',
      signer_npub: 'npub1workspacekey',
      workspace_user_key_npub: 'npub1workspacekey',
      ws_key_npub: 'npub1workspacekey',
      records: result.body.records,
    };

    expect(result.body).toMatchObject({
      owner_npub: 'npub1workspaceservicekey',
      workspace_service_npub: 'npub1workspaceservicekey',
      user_npub: 'npub1collaborator',
      actor_npub: 'npub1collaborator',
      viewer_npub: 'npub1collaborator',
      signer_npub: 'npub1workspacekey',
      workspace_user_key_npub: 'npub1workspacekey',
      ws_key_npub: 'npub1workspacekey',
      records: [record],
    });
    expect(Object.keys(result.body.group_write_tokens)).toEqual([writeGroupId]);

    const proofEvent = decodeNostrAuthEvent(result.body.group_write_tokens[writeGroupId]);
    expect(eventTag(proofEvent, 'u')).toBe('https://sb.example/api/v4/records/sync');
    expect(eventTag(proofEvent, 'method')).toBe('POST');
    expect(eventTag(proofEvent, 'payload')).toBe(await jsonPayloadHash(expectedProofBody));
  });

  it('keeps pre-Phase-4 pending writes with write_group_npub syncable', async () => {
    workspaceSecret = new Uint8Array(32).fill(7);
    workspaceNpub = 'npub1workspacekey';
    sessionNpub = 'npub1collaborator';
    const legacyWriteGroupNpub = 'npub1legacywritegroup';
    groupKeys.set(legacyWriteGroupNpub, {
      group_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      group_npub: legacyWriteGroupNpub,
      key_version: 1,
      secret: new Uint8Array(32).fill(8),
    });

    const fetchMock = vi.fn(async (_requestUrl, options) => ({
      ok: true,
      status: 200,
      json: async () => ({ body: JSON.parse(options.body) }),
      text: async () => '',
    }));
    globalThis.fetch = fetchMock;

    const legacyPendingRecord = {
      record_id: 'rec-legacy-write-group-npub',
      owner_npub: 'npub1workspaceservicekey',
      signature_npub: 'npub1workspacekey',
      write_group_npub: legacyWriteGroupNpub,
      owner_payload: { ciphertext: '{}' },
      group_payloads: [],
    };

    const api = await import('../src/api.js');
    api.setBaseUrl('https://sb.example');
    const result = await api.syncRecords({
      owner_npub: 'npub1workspaceservicekey',
      records: [legacyPendingRecord],
    });

    expect(result.deferred).toEqual([]);
    expect(result.body.records).toEqual([legacyPendingRecord]);
    expect(Object.keys(result.body.group_write_tokens)).toEqual([legacyWriteGroupNpub]);
  });

  it('defers records when the write group key is missing', async () => {
    workspaceSecret = new Uint8Array(32).fill(7);
    workspaceNpub = 'npub1workspacekey';
    sessionNpub = 'npub1collaborator';

    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    const api = await import('../src/api.js');
    api.setBaseUrl('https://sb.example');

    const result = await api.syncRecords({
      owner_npub: 'npub1workspaceservicekey',
      records: [{
        record_id: 'rec-missing-key',
        owner_npub: 'npub1workspaceservicekey',
        signature_npub: 'npub1workspacekey',
        write_group_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
      }],
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      synced: 0,
      created: 0,
      updated: 0,
      rejected: [],
      deferred: ['rec-missing-key'],
    });
  });

  it('preserves legacy permissive sync shape for records without write groups', async () => {
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

    const record = {
      record_id: 'settings-1',
      owner_npub: 'npub1workspaceservicekey',
      record_family_hash: 'settings-family',
      signature_npub: 'npub1workspacekey',
      owner_payload: { ciphertext: '{}' },
      group_payloads: [],
    };

    const api = await import('../src/api.js');
    api.setBaseUrl('https://sb.example');
    const result = await api.syncRecords({
      owner_npub: 'npub1workspaceservicekey',
      records: [record],
    });

    expect(result.body).toMatchObject({
      owner_npub: 'npub1workspaceservicekey',
      workspace_service_npub: 'npub1workspaceservicekey',
      user_npub: 'npub1collaborator',
      viewer_npub: 'npub1collaborator',
      signer_npub: 'npub1workspacekey',
      records: [record],
      group_write_tokens: {},
    });
    expect(result.deferred).toEqual([]);
  });

  it('does not mutate pending write record objects while building sync requests', async () => {
    workspaceSecret = new Uint8Array(32).fill(7);
    workspaceNpub = 'npub1workspacekey';
    sessionNpub = 'npub1collaborator';
    const writeGroupId = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
    groupKeys.set(writeGroupId, {
      group_id: writeGroupId,
      group_npub: 'npub1groupkey',
      key_version: 1,
      secret: new Uint8Array(32).fill(8),
    });

    const fetchMock = vi.fn(async (_requestUrl, options) => ({
      ok: true,
      status: 200,
      json: async () => ({ body: JSON.parse(options.body) }),
      text: async () => '',
    }));
    globalThis.fetch = fetchMock;

    const record = {
      record_id: 'rec-immutable',
      owner_npub: 'npub1workspaceservicekey',
      signature_npub: 'npub1workspacekey',
      write_group_id: writeGroupId,
      payload: { helper: true },
    };
    const before = structuredClone(record);

    const api = await import('../src/api.js');
    api.setBaseUrl('https://sb.example');
    const result = await api.syncRecords({
      owner_npub: 'npub1workspaceservicekey',
      records: [record],
    });

    expect(record).toEqual(before);
    expect(result.body.records).toEqual([{
      record_id: 'rec-immutable',
      owner_npub: 'npub1workspaceservicekey',
      signature_npub: 'npub1workspacekey',
      write_group_id: writeGroupId,
    }]);
  });

  it('uses the real user as viewer_npub for record history reads', async () => {
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
      'https://sb.example/api/v4/records/rec-1/history?owner_npub=npub1owner&viewer_npub=npub1collaborator'
    );
    expect(result.requestUrl).toBe(
      'https://sb.example/api/v4/records/rec-1/history?owner_npub=npub1owner&viewer_npub=npub1collaborator'
    );
  });

  it('uses the real user as viewer_npub for record pulls', async () => {
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
      'https://sb.example/api/v4/records?owner_npub=npub1owner&viewer_npub=npub1collaborator&record_family_hash=family-1&since=2026-04-22T00%3A00%3A00.000Z'
    );
    expect(result.requestUrl).toBe(
      'https://sb.example/api/v4/records?owner_npub=npub1owner&viewer_npub=npub1collaborator&record_family_hash=family-1&since=2026-04-22T00%3A00%3A00.000Z'
    );
  });

  it('uses the real user as viewer_npub for heartbeat checks', async () => {
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
      viewer_npub: 'npub1collaborator',
      family_cursors: { task: 'cursor-1' },
    });
  });

  it('falls back to the active real user when viewer_npub is omitted', async () => {
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

    await api.fetchRecords({
      owner_npub: 'npub1owner',
      record_family_hash: 'family-1',
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://sb.example/api/v4/records?owner_npub=npub1owner&viewer_npub=npub1collaborator&record_family_hash=family-1'
    );
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
