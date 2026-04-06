/**
 * V4 API client — all network calls live here (or in the sync worker).
 * The UI never calls these directly; the worker or explicit user actions do.
 */

import { createNip98AuthHeader, createNip98AuthHeaderForSecret } from './auth/nostr.js';
import { createGroupWriteAuthHeader, getActiveSessionNpub } from './crypto/group-keys.js';
import { getActiveWorkspaceKeyNpub, getActiveWorkspaceKeySecretForAuth } from './crypto/workspace-keys.js';

let _baseUrl = '';

const DEFAULT_FETCH_TIMEOUT_MS = 20_000;
const UPLOAD_FETCH_TIMEOUT_MS = 60_000;

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function setBaseUrl(url) {
  _baseUrl = url.replace(/\/+$/, '');
}

export function getBaseUrl() {
  return _baseUrl;
}

function url(path) {
  return `${_baseUrl}${path}`;
}

function getEffectiveSigningNpub(signingNpub = null) {
  return String(
    signingNpub
    || getActiveWorkspaceKeyNpub()
    || getActiveSessionNpub()
    || ''
  ).trim();
}

async function createApiAuthHeader(requestUrl, method, body = null) {
  const workspaceSecret = getActiveWorkspaceKeySecretForAuth();
  if (workspaceSecret) {
    return createNip98AuthHeaderForSecret(requestUrl, method, body ?? null, workspaceSecret);
  }
  return createNip98AuthHeader(requestUrl, method, body ?? null);
}

async function buildApiError(resp, { requestUrl = '', method = 'GET', prefix = 'API' } = {}) {
  const text = await resp.text().catch(() => '');
  const requestMethod = String(method || 'GET').toUpperCase();
  const location = requestUrl ? ` ${requestMethod} ${requestUrl}` : '';
  const suffix = text ? `: ${text}` : '';
  const error = new Error(`${prefix} ${resp.status}${location}${suffix}`);
  error.status = resp.status;
  error.method = requestMethod;
  error.requestUrl = requestUrl || null;
  error.responseText = text;
  return error;
}

async function json(resp, requestMeta = {}) {
  if (!resp.ok) {
    throw await buildApiError(resp, requestMeta);
  }
  return resp.json();
}

async function signedFetch(path, { method = 'GET', body } = {}) {
  const requestUrl = url(path);
  const headers = {
    Authorization: await createApiAuthHeader(requestUrl, method, body ?? null),
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  return fetch(requestUrl, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
  });
}

async function signedFetchAbsolute(requestUrl, { method = 'GET', body } = {}) {
  const headers = {
    Authorization: await createApiAuthHeader(requestUrl, method, body ?? null),
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  return fetch(requestUrl, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
  });
}

async function signedFetchWithFallbacks(path, { method = 'GET', body } = {}, options = {}) {
  const result = await signedFetchWithFallbackMeta(path, { method, body }, options);
  return result.response;
}

async function signedFetchWithFallbackMeta(path, { method = 'GET', body } = {}, options = {}) {
  if (!_baseUrl) {
    throw new Error('Backend URL not configured');
  }
  const requestUrl = `${_baseUrl}${path}`;
  const response = await signedFetchAbsolute(requestUrl, { method, body });
  return { response, requestUrl };
}

async function signedFetchBytes(path) {
  const requestUrl = url(path);
  const resp = await signedFetch(path);
  if (!resp.ok) {
    throw await buildApiError(resp, { requestUrl, method: 'GET' });
  }
  return new Uint8Array(await resp.arrayBuffer());
}

async function signedFetchBlob(path) {
  const requestUrl = url(path);
  const resp = await signedFetch(path);
  if (!resp.ok) {
    throw await buildApiError(resp, { requestUrl, method: 'GET' });
  }
  return resp.blob();
}

// --- Groups ---

export async function createGroup({ owner_npub, name, group_npub, member_keys }) {
  const requestUrl = url('/api/v4/groups');
  const resp = await signedFetch('/api/v4/groups', {
    method: 'POST',
    body: { owner_npub, name, group_npub, member_keys },
  });
  return json(resp, { requestUrl, method: 'POST' });
}

