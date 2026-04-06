import { getExtensionPublicKey, signEventWithExtension } from './auth/nostr.js';
import { exportDecryptedKeys, getActiveSessionNpub } from './crypto/group-keys.js';
import { exportWorkspaceKeyForWorker } from './crypto/workspace-keys.js';

const REQUEST_TYPE = 'sync-worker:request';
const PROGRESS_TYPE = 'sync-worker:progress';
const RESPONSE_TYPE = 'sync-worker:response';
const AUTH_REQUEST_TYPE = 'sync-worker:auth-request';
const AUTH_RESPONSE_TYPE = 'sync-worker:auth-response';
const BOOTSTRAP_KEYS_TYPE = 'sync-worker:bootstrap-keys';
const SSE_STATUS_TYPE = 'sync-worker:sse-status';

const MAX_RECOVERY_ATTEMPTS = 2;

let _sseStatusCallback = null;

let workerInstance = null;
let nextRequestId = 1;
const pendingRequests = new Map();
const requestQueue = [];
let drainingQueue = false;

function supportsWorker() {
  return typeof Worker !== 'undefined';
}

function createWorkerInstance() {
  if (!supportsWorker()) return null;
  try {
    const worker = new Worker(new URL('./worker/sync-worker-runner.js', import.meta.url), { type: 'module' });
    worker.addEventListener('message', handleWorkerMessage);
    worker.addEventListener('error', handleWorkerError);
    worker.addEventListener('messageerror', handleWorkerError);
    return worker;
  } catch (error) {
    workerInstance = null;
    return null;
  }
}

function ensureWorkerInstance() {
  if (workerInstance) return workerInstance;
  workerInstance = createWorkerInstance();
  return workerInstance;
}

function resetWorkerInstance() {
  if (workerInstance) {
    try {
      workerInstance.removeEventListener('message', handleWorkerMessage);
      workerInstance.removeEventListener('error', handleWorkerError);
      workerInstance.removeEventListener('messageerror', handleWorkerError);
      workerInstance.terminate();
    } catch {
      // Ignore termination failures.
    }
  }
  workerInstance = null;
}

function rejectPendingRequests(error) {
  const pending = [...pendingRequests.values()];
  pendingRequests.clear();
  for (const request of pending) {
    request.reject(error);
  }
}

async function resolveAuthBridgeRequest(message) {
  switch (message?.method) {
    case 'getPublicKey':
      return getExtensionPublicKey();
    case 'signEvent':
      return signEventWithExtension(message?.params?.event);
    default:
      throw new Error(`Unsupported sync worker auth method: ${message?.method || 'unknown'}`);
  }
}

function serializeWorkerError(error) {
  if (!error) return { name: 'Error', message: 'Sync worker failed' };
  return {
    name: error.name || 'Error',
    message: error.message || String(error),
    stack: error.stack || '',
  };
}

async function handleAuthBridgeRequest(message) {
  const worker = workerInstance;
  if (!worker) return;

  try {
    const value = await resolveAuthBridgeRequest(message);
    if (worker !== workerInstance) return;
    worker.postMessage({
      type: AUTH_RESPONSE_TYPE,
      authId: message.authId,
      ok: true,
      value,
    });
  } catch (error) {
    if (worker !== workerInstance) return;
    worker.postMessage({
      type: AUTH_RESPONSE_TYPE,
      authId: message.authId,
      ok: false,
      error: serializeWorkerError(error),
    });
  }
}

function handleWorkerMessage(event) {
  const message = event?.data;
  if (!message || typeof message !== 'object') return;

  if (message.type === AUTH_REQUEST_TYPE) {
    void handleAuthBridgeRequest(message);
    return;
  }

  if (message.type === PROGRESS_TYPE) {
    const request = pendingRequests.get(message.id);
    if (request && typeof request.onProgress === 'function') {
      request.onProgress(message.update);
    }
    return;
  }

  if (message.type === SSE_STATUS_TYPE) {
    if (typeof _sseStatusCallback === 'function') {
      _sseStatusCallback(message);
    }
    return;
  }

  if (message.type !== RESPONSE_TYPE) return;

  const request = pendingRequests.get(message.id);
  if (!request) return;
  pendingRequests.delete(message.id);

  if (message.ok) {
    request.resolve(message.value);
    return;
  }

  request.reject(deserializeWorkerError(message.error));
}

function handleWorkerError(event) {
  const error = event?.error instanceof Error
    ? event.error
    : new Error(event?.message || 'Sync worker crashed');
  resetWorkerInstance();
  rejectPendingRequests(error);
}

function deserializeWorkerError(error) {
  if (!error) return new Error('Sync worker failed');
  if (error instanceof Error) return error;
  const message = typeof error.message === 'string' && error.message ? error.message : 'Sync worker failed';
  const reconstructed = new Error(message);
  if (typeof error.name === 'string') reconstructed.name = error.name;
  if (typeof error.stack === 'string') reconstructed.stack = error.stack;
  return reconstructed;
}

function syncKeysToWorker(worker) {
  if (!worker) return;
  try {
    worker.postMessage({
      type: BOOTSTRAP_KEYS_TYPE,
      sessionNpub: getActiveSessionNpub(),
      keys: exportDecryptedKeys(),
      wsKey: exportWorkspaceKeyForWorker(),
    });
  } catch {
    /* ignore — keys will be missing and records will quarantine */
  }
}

/**
 * Dispatch a method call to the sync worker. If postMessage fails (e.g. the
 * worker crashed between ensureWorkerInstance and the send), reset the worker,
 * create a new one, and retry — up to MAX_RECOVERY_ATTEMPTS times. If the
 * worker cannot be created at all, reject immediately with a clear error.
 */
