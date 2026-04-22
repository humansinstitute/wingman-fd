import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildWingmenLiveUrl,
  disableHarnessNightWatch,
  enableHarnessNightWatch,
  getHarnessNightWatchSession,
  listHarnessNightWatchReports,
  listHarnessSessions,
  updateHarnessSessionMetadata,
} from '../src/wingmen-live-api.js';

describe('wingmen live api adapter', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('builds harness URLs without double slashes', () => {
    expect(buildWingmenLiveUrl('https://wingmen.example/', '/api/sessions')).toBe(
      'https://wingmen.example/api/sessions',
    );
  });

  it('returns an unconfigured state when the workspace has no harness URL', async () => {
    await expect(listHarnessSessions({ harnessUrl: '' })).resolves.toEqual({
      ok: false,
      error: 'unconfigured',
      sessions: [],
    });
  });

  it('patches session metadata through the harness API', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'session-1',
        metadata: { goal: 'Ship', nextAction: 'reflect' },
      }),
      text: async () => '',
    }));
    globalThis.fetch = fetchMock;

    const result = await updateHarnessSessionMetadata({
      harnessUrl: 'https://wingmen.example/',
      sessionId: 'session-1',
      metadata: { goal: 'Ship', nextAction: 'reflect' },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://wingmen.example/api/sessions/session-1/metadata',
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ goal: 'Ship', nextAction: 'reflect' }),
      }),
    );
    expect(result).toEqual({
      ok: true,
      session: {
        id: 'session-1',
        metadata: { goal: 'Ship', nextAction: 'reflect' },
      },
    });
  });

  it('reads and toggles Night Watch state through per-session endpoints', async () => {
    const fetchMock = vi.fn(async (url, options = {}) => ({
      ok: true,
      status: 200,
      json: async () => ({
        url,
        method: options.method || 'GET',
      }),
      text: async () => '',
    }));
    globalThis.fetch = fetchMock;

    await getHarnessNightWatchSession({
      harnessUrl: 'https://wingmen.example',
      sessionId: 'session-1',
    });
    await enableHarnessNightWatch({
      harnessUrl: 'https://wingmen.example',
      sessionId: 'session-1',
      config: { intervalMinutes: 10, maxCycles: 4 },
    });
    await disableHarnessNightWatch({
      harnessUrl: 'https://wingmen.example',
      sessionId: 'session-1',
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://wingmen.example/api/nightwatch/sessions/session-1',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://wingmen.example/api/nightwatch/sessions/session-1/enable',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ intervalMinutes: 10, maxCycles: 4 }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://wingmen.example/api/nightwatch/sessions/session-1/disable',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('maps 401 responses to an unauthorized state', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: 'auth-required' }),
      text: async () => 'auth-required',
    }));

    await expect(listHarnessSessions({ harnessUrl: 'https://wingmen.example' })).resolves.toEqual({
      ok: false,
      error: 'unauthorized',
      sessions: [],
    });
  });

  it('maps fetch failures to an unavailable state', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down');
    });

    await expect(listHarnessSessions({ harnessUrl: 'https://wingmen.example' })).resolves.toEqual({
      ok: false,
      error: 'unavailable',
      sessions: [],
    });
  });

  it('filters Night Watch reports to the selected session and marks the compatibility path', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        reports: [
          { id: 'report-1', sessionId: 'session-1', summary: 'Recent' },
          { id: 'report-2', sessionId: 'session-2', summary: 'Other session' },
        ],
      }),
      text: async () => '',
    }));

    const result = await listHarnessNightWatchReports({
      harnessUrl: 'https://wingmen.example',
      sessionId: 'session-1',
      limit: 25,
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://wingmen.example/api/nightwatch/reports?limit=25',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result).toEqual({
      ok: true,
      historySource: 'client-filtered-global-list',
      reports: [
        { id: 'report-1', sessionId: 'session-1', summary: 'Recent' },
      ],
    });
  });
});
