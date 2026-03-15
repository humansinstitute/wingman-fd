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
  const resp = await signedFetch('/api/v4/workspaces', {
    method: 'POST',
    body,
  });
  return json(resp);
}

export async function getWorkspaces(memberNpub) {
  const resp = await signedFetch(`/api/v4/workspaces?member_npub=${encodeURIComponent(memberNpub)}`);
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

export async function downloadStorageObject(objectId) {
  const { download_url: downloadUrl } = await getStorageDownloadUrl(objectId);
  const resp = await fetch(downloadUrl);
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`API ${resp.status}: ${text}`);
  }
  return new Uint8Array(await resp.arrayBuffer());
}

// --- Records sync ---

export async function syncRecords({ owner_npub, records }) {
  const proofPayload = { owner_npub, records };
  const groupWriteTokens = {};

  for (const record of records) {
    const groupNpub = String(record?.write_group_npub || '').trim();
    if (!groupNpub || groupWriteTokens[groupNpub]) continue;
    groupWriteTokens[groupNpub] = await createGroupWriteAuthHeader(
      groupNpub,
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
