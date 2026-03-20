/**
 * V4 API client — all network calls live here (or in the sync worker).
 * The UI never calls these directly; the worker or explicit user actions do.
 */

import { createNip98AuthHeader } from './auth/nostr.js';
import { createGroupWriteAuthHeader } from './crypto/group-keys.js';

let _baseUrl = '';

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

function getCurrentOriginBaseUrl() {
  if (typeof window === 'undefined' || !window.location?.origin) return '';
  return String(window.location.origin || '').replace(/\/+$/, '');
}

function getCandidateBaseUrls({ preferCurrentOrigin = false } = {}) {
  const currentOrigin = getCurrentOriginBaseUrl();
  const ordered = preferCurrentOrigin
    ? [currentOrigin, _baseUrl]
    : [_baseUrl, currentOrigin];
  return [...new Set(ordered.filter(Boolean))];
}

async function json(resp) {
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`API ${resp.status}: ${text}`);
  }
  return resp.json();
}

async function signedFetch(path, { method = 'GET', body } = {}) {
  const requestUrl = url(path);
  const headers = {
    Authorization: await createNip98AuthHeader(requestUrl, method, body ?? null),
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  return fetch(requestUrl, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function signedFetchAbsolute(requestUrl, { method = 'GET', body } = {}) {
  const headers = {
    Authorization: await createNip98AuthHeader(requestUrl, method, body ?? null),
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  return fetch(requestUrl, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function signedFetchWithFallbacks(path, { method = 'GET', body } = {}, options = {}) {
  const candidateBaseUrls = getCandidateBaseUrls(options);
  if (candidateBaseUrls.length === 0) {
    throw new Error('Backend URL not configured');
  }

  let lastResponse = null;
  let lastError = null;

  for (const baseUrl of candidateBaseUrls) {
    const requestUrl = `${baseUrl}${path}`;
    try {
      const response = await signedFetchAbsolute(requestUrl, { method, body });
      if (response.status !== 404 && response.status !== 405) {
        return response;
      }
      lastResponse = response;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastResponse) return lastResponse;
  throw lastError || new Error(`Request failed for ${path}`);
}

async function signedFetchBytes(path) {
  const resp = await signedFetch(path);
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`API ${resp.status}: ${text}`);
  }
  return new Uint8Array(await resp.arrayBuffer());
}

async function signedFetchBlob(path) {
  const resp = await signedFetch(path);
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`API ${resp.status}: ${text}`);
  }
  return resp.blob();
}

// --- Groups ---

export async function createGroup({ owner_npub, name, group_npub, member_keys }) {
  const resp = await signedFetch('/api/v4/groups', {
    method: 'POST',
    body: { owner_npub, name, group_npub, member_keys },
  });
  return json(resp);
}

export async function addGroupMember(groupId, { member_npub, wrapped_group_nsec, wrapped_by_npub }) {
  const resp = await signedFetch(`/api/v4/groups/${groupId}/members`, {
    method: 'POST',
    body: { member_npub, wrapped_group_nsec, wrapped_by_npub },
  });
  return json(resp);
}

export async function rotateGroup(groupId, { group_npub, member_keys, name }) {
  const resp = await signedFetch(`/api/v4/groups/${groupId}/rotate`, {
    method: 'POST',
    body: { group_npub, member_keys, name },
  });
  return json(resp);
}

export async function deleteGroupMember(groupId, memberNpub) {
  const resp = await signedFetch(`/api/v4/groups/${groupId}/members/${encodeURIComponent(memberNpub)}`, {
    method: 'DELETE',
  });
  return json(resp);
}

export async function getGroups(npub) {
  const resp = await signedFetch(`/api/v4/groups?npub=${encodeURIComponent(npub)}`);
  return json(resp);
}

export async function getGroupKeys(memberNpub) {
  const resp = await signedFetch(`/api/v4/groups/keys?member_npub=${encodeURIComponent(memberNpub)}`);
  return json(resp);
}

export async function updateGroup(groupId, { name }) {
  const resp = await signedFetch(`/api/v4/groups/${groupId}`, {
    method: 'PATCH',
    body: { name },
  });
  return json(resp);
}

export async function deleteGroup(groupId) {
  const resp = await signedFetch(`/api/v4/groups/${groupId}`, {
    method: 'DELETE',
  });
  return json(resp);
}

// --- Workspaces ---

export async function createWorkspace(body) {
  const resp = await signedFetchWithFallbacks('/api/v4/workspaces', {
    method: 'POST',
    body,
  }, { preferCurrentOrigin: true });
  return json(resp);
}

export async function getWorkspaces(memberNpub) {
  const resp = await signedFetchWithFallbacks(`/api/v4/workspaces?member_npub=${encodeURIComponent(memberNpub)}`, {}, { preferCurrentOrigin: true });
  return json(resp);
}

export async function recoverWorkspace(body) {
  const resp = await signedFetchWithFallbacks('/api/v4/workspaces/recover', {
    method: 'POST',
    body,
  }, { preferCurrentOrigin: true });
  return json(resp);
}

export async function updateWorkspace(workspaceOwnerNpub, body) {
  const resp = await signedFetchWithFallbacks(`/api/v4/workspaces/${encodeURIComponent(workspaceOwnerNpub)}`, {
    method: 'PATCH',
    body,
  }, { preferCurrentOrigin: true });
  return json(resp);
}

// --- Storage ---

export async function prepareStorageObject(body) {
  const resp = await signedFetch('/api/v4/storage/prepare', {
    method: 'POST',
    body,
  });
  return json(resp);
}

export async function uploadStorageObject(prepared, bytes, contentType = 'application/octet-stream') {
  const uploadUrl = String(prepared?.upload_url || '').trim();
  if (!uploadUrl) {
    throw new Error('Missing upload URL for storage object.');
  }

  const directResp = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
    },
    body: bytes,
  });

  if (directResp.ok) {
    return {
      object_id: prepared.object_id,
      size_bytes: bytes.byteLength,
      content_type: contentType,
    };
  }

  // Fallback for environments still using backend-proxied upload.
  const payload = {
    base64_data: bytesToBase64(bytes),
  };
  const fallbackResp = await signedFetch(`/api/v4/storage/${prepared.object_id}`, {
    method: 'PUT',
    body: payload,
  });
  return json(fallbackResp);
}

