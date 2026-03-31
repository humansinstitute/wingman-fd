import {
  runSync,
  pullRecordsForFamilies,
  pruneOnLogin,
  checkStaleness,
} from './sync-worker.js';
import { setBaseUrl } from '../api.js';
import { setExtensionSignerBridge } from '../auth/nostr.js';
import { importDecryptedKeys, setActiveSessionNpub } from '../crypto/group-keys.js';

const REQUEST_TYPE = 'sync-worker:request';
const PROGRESS_TYPE = 'sync-worker:progress';
const RESPONSE_TYPE = 'sync-worker:response';
const AUTH_REQUEST_TYPE = 'sync-worker:auth-request';
const AUTH_RESPONSE_TYPE = 'sync-worker:auth-response';
const BOOTSTRAP_KEYS_TYPE = 'sync-worker:bootstrap-keys';

let nextAuthRequestId = 1;
const pendingAuthRequests = new Map();

function serializeError(error) {
  if (!error) {
    return { name: 'Error', message: 'Sync worker failed' };
  }
  return {
    name: error.name || 'Error',
    message: error.message || String(error),
    stack: error.stack || '',
  };
}

function respond(id, ok, value) {
  self.postMessage({
    type: RESPONSE_TYPE,
    id,
    ok,
    ...(ok ? { value } : { error: serializeError(value) }),
  });
}

function requestExtensionAuth(method, params = {}) {
  return new Promise((resolve, reject) => {
    const authId = nextAuthRequestId++;
    pendingAuthRequests.set(authId, { resolve, reject });
    self.postMessage({
      type: AUTH_REQUEST_TYPE,
      authId,
      method,
      params,
    });
  });
}

function handleAuthResponse(message) {
  const request = pendingAuthRequests.get(message?.authId);
  if (!request) return;
  pendingAuthRequests.delete(message.authId);

  if (message.ok) {
    request.resolve(message.value);
    return;
  }

  request.reject(deserializeWorkerError(message.error));
}

setExtensionSignerBridge({
  getPublicKey: () => requestExtensionAuth('getPublicKey'),
  signEvent: (event) => requestExtensionAuth('signEvent', { event }),
});

async function handleRequest(message) {
  const { id, method, payload } = message;
  const backendUrl = String(payload?.options?.backendUrl || '').trim();
  if (backendUrl) {
    setBaseUrl(backendUrl);
  }
  const onProgress = (update) => {
    self.postMessage({
      type: PROGRESS_TYPE,
      id,
      update,
    });
  };

  switch (method) {
    case 'runSync':
      return runSync(
        payload.ownerNpub,
        payload.viewerNpub,
        onProgress,
        payload.options || {},
      );
    case 'pullRecordsForFamilies':
      return pullRecordsForFamilies(
        payload.ownerNpub,
        payload.viewerNpub,
        payload.families || [],
        payload.options || {},
        onProgress,
      );
    case 'pruneOnLogin':
      return pruneOnLogin(
        payload.viewerNpub,
        payload.ownerNpub,
        payload.options || {},
      );
    case 'checkStaleness':
      return checkStaleness(
        payload.ownerNpub,
        payload.options || {},
      );
    default:
      throw new Error(`Unsupported sync worker method: ${method}`);
  }
}

self.addEventListener('message', async (event) => {
  const message = event.data;
  if (!message || typeof message !== 'object') return;
  if (message.type === AUTH_RESPONSE_TYPE) {
    handleAuthResponse(message);
    return;
  }
  if (message.type === BOOTSTRAP_KEYS_TYPE) {
    if (message.sessionNpub) setActiveSessionNpub(message.sessionNpub);
    importDecryptedKeys(message.keys || []);
    return;
  }
  if (message.type !== REQUEST_TYPE) return;

  try {
    const value = await handleRequest(message);
    respond(message.id, true, value);
  } catch (error) {
    respond(message.id, false, error);
  }
});
