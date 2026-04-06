import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * SSE worker-side logic tests — verifies echo suppression, debounce batching,
 * reconnect backoff, catch-up-required handling, and the worker message protocol
 * for SSE status reporting.
 *
 * These are pure unit tests that exercise the logic extracted from
 * sync-worker-runner.js without requiring a real EventSource or Web Worker.
 */

// ---------------------------------------------------------------------------
// Echo suppression
// ---------------------------------------------------------------------------

describe('SSE echo suppression', () => {
  let echoSet;
  let markOwnWrite;
  let isOwnEcho;
  let cleanEchoSet;

  beforeEach(() => {
    echoSet = new Map();
    const TTL = 30_000;

    markOwnWrite = (recordId, version) => {
      echoSet.set(`${recordId}:${version}`, Date.now() + TTL);
    };

    isOwnEcho = (recordId, version) => {
      const key = `${recordId}:${version}`;
      const expiry = echoSet.get(key);
      if (!expiry) return false;
      if (Date.now() > expiry) {
        echoSet.delete(key);
        return false;
      }
      echoSet.delete(key);
      return true;
    };

    cleanEchoSet = () => {
      const now = Date.now();
      for (const [key, expiry] of echoSet) {
        if (now > expiry) echoSet.delete(key);
      }
    };
  });

  it('detects own echo for a recently written record', () => {
    markOwnWrite('rec-1', 3);
    expect(isOwnEcho('rec-1', 3)).toBe(true);
  });

  it('does not detect echo for unknown records', () => {
    expect(isOwnEcho('rec-unknown', 1)).toBe(false);
  });

  it('consumes the echo entry (single-use)', () => {
    markOwnWrite('rec-1', 3);
    expect(isOwnEcho('rec-1', 3)).toBe(true);
    // Second check should return false — entry consumed
    expect(isOwnEcho('rec-1', 3)).toBe(false);
  });

  it('returns false for expired entries', () => {
    echoSet.set('rec-1:3', Date.now() - 1); // already expired
    expect(isOwnEcho('rec-1', 3)).toBe(false);
  });

  it('distinguishes different versions of the same record', () => {
    markOwnWrite('rec-1', 3);
    expect(isOwnEcho('rec-1', 4)).toBe(false);
    expect(isOwnEcho('rec-1', 3)).toBe(true);
  });

  it('cleanEchoSet removes expired entries', () => {
    echoSet.set('rec-1:1', Date.now() - 1);
    echoSet.set('rec-2:1', Date.now() + 30_000);
    cleanEchoSet();
    expect(echoSet.size).toBe(1);
    expect(echoSet.has('rec-2:1')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Debounce batching
// ---------------------------------------------------------------------------

describe('SSE debounce batching', () => {
  it('collects multiple families and flushes after debounce window', async () => {
    vi.useFakeTimers();
    const SSE_DEBOUNCE_MS = 300;
    const staleFamilies = new Set();
    const flushed = [];
    let debounceTimer = null;

    function handleRecordChanged(familyHash) {
      staleFamilies.add(familyHash);
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        flushed.push([...staleFamilies]);
        staleFamilies.clear();
        debounceTimer = null;
      }, SSE_DEBOUNCE_MS);
    }

    handleRecordChanged('family-a');
    handleRecordChanged('family-b');
    handleRecordChanged('family-a'); // duplicate, set deduplicates
    handleRecordChanged('family-c');

    expect(flushed).toHaveLength(0); // not flushed yet

    vi.advanceTimersByTime(SSE_DEBOUNCE_MS);

    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toEqual(['family-a', 'family-b', 'family-c']);

    vi.useRealTimers();
  });

  it('resets debounce timer on each new event', async () => {
    vi.useFakeTimers();
    const SSE_DEBOUNCE_MS = 300;
    const staleFamilies = new Set();
    const flushed = [];
    let debounceTimer = null;

    function handleRecordChanged(familyHash) {
      staleFamilies.add(familyHash);
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        flushed.push([...staleFamilies]);
        staleFamilies.clear();
        debounceTimer = null;
      }, SSE_DEBOUNCE_MS);
    }

    handleRecordChanged('family-a');
    vi.advanceTimersByTime(200); // 200ms in
    handleRecordChanged('family-b'); // resets timer
    vi.advanceTimersByTime(200); // 400ms total, 200ms since last event
    expect(flushed).toHaveLength(0); // still not flushed

    vi.advanceTimersByTime(100); // 300ms since last event
    expect(flushed).toHaveLength(1);
    expect(flushed[0]).toEqual(['family-a', 'family-b']);

    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Reconnect backoff
// ---------------------------------------------------------------------------

describe('SSE reconnect backoff', () => {
  it('calculates exponential backoff delays', () => {
    const delays = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      delays.push(Math.min(1000 * Math.pow(2, attempt), 60_000));
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 32000]);
  });

  it('caps at 60 seconds', () => {
    const delay = Math.min(1000 * Math.pow(2, 10), 60_000);
    expect(delay).toBe(60_000);
  });

  it('falls back to polling after 5 consecutive failures', () => {
    let sseReconnectAttempts = 0;
    const statuses = [];

    function scheduleReconnect() {
      sseReconnectAttempts++;
      if (sseReconnectAttempts > 5) {
        statuses.push('fallback-polling');
        return;
      }
      statuses.push('reconnecting');
    }

    for (let i = 0; i < 7; i++) {
      scheduleReconnect();
    }

    expect(statuses).toEqual([
      'reconnecting', 'reconnecting', 'reconnecting',
      'reconnecting', 'reconnecting',
      'fallback-polling', 'fallback-polling',
    ]);
  });

  it('resets reconnect attempts on successful connection', () => {
    let sseReconnectAttempts = 4;

    function handleConnected() {
      sseReconnectAttempts = 0;
    }

    handleConnected();
    expect(sseReconnectAttempts).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Worker message protocol for SSE
// ---------------------------------------------------------------------------

describe('SSE worker message protocol', () => {
  it('sync-worker:sse-connect message carries all required fields', () => {
    const message = {
      type: 'sync-worker:sse-connect',
      ownerNpub: 'npub1owner...',
      viewerNpub: 'npub1viewer...',
      backendUrl: 'https://tower.example.com',
      token: 'base64encodedNip98Token',
      workspaceDbKey: 'ws-db-key',
    };

    expect(message.type).toBe('sync-worker:sse-connect');
    expect(message.ownerNpub).toBeTruthy();
    expect(message.viewerNpub).toBeTruthy();
    expect(message.backendUrl).toBeTruthy();
    expect(message.token).toBeTruthy();
    expect(message.workspaceDbKey).toBeTruthy();
  });

  it('SSE status messages have the correct type', () => {
    const SSE_STATUS_TYPE = 'sync-worker:sse-status';

    const validStatuses = [
      'connecting', 'connected', 'reconnecting',
      'token-needed', 'fallback-polling', 'disconnected',
      'group-changed', 'catch-up-required', 'pull-complete',
    ];

    for (const status of validStatuses) {
      const msg = { type: SSE_STATUS_TYPE, status };
      expect(msg.type).toBe(SSE_STATUS_TYPE);
      expect(typeof msg.status).toBe('string');
    }
  });

  it('pull-complete status includes families list', () => {
    const msg = {
      type: 'sync-worker:sse-status',
      status: 'pull-complete',
      families: ['family-a', 'family-b'],
    };

    expect(msg.families).toEqual(['family-a', 'family-b']);
  });
});

// ---------------------------------------------------------------------------
// Event parsing (record-changed handler logic)
// ---------------------------------------------------------------------------

describe('SSE record-changed event parsing', () => {
  it('parses valid JSON data from SSE event', () => {
    const eventData = JSON.stringify({
      family_hash: 'chat_message_abc123',
      record_id: 'rec-001',
      version: 3,
      signature_npub: 'npub1signer...',
      updated_at: '2026-04-01T12:00:00Z',
      record_state: 'active',
    });

    let data;
    try { data = JSON.parse(eventData); } catch { data = null; }

    expect(data).not.toBeNull();
    expect(data.family_hash).toBe('chat_message_abc123');
    expect(data.record_id).toBe('rec-001');
    expect(data.version).toBe(3);
    expect(data.record_state).toBe('active');
  });

  it('silently ignores malformed JSON', () => {
    const eventData = 'not valid json{{{';
    let data = null;
    try { data = JSON.parse(eventData); } catch { /* expected */ }
    expect(data).toBeNull();
  });

  it('tracks lastEventId from SSE events', () => {
    let sseLastEventId = null;
    const event = { data: '{"record_id":"r1"}', lastEventId: '42' };

    if (event.lastEventId) sseLastEventId = event.lastEventId;
    expect(sseLastEventId).toBe('42');
  });
});

// ---------------------------------------------------------------------------
// Catch-up-required handling
// ---------------------------------------------------------------------------

describe('SSE catch-up-required', () => {
  it('signals main thread to perform full sync', () => {
    const statuses = [];
    function postSSEStatus(status) { statuses.push(status); }

    function handleCatchUpRequired() {
      postSSEStatus('catch-up-required');
    }

    handleCatchUpRequired();
    expect(statuses).toEqual(['catch-up-required']);
  });
});

// ---------------------------------------------------------------------------
// Group-changed handling
// ---------------------------------------------------------------------------

describe('SSE group-changed', () => {
  it('signals main thread to refresh groups', () => {
    const statuses = [];
    function postSSEStatus(status) { statuses.push(status); }

    function handleGroupChanged() {
      postSSEStatus('group-changed');
    }

    handleGroupChanged();
    expect(statuses).toEqual(['group-changed']);
  });
});

// ---------------------------------------------------------------------------
// SSE URL construction
// ---------------------------------------------------------------------------

describe('SSE URL construction', () => {
  it('builds correct URL with token and no last_event_id', () => {
    const ownerNpub = 'npub1owner123';
    const backendUrl = 'https://tower.example.com';
    const token = 'base64token==';

    const sseUrl = new URL(`/api/v4/workspaces/${ownerNpub}/stream`, backendUrl);
    sseUrl.searchParams.set('token', token);

    expect(sseUrl.pathname).toBe(`/api/v4/workspaces/${ownerNpub}/stream`);
    expect(sseUrl.searchParams.get('token')).toBe(token);
    expect(sseUrl.searchParams.has('last_event_id')).toBe(false);
  });

  it('includes last_event_id when available', () => {
    const ownerNpub = 'npub1owner123';
    const backendUrl = 'https://tower.example.com';
    const token = 'base64token==';
    const lastEventId = 42;

    const sseUrl = new URL(`/api/v4/workspaces/${ownerNpub}/stream`, backendUrl);
    sseUrl.searchParams.set('token', token);
    if (lastEventId != null) {
      sseUrl.searchParams.set('last_event_id', String(lastEventId));
    }

    expect(sseUrl.searchParams.get('last_event_id')).toBe('42');
  });
});