export async function addGroupMember(groupId, { member_npub, wrapped_group_nsec, wrapped_by_npub }) {
  const requestPath = `/api/v4/groups/${groupId}/members`;
  const requestUrl = url(requestPath);
  const resp = await signedFetch(`/api/v4/groups/${groupId}/members`, {
    method: 'POST',
    body: { member_npub, wrapped_group_nsec, wrapped_by_npub },
  });
  return json(resp, { requestUrl, method: 'POST' });
}

export async function rotateGroup(groupId, { group_npub, member_keys, name }) {
  const requestPath = `/api/v4/groups/${groupId}/rotate`;
  const requestUrl = url(requestPath);
  const resp = await signedFetch(`/api/v4/groups/${groupId}/rotate`, {
    method: 'POST',
    body: { group_npub, member_keys, name },
  });
  return json(resp, { requestUrl, method: 'POST' });
}

export async function deleteGroupMember(groupId, memberNpub) {
  const requestPath = `/api/v4/groups/${groupId}/members/${encodeURIComponent(memberNpub)}`;
  const requestUrl = url(requestPath);
  const resp = await signedFetch(requestPath, {
    method: 'DELETE',
  });
  return json(resp, { requestUrl, method: 'DELETE' });
}

export async function getGroups(npub) {
  const requestPath = `/api/v4/groups?npub=${encodeURIComponent(npub)}`;
  const requestUrl = url(requestPath);
  const resp = await signedFetch(requestPath);
  return json(resp, { requestUrl, method: 'GET' });
}

export async function getGroupKeys(memberNpub) {
  const requestPath = `/api/v4/groups/keys?member_npub=${encodeURIComponent(memberNpub)}`;
  const requestUrl = url(requestPath);
  const resp = await signedFetch(requestPath);
  return json(resp, { requestUrl, method: 'GET' });
}

export async function updateGroup(groupId, { name }) {
  const requestPath = `/api/v4/groups/${groupId}`;
  const requestUrl = url(requestPath);
  const resp = await signedFetch(`/api/v4/groups/${groupId}`, {
    method: 'PATCH',
    body: { name },
  });
  return json(resp, { requestUrl, method: 'PATCH' });
}

export async function deleteGroup(groupId) {
  const requestPath = `/api/v4/groups/${groupId}`;
  const requestUrl = url(requestPath);
  const resp = await signedFetch(`/api/v4/groups/${groupId}`, {
    method: 'DELETE',
  });
  return json(resp, { requestUrl, method: 'DELETE' });
}

// --- Workspaces ---

export async function createWorkspace(body) {
  const requestPath = '/api/v4/workspaces';
  const requestUrl = url(requestPath);
  const resp = await signedFetchWithFallbacks('/api/v4/workspaces', {
    method: 'POST',
    body,
  });
  return json(resp, { requestUrl, method: 'POST' });
}

export async function getWorkspaces(memberNpub) {
  const requestPath = `/api/v4/workspaces?member_npub=${encodeURIComponent(memberNpub)}`;
  const requestUrl = url(requestPath);
  const resp = await signedFetchWithFallbacks(requestPath, {});
  return json(resp, { requestUrl, method: 'GET' });
}

export async function recoverWorkspace(body) {
  const requestPath = '/api/v4/workspaces/recover';
  const requestUrl = url(requestPath);
  const resp = await signedFetchWithFallbacks('/api/v4/workspaces/recover', {
    method: 'POST',
    body,
  });
  return json(resp, { requestUrl, method: 'POST' });
}

export async function updateWorkspace(workspaceOwnerNpub, body) {
  const requestPath = `/api/v4/workspaces/${encodeURIComponent(workspaceOwnerNpub)}`;
  const requestUrl = url(requestPath);
  const resp = await signedFetchWithFallbacks(requestPath, {
    method: 'PATCH',
    body,
  });
  return json(resp, { requestUrl, method: 'PATCH' });
}

// --- Storage ---

export async function prepareStorageObject(body) {
  const requestPath = '/api/v4/storage/prepare';
  const { response: resp, requestUrl } = await signedFetchWithFallbackMeta(requestPath, {
    method: 'POST',
    body,
  });
  return json(resp, { requestUrl, method: 'POST' });
}

