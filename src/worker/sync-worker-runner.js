import {
  runSync,
  flushPendingWrites,
  pullRecordsForFamilies,
  pruneOnLogin,
  checkStaleness,
} from './sync-worker.js';
import { getPendingWrites } from '../db.js';
import { setBaseUrl } from '../api.js';
import { setExtensionSignerBridge } from '../auth/nostr.js';
import { importDecryptedKeys, setActiveSessionNpub } from '../crypto/group-keys.js';
import { importWorkspaceKeyFromMain } from '../crypto/workspace-keys.js';

const REQUEST_TYPE = 'sync-worker:request';
const PROGRESS_TYPE = 'sync-worker:progress';
const RESPONSE_TYPE = 'sync-worker:response';
const AUTH_REQUEST_TYPE = 'sync-worker:auth-request';
const AUTH_RESPONSE_TYPE = 'sync-worker:auth-response';
const BOOTSTRAP_KEYS_TYPE = 'sync-worker:bootstrap-keys';
const START_FLUSH_TIMER_TYPE = 'sync-worker:start-flush-timer';
const STOP_FLUSH_TIMER_TYPE = 'sync-worker:stop-flush-timer';
const FLUSH_RESULT_TYPE = 'sync-worker:flush-result';

// SSE advisory transport — worker ↔ main-thread message types.
// SSE events notify the worker what to refresh; actual data comes from pull requests.
const SSE_CONNECT_TYPE = 'sync-worker:sse-connect';
const SSE_DISCONNECT_TYPE = 'sync-worker:sse-disconnect';
const SSE_STATUS_TYPE = 'sync-worker:sse-status';
const FLUSH_NOW_TYPE = 'sync-worker:flush-now';

let nextAuthRequestId = 1;
const pendingAuthRequests = new Map();

// --- Independent outbox flush timer ---
let flushTimerId = null;
let flushOwnerNpub = null;
let flushBackendUrl = null;
let flushWorkspaceDbKey = null;
let flushInProgress = false; // guard against concurrent flushes
const FLUSH_INTERVAL_MS = 2000;

// --- SSE advisory transport state ---
let eventSource = null;
let sseOwnerNpub = null;
let sseViewerNpub = null;
let sseBackendUrl = null;
let sseWorkspaceDbKey = null;
let sseLastEventId = null;
let sseReconnectTimer = null;
let sseReconnectAttempts = 0;
const SSE_DEBOUNCE_MS = 300;
const SSE_ECHO_TTL_MS = 30_000;
let sseDebounceTimer = null;
const sseStaleFamilies = new Set();
const sseEchoSet = new Map(); // key: "recordId:version" → expiry timestamp

async function registerEchoEntries() {
  if (!eventSource) return; // only needed when SSE is active
  try {
    const pending = await getPendingWrites();
    for (const pw of pending) {
      if (pw.envelope?.record_id && pw.envelope?.version) {
        markOwnWrite(pw.envelope.record_id, pw.envelope.version);
      }
    }
  } catch { /* non-fatal */ }
}

async function tickFlush() {
  if (!flushOwnerNpub || !flushBackendUrl) return;
  if (flushInProgress) return; // skip if a flush or runSync is already running
  flushInProgress = true;
  try {
    if (flushBackendUrl) setBaseUrl(flushBackendUrl);
    await registerEchoEntries();
    const result = await flushPendingWrites(flushOwnerNpub, null, {
      workspaceDbKey: flushWorkspaceDbKey || flushOwnerNpub,
    });
    if (result.pushed > 0) {
      self.postMessage({ type: FLUSH_RESULT_TYPE, pushed: result.pushed });
    }
    cleanEchoSet();
  } catch {
    // Silent — next tick will retry
  } finally {
    flushInProgress = false;
  }
}

function startFlushTimer(ownerNpub, backendUrl, workspaceDbKey) {
  stopFlushTimer();
  flushOwnerNpub = ownerNpub;
  flushBackendUrl = backendUrl;
  flushWorkspaceDbKey = workspaceDbKey;
  flushTimerId = setInterval(tickFlush, FLUSH_INTERVAL_MS);
}

function stopFlushTimer() {
  if (flushTimerId != null) {
    clearInterval(flushTimerId);
    flushTimerId = null;
  }
  flushOwnerNpub = null;
  flushBackendUrl = null;
  flushWorkspaceDbKey = null;
}

// --- Echo suppression ---

function markOwnWrite(recordId, version) {
  sseEchoSet.set(`${recordId}:${version}`, Date.now() + SSE_ECHO_TTL_MS);
}

function isOwnEcho(recordId, version) {
  const key = `${recordId}:${version}`;
  const expiry = sseEchoSet.get(key);
  if (!expiry) return false;
  if (Date.now() > expiry) {
    sseEchoSet.delete(key);
    return false;
  }
  sseEchoSet.delete(key);
  return true;
}

function cleanEchoSet() {
  const now = Date.now();
  for (const [key, expiry] of sseEchoSet) {
    if (now > expiry) sseEchoSet.delete(key);
  }
}

// --- SSE client ---

