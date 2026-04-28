import { createNip98AuthHeaderForSecret } from '@superbased/core/client';
import { normalizeSuperbasedIdentityContext } from '@superbased/core/identity-model';
import { RecordManager } from '@superbased/core/records';

import { getGroupKey } from '../crypto/group-keys.js';
import { buildFlightDeckIdentityContext } from './identity-context.js';
import {
  normalizeFlightDeckRecordCheckoutPolicyConfig,
  stripCheckoutForOptimisticWrite,
} from '../record-checkout-policy.js';

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '').trim().replace(/\/+$/, '');
}

function buildRecordManager(baseUrl) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  return new RecordManager({
    buildUrl(path) {
      const normalizedPath = String(path || '').startsWith('/') ? path : `/${path}`;
      return `${normalizedBaseUrl}${normalizedPath}`;
    },
    getGroupKey(groupRef, options = {}) {
      return getGroupKey(groupRef, options);
    },
  });
}

function copyRecordForSync(record, workspaceServiceNpub) {
  return {
    owner_npub: workspaceServiceNpub,
    ...record,
  };
}

function stripHelperFields(record) {
  const { payload: _payload, ...sendable } = record;
  return sendable;
}

function recordWriteGroupRef(record) {
  return String(record?.write_group_id || record?.write_group_npub || '').trim() || null;
}

function isDirectOwnerWrite(record) {
  const signer = String(record?.signature_npub || '').trim();
  const owner = String(record?.owner_npub || '').trim();
  return Boolean(signer && owner && signer === owner);
}

function hasNonOwnerRecordWithoutWriteGroup(records) {
  return records.some((record) => !isDirectOwnerWrite(record) && !recordWriteGroupRef(record));
}

function buildIdentityContext({ ownerNpub, signingNpub } = {}) {
  const baseContext = buildFlightDeckIdentityContext({ workspaceServiceNpub: ownerNpub });
  const explicitSigningNpub = String(signingNpub || '').trim();
  const explicitWorkspaceUserKeyNpub = explicitSigningNpub && explicitSigningNpub !== baseContext.userNpub
    ? explicitSigningNpub
    : null;
  const context = explicitWorkspaceUserKeyNpub && !baseContext.workspaceUserKeyNpub
    ? buildFlightDeckIdentityContext({
      workspaceServiceNpub: ownerNpub,
      workspaceUserKeyNpub: explicitWorkspaceUserKeyNpub,
    })
    : baseContext;

  if (!context.userNpub) return null;
  return {
    userNpub: context.userNpub,
    actorNpub: context.actorNpub,
    viewerNpub: context.viewerNpub,
    workspaceServiceNpub: context.workspaceServiceNpub,
    ...(context.workspaceUserKeyNpub ? {
      workspaceUserKeyNpub: context.workspaceUserKeyNpub,
      signerNpub: context.signerNpub,
    } : {}),
  };
}

function buildIdentityFields(identityContext) {
  if (!identityContext) return {};
  const context = normalizeSuperbasedIdentityContext(identityContext);
  return {
    user_npub: context.userNpub,
    actor_npub: context.actorNpub,
    viewer_npub: context.viewerNpub,
    ...(context.signerNpub ? { signer_npub: context.signerNpub } : {}),
    ...(context.workspaceUserKeyNpub ? {
      workspace_user_key_npub: context.workspaceUserKeyNpub,
      ws_key_npub: context.workspaceUserKeyNpub,
    } : {}),
  };
}

async function buildCompatibilitySyncRequest({
  workspaceServiceNpub,
  records,
  identityContext,
  baseUrl,
  checkoutPolicyConfig,
}) {
  const identityFields = buildIdentityFields(identityContext);
  const deferredRecordIds = new Set();
  const missingGroupRefs = new Set();

  for (const record of records) {
    if (isDirectOwnerWrite(record)) continue;
    const writeGroupRef = recordWriteGroupRef(record);
    if (!writeGroupRef) continue;
    if (!getGroupKey(writeGroupRef)) missingGroupRefs.add(writeGroupRef);
  }

  for (const record of records) {
    const writeGroupRef = recordWriteGroupRef(record);
    if (writeGroupRef && missingGroupRefs.has(writeGroupRef)) {
      deferredRecordIds.add(record.record_id);
    }
  }

  const sendableRecords = records
    .filter((record) => !deferredRecordIds.has(record.record_id))
    .map((record) => stripHelperFields(stripCheckoutForOptimisticWrite(record, checkoutPolicyConfig)));
  const proofBody = {
    owner_npub: workspaceServiceNpub,
    workspace_service_npub: workspaceServiceNpub,
    ...identityFields,
    records: sendableRecords,
  };
  const groupWriteTokens = {};
  const requestUrl = `${normalizeBaseUrl(baseUrl)}/api/v4/records/sync`;

  for (const record of sendableRecords) {
    if (isDirectOwnerWrite(record)) continue;
    const writeGroupRef = recordWriteGroupRef(record);
    if (!writeGroupRef || groupWriteTokens[writeGroupRef]) continue;
    const key = getGroupKey(writeGroupRef);
    if (!key) continue;
    groupWriteTokens[writeGroupRef] = await createNip98AuthHeaderForSecret(
      requestUrl,
      'POST',
      proofBody,
      key.secret,
    );
  }

  return {
    owner_npub: workspaceServiceNpub,
    workspace_service_npub: workspaceServiceNpub,
    ...identityFields,
    records: sendableRecords,
    group_write_tokens: groupWriteTokens,
    deferred_record_ids: [...deferredRecordIds],
  };
}

export async function buildFlightDeckSyncRequest({
  ownerNpub,
  records = [],
  signingNpub = null,
  baseUrl = '',
  checkoutPolicyConfig = null,
} = {}) {
  const workspaceServiceNpub = String(ownerNpub || '').trim();
  if (!workspaceServiceNpub) throw new Error('owner_npub is required for record sync');

  if (!Array.isArray(records) || records.length === 0) {
    return {
      owner_npub: workspaceServiceNpub,
      workspace_service_npub: workspaceServiceNpub,
      records: [],
      group_write_tokens: {},
      deferred_record_ids: [],
    };
  }

  const copiedRecords = records.map((record) => copyRecordForSync(record, workspaceServiceNpub));
  const identityContext = buildIdentityContext({ ownerNpub: workspaceServiceNpub, signingNpub });
  const policyConfig = normalizeFlightDeckRecordCheckoutPolicyConfig(checkoutPolicyConfig);

  if (hasNonOwnerRecordWithoutWriteGroup(copiedRecords)) {
    return buildCompatibilitySyncRequest({
      workspaceServiceNpub,
      records: copiedRecords,
      identityContext,
      baseUrl,
      checkoutPolicyConfig: policyConfig,
    });
  }

  const recordManager = buildRecordManager(baseUrl);
  return recordManager.buildCheckoutAwareSyncRequest({
    records: copiedRecords,
    identityContext,
    deferMissingGroupKeys: true,
    checkoutPolicy: policyConfig,
  });
}