export async function uploadStorageObject(prepared, bytes, contentType = 'application/octet-stream') {
  const uploadUrl = String(prepared?.upload_url || '').trim();
  const payload = {
    base64_data: bytesToBase64(bytes),
  };
  const fallbackPath = `/api/v4/storage/${prepared.object_id}`;
  const { response: fallbackResp, requestUrl: fallbackUrl } = await signedFetchWithFallbackMeta(fallbackPath, {
    method: 'PUT',
    body: payload,
  });
  if (fallbackResp.ok) {
    return json(fallbackResp, { requestUrl: fallbackUrl, method: 'PUT' });
  }

  const fallbackError = await buildApiError(fallbackResp, {
    requestUrl: fallbackUrl,
    method: 'PUT',
  });
  if (fallbackResp.status !== 404 && fallbackResp.status !== 405) {
    throw fallbackError;
  }

  if (!uploadUrl) {
    throw fallbackError;
  }

  let directUploadFailure = null;
  let directResp;
  try {
    directResp = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
      },
      body: bytes,
      signal: AbortSignal.timeout(UPLOAD_FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    directUploadFailure = error instanceof Error ? error : new Error(String(error));
  }

  if (directResp?.ok) {
    return {
      object_id: prepared.object_id,
      size_bytes: bytes.byteLength,
      content_type: contentType,
    };
  }

  if (directResp && !directResp.ok) {
    directUploadFailure = await buildApiError(directResp, {
      requestUrl: uploadUrl,
      method: 'PUT',
      prefix: 'Storage upload',
    });
  }

  if (directUploadFailure) {
    fallbackError.directUploadMessage = directUploadFailure.message;
    fallbackError.message = `${fallbackError.message} | direct upload failed after backend upload fallback: ${directUploadFailure.message}`;
  }
  throw fallbackError;
}

export async function completeStorageObject(objectId, body = {}) {
  const requestPath = `/api/v4/storage/${objectId}/complete`;
  const { response: resp, requestUrl } = await signedFetchWithFallbackMeta(requestPath, {
    method: 'POST',
    body,
  });
  return json(resp, { requestUrl, method: 'POST' });
}

export async function getStorageDownloadUrl(objectId) {
  const requestPath = `/api/v4/storage/${objectId}/download-url`;
  const { response: resp, requestUrl } = await signedFetchWithFallbackMeta(requestPath);
  return json(resp, { requestUrl, method: 'GET' });
}

export async function getStorageObject(objectId) {
  const requestPath = `/api/v4/storage/${objectId}`;
  const { response: resp, requestUrl } = await signedFetchWithFallbackMeta(requestPath);
  return json(resp, { requestUrl, method: 'GET' });
}

export async function downloadStorageObject(objectId) {
  const requestPath = `/api/v4/storage/${objectId}/content`;
  const { response: resp, requestUrl } = await signedFetchWithFallbackMeta(requestPath);
  if (!resp.ok) {
    throw await buildApiError(resp, { requestUrl, method: 'GET' });
  }
  return new Uint8Array(await resp.arrayBuffer());
}

export async function downloadStorageObjectBlob(objectId, options = {}) {
  const requestPath = `/api/v4/storage/${objectId}/content`;
  const explicitBackendUrl = String(options?.backendUrl || '').trim().replace(/\/+$/, '');
  if (explicitBackendUrl) {
    const requestUrl = `${explicitBackendUrl}${requestPath}`;
    const resp = await signedFetchAbsolute(requestUrl);
    if (!resp.ok) {
      throw await buildApiError(resp, { requestUrl, method: 'GET' });
    }
    return resp.blob();
  }
  const { response: resp, requestUrl } = await signedFetchWithFallbackMeta(requestPath);
  if (!resp.ok) {
    throw await buildApiError(resp, { requestUrl, method: 'GET' });
  }
  return resp.blob();
}

// --- Records heartbeat ---

export async function fetchHeartbeat({ owner_npub, viewer_npub, family_cursors }) {
  const requestUrl = url('/api/v4/records/heartbeat');
  const body = { owner_npub, viewer_npub, family_cursors };
  const resp = await signedFetch('/api/v4/records/heartbeat', {
    method: 'POST',
    body,
  });
  return json(resp, { requestUrl, method: 'POST' });
}

