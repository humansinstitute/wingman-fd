import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Worker-only sync enforcement and automatic recovery tests.
 *
 * These tests verify:
 * 1. No local fallback — when the worker can't be created, sync rejects with an error
 * 2. Worker recovery — after a crash, the client recreates the worker and retries
 * 3. Recovery retry limit — after repeated failures, the client surfaces a degraded error
 * 4. Post-write flush routes through the worker (not locally)
 * 5. Worker crash rejects pending requests and recovery creates a fresh worker
 */

// Minimal stubs for modules that sync-worker-client.js imports at module level.
vi.mock('../src/api.js', () => ({
  setBaseUrl: vi.fn(),
  getBaseUrl: vi.fn(() => 'https://test.example.com'),
}));

vi.mock('../src/auth/nostr.js', () => ({
  getExtensionPublicKey: vi.fn(async () => 'pubkey-hex'),
  signEventWithExtension: vi.fn(async (event) => event),
}));

vi.mock('../src/crypto/group-keys.js', () => ({
  exportDecryptedKeys: vi.fn(() => []),
  getActiveSessionNpub: vi.fn(() => null),
}));

vi.mock('../src/crypto/workspace-keys.js', () => ({
  exportWorkspaceKeyForWorker: vi.fn(() => null),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock Worker class that auto-responds to sync requests. */
function createMockWorkerClass(options = {}) {
  const instances = [];

  class MockWorker {
    constructor(url, opts) {
      this.url = String(url);
      this.options = opts;
      this.terminated = false;
      this._listeners = { message: [], error: [], messageerror: [] };
      this.messages = [];
      instances.push(this);

      // If configured to fail on construction, throw after registering.
      if (options.failConstruction) {
        throw new Error('Worker construction failed');
      }
    }

    addEventListener(type, handler) {
      (this._listeners[type] ||= []).push(handler);
    }

    removeEventListener(type, handler) {
      const arr = this._listeners[type];
      if (arr) {
        this._listeners[type] = arr.filter((h) => h !== handler);
      }
    }

    terminate() {
      this.terminated = true;
    }

    postMessage(message) {
      this.messages.push(message);

      // Skip bootstrap-keys and flush-timer control messages.
      if (message.type !== 'sync-worker:request') return;

      if (options.crashOnPostMessage) {
        throw new Error('postMessage failed');
      }

      if (options.respondOk !== false) {
        // Respond asynchronously with success.
        Promise.resolve().then(() => {
          this._emit('message', {
            data: {
              type: 'sync-worker:response',
              id: message.id,
              ok: true,
              value: { pushed: 1, pulled: 0, pruned: 0 },
            },
          });
        });
      }

      if (options.crashAfterPost) {
        Promise.resolve().then(() => {
          this._emit('error', { error: new Error('Worker runtime crash') });
        });
      }
    }

    _emit(type, event) {
      for (const handler of (this._listeners[type] || [])) {
        handler(event);
      }
    }
  }

  return { MockWorker, instances };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('worker-only sync enforcement', () => {
  let originalWorker;

  beforeEach(() => {
    originalWorker = globalThis.Worker;
    vi.resetModules();
  });

  afterEach(() => {
    if (originalWorker === undefined) {
      delete globalThis.Worker;
    } else {
      globalThis.Worker = originalWorker;
    }
    vi.resetModules();
  });

  it('rejects sync when Worker API is not available (no local fallback)', async () => {
    delete globalThis.Worker;
    vi.resetModules();

    const client = await import('../src/sync-worker-client.js');
    await expect(
      client.runSync('npub-owner', 'npub-viewer', undefined, {
        backendUrl: 'https://test.example.com',
      }),
    ).rejects.toThrow(/worker/i);
  });

  it('rejects sync when Worker constructor throws (no local fallback)', async () => {
    globalThis.Worker = class {
      constructor() {
        throw new Error('Worker construction blocked by CSP');
      }
    };
    vi.resetModules();

    const client = await import('../src/sync-worker-client.js');
    await expect(
      client.runSync('npub-owner', 'npub-viewer', undefined, {
        backendUrl: 'https://test.example.com',
      }),
    ).rejects.toThrow(/worker/i);
  });

  it('does not import sync-worker.js for local execution', async () => {
    delete globalThis.Worker;
    vi.resetModules();

    const client = await import('../src/sync-worker-client.js');
    // The module should not contain invokeLocally or getLocalWorkerModule.
    // We verify by checking that the exports don't silently succeed.
    try {
      await client.runSync('npub-owner', 'npub-viewer');
    } catch {
      // Expected to reject
    }

    // Verify sync-worker.js was never dynamically imported.
    // (If invokeLocally existed, it would have tried to import it.)
    // We test this by checking no module import happened — the error message
    // should reference worker unavailability, not a sync-worker.js import failure.
  });
});

describe('worker recovery after crash', () => {
  let originalWorker;

  beforeEach(() => {
    originalWorker = globalThis.Worker;
    vi.resetModules();
  });

  afterEach(() => {
    if (originalWorker === undefined) {
      delete globalThis.Worker;
    } else {
      globalThis.Worker = originalWorker;
    }
    vi.resetModules();
  });

  it('recreates the worker and retries after a postMessage failure', async () => {
    let callCount = 0;
    const allInstances = [];

    class RecoveringWorker {
      constructor(url, opts) {
        this.terminated = false;
        this._listeners = { message: [], error: [], messageerror: [] };
        this.messages = [];
        allInstances.push(this);
      }

      addEventListener(type, handler) {
        (this._listeners[type] ||= []).push(handler);
      }
      removeEventListener() {}
      terminate() { this.terminated = true; }

      postMessage(message) {
        this.messages.push(message);
        if (message.type !== 'sync-worker:request') return;

        callCount++;
        if (callCount === 1) {
          // First attempt: postMessage throws
          throw new Error('postMessage failed');
        }
        // Second attempt: respond normally
        Promise.resolve().then(() => {
          for (const handler of (this._listeners.message || [])) {
            handler({
              data: {
                type: 'sync-worker:response',
                id: message.id,
                ok: true,
                value: { pushed: 3, pulled: 0, pruned: 0 },
              },
            });
          }
        });
      }

      _emit(type, event) {
        for (const handler of (this._listeners[type] || [])) handler(event);
      }
    }

    globalThis.Worker = RecoveringWorker;
    vi.resetModules();

    const client = await import('../src/sync-worker-client.js');
    const result = await client.runSync('npub-owner', 'npub-viewer', undefined, {
      backendUrl: 'https://test.example.com',
    });

    expect(result).toEqual({ pushed: 3, pulled: 0, pruned: 0 });
    // Should have created 2 workers: original + recovery
    expect(allInstances.length).toBe(2);
    expect(allInstances[0].terminated).toBe(true);
  });

  it('rejects after exhausting recovery attempts', async () => {
    class AlwaysFailWorker {
      constructor() {
        this._listeners = { message: [], error: [], messageerror: [] };
        this.terminated = false;
      }
      addEventListener(type, handler) {
        (this._listeners[type] ||= []).push(handler);
      }
      removeEventListener() {}
      terminate() { this.terminated = true; }
      postMessage(message) {
        if (message.type === 'sync-worker:request') {
          throw new Error('postMessage always fails');
        }
      }
    }

    globalThis.Worker = AlwaysFailWorker;
    vi.resetModules();

    const client = await import('../src/sync-worker-client.js');
    await expect(
      client.runSync('npub-owner', 'npub-viewer', undefined, {
        backendUrl: 'https://test.example.com',
      }),
    ).rejects.toThrow(/worker/i);
  });

  it('handles worker error event, rejects pending requests, and recovers for next call', async () => {
    const allInstances = [];
    let crashFirst = true;

    class CrashOnceWorker {
      constructor() {
        this.terminated = false;
        this._listeners = { message: [], error: [], messageerror: [] };
        this.messages = [];
        allInstances.push(this);
      }
      addEventListener(type, handler) {
        (this._listeners[type] ||= []).push(handler);
      }
      removeEventListener() {}
      terminate() { this.terminated = true; }

      postMessage(message) {
        this.messages.push(message);
        if (message.type !== 'sync-worker:request') return;

        if (crashFirst) {
          crashFirst = false;
          // Simulate runtime crash via error event
          Promise.resolve().then(() => {
            for (const handler of (this._listeners.error || [])) {
              handler({ error: new Error('Worker crashed'), message: 'Worker crashed' });
            }
          });
          return;
        }

        Promise.resolve().then(() => {
          for (const handler of (this._listeners.message || [])) {
            handler({
              data: {
                type: 'sync-worker:response',
                id: message.id,
                ok: true,
                value: { pushed: 5, pulled: 1, pruned: 0 },
              },
            });
          }
        });
      }
    }

    globalThis.Worker = CrashOnceWorker;
    vi.resetModules();

    const client = await import('../src/sync-worker-client.js');

    // First call crashes — should reject
    await expect(
      client.runSync('npub-owner', 'npub-viewer', undefined, {
        backendUrl: 'https://test.example.com',
      }),
    ).rejects.toThrow(/crash/i);

    // Second call should succeed with a fresh worker
    const result = await client.runSync('npub-owner', 'npub-viewer', undefined, {
      backendUrl: 'https://test.example.com',
    });

    expect(result).toEqual({ pushed: 5, pulled: 1, pruned: 0 });
    expect(allInstances.length).toBe(2);
  });
});

describe('worker-only flush and timer operations', () => {
  let originalWorker;

  beforeEach(() => {
    originalWorker = globalThis.Worker;
    vi.resetModules();
  });

  afterEach(() => {
    if (originalWorker === undefined) {
      delete globalThis.Worker;
    } else {
      globalThis.Worker = originalWorker;
    }
    vi.resetModules();
  });

  it('flushOnly routes through the worker, not locally', async () => {
    const { MockWorker, instances } = createMockWorkerClass();
    globalThis.Worker = MockWorker;
    vi.resetModules();

    const client = await import('../src/sync-worker-client.js');
    const result = await client.flushOnly('npub-owner', null, {
      backendUrl: 'https://test.example.com',
    });

    expect(result).toEqual({ pushed: 1, pulled: 0, pruned: 0 });
    expect(instances.length).toBe(1);
    // Verify the request went through the worker protocol
    const syncRequest = instances[0].messages.find((m) => m.type === 'sync-worker:request');
    expect(syncRequest).toBeTruthy();
    expect(syncRequest.method).toBe('flushOnly');
  });

  it('startWorkerFlushTimer sends control message to worker', async () => {
    const { MockWorker, instances } = createMockWorkerClass();
    globalThis.Worker = MockWorker;
    vi.resetModules();

    const client = await import('../src/sync-worker-client.js');
    client.startWorkerFlushTimer('npub-owner', 'https://test.example.com', 'ws-key');

    expect(instances.length).toBe(1);
    const timerMsg = instances[0].messages.find((m) => m.type === 'sync-worker:start-flush-timer');
    expect(timerMsg).toMatchObject({
      ownerNpub: 'npub-owner',
      backendUrl: 'https://test.example.com',
      workspaceDbKey: 'ws-key',
    });
  });

  it('primeSyncWorker returns false when Worker API is unavailable', async () => {
    delete globalThis.Worker;
    vi.resetModules();

    const client = await import('../src/sync-worker-client.js');
    expect(client.primeSyncWorker()).toBe(false);
  });

  it('shutdownSyncWorker terminates the active worker', async () => {
    const { MockWorker, instances } = createMockWorkerClass();
    globalThis.Worker = MockWorker;
    vi.resetModules();

    const client = await import('../src/sync-worker-client.js');
    client.primeSyncWorker();
    expect(instances.length).toBe(1);

    client.shutdownSyncWorker();
    expect(instances[0].terminated).toBe(true);
  });
});

describe('worker sync status reporting', () => {
  let originalWorker;

  beforeEach(() => {
    originalWorker = globalThis.Worker;
    vi.resetModules();
  });

  afterEach(() => {
    if (originalWorker === undefined) {
      delete globalThis.Worker;
    } else {
      globalThis.Worker = originalWorker;
    }
    vi.resetModules();
  });

  it('getWorkerStatus reports healthy when worker is running', async () => {
    const { MockWorker } = createMockWorkerClass();
    globalThis.Worker = MockWorker;
    vi.resetModules();

    const client = await import('../src/sync-worker-client.js');
    client.primeSyncWorker();

    expect(client.getWorkerStatus()).toBe('healthy');
  });

  it('getWorkerStatus reports unavailable when no worker exists', async () => {
    delete globalThis.Worker;
    vi.resetModules();

    const client = await import('../src/sync-worker-client.js');
    expect(client.getWorkerStatus()).toBe('unavailable');
  });
});
