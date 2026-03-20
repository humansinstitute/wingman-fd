import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/auth/nostr.js', () => ({
  createNip98AuthHeader: vi.fn(async (requestUrl, method) => `NIP98 ${method} ${requestUrl}`),
}));

describe('workspace API host fallback', () => {
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

  it('sends workspace writes directly to the configured backend', async () => {
    const fetchMock = vi.fn(async (requestUrl) => {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, requestUrl }),
        text: async () => JSON.stringify({ ok: true, requestUrl }),
      };
    });
    globalThis.fetch = fetchMock;

    const api = await import('../src/api.js');
    api.setBaseUrl('https://sb.example');
    const result = await api.updateWorkspace('npub1workspace', { name: 'Other Stuff' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://sb.example/api/v4/workspaces/npub1workspace');
    expect(result.requestUrl).toBe('https://sb.example/api/v4/workspaces/npub1workspace');
  });

  it('sends workspace reads directly to the configured backend', async () => {
    const fetchMock = vi.fn(async (requestUrl) => {
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, requestUrl }),
        text: async () => JSON.stringify({ ok: true, requestUrl }),
      };
    });
    globalThis.fetch = fetchMock;

    const api = await import('../src/api.js');
    api.setBaseUrl('https://sb.example');
    const result = await api.getWorkspaces('npub1member');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://sb.example/api/v4/workspaces?member_npub=npub1member');
    expect(result.requestUrl).toBe('https://sb.example/api/v4/workspaces?member_npub=npub1member');
  });

  it('uses the configured backend for storage prepare requests', async () => {
    const fetchMock = vi.fn(async (requestUrl) => {
      return {
        ok: true,
        status: 200,
        json: async () => ({ object_id: 'obj-1', requestUrl }),
        text: async () => JSON.stringify({ object_id: 'obj-1', requestUrl }),
      };
    });
    globalThis.fetch = fetchMock;

    const api = await import('../src/api.js');
    api.setBaseUrl('https://sb.example');
    const result = await api.prepareStorageObject({
      owner_npub: 'npub1workspace',
      content_type: 'image/png',
      size_bytes: 12,
      file_name: 'avatar.png',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://sb.example/api/v4/storage/prepare');
    expect(result.requestUrl).toBe('https://sb.example/api/v4/storage/prepare');
  });

  it('uses the configured backend for storage blob downloads', async () => {
    const imageBlob = new Blob(['avatar'], { type: 'image/png' });
    const fetchMock = vi.fn(async (requestUrl) => {
      return {
        ok: true,
        status: 200,
        blob: async () => imageBlob,
        text: async () => '',
      };
    });
    globalThis.fetch = fetchMock;

    const api = await import('../src/api.js');
    api.setBaseUrl('https://sb.example');
    const result = await api.downloadStorageObjectBlob('obj-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://sb.example/api/v4/storage/obj-1/content');
    expect(result).toBe(imageBlob);
  });
});