function connectSSE(ownerNpub, viewerNpub, backendUrl, token, workspaceDbKey) {
  disconnectSSE();

  sseOwnerNpub = ownerNpub;
  sseViewerNpub = viewerNpub;
  sseBackendUrl = backendUrl;
  sseWorkspaceDbKey = workspaceDbKey;

  const sseUrl = new URL(`/api/v4/workspaces/${ownerNpub}/stream`, backendUrl);
  sseUrl.searchParams.set('token', token);
  if (sseLastEventId != null) {
    sseUrl.searchParams.set('last_event_id', String(sseLastEventId));
  }

  eventSource = new EventSource(sseUrl.toString());

  eventSource.addEventListener('record-changed', handleRecordChanged);
  eventSource.addEventListener('group-changed', handleGroupChanged);
  eventSource.addEventListener('catch-up-required', handleCatchUpRequired);
  eventSource.addEventListener('connected', handleConnected);
  eventSource.addEventListener('heartbeat', () => { /* keep-alive, no action needed */ });

  eventSource.onerror = () => {
    disconnectSSE();
    scheduleReconnect();
  };

  sseReconnectAttempts = 0;
  postSSEStatus('connecting');
}

function disconnectSSE() {
  if (sseDebounceTimer) {
    clearTimeout(sseDebounceTimer);
    sseDebounceTimer = null;
  }
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  sseStaleFamilies.clear();
}

function scheduleReconnect() {
  if (sseReconnectTimer) clearTimeout(sseReconnectTimer);

  const delay = Math.min(1000 * Math.pow(2, sseReconnectAttempts), 60_000);
  sseReconnectAttempts++;

  if (sseReconnectAttempts > 5) {
    postSSEStatus('fallback-polling');
    return;
  }

  postSSEStatus('reconnecting');
  sseReconnectTimer = setTimeout(() => {
    sseReconnectTimer = null;
    // Request a fresh token from the main thread
    self.postMessage({ type: SSE_STATUS_TYPE, status: 'token-needed' });
  }, delay);
}

function postSSEStatus(status, extra = {}) {
  self.postMessage({ type: SSE_STATUS_TYPE, status, ...extra });
}

function handleConnected(event) {
  sseReconnectAttempts = 0;
  postSSEStatus('connected');
}

function handleRecordChanged(event) {
  let data;
  try { data = JSON.parse(event.data); } catch { return; }
  if (event.lastEventId) sseLastEventId = event.lastEventId;

  // Echo suppression
  if (isOwnEcho(data.record_id, data.version)) return;

  // Collect stale family and debounce
  sseStaleFamilies.add(data.family_hash);
  if (sseDebounceTimer) clearTimeout(sseDebounceTimer);
  sseDebounceTimer = setTimeout(flushSSEStaleFamilies, SSE_DEBOUNCE_MS);
}

async function flushSSEStaleFamilies() {
  sseDebounceTimer = null;
  const families = [...sseStaleFamilies];
  sseStaleFamilies.clear();
  if (!families.length || !sseOwnerNpub || !sseBackendUrl) return;

  try {
    if (sseBackendUrl) setBaseUrl(sseBackendUrl);
    await pullRecordsForFamilies(
      sseOwnerNpub,
      sseViewerNpub || sseOwnerNpub,
      families,
      { workspaceDbKey: sseWorkspaceDbKey || sseOwnerNpub },
    );
    postSSEStatus('pull-complete', { families });
  } catch (error) {
    // Non-fatal — next SSE event will retry
  }
}

function handleGroupChanged(event) {
  // Notify main thread to refresh groups
  postSSEStatus('group-changed');
}

function handleCatchUpRequired() {
  // Cursor evicted from ring buffer — main thread should do a full sync
  postSSEStatus('catch-up-required');
}

// --- Flush now (immediate outbox push) ---

async function flushNow() {
  if (!flushOwnerNpub || !flushBackendUrl) return;
  if (flushInProgress) return; // skip if a flush or runSync is already running
  flushInProgress = true;
  try {
    if (flushBackendUrl) setBaseUrl(flushBackendUrl);
    await registerEchoEntries();
    const result = await flushPendingWrites(flushOwnerNpub, null, {
      workspaceDbKey: flushWorkspaceDbKey || flushOwnerNpub,
    });
    if (result.pushed > 0) {
      self.postMessage({ type: FLUSH_RESULT_TYPE, pushed: result.pushed });
    }
    cleanEchoSet();
  } catch {
    // Silent
  } finally {
    flushInProgress = false;
  }
}

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
      // Set flushInProgress so tickFlush/flushNow skip while runSync
      // (which calls flushPendingWrites internally) is running.
      flushInProgress = true;
      try {
        return await runSync(
          payload.ownerNpub,
          payload.viewerNpub,
          onProgress,
          payload.options || {},
        );
      } finally {
        flushInProgress = false;
      }
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
    case 'flushOnly':
      flushInProgress = true;
      try {
        return await flushPendingWrites(
          payload.ownerNpub,
          onProgress,
          payload.options || {},
        );
      } finally {
        flushInProgress = false;
      }
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
    if (message.wsKey) importWorkspaceKeyFromMain(message.wsKey);
    return;
  }
  if (message.type === START_FLUSH_TIMER_TYPE) {
    startFlushTimer(message.ownerNpub, message.backendUrl, message.workspaceDbKey);
    return;
  }
  if (message.type === STOP_FLUSH_TIMER_TYPE) {
    stopFlushTimer();
    return;
  }
  if (message.type === SSE_CONNECT_TYPE) {
    connectSSE(
      message.ownerNpub,
      message.viewerNpub,
      message.backendUrl,
      message.token,
      message.workspaceDbKey,
    );
    return;
  }
  if (message.type === SSE_DISCONNECT_TYPE) {
    disconnectSSE();
    postSSEStatus('disconnected');
    return;
  }
  if (message.type === FLUSH_NOW_TYPE) {
    void flushNow();
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