function invokeWithWorker(method, payload, onProgress) {
  const worker = ensureWorkerInstance();
  if (!worker) {
    return Promise.reject(new Error(
      'Sync worker unavailable: background sync requires Web Worker support. Pending writes are preserved locally and will sync when the worker recovers.',
    ));
  }
  syncKeysToWorker(worker);

  return new Promise((resolve, reject) => {
    const id = nextRequestId++;
    pendingRequests.set(id, { resolve, reject, onProgress });
    try {
      worker.postMessage({
        type: REQUEST_TYPE,
        id,
        method,
        payload,
      });
    } catch (error) {
      pendingRequests.delete(id);
      resetWorkerInstance();

      // Attempt recovery: recreate the worker and retry.
      retryViaRecovery(method, payload, onProgress, 1).then(resolve, reject);
    }
  });
}

/**
 * Attempt to recover the worker and retry the request.
 * Gives up after MAX_RECOVERY_ATTEMPTS and rejects with an explicit error.
 */
function retryViaRecovery(method, payload, onProgress, attempt) {
  if (attempt > MAX_RECOVERY_ATTEMPTS) {
    return Promise.reject(new Error(
      'Sync worker recovery failed after ' + MAX_RECOVERY_ATTEMPTS + ' attempts. Pending writes are preserved locally and will sync when the worker recovers.',
    ));
  }

  const worker = ensureWorkerInstance();
  if (!worker) {
    return Promise.reject(new Error(
      'Sync worker unavailable: could not recreate worker. Pending writes are preserved locally.',
    ));
  }
  syncKeysToWorker(worker);

  return new Promise((resolve, reject) => {
    const id = nextRequestId++;
    pendingRequests.set(id, { resolve, reject, onProgress });
    try {
      worker.postMessage({
        type: REQUEST_TYPE,
        id,
        method,
        payload,
      });
    } catch (error) {
      pendingRequests.delete(id);
      resetWorkerInstance();
      retryViaRecovery(method, payload, onProgress, attempt + 1).then(resolve, reject);
    }
  });
}

function enqueue(method, payload, onProgress) {
  return new Promise((resolve, reject) => {
    requestQueue.push({ method, payload, onProgress, resolve, reject });
    if (!drainingQueue) {
      void drainQueue();
    }
  });
}

async function drainQueue() {
  drainingQueue = true;
  try {
    while (requestQueue.length > 0) {
      const request = requestQueue.shift();
      try {
        const value = await invokeWithWorker(request.method, request.payload, request.onProgress);
        request.resolve(value);
      } catch (error) {
        request.reject(error);
      }
    }
  } finally {
    drainingQueue = false;
  }
}

export function primeSyncWorker() {
  return Boolean(ensureWorkerInstance());
}

export function shutdownSyncWorker() {
  stopWorkerFlushTimer();
  resetWorkerInstance();
}

/**
 * Return the current health status of the sync worker.
 * - 'healthy': worker is running
 * - 'unavailable': no worker instance (not supported or not yet started)
 */
export function getWorkerStatus() {
  if (workerInstance) return 'healthy';
  return 'unavailable';
}

/**
 * Start an independent outbox flush timer in the worker.
 * The worker will flush pending writes every 2s on its own,
 * decoupling UI responsiveness from sync latency.
 */
export function startWorkerFlushTimer(ownerNpub, backendUrl, workspaceDbKey) {
  const worker = ensureWorkerInstance();
  if (!worker) return;
  try {
    worker.postMessage({
      type: 'sync-worker:start-flush-timer',
      ownerNpub,
      backendUrl,
      workspaceDbKey,
    });
  } catch { /* ignore */ }
}

export function stopWorkerFlushTimer() {
  if (!workerInstance) return;
  try {
    workerInstance.postMessage({ type: 'sync-worker:stop-flush-timer' });
  } catch { /* ignore */ }
}

export async function runSync(ownerNpub, viewerNpub = ownerNpub, onProgress, options = {}) {
  return enqueue('runSync', { ownerNpub, viewerNpub, options }, onProgress);
}

/**
 * Flush pending writes to Tower without pulling or running a heartbeat.
 * Returns { pushed } — much faster than runSync for write-then-continue flows.
 */
export async function flushOnly(ownerNpub, onProgress, options = {}) {
  return enqueue('flushOnly', { ownerNpub, options }, onProgress);
}

export async function pullRecordsForFamilies(ownerNpub, viewerNpub = ownerNpub, families = [], options = {}, onProgress) {
  return enqueue('pullRecordsForFamilies', { ownerNpub, viewerNpub, families, options }, onProgress);
}

export async function pruneOnLogin(viewerNpub, ownerNpub, options = {}) {
  return enqueue('pruneOnLogin', { viewerNpub, ownerNpub, options });
}

export async function checkStaleness(ownerNpub, options = {}) {
  return enqueue('checkStaleness', { ownerNpub, options });
}

// --- SSE control ---

export function setSSEStatusCallback(callback) {
  _sseStatusCallback = callback;
}

export function connectSSE(ownerNpub, viewerNpub, backendUrl, token, workspaceDbKey) {
  const worker = ensureWorkerInstance();
  if (!worker) return;
  syncKeysToWorker(worker);
  try {
    worker.postMessage({
      type: 'sync-worker:sse-connect',
      ownerNpub,
      viewerNpub,
      backendUrl,
      token,
      workspaceDbKey,
    });
  } catch { /* ignore */ }
}

export function disconnectSSE() {
  if (!workerInstance) return;
  try {
    workerInstance.postMessage({ type: 'sync-worker:sse-disconnect' });
  } catch { /* ignore */ }
}

export function flushNow() {
  if (!workerInstance) return;
  try {
    workerInstance.postMessage({ type: 'sync-worker:flush-now' });
  } catch { /* ignore */ }
}