// --- Records summary ---

export async function fetchRecordsSummary(ownerNpub) {
  try {
    const resp = await signedFetch(`/api/v4/records/summary?owner_npub=${encodeURIComponent(ownerNpub)}`);
    if (resp.status === 404 || resp.status === 405) {
      return { available: false, families: [] };
    }
    const data = await json(resp);
    return { available: true, ...data };
  } catch {
    return { available: false, families: [] };
  }
}

// --- Records sync ---

export async function syncRecords({ owner_npub, records, signing_npub }) {
  const proofPayload = { owner_npub, records };
  const groupWriteTokens = {};
  const effectiveSigningNpub = getEffectiveSigningNpub(signing_npub);

  // owner_npub is the workspace service identity — not any person's npub.
  // No user's real npub will ever match it, so all writes are non-owner
  // writes from Tower's perspective and require a group write proof.
  // We still check in case the identity model changes, but in practice
  // isOwnerUser is always false.
  const realUserNpub = String(getActiveSessionNpub() || '').trim();
  const owner = String(owner_npub || '').trim();
  const isOwnerUser = realUserNpub === owner;

  const deferredRecordIds = new Set();

  for (const record of records) {
    if (isOwnerUser) continue;
    const groupRef = String(record?.write_group_id || record?.write_group_npub || '').trim();
    if (!groupRef || groupWriteTokens[groupRef]) continue;
    try {
      groupWriteTokens[groupRef] = await createGroupWriteAuthHeader(
        groupRef,
        url('/api/v4/records/sync'),
        'POST',
        proofPayload,
      );
    } catch (error) {
      // Group key not loaded — defer these records for a later sync cycle
      // rather than crashing the entire batch.
      console.warn(`[sync] Cannot create group write proof for ${groupRef}, deferring records:`, error?.message);
      for (const r of records) {
        const ref = String(r?.write_group_id || r?.write_group_npub || '').trim();
        if (ref === groupRef) deferredRecordIds.add(r.record_id);
      }
    }
  }

  const sendableRecords = deferredRecordIds.size > 0
    ? records.filter((r) => !deferredRecordIds.has(r.record_id))
    : records;

  if (sendableRecords.length === 0) {
    return { synced: 0, created: 0, updated: 0, rejected: [], deferred: [...deferredRecordIds] };
  }

  const requestUrl = url('/api/v4/records/sync');
  const resp = await signedFetch('/api/v4/records/sync', {
    method: 'POST',
    body: {
      owner_npub,
      records: sendableRecords,
      group_write_tokens: groupWriteTokens,
    },
  });
  const result = await json(resp, { requestUrl, method: 'POST' });
  result.deferred = [...deferredRecordIds];
  return result;
}

export async function fetchRecordHistory({ record_id, owner_npub, viewer_npub }) {
  const params = new URLSearchParams({ owner_npub });
  if (viewer_npub) params.set('viewer_npub', viewer_npub);
  const requestPath = `/api/v4/records/${encodeURIComponent(record_id)}/history?${params}`;
  const { response: resp, requestUrl } = await signedFetchWithFallbackMeta(requestPath);
  return json(resp, { requestUrl, method: 'GET' });
}

export async function fetchWorkspaceKeyMappings(ownerNpub) {
  const requestPath = `/api/v4/user/workspace-key-mappings?workspace_owner_npub=${encodeURIComponent(ownerNpub)}`;
  const requestUrl = url(requestPath);
  const resp = await signedFetch(requestPath);
  return json(resp, { requestUrl, method: 'GET' });
}

export async function fetchRecords({ owner_npub, viewer_npub, record_family_hash, since }) {
  const params = new URLSearchParams({ owner_npub });
  if (viewer_npub) params.set('viewer_npub', viewer_npub);
  if (record_family_hash) params.set('record_family_hash', record_family_hash);
  if (since) params.set('since', since);
  const requestPath = `/api/v4/records?${params}`;
  const requestUrl = url(requestPath);
  const resp = await signedFetch(requestPath);
  return json(resp, { requestUrl, method: 'GET' });
}
