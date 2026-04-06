/**
 * Bun-compatible tests for sync-worker-client.js.
 *
 * Tests worker-only sync enforcement, automatic recovery, and degraded state
 * notification. Uses only shallow mocks for the client module's direct
 * dependencies — no deep transitive mocking required.
 *
 * The deeper sync-worker.js module tests (batching, staleness, progress) live
 * in sync-worker.test.js and require vitest's vi.resetModules() + deep mocking.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

let client;

beforeAll(async () => {
  client = await import('../src/sync-worker-client.js');
});

describe('worker-only sync enforcement', () => {
  let originalWorker;

  beforeEach(() => {
    originalWorker = globalThis.Worker;
  });

  afterEach(() => {
    client.shutdownSyncWorker();
    client.setWorkerDegradedCallback(null);
    if (originalWorker === undefined) {
      delete globalThis.Worker;
    } else {
      globalThis.Worker = originalWorker;
    }
  });

  it('rejects sync when Worker API is not available (no local fallback)', async () => {
    delete globalThis.Worker;

    await expect(
      client.runSync('npub-owner', 'npub-viewer', undefined, { backendUrl: 'https://x.com' }),
    ).rejects.toThrow(/Sync unavailable.*Web Workers/);
  });

  it('rejects sync when Worker constructor throws (no local fallback)', async () => {
    globalThis.Worker = class {
      constructor() { throw new Error('Worker construction blocked by CSP'); }
    };

    await expect(
      client.runSync('npub-owner', 'npub-viewer', undefined, { backendUrl: 'https://x.com' }),
    ).rejects.toThrow(/Sync unavailable/);
  });

  it('routes sync through the worker and returns results', async () => {
    class MockWorker {
      constructor() { this.onmessage = null; }
      addEventListener(type, handler) {
        if (type === 'message') this.onmessage = handler;
      }
      removeEventListener() {}
      terminate() {}
      postMessage(message) {
        if (message.type !== 'sync-worker:request') return;
        Promise.resolve().then(() => {
          this.onmessage?.({
            data: {
              type: 'sync-worker:response',
              id: message.id,
              ok: true,
              value: { pushed: 3, pulled: 1, pruned: 0 },
            },
          });
        });
      }
    }

    globalThis.Worker = MockWorker;

    const result = await client.runSync('npub-owner', 'npub-viewer', undefined, {
      backendUrl: 'https://backend.example.com',
    });
    expect(result).toEqual({ pushed: 3, pulled: 1, pruned: 0 });
  });

  it('flushOnly routes through the worker path', async () => {
    class MockWorker {
      constructor() { this.onmessage = null; }
      addEventListener(type, handler) {
        if (type === 'message') this.onmessage = handler;
      }
      removeEventListener() {}
      terminate() {}
      postMessage(message) {
        if (message.type !== 'sync-worker:request') return;
        expect(message.method).toBe('flushOnly');
        Promise.resolve().then(() => {
          this.onmessage?.({
            data: {
              type: 'sync-worker:response',
              id: message.id,
              ok: true,
              value: { pushed: 5 },
            },
          });
        });
      }
    }

    globalThis.Worker = MockWorker;

    const result = await client.flushOnly('npub-owner', null, {
      backendUrl: 'https://backend.example.com',
    });
    expect(result).toEqual({ pushed: 5 });
  });
});

describe('automatic worker recovery', () => {
  let originalWorker;

  beforeEach(() => {
    originalWorker = globalThis.Worker;
  });

  afterEach(() => {
    client.shutdownSyncWorker();
    client.setWorkerDegradedCallback(null);
    if (originalWorker === undefined) {
      delete globalThis.Worker;
    } else {
      globalThis.Worker = originalWorker;
    }
  });

  it('recovers by spawning a fresh worker after the first one crashes', async () => {
    const workerInstances = [];
    let crashFirst = true;

    class MockWorker {
      constructor() {
        workerInstances.push(this);
        this.onmessage = null;
        this.onerror = null;
        this.terminated = false;
      }
      addEventListener(type, handler) {
        if (type === 'message') this.onmessage = handler;
        if (type === 'error' || type === 'messageerror') this.onerror = handler;
      }
      removeEventListener() {}
      terminate() { this.terminated = true; }
      postMessage(message) {
        if (message.type !== 'sync-worker:request') return;
        Promise.resolve().then(() => {
          if (crashFirst) {
            crashFirst = false;
            this.onerror?.({ error: new Error('Worker crashed') });
            return;
          }
          this.onmessage?.({
            data: {
              type: 'sync-worker:response',
              id: message.id,
              ok: true,
              value: { pushed: 3, pulled: 1, pruned: 0 },
            },
          });
        });
      }
    }

    globalThis.Worker = MockWorker;

    const result = await client.runSync('npub-owner', 'npub-viewer', undefined, {
      backendUrl: 'https://backend.example.com',
    });

    expect(result).toEqual({ pushed: 3, pulled: 1, pruned: 0 });
    expect(workerInstances).toHaveLength(2);
    expect(workerInstances[0].terminated).toBe(true);
  });

  it('rejects after exhausting recovery attempts', async () => {
    let instanceCount = 0;

    class AlwaysCrashWorker {
      constructor() {
        instanceCount++;
        this.onerror = null;
      }
      addEventListener(type, handler) {
        if (type === 'error' || type === 'messageerror') this.onerror = handler;
      }
      removeEventListener() {}
      terminate() {}
      postMessage(message) {
        if (message.type !== 'sync-worker:request') return;
        Promise.resolve().then(() => {
          this.onerror?.({ error: new Error('persistent crash') });
        });
      }
    }

    globalThis.Worker = AlwaysCrashWorker;

    await expect(
      client.runSync('npub-owner', 'npub-viewer', undefined, { backendUrl: 'https://x.com' }),
    ).rejects.toThrow(/Sync worker recovery failed/);

    // 1 initial + 2 recovery = 3 worker instances created
    expect(instanceCount).toBe(3);
  });

  it('notifies the degraded callback when worker cannot recover', async () => {
    class AlwaysCrashWorker {
      constructor() { this.onerror = null; }
      addEventListener(type, handler) {
        if (type === 'error' || type === 'messageerror') this.onerror = handler;
      }
      removeEventListener() {}
      terminate() {}
      postMessage(message) {
        if (message.type !== 'sync-worker:request') return;
        Promise.resolve().then(() => {
          this.onerror?.({ error: new Error('boom') });
        });
      }
    }

    globalThis.Worker = AlwaysCrashWorker;

    const degradedEvents = [];
    client.setWorkerDegradedCallback((event) => degradedEvents.push(event));

    await expect(client.runSync('npub-owner')).rejects.toThrow();
    expect(degradedEvents.length).toBeGreaterThanOrEqual(1);
    expect(degradedEvents[degradedEvents.length - 1]).toMatchObject({
      degraded: true,
      reason: expect.any(String),
    });
  });

  it('does not fall back to local sync module when postMessage fails', async () => {
    const workerInstances = [];
    let firstPostMessage = true;

    class PostMessageFailWorker {
      constructor() {
        workerInstances.push(this);
        this.onmessage = null;
        this.onerror = null;
      }
      addEventListener(type, handler) {
        if (type === 'message') this.onmessage = handler;
        if (type === 'error' || type === 'messageerror') this.onerror = handler;
      }
      removeEventListener() {}
      terminate() {}
      postMessage(message) {
        if (message.type !== 'sync-worker:request') return;
        if (firstPostMessage) {
          firstPostMessage = false;
          throw new Error('DataCloneError');
        }
        Promise.resolve().then(() => {
          this.onmessage?.({
            data: {
              type: 'sync-worker:response',
              id: message.id,
              ok: true,
              value: { pushed: 0, pulled: 0, pruned: 0 },
            },
          });
        });
      }
    }

    globalThis.Worker = PostMessageFailWorker;

    const result = await client.runSync('npub-owner', 'npub-viewer', undefined, {
      backendUrl: 'https://backend.example.com',
    });

    expect(result).toEqual({ pushed: 0, pulled: 0, pruned: 0 });
    expect(workerInstances).toHaveLength(2);
  });
});
