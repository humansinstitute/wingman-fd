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

  it('falls back to the current origin for storage prepare requests', async () => {
    const fetchMock = vi.fn(async (requestUrl) => {
      if (requestUrl === 'https://sb.example/api/v4/storage/prepare') {
        return {
          ok: false,
          status: 404,
          json: async () => ({ error: 'Not Found' }),
          text: async () => 'Not Found',
        };
      }
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

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('https://sb.example/api/v4/storage/prepare');
    expect(fetchMock.mock.calls[1][0]).toBe('https://tower.example/api/v4/storage/prepare');
    expect(result.requestUrl).toBe('https://tower.example/api/v4/storage/prepare');
  });

  it('preserves storage prepare failure details', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 404,
      text: async () => 'Not Found',
    }));

    const api = await import('../src/api.js');
    api.setBaseUrl('https://sb.example');

    await expect(api.prepareStorageObject({
      owner_npub: 'npub1workspace',
      content_type: 'image/png',
    })).rejects.toMatchObject({
      status: 404,
      method: 'POST',
      requestUrl: 'https://tower.example/api/v4/storage/prepare',
      message: 'API 404 POST https://tower.example/api/v4/storage/prepare: Not Found',
    });
  });

  it('uses backend storage upload before trying the direct upload URL', async () => {
    const fetchMock = vi.fn(async (requestUrl) => {
      if (requestUrl === 'https://tower.example/api/v4/storage/obj-1') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ object_id: 'obj-1', requestUrl }),
          text: async () => JSON.stringify({ object_id: 'obj-1', requestUrl }),
        };
      }
      throw new Error(`unexpected fetch ${requestUrl}`);
    });
    globalThis.fetch = fetchMock;

    const api = await import('../src/api.js');
    api.setBaseUrl('https://sb.example');

    const result = await api.uploadStorageObject(
      {
        object_id: 'obj-1',
        upload_url: 'https://upload.example/object',
      },
      new Uint8Array([1, 2, 3]),
      'image/png',
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('https://sb.example/api/v4/storage/obj-1');
    expect(fetchMock.mock.calls[1][0]).toBe('https://tower.example/api/v4/storage/obj-1');
    expect(result.requestUrl).toBe('https://tower.example/api/v4/storage/obj-1');
  });

  it('includes direct upload failure when backend upload path is unavailable too', async () => {
    globalThis.fetch = vi.fn(async (requestUrl) => {
      if (requestUrl === 'https://sb.example/api/v4/storage/obj-1' || requestUrl === 'https://tower.example/api/v4/storage/obj-1') {
        return {
          ok: false,
          status: 404,
          text: async () => 'Prepared object missing',
        };
      }
      if (requestUrl === 'https://upload.example/object') {
        return {
          ok: false,
          status: 404,
          text: async () => 'Upload target missing',
        };
      }
      throw new Error(`unexpected fetch ${requestUrl}`);
    });

    const api = await import('../src/api.js');
    api.setBaseUrl('https://sb.example');

    await expect(api.uploadStorageObject(
      {
        object_id: 'obj-1',
        upload_url: 'https://upload.example/object',
      },
      new Uint8Array([1, 2, 3]),
      'image/png',
    )).rejects.toMatchObject({
      status: 404,
      method: 'PUT',
      requestUrl: 'https://tower.example/api/v4/storage/obj-1',
      directUploadMessage: 'Storage upload 404 PUT https://upload.example/object: Upload target missing',
      message: 'API 404 PUT https://tower.example/api/v4/storage/obj-1: Prepared object missing | direct upload failed after backend upload fallback: Storage upload 404 PUT https://upload.example/object: Upload target missing',
    });
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

  it('falls back to the current origin for storage blob downloads', async () => {
    const imageBlob = new Blob(['avatar'], { type: 'image/png' });
    const fetchMock = vi.fn(async (requestUrl) => {
      if (requestUrl === 'https://sb.example/api/v4/storage/obj-1/content') {
        return {
          ok: false,
          status: 404,
          blob: async () => imageBlob,
          text: async () => 'Not Found',
        };
      }
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

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe('https://sb.example/api/v4/storage/obj-1/content');
    expect(fetchMock.mock.calls[1][0]).toBe('https://tower.example/api/v4/storage/obj-1/content');
    expect(result).toBe(imageBlob);
  });
});

describe('records summary API', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns summary data when endpoint is available', async () => {
    const families = [{ record_family_hash: 'abc', latest_updated_at: '2026-01-01T00:00:00Z' }];
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ families }),
      text: async () => JSON.stringify({ families }),
    }));

    const api = await import('../src/api.js');
    api.setBaseUrl('https://sb.example');
    const result = await api.fetchRecordsSummary('npub1owner');

    expect(result.available).toBe(true);
    expect(result.families).toEqual(families);
  });

  it('returns fallback when endpoint returns 404', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({}),
      text: async () => 'Not Found',
    }));

    const api = await import('../src/api.js');
    api.setBaseUrl('https://sb.example');
    const result = await api.fetchRecordsSummary('npub1owner');

    expect(result.available).toBe(false);
    expect(result.families).toEqual([]);
  });

  it('returns fallback when fetch throws', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Network failure');
    });

    const api = await import('../src/api.js');
    api.setBaseUrl('https://sb.example');
    const result = await api.fetchRecordsSummary('npub1owner');

    expect(result.available).toBe(false);
    expect(result.families).toEqual([]);
  });
});
