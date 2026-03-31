import { setBaseUrl } from './api.js';
import { getExtensionPublicKey, signEventWithExtension } from './auth/nostr.js';
import { exportDecryptedKeys, getActiveSessionNpub } from './crypto/group-keys.js';

const REQUEST_TYPE = 'sync-worker:request';
const PROGRESS_TYPE = 'sync-worker:progress';
const RESPONSE_TYPE = 'sync-worker:response';
const AUTH_REQUEST_TYPE = 'sync-worker:auth-request';
const AUTH_RESPONSE_TYPE = 'sync-worker:auth-response';
const BOOTSTRAP_KEYS_TYPE = 'sync-worker:bootstrap-keys';

let workerInstance = null;
let nextRequestId = 1;
let localModulePromise = null;
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
      // Ignore termination failures; the client will fall back cleanly.
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

async function getLocalWorkerModule() {
  if (!localModulePromise) {
    localModulePromise = import('./worker/sync-worker.js');
  }
  return localModulePromise;
}

function primeRequestBaseUrl(payload) {
  const backendUrl = String(payload?.options?.backendUrl || '').trim();
  if (backendUrl) {
    setBaseUrl(backendUrl);
  }
}

async function invokeLocally(method, payload) {
  primeRequestBaseUrl(payload);
  const mod = await getLocalWorkerModule();
  switch (method) {
    case 'runSync':
      return mod.runSync(
        payload.ownerNpub,
        payload.viewerNpub,
        payload.onProgress,
        payload.options,
      );
    case 'pullRecordsForFamilies':
      return mod.pullRecordsForFamilies(
        payload.ownerNpub,
        payload.viewerNpub,
        payload.families,
        payload.options,
        payload.onProgress,
      );
    case 'pruneOnLogin':
      return mod.pruneOnLogin(
        payload.viewerNpub,
        payload.ownerNpub,
        payload.options,
      );
    case 'checkStaleness':
      return mod.checkStaleness(
        payload.ownerNpub,
        payload.options,
      );
    default:
      throw new Error(`Unsupported sync worker method: ${method}`);
  }
}

function syncKeysToWorker(worker) {
  if (!worker) return;
  try {
    worker.postMessage({
      type: BOOTSTRAP_KEYS_TYPE,
      sessionNpub: getActiveSessionNpub(),
      keys: exportDecryptedKeys(),
    });
  } catch {
    /* ignore — keys will be missing and records will quarantine */
  }
}

function invokeWithWorker(method, payload, onProgress) {
  const worker = ensureWorkerInstance();
  if (!worker) {
    return invokeLocally(method, { ...payload, onProgress });
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
      invokeLocally(method, { ...payload, onProgress }).then(resolve, reject);
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
  resetWorkerInstance();
}

export async function runSync(ownerNpub, viewerNpub = ownerNpub, onProgress, options = {}) {
  return enqueue('runSync', { ownerNpub, viewerNpub, options }, onProgress);
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