export async function completeStorageObject(objectId, body = {}) {
  const resp = await signedFetch(`/api/v4/storage/${objectId}/complete`, {
    method: 'POST',
    body,
  });
  return json(resp);
}

export async function getStorageDownloadUrl(objectId) {
  const resp = await signedFetch(`/api/v4/storage/${objectId}/download-url`);
  return json(resp);
}

export async function getStorageObject(objectId) {
  const resp = await signedFetch(`/api/v4/storage/${objectId}`);
  return json(resp);
}

export async function downloadStorageObject(objectId) {
  return signedFetchBytes(`/api/v4/storage/${objectId}/content`);
}

export async function downloadStorageObjectBlob(objectId) {
  return signedFetchBlob(`/api/v4/storage/${objectId}/content`);
}

// --- Records sync ---

export async function syncRecords({ owner_npub, records }) {
  const proofPayload = { owner_npub, records };
  const groupWriteTokens = {};

  for (const record of records) {
    const groupRef = String(record?.write_group_id || record?.write_group_npub || '').trim();
    if (!groupRef || groupWriteTokens[groupRef]) continue;
    groupWriteTokens[groupRef] = await createGroupWriteAuthHeader(
      groupRef,
      url('/api/v4/records/sync'),
      'POST',
      proofPayload,
    );
  }

  const resp = await signedFetch('/api/v4/records/sync', {
    method: 'POST',
    body: {
      owner_npub,
      records,
      group_write_tokens: groupWriteTokens,
    },
  });
  return json(resp);
}

export async function fetchRecords({ owner_npub, viewer_npub, record_family_hash, since }) {
  const params = new URLSearchParams({ owner_npub });
  if (viewer_npub) params.set('viewer_npub', viewer_npub);
  if (record_family_hash) params.set('record_family_hash', record_family_hash);
  if (since) params.set('since', since);
  const resp = await signedFetch(`/api/v4/records?${params}`);
  return json(resp);
}
