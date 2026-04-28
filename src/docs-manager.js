/**
 * Document management methods extracted from app.js.
 *
 * Pure utility functions are exported individually for direct testing.
 * The docsManagerMixin object contains methods that use `this` (the Alpine store)
 * and should be spread into the store definition.
 */

import { commentBelongsToDocBlock } from './doc-comment-anchors.js';
import {
  sameListBySignature,
  parseMarkdownBlocks,
  assembleMarkdownBlocks,
} from './utils/state-helpers.js';
import {
  upsertDocument,
  upsertDirectory,
  upsertComment,
  getCommentsByTarget,
  getAudioNoteById,
  addPendingWrite,
} from './db.js';
import { recordFamilyHash } from './translators/chat.js';
import { outboundDocument, outboundDirectory } from './translators/docs.js';
import { outboundComment } from './translators/comments.js';
import { toRaw } from './utils/state-helpers.js';
import { acquireRecordCheckout, fetchRecordHistory, releaseRecordCheckout } from './api.js';
import { inboundDocument } from './translators/docs.js';
import { renderMarkdownToHtml, hydrateStorageImageMarkup } from './markdown.js';
import { normalizeGroupIds } from './scope-delivery.js';
import { hasGroupKey } from './crypto/group-keys.js';
import { getStoreActorWritableGroupRefs } from './preferred-write-group.js';
import { requireFlightDeckIdentityContext } from './superbased/identity-context.js';
import {
  checkoutErrorMessage,
  describeCheckoutHolder,
  formatLeaseRemaining,
  isCheckoutHeld,
  lockManagedRecordKey,
} from './lock-managed-records.js';
import { resolveFlightDeckRecordCheckoutPolicy } from './record-checkout-policy.js';
import { diffLines } from 'diff';

// ---------------------------------------------------------------------------
// Pure utility functions (no `this` dependency)
// ---------------------------------------------------------------------------

export function normalizeDocShare(share, inheritedFromDirectoryId = null) {
  if (!share) return null;
  const type = share.type === 'person' ? 'person' : 'group';
  const personNpub = String(share.person_npub || '').trim() || null;
  const groupNpub = String(share.group_npub || '').trim() || null;
  const viaGroupNpub = String(share.via_group_npub || '').trim() || null;
  const groupId = String(share.group_id || '').trim() || groupNpub || null;
  const viaGroupId = String(share.via_group_id || '').trim() || viaGroupNpub || null;
  const key = type === 'person'
    ? (personNpub ? `person:${personNpub}` : null)
    : `group:${groupId || viaGroupId || groupNpub || viaGroupNpub}`;
  if (!key) return null;

  const sourceDirectoryId = inheritedFromDirectoryId || share.inherited_from_directory_id || null;
  return {
    ...share,
    type,
    key,
    access: share.access === 'write' ? 'write' : 'read',
    person_npub: personNpub,
    group_id: groupId,
    group_npub: groupNpub,
    via_group_id: viaGroupId,
    via_group_npub: viaGroupNpub,
    inherited: Boolean(sourceDirectoryId || share.inherited),
    inherited_from_directory_id: sourceDirectoryId,
  };
}

export function serializeDocShares(shares) {
  return JSON.stringify((shares || [])
    .map((share) => ({
      type: share.type,
      key: share.key,
      access: share.access,
      person_npub: share.person_npub || null,
      group_id: share.group_id || null,
      group_npub: share.group_npub || null,
      via_group_id: share.via_group_id || null,
      via_group_npub: share.via_group_npub || null,
      inherited: share.inherited === true,
      inherited_from_directory_id: share.inherited_from_directory_id || null,
    }))
    .sort((a, b) => String(a.key || '').localeCompare(String(b.key || ''))));
}

export function mergeDocShareLists(primaryShares = [], inheritedShares = []) {
  const merged = new Map();
  for (const share of primaryShares) {
    const normalized = normalizeDocShare(share);
    if (!normalized?.key) continue;
    merged.set(normalized.key, normalized);
  }

  for (const share of inheritedShares) {
    const normalized = normalizeDocShare(
      share,
      share.inherited_from_directory_id || share.source_directory_id || null,
    );
    if (!normalized?.key) continue;
    const existing = merged.get(normalized.key);
    if (!existing) {
      merged.set(normalized.key, normalized);
      continue;
    }
    merged.set(normalized.key, {
      ...existing,
      access: existing.access === 'write' || normalized.access === 'write' ? 'write' : 'read',
      inherited: existing.inherited || normalized.inherited,
      inherited_from_directory_id: existing.inherited_from_directory_id || normalized.inherited_from_directory_id || null,
    });
  }

  return [...merged.values()].sort((a, b) => String(a.key || '').localeCompare(String(b.key || '')));
}

export function getStoredDocShares(item) {
  return Array.isArray(item?.shares)
    ? item.shares.map((share) => normalizeDocShare(share)).filter(Boolean)
    : [];
}

export function getExplicitDocShares(item) {
  return getStoredDocShares(item).filter((share) => !share.inherited && !share.inherited_from_directory_id);
}

export function getShareGroupIds(shares = []) {
  return [...new Set((shares || []).map((share) => share.type === 'person'
    ? (share.via_group_id || share.group_id || share.via_group_npub || share.group_npub)
    : (share.group_id || share.group_npub)).filter(Boolean))];
}

export function getWriteableShareGroupIds(shares = []) {
  return [...new Set((shares || [])
    .filter((share) => share?.access === 'write')
    .map((share) => share.type === 'person'
      ? (share.via_group_id || share.group_id || share.via_group_npub || share.group_npub)
      : (share.group_id || share.group_npub))
    .filter(Boolean))];
}

export function getPreferredDocWriteGroupRef(item = null, options = {}) {
  const hasKey = typeof options?.hasKey === 'function'
    ? options.hasKey
    : hasGroupKey;
  const allowedGroupIds = normalizeGroupIds(options?.allowedGroupIds || []);
  const hasAllowedFilter = allowedGroupIds.length > 0;
  const allowedSet = new Set(allowedGroupIds);
  const isAllowed = (groupId) => !hasAllowedFilter || allowedSet.has(groupId);
  const shares = getStoredDocShares(item);
  const groupIds = normalizeGroupIds(
    Array.isArray(item?.group_ids) && item.group_ids.length > 0
      ? item.group_ids
      : getShareGroupIds(shares),
  );
  const candidateGroupIds = hasAllowedFilter
    ? groupIds.filter((groupId) => isAllowed(groupId))
    : groupIds;
  const explicitWriteGroupId = String(item?.write_group_id || '').trim() || null;
  const scopePolicyGroupIds = normalizeGroupIds(item?.scope_policy_group_ids || [])
    .filter((groupId) => !hasAllowedFilter || isAllowed(groupId));
  const writeableGroupIds = getWriteableShareGroupIds(shares);
  const candidateWriteableGroupIds = writeableGroupIds.filter((groupId) => candidateGroupIds.includes(groupId));
  const hasWritableCandidates = candidateWriteableGroupIds.length > 0;
  const prioritizedScopePolicyGroupIds = hasAllowedFilter
    ? allowedGroupIds.filter((groupId) => scopePolicyGroupIds.includes(groupId))
    : scopePolicyGroupIds;
  const prioritizedCandidateGroupIds = hasAllowedFilter
    ? allowedGroupIds.filter((groupId) => candidateGroupIds.includes(groupId))
    : candidateGroupIds;
  const prioritizedWriteableGroupIds = hasAllowedFilter
    ? allowedGroupIds.filter((groupId) => candidateWriteableGroupIds.includes(groupId))
    : candidateWriteableGroupIds;

  if (explicitWriteGroupId && isAllowed(explicitWriteGroupId) && hasKey(explicitWriteGroupId)) {
    if (hasAllowedFilter && prioritizedCandidateGroupIds.length > 1) {
      // In actor-scoped contexts, avoid pinning writes to a stale explicit group
      // when multiple allowed groups are available for this actor.
    } else if (hasWritableCandidates && candidateWriteableGroupIds.includes(explicitWriteGroupId)) {
      return explicitWriteGroupId;
    } else if (!hasWritableCandidates) {
      return explicitWriteGroupId;
    }
  }
  for (const groupId of prioritizedScopePolicyGroupIds) {
    if (hasWritableCandidates && !candidateWriteableGroupIds.includes(groupId)) continue;
    if (candidateGroupIds.includes(groupId) && hasKey(groupId)) return groupId;
  }

  const loadedWritableGroupIds = prioritizedWriteableGroupIds.filter((groupId) => hasKey(groupId));
  if (loadedWritableGroupIds.length > 0) return loadedWritableGroupIds[0];
  for (const groupId of prioritizedCandidateGroupIds) {
    if (hasKey(groupId)) return groupId;
  }
  if (prioritizedScopePolicyGroupIds.length > 0) return prioritizedScopePolicyGroupIds[0];
  if (explicitWriteGroupId && isAllowed(explicitWriteGroupId) && candidateGroupIds.includes(explicitWriteGroupId)) {
    return explicitWriteGroupId;
  }
  for (const groupId of prioritizedWriteableGroupIds) {
    if (candidateGroupIds.includes(groupId)) return groupId;
  }

  if (prioritizedCandidateGroupIds.length > 0) return prioritizedCandidateGroupIds[0];
  if (hasAllowedFilter) return null;
  return groupIds[0] || explicitWriteGroupId || null;
}

export function normalizeDocAccessRow(item, resolverFn = (value) => String(value || '').trim() || null, options = {}) {
  if (!item || typeof item !== 'object') return item;

  const allowedGroupIds = normalizeGroupIds((options.allowedGroupIds || [])
    .map((value) => resolverFn(value))
    .filter(Boolean));
  const hasAllowedFilter = allowedGroupIds.length > 0;
  const allowedSet = new Set(allowedGroupIds);
  const isAllowedGroupRef = (groupRef) => {
    if (!hasAllowedFilter) return true;
    const resolved = resolverFn(groupRef);
    return Boolean(resolved && allowedSet.has(resolved));
  };

  const nextShares = getStoredDocShares(item)
    .map((share) => normalizeDocShare({
      ...share,
      group_id: resolverFn(share.group_id || share.group_npub),
      via_group_id: resolverFn(share.via_group_id || share.via_group_npub),
    }))
    .filter(Boolean)
    .filter((share) => {
      const groupRef = share.type === 'person'
        ? (share.via_group_id || share.group_id || share.via_group_npub || share.group_npub || null)
        : (share.group_id || share.group_npub || null);
      if (!groupRef) return true;
      return isAllowedGroupRef(groupRef);
    });
  const nextScopePolicyGroupIds = item.scope_policy_group_ids == null
    ? null
    : normalizeGroupIds((item.scope_policy_group_ids || [])
      .map((value) => resolverFn(value))
      .filter((value) => Boolean(value) && isAllowedGroupRef(value)));
  const shareGroupIds = getShareGroupIds(nextShares).map((value) => resolverFn(value)).filter(Boolean);
  const providedGroupIds = Array.isArray(item.group_ids) && item.group_ids.length > 0
    ? item.group_ids
      .map((value) => resolverFn(value))
      .filter((value) => Boolean(value) && isAllowedGroupRef(value))
    : [];
  const nextGroupIds = normalizeGroupIds([
    ...(nextScopePolicyGroupIds || []),
    ...providedGroupIds,
    ...shareGroupIds,
  ]);
  const nextWriteGroupId = resolverFn(
    getPreferredDocWriteGroupRef({
      ...item,
      shares: nextShares,
      group_ids: nextGroupIds,
      scope_policy_group_ids: nextScopePolicyGroupIds,
    }, options),
  );

  const sharesChanged = serializeDocShares(item.shares || []) !== serializeDocShares(nextShares);
  const groupIdsChanged = JSON.stringify(item.group_ids || []) !== JSON.stringify(nextGroupIds);
  const scopePolicyChanged = JSON.stringify(item.scope_policy_group_ids || null) !== JSON.stringify(nextScopePolicyGroupIds);
  const writeGroupChanged = (item.write_group_id || null) !== (nextWriteGroupId || null);

  if (!sharesChanged && !groupIdsChanged && !scopePolicyChanged && !writeGroupChanged) {
    return item;
  }

  return {
    ...item,
    shares: nextShares,
    group_ids: nextGroupIds,
    scope_policy_group_ids: nextScopePolicyGroupIds,
    write_group_id: nextWriteGroupId,
  };
}

export function getDocCommentSummary(comment) {
  const words = String(comment?.body || '').trim().split(/\s+/).filter(Boolean);
  if (words.length <= 7) return words.join(' ');
  return `${words.slice(0, 7).join(' ')}…`;
}

/**
 * Convert a Blob into a data: URL string.
 *
 * Data URLs are self-contained and work across browsing contexts, unlike
 * blob: URLs which are tied to the document that created them.
 */
export async function blobToDataUrl(blob) {
  // Use FileReader in browser environments, fall back to arrayBuffer for
  // Node/Bun where FileReader may not exist.
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
      reader.readAsDataURL(blob);
    });
  }
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  const base64 = btoa(binary);
  return `data:${blob.type || 'application/octet-stream'};base64,${base64}`;
}

/**
 * Build the full HTML document string used for the print/PDF export window.
 */
export function buildDocPrintHtml(title, bodyHtml) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; color: #222; line-height: 1.6; }
  h1 { font-size: 1.8rem; border-bottom: 1px solid #ddd; padding-bottom: 0.5rem; }
  h2 { font-size: 1.4rem; margin-top: 1.5rem; }
  h3 { font-size: 1.2rem; margin-top: 1.2rem; }
  pre { background: #f5f5f5; padding: 1rem; border-radius: 6px; overflow-x: auto; }
  code { background: #f0f0f0; padding: 0.15rem 0.3rem; border-radius: 3px; font-size: 0.9em; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  th, td { border: 1px solid #ddd; padding: 0.5rem; text-align: left; }
  th { background: #f5f5f5; }
  blockquote { border-left: 3px solid #ddd; margin-left: 0; padding-left: 1rem; color: #555; }
  img { max-width: 100%; }
  .md-storage-image-error { opacity: 0.3; min-height: 2rem; background: #f0f0f0; }
  @media print { body { margin: 0; } }
</style>
</head><body><h1>${title}</h1>${bodyHtml}</body></html>`;
}

// ---------------------------------------------------------------------------
// Mixin methods — use `this` (the Alpine store). Spread into the store.
// ---------------------------------------------------------------------------

export const docsManagerMixin = {
  getRecordCheckoutPolicyConfig() {
    return this.recordCheckoutPolicyConfig || null;
  },

  resolveRecordCheckoutPolicy(recordFamilyHash, record = null) {
    return resolveFlightDeckRecordCheckoutPolicy(
      recordFamilyHash,
      this.getRecordCheckoutPolicyConfig(),
      { recordId: record?.record_id },
    );
  },

  isCheckoutRequiredRecordFamily(recordFamilyHash, record = null) {
    return this.resolveRecordCheckoutPolicy(recordFamilyHash, record) === 'checkout_required';
  },

  getLockManagedCheckoutSession(recordId, recordFamilyHash) {
    const key = lockManagedRecordKey(recordId, recordFamilyHash);
    if (!key) return null;
    return this.lockManagedCheckoutSessions?.[key] || null;
  },

  setLockManagedCheckoutSession(recordId, recordFamilyHash, patch = {}) {
    const key = lockManagedRecordKey(recordId, recordFamilyHash);
    if (!key) return null;
    const current = this.lockManagedCheckoutSessions?.[key] || {};
    const next = {
      ...current,
      ...patch,
      recordId: String(recordId || '').trim(),
      recordFamilyHash: String(recordFamilyHash || '').trim(),
      updatedAt: new Date().toISOString(),
    };
    this.lockManagedCheckoutSessions = {
      ...(this.lockManagedCheckoutSessions || {}),
      [key]: next,
    };
    return next;
  },

  clearLockManagedCheckoutSession(recordId, recordFamilyHash) {
    const key = lockManagedRecordKey(recordId, recordFamilyHash);
    if (!key || !this.lockManagedCheckoutSessions?.[key]) return;
    const next = { ...(this.lockManagedCheckoutSessions || {}) };
    delete next[key];
    this.lockManagedCheckoutSessions = next;
  },

  buildLockManagedCheckoutIdentityContext() {
    try {
      return requireFlightDeckIdentityContext(this);
    } catch (error) {
      const classification = Array.isArray(error?.missing) && error.missing.includes('workspaceUserKeyNpub')
        ? 'workspace_key_missing'
        : 'identity_alias_mismatch';
      const wrapped = new Error(checkoutErrorMessage(classification));
      wrapped.classification = classification;
      wrapped.cause = error;
      throw wrapped;
    }
  },

  canCurrentActorEditOwnerOnlyLockManagedRecord() {
    try {
      this.buildLockManagedCheckoutIdentityContext();
      return true;
    } catch {
      return false;
    }
  },

  normalizeLockManagedCheckoutFailure(error) {
    const classification = String(error?.classification || error?.towerCode || error?.code || '').trim() || 'unknown';
    const checkout = error?.response?.checkout || error?.checkout || null;
    return {
      classification,
      checkout,
      message: error?.userMessage || checkoutErrorMessage(classification, checkout),
    };
  },

  assertCanMutateLockManagedRecord(record, recordFamilyHash, options = {}) {
    const familyHash = String(recordFamilyHash || '').trim();
    if (!record?.record_id || !familyHash || !this.isCheckoutRequiredRecordFamily(familyHash, record)) return true;
    try {
      this.buildLockManagedCheckoutIdentityContext();
      return true;
    } catch (error) {
      const normalized = this.normalizeLockManagedCheckoutFailure(error);
      if (options.autosave === true) this.docAutosaveState = 'error';
      if (options.reportError !== false) this.error = normalized.message;
      error.userMessage = normalized.message;
      throw error;
    }
  },

  async ensureLockManagedCheckout(record, recordFamilyHash, options = {}) {
    const recordId = String(record?.record_id || '').trim();
    const familyHash = String(recordFamilyHash || '').trim();
    if (!recordId || !familyHash || !this.isCheckoutRequiredRecordFamily(familyHash, record)) return null;

    let existingSession = this.getLockManagedCheckoutSession(recordId, familyHash);
    const submittedVersion = Number(existingSession?.submittedVersion ?? 0) || 0;
    const localVersion = Number(record?.version ?? 0) || 0;
    if (
      isCheckoutHeld(existingSession?.checkout)
      && submittedVersion > 0
      && String(record?.sync_status || '').trim() === 'synced'
      && localVersion >= submittedVersion
    ) {
      this.clearLockManagedCheckoutSession(recordId, familyHash);
      existingSession = null;
    }
    if (isCheckoutHeld(existingSession?.checkout)) {
      return existingSession.checkout;
    }

    let identityContext;
    try {
      identityContext = this.buildLockManagedCheckoutIdentityContext();
    } catch (error) {
      const normalized = this.normalizeLockManagedCheckoutFailure(error);
      if (options.autosave === true) this.docAutosaveState = 'error';
      if (options.reportError !== false) this.error = normalized.message;
      this.setLockManagedCheckoutSession(recordId, familyHash, {
        acquireState: 'blocked',
        checkout: existingSession?.checkout || null,
        classification: normalized.classification,
        message: normalized.message,
      });
      error.checkout = existingSession?.checkout || null;
      error.userMessage = normalized.message;
      throw error;
    }

    const idempotencyKey = existingSession?.idempotencyKey || crypto.randomUUID();
    this.setLockManagedCheckoutSession(recordId, familyHash, {
      acquireState: 'acquiring',
      idempotencyKey,
      intent: String(options.intent || 'edit').trim() || 'edit',
      classification: '',
      message: '',
    });

    try {
      const checkout = await acquireRecordCheckout({
        recordId,
        recordFamilyHash: familyHash,
        identityContext,
        leaseSeconds: Number.isInteger(options.leaseSeconds) ? options.leaseSeconds : undefined,
        idempotencyKey,
      });
      this.setLockManagedCheckoutSession(recordId, familyHash, {
        acquireState: 'held',
        checkout: checkout?.checkout || null,
        classification: '',
        message: '',
      });
      return checkout?.checkout || null;
    } catch (error) {
      const normalized = this.normalizeLockManagedCheckoutFailure(error);
      this.setLockManagedCheckoutSession(recordId, familyHash, {
        acquireState: normalized.classification === 'unknown' ? 'error' : 'blocked',
        checkout: normalized.checkout,
        classification: normalized.classification,
        message: normalized.message,
      });
      if (options.reportError !== false) this.error = normalized.message;
      error.userMessage = normalized.message;
      throw error;
    }
  },

  async releaseLockManagedCheckout(record, recordFamilyHash, options = {}) {
    const recordId = String(record?.record_id || '').trim();
    const familyHash = String(recordFamilyHash || '').trim();
    if (!recordId || !familyHash || !this.isCheckoutRequiredRecordFamily(familyHash, record)) return false;
    const session = this.getLockManagedCheckoutSession(recordId, familyHash);
    if (!isCheckoutHeld(session?.checkout)) return false;
    if (options.force !== true && String(record?.sync_status || '').trim() === 'pending') {
      return false;
    }

    try {
      await releaseRecordCheckout({
        recordId,
        recordFamilyHash: familyHash,
        checkoutId: session.checkout.checkout_id,
        identityContext: this.buildLockManagedCheckoutIdentityContext(),
      });
      this.clearLockManagedCheckoutSession(recordId, familyHash);
      return true;
    } catch (error) {
      const normalized = this.normalizeLockManagedCheckoutFailure(error);
      this.setLockManagedCheckoutSession(recordId, familyHash, {
        acquireState: normalized.classification === 'unknown' ? 'error' : 'blocked',
        checkout: normalized.checkout || session.checkout,
        classification: normalized.classification,
        message: normalized.message,
      });
      if (options.reportError === true) this.error = normalized.message;
      return false;
    }
  },

  async attachCheckoutRequiredCheckoutToEnvelope(record, envelope, options = {}) {
    const familyHash = String(envelope?.record_family_hash || '').trim();
    if (!record?.record_id || !familyHash || !this.isCheckoutRequiredRecordFamily(familyHash, record)) return envelope;
    const checkout = await this.ensureLockManagedCheckout(record, familyHash, options);
    if (!checkout?.checkout_id) return envelope;
    this.setLockManagedCheckoutSession(record.record_id, familyHash, {
      acquireState: 'held',
      checkout,
      submittedVersion: Number(envelope?.version ?? 0) || 0,
    });
    return {
      ...envelope,
      checkout: {
        checkout_id: checkout.checkout_id,
        consume_on_success: true,
      },
    };
  },

  async attachLockManagedCheckoutToEnvelope(record, envelope, options = {}) {
    return this.attachCheckoutRequiredCheckoutToEnvelope(record, envelope, options);
  },

  async buildManagedDocumentEnvelope(payload, record = null, options = {}) {
    const requestedGroupIds = normalizeGroupIds((payload?.group_ids || [])
      .map((value) => this._resolveDocGroupRef(value))
      .filter(Boolean));
    const encryptableGroupIds = requestedGroupIds.filter((groupId) => hasGroupKey(groupId));
    if (requestedGroupIds.length > 0 && encryptableGroupIds.length === 0) {
      throw new Error(`Document write is missing group keys: ${requestedGroupIds.join(', ')}`);
    }
    const envelope = await outboundDocument({
      ...payload,
      group_ids: encryptableGroupIds,
    });
    return this.attachLockManagedCheckoutToEnvelope(record, envelope, options);
  },

  async buildManagedDirectoryEnvelope(payload, record = null, options = {}) {
    const requestedGroupIds = normalizeGroupIds((payload?.group_ids || [])
      .map((value) => this._resolveDocGroupRef(value))
      .filter(Boolean));
    const encryptableGroupIds = requestedGroupIds.filter((groupId) => hasGroupKey(groupId));
    if (requestedGroupIds.length > 0 && encryptableGroupIds.length === 0) {
      throw new Error(`Folder write is missing group keys: ${requestedGroupIds.join(', ')}`);
    }
    const envelope = await outboundDirectory({
      ...payload,
      group_ids: encryptableGroupIds,
    });
    return this.attachLockManagedCheckoutToEnvelope(record, envelope, options);
  },

  openDoc(recordId, options = {}) {
    const nextRecordId = String(recordId || '').trim();
    const previousRecord = this.selectedDocType === 'document' ? this.selectedDocument : null;
    if (previousRecord?.record_id && previousRecord.record_id !== nextRecordId) {
      void this.releaseLockManagedCheckout(previousRecord, recordFamilyHash('document'), { reportError: false });
    }
    this.selectedDocType = 'document';
    this.selectedDocId = recordId;
    if (Object.prototype.hasOwnProperty.call(options, 'commentId')) {
      this.selectedDocCommentId = options.commentId || null;
    } else {
      this.selectedDocCommentId = null;
    }
    this.navSection = 'docs';
    this.mobileNavOpen = false;
    const document = this.documents.find((item) => item.record_id === recordId);
    this.currentFolderId = document?.parent_directory_id || null;
    this.docCommentBackfillAttemptsByDocId = {
      ...this.docCommentBackfillAttemptsByDocId,
      [recordId]: false,
    };
    this.loadDocEditorFromSelection();
    this.loadDocComments(recordId);
    if (options.syncRoute !== false) this.syncRoute();
    this.ensureBackgroundSync(true);
  },

  closeDocEditor(options = {}) {
    const selectedRecord = this.selectedDocument;
    if (selectedRecord?.record_id) {
      void this.releaseLockManagedCheckout(selectedRecord, recordFamilyHash('document'), { reportError: false });
    }
    this.stopDocCommentsLiveQuery();
    this.selectedDocType = null;
    this.selectedDocId = null;
    this.selectedDocCommentId = null;
    this.docComments = [];
    this.docCommentsVisible = true;
    this.showDocCommentModal = false;
    this.docCommentAnchorLine = null;
    this.docCommentAnchorBlockId = null;
    this.newDocCommentBody = '';
    this.newDocCommentReplyBody = '';
    this.showDocShareModal = false;
    this.docVersioningOpen = false;
    this.docVersionHistory = [];
    this.docVersioningSelectedIndex = -1;
    this.docVersioningPreviewHtml = '';
    this.docVersioningError = null;
    this.docDiffMode = false;
    this.docDiffHunks = [];
    this.docDiffCompareIndex = -1;
    this.docDiffFromIndex = -1;
    this.docDiffToIndex = -1;
    this.docCommentBackfillAttemptsByDocId = {};
    this.clearDocCommentConnector();
    this.closeDocScopeModal?.();
    this.closeDocMoveModal?.();
    this.closeDocMoveScopePrompt?.();
    this.loadDocEditorFromSelection();
    if (options.syncRoute !== false) this.syncRoute();
  },

  loadDocEditorFromSelection() {
    const item = this.selectedDocument;
    this.docShareQuery = '';
    if (!item) {
      this.docEditorTitle = '';
      this.docEditorContent = '';
      this.docEditorShares = [];
      this.docEditorMode = 'preview';
      this.docEditorSharesDirty = false;
      this.docEditorBlocks = [];
      this.docEditingBlockIndex = -1;
      this.docBlockBuffer = '';
      this.docEditingTitle = false;
      this.docComments = [];
      this.docCommentsVisible = true;
      this.showDocCommentModal = false;
      this.docCommentAnchorLine = null;
      this.docCommentAnchorBlockId = null;
      this.newDocCommentBody = '';
      this.newDocCommentReplyBody = '';
      this.docAutosaveState = 'saved';
      this.showDocShareModal = false;
      this.docShareTargetType = '';
      this.docShareTargetId = '';
      return;
    }

    this.docEditorTitle = item.title ?? '';
    this.docEditorContent = this.selectedDocType === 'document' ? (item.content ?? '') : '';
    this.docEditorShares = this.getEffectiveDocShares(item)
      .map((share) => ({ ...share }));
    this.docEditorMode = 'preview';
    this.docEditorSharesDirty = false;
    this.docEditorBlocks = parseMarkdownBlocks(this.docEditorContent);
    this.docEditingBlockIndex = -1;
    this.docBlockBuffer = '';
    this.docEditingTitle = false;
    this.showDocCommentModal = false;
    this.docCommentAnchorLine = null;
    this.docCommentAnchorBlockId = null;
    this.newDocCommentBody = '';
    this.newDocCommentReplyBody = '';
    this.docAutosaveState = 'saved';
    this.showDocShareModal = false;
    this.docShareTargetType = '';
    this.docShareTargetId = '';
    this.scheduleDocCommentConnectorUpdate();
    this.scheduleStorageImageHydration();
  },

  async loadDocComments(docId) {
    if (!docId) {
      this.applyDocComments([]);
      return;
    }
    this.startDocCommentsLiveQuery(docId);
    const documentFamilyHash = recordFamilyHash('document');
    let comments = (await getCommentsByTarget(docId))
      .filter((comment) => comment.target_record_family_hash === documentFamilyHash);

    if (
      (comments.length === 0 || await this.hasMissingDocCommentAudio(comments))
      && !this.docCommentBackfillAttemptsByDocId[docId]
    ) {
      this.docCommentBackfillAttemptsByDocId = {
        ...this.docCommentBackfillAttemptsByDocId,
        [docId]: true,
      };
      comments = await this.backfillDocCommentsFromBackend(docId, documentFamilyHash);
    }

    await this.applyDocComments(comments);
  },

  async applyDocComments(comments = [], options = {}) {
    const nextComments = Array.isArray(comments) ? comments : [];
    if (!sameListBySignature(this.docComments, nextComments, (comment) => [
      String(comment?.record_id || ''),
      String(comment?.updated_at || ''),
      String(comment?.version ?? ''),
      String(comment?.record_state || ''),
    ].join('|'))) {
      this.docComments = nextComments;
    }

    for (const comment of nextComments) {
      await this.rememberPeople([comment.sender_npub], 'doc-comment');
    }

    if (
      options.allowBackfill
      && this.selectedDocType === 'document'
      && this.selectedDocId
      && !this.docCommentBackfillAttemptsByDocId[this.selectedDocId]
      && (nextComments.length === 0 || await this.hasMissingDocCommentAudio(nextComments))
    ) {
      this.docCommentBackfillAttemptsByDocId = {
        ...this.docCommentBackfillAttemptsByDocId,
        [this.selectedDocId]: true,
      };
      const backfilled = await this.backfillDocCommentsFromBackend(this.selectedDocId, recordFamilyHash('document'));
      if (backfilled.length > 0) {
        await this.applyDocComments(backfilled);
        return;
      }
    }

    if (this.selectedDocCommentId) {
      const rootId = this.getDocCommentThreadId(this.selectedDocCommentId);
      this.selectedDocCommentId = nextComments.some((comment) => comment.record_id === rootId) ? rootId : null;
    }
    this.scheduleDocCommentConnectorUpdate();
    this.scheduleStorageImageHydration();
  },

  async hasMissingDocCommentAudio(comments = []) {
    for (const comment of comments) {
      for (const attachment of comment.attachments || []) {
        if (attachment?.kind !== 'audio' || !attachment?.audio_note_record_id) continue;
        const note = await getAudioNoteById(attachment.audio_note_record_id);
        if (!note || note.record_state === 'deleted') return true;
      }
    }
    return false;
  },

  async backfillDocCommentsFromBackend(docId, documentFamilyHash) {
    if (!this.backendUrl || !this.workspaceOwnerNpub || !this.session?.npub) return [];

    try {
      await this.pullFamiliesFromBackend(['comment', 'audio_note'], { forceFull: true });
      return (await getCommentsByTarget(docId))
        .filter((comment) => comment.target_record_family_hash === documentFamilyHash);
    } catch (error) {
      console.debug('Doc comment backfill failed:', error?.message || error);
      return [];
    }
  },

  getDocCommentById(commentId) {
    if (!commentId) return null;
    return this.docComments.find((comment) => comment.record_id === commentId) ?? null;
  },

  getDocCommentThreadId(commentId) {
    let current = this.getDocCommentById(commentId);
    while (current?.parent_comment_id) {
      const parent = this.getDocCommentById(current.parent_comment_id);
      if (!parent) break;
      current = parent;
    }
    return current?.record_id || commentId || null;
  },

  getDocCommentsForBlock(block) {
    const startLine = Number(block?.start_line);
    if (!Number.isFinite(startLine) && !block?.id) return [];
    return this.docComments
      .filter((comment) => commentBelongsToDocBlock(comment, block))
      .sort((a, b) => String(a.updated_at || '').localeCompare(String(b.updated_at || '')));
  },

  blockHasSelectedDocComment(block) {
    return this.getDocCommentsForBlock(block)
      .some((comment) => comment.record_id === this.selectedDocCommentId);
  },

  getDocBlockCommentState(block) {
    const comments = this.getDocCommentsForBlock(block);
    if (comments.length === 0) return 'none';
    if (comments.some((comment) => comment.comment_status !== 'resolved')) return 'open';
    return 'resolved';
  },

  getDocBlockCommentCount(block) {
    return this.getDocCommentsForBlock(block).reduce((count, comment) => {
      const replies = this.docComments.filter((candidate) => candidate.parent_comment_id === comment.record_id).length;
      return count + 1 + replies;
    }, 0);
  },

  selectDocCommentThread(commentId, options = {}) {
    const rootId = this.getDocCommentThreadId(commentId);
    if (!rootId) return;
    this.docCommentsVisible = true;
    this.selectedDocCommentId = rootId;
    this.showDocCommentModal = false;
    this.newDocCommentReplyBody = '';
    if (options.syncRoute !== false) this.syncRoute();
    this.scheduleDocCommentConnectorUpdate();
  },

  closeDocCommentThread(options = {}) {
    this.selectedDocCommentId = null;
    this.newDocCommentReplyBody = '';
    if (options.syncRoute !== false) this.syncRoute();
    this.clearDocCommentConnector();
  },

  openDocCommentModal(block) {
    if (!this.selectedDocId || !block) return;
    this.docCommentsVisible = true;
    this.docCommentAnchorLine = Number(block.start_line) || 1;
    this.docCommentAnchorBlockId = block.id || null;
    this.newDocCommentBody = '';
    this.showDocCommentModal = true;
    this.scheduleDocCommentConnectorUpdate();
  },

  closeDocCommentModal() {
    this.showDocCommentModal = false;
    this.docCommentAnchorLine = null;
    this.docCommentAnchorBlockId = null;
    this.newDocCommentBody = '';
    this.scheduleDocCommentConnectorUpdate();
  },

  toggleDocCommentsVisible() {
    this.docCommentsVisible = !this.docCommentsVisible;
    if (!this.docCommentsVisible) {
      this.showDocCommentModal = false;
      this.closeDocCommentThread({ syncRoute: false });
      this.clearDocCommentConnector();
      return;
    }
    this.scheduleDocCommentConnectorUpdate();
  },

  async addDocComment() {
    const body = String(this.newDocCommentBody || '').trim();
    const doc = this.selectedDocument;
    const drafts = [...this.docCommentAudioDrafts];
    if (this.containsInlineImageUploadToken(body)) {
      this.error = 'Wait for image upload to finish.';
      return;
    }
    if ((!body && drafts.length === 0) || !doc || !this.session?.npub) return;

    const targetGroupIds = await this.getEncryptableDocCommentGroupIdsForWrite(doc);
    if (targetGroupIds == null) return;

    const now = new Date().toISOString();
    const recordId = crypto.randomUUID();
    const { attachments } = await this.materializeAudioDrafts({
      drafts,
      target_record_id: recordId,
      target_record_family_hash: recordFamilyHash('comment'),
      target_group_ids: toRaw(targetGroupIds),
      write_group_ref: this.getPreferredDocWriteGroupRef(doc),
    });
    const localRow = {
      record_id: recordId,
      owner_npub: this.workspaceOwnerNpub,
      target_record_id: doc.record_id,
      target_record_family_hash: recordFamilyHash('document'),
      parent_comment_id: null,
      anchor_block_id: this.docCommentAnchorBlockId || null,
      anchor_line_number: this.docCommentAnchorLine || 1,
      comment_status: 'open',
      body,
      attachments,
      sender_npub: this.session.npub,
      record_state: 'active',
      version: 1,
      created_at: now,
      updated_at: now,
    };

    await upsertComment(localRow);
    this.docComments = [...this.docComments, localRow]
      .sort((a, b) => String(a.updated_at || '').localeCompare(String(b.updated_at || '')));
    this.scheduleStorageImageHydration();
    this.selectDocCommentThread(recordId, { syncRoute: false });
    this.docCommentAudioDrafts = [];
    this.closeDocCommentModal();
    this.syncRoute();

    const envelope = await outboundComment({
      ...localRow,
      target_group_ids: toRaw(targetGroupIds),
      signature_npub: this.signingNpub,
      write_group_ref: this.getPreferredDocWriteGroupRef(doc),
    });
    await addPendingWrite({
      record_id: recordId,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });
    this._fireMentionTriggers(body, `doc comment on "${doc.title}"`);
    await this.flushAndBackgroundSync();
  },

  async addDocCommentReply() {
    const body = String(this.newDocCommentReplyBody || '').trim();
    const doc = this.selectedDocument;
    const root = this.selectedDocComment;
    const drafts = [...this.docCommentReplyAudioDrafts];
    if (this.containsInlineImageUploadToken(body)) {
      this.error = 'Wait for image upload to finish.';
      return;
    }
    if ((!body && drafts.length === 0) || !doc || !root || !this.session?.npub) return;

    const targetGroupIds = await this.getEncryptableDocCommentGroupIdsForWrite(doc);
    if (targetGroupIds == null) return;

    const now = new Date().toISOString();
    const recordId = crypto.randomUUID();
    const { attachments } = await this.materializeAudioDrafts({
      drafts,
      target_record_id: recordId,
      target_record_family_hash: recordFamilyHash('comment'),
      target_group_ids: toRaw(targetGroupIds),
      write_group_ref: this.getPreferredDocWriteGroupRef(doc),
    });
    const localRow = {
      record_id: recordId,
      owner_npub: this.workspaceOwnerNpub,
      target_record_id: doc.record_id,
      target_record_family_hash: recordFamilyHash('document'),
      parent_comment_id: root.record_id,
      anchor_block_id: root.anchor_block_id || null,
      anchor_line_number: root.anchor_line_number || 1,
      comment_status: 'open',
      body,
      attachments,
      sender_npub: this.session.npub,
      record_state: 'active',
      version: 1,
      created_at: now,
      updated_at: now,
    };

    await upsertComment(localRow);
    this.docComments = [...this.docComments, localRow]
      .sort((a, b) => String(a.updated_at || '').localeCompare(String(b.updated_at || '')));
    this.scheduleStorageImageHydration();
    this.newDocCommentReplyBody = '';
    this.docCommentReplyAudioDrafts = [];
    this.scheduleDocCommentConnectorUpdate();

    const envelope = await outboundComment({
      ...localRow,
      target_group_ids: toRaw(targetGroupIds),
      signature_npub: this.signingNpub,
      write_group_ref: this.getPreferredDocWriteGroupRef(doc),
    });
    await addPendingWrite({
      record_id: recordId,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });
    this._fireMentionTriggers(body, `doc comment reply on "${doc.title}"`);
    await this.flushAndBackgroundSync();
  },

  async setDocCommentStatus(commentId, nextStatus) {
    const comment = this.getDocCommentById(commentId);
    const doc = this.selectedDocument;
    if (!comment || !doc || !this.session?.npub) return;
    const status = nextStatus === 'resolved' ? 'resolved' : 'open';
    if ((comment.comment_status || 'open') === status) return;
    const targetGroupIds = await this.getEncryptableDocCommentGroupIdsForWrite(doc);
    if (targetGroupIds == null) return;

    const updated = {
      ...comment,
      comment_status: status,
      version: (comment.version ?? 1) + 1,
      updated_at: new Date().toISOString(),
    };
    await upsertComment(updated);
    this.docComments = this.docComments.map((candidate) =>
      candidate.record_id === comment.record_id ? updated : candidate
    );
    if (status === 'resolved' && this.selectedDocCommentId === comment.record_id) {
      this.selectedDocCommentId = null;
      this.newDocCommentReplyBody = '';
      this.showDocCommentModal = false;
      this.clearDocCommentConnector();
    }
    this.syncRoute();
    this.scheduleDocCommentConnectorUpdate();

    const envelope = await outboundComment({
      ...updated,
      previous_version: comment.version ?? 1,
      target_group_ids: toRaw(targetGroupIds),
      signature_npub: this.signingNpub,
      write_group_ref: this.getPreferredDocWriteGroupRef(doc),
    });
    await addPendingWrite({
      record_id: updated.record_id,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });
    await this.flushAndBackgroundSync();
    if (status === 'resolved') {
      this.selectedDocCommentId = null;
      this.newDocCommentReplyBody = '';
      this.clearDocCommentConnector();
      this.syncRoute();
    }
  },

  getDocCommentSummary,

  getSelectedDocCheckoutSession() {
    if (!this.selectedDocId || this.selectedDocType !== 'document') return null;
    return this.getLockManagedCheckoutSession(this.selectedDocId, recordFamilyHash('document'));
  },

  async acquireSelectedDocCheckout(options = {}) {
    const item = this.selectedDocument;
    if (!item) return false;
    try {
      await this.ensureLockManagedCheckout(item, recordFamilyHash('document'), {
        intent: 'edit',
        reportError: true,
        ...options,
      });
      return true;
    } catch {
      return false;
    }
  },

  async enterSelectedDocEditMode(mode = 'block') {
    const item = this.selectedDocument;
    if (!item) return false;
    const session = this.getSelectedDocCheckoutSession();
    if (!isCheckoutHeld(session?.checkout)) {
      const acquired = await this.acquireSelectedDocCheckout();
      if (!acquired) return false;
    }
    this.setDocEditorMode(mode === 'source' ? 'source' : 'block');
    return true;
  },

  setDocReadMode() {
    this.setDocEditorMode('preview');
  },

  async saveAndExitSelectedDocEditMode() {
    const item = this.selectedDocument;
    if (!item) return false;

    if (this.docEditorMode !== 'preview') {
      if (this.docEditingBlockIndex >= 0) {
        this.commitDocBlockEdit();
      }
      try {
        await this.saveSelectedDocItem({ autosave: false });
      } catch {
        return false;
      }
    }

    this.setDocEditorMode('preview');
    await this.releaseLockManagedCheckout(this.selectedDocument || item, recordFamilyHash('document'), {
      reportError: false,
      force: true,
    });
    return true;
  },

  setDocEditorMode(mode) {
    const nextMode = mode === 'source' ? 'source' : mode === 'block' ? 'block' : 'preview';
    if (nextMode !== 'preview') {
      const session = this.getSelectedDocCheckoutSession();
      if (!isCheckoutHeld(session?.checkout)) return;
    }
    if (nextMode === 'source' && this.docEditingBlockIndex >= 0) {
      this.commitDocBlockEdit();
    }
    if (nextMode === 'preview' && this.docEditingBlockIndex >= 0) {
      this.cancelDocBlockEdit();
    }
    this.docEditorMode = nextMode;
  },

  toggleDocEditorMode() {
    if (this.docEditorMode === 'preview') {
      void this.enterSelectedDocEditMode('block');
      return;
    }
    if (this.docEditorMode === 'block') {
      this.setDocEditorMode('source');
      return;
    }
    this.setDocEditorMode('preview');
  },

  resolveDocShareTarget(target = null) {
    if (target === 'current-folder') {
      return this.currentFolder
        ? { type: 'directory', item: this.currentFolder }
        : { type: null, item: null };
    }
    if (target?.type === 'document' || target?.type === 'directory') {
      return { type: target.type, item: target.item || null };
    }
    if (this.selectedDocument) {
      return { type: 'document', item: this.selectedDocument };
    }
    if (this.selectedDirectory) {
      return { type: 'directory', item: this.selectedDirectory };
    }
    if (this.currentFolder) {
      return { type: 'directory', item: this.currentFolder };
    }
    return { type: null, item: null };
  },

  openDocShareModal(target = null) {
    const resolved = this.resolveDocShareTarget(target);
    if (!resolved.item) {
      this.error = 'Select a document or folder first';
      return;
    }
    this.docShareTargetType = resolved.type;
    this.docShareTargetId = resolved.item.record_id;
    this.docEditorShares = this.getEffectiveDocShares(resolved.item).map((share) => ({ ...share }));
    this.docEditorSharesDirty = false;
    this.docShareQuery = '';
    this.showDocShareModal = true;
  },

  closeDocShareModal() {
    this.showDocShareModal = false;
    this.docShareQuery = '';
    this.docShareTargetType = '';
    this.docShareTargetId = '';
  },

  startDocTitleEdit() {
    if (this.docEditorMode === 'preview') return;
    this.docEditingTitle = true;
  },

  finishDocTitleEdit() {
    this.docEditingTitle = false;
    this.scheduleDocAutosave();
  },

  syncDocBlocksFromContent() {
    this.docEditorBlocks = parseMarkdownBlocks(this.docEditorContent);
  },

  handleDocSourceInput(value) {
    this.docEditorContent = value;
    this.syncDocBlocksFromContent();
    this.scheduleDocAutosave();
    this.scheduleStorageImageHydration();
  },

  startDocBlockEdit(index) {
    if (this.docEditorMode !== 'block') return;
    if (this.docEditingBlockIndex >= 0 && this.docEditingBlockIndex !== index) {
      this.commitDocBlockEdit();
    }
    if (!this.docEditorBlocks[index]) {
      this.docEditorBlocks = [...this.docEditorBlocks, { id: `block-${Date.now()}`, raw: '' }];
    }
    this.docEditingBlockIndex = index;
    this.docBlockBuffer = this.docEditorBlocks[index]?.raw ?? '';
  },

  appendDocBlock() {
    if (this.docEditorMode !== 'block') return;
    const index = this.docEditorBlocks.length;
    this.docEditorBlocks = [...this.docEditorBlocks, { id: `block-${Date.now()}`, raw: '' }];
    this.startDocBlockEdit(index);
  },

  updateDocBlockBuffer(value) {
    this.docBlockBuffer = value;
    this.scheduleStorageImageHydration();
  },

  commitDocBlockEdit() {
    if (this.docEditingBlockIndex < 0) return;
    const blocks = [...this.docEditorBlocks];
    const raw = String(this.docBlockBuffer || '').trimEnd();
    if (raw) {
      blocks[this.docEditingBlockIndex] = {
        ...(blocks[this.docEditingBlockIndex] || { id: `block-${Date.now()}` }),
        raw,
      };
    } else {
      blocks.splice(this.docEditingBlockIndex, 1);
    }
    this.docEditorBlocks = blocks;
    this.docEditorContent = assembleMarkdownBlocks(blocks);
    this.docEditingBlockIndex = -1;
    this.docBlockBuffer = '';
    this.scheduleDocAutosave();
    this.scheduleStorageImageHydration();
  },

  cancelDocBlockEdit() {
    this.docEditingBlockIndex = -1;
    this.docBlockBuffer = '';
  },

  scheduleDocAutosave() {
    if (!this.docsEditorOpen) return;
    if (this.docEditorMode === 'preview') return;
    this.docAutosaveState = 'pending';
    if (this.docAutosaveTimer) clearTimeout(this.docAutosaveTimer);
    this.docAutosaveTimer = setTimeout(async () => {
      this.docAutosaveTimer = null;
      try {
        await this.saveSelectedDocItem({ autosave: true });
      } catch {
        // saveSelectedDocItem already updates error/autosave state
      }
    }, 900);
  },

  cancelDocAutosave() {
    if (this.docAutosaveTimer) clearTimeout(this.docAutosaveTimer);
    this.docAutosaveTimer = null;
  },

  serializeDocShares,
  normalizeDocShare,
  mergeDocShareLists,
  getStoredDocShares,
  getExplicitDocShares,
  _resolveDocGroupRef(value) {
    return this.resolveGroupId
      ? this.resolveGroupId(value)
      : String(value || '').trim() || null;
  },
  getPreferredDocWriteGroupRef(record) {
    const resolveGroupRef = (value) => this._resolveDocGroupRef(value);
    const allowedGroupIds = getStoreActorWritableGroupRefs(this);
    const normalizedRecord = normalizeDocAccessRow(record, resolveGroupRef);
    return getPreferredDocWriteGroupRef(
      normalizedRecord,
      {
        hasKey: (value) => hasGroupKey(resolveGroupRef(value)),
        allowedGroupIds,
      },
    );
  },

  normalizeDocumentRowGroupRefs(record) {
    const resolveGroupRef = (value) => this._resolveDocGroupRef(value);
    return normalizeDocAccessRow(record, resolveGroupRef);
  },

  normalizeDirectoryRowGroupRefs(record) {
    const resolveGroupRef = (value) => this._resolveDocGroupRef(value);
    return normalizeDocAccessRow(record, resolveGroupRef);
  },

  getMissingDocGroupRefs(record) {
    const normalized = this.normalizeDocumentRowGroupRefs(record);
    const groupIds = normalizeGroupIds(normalized?.group_ids || []);
    return groupIds.filter((groupId) => !hasGroupKey(groupId));
  },

  async ensureDocGroupKeysLoaded(record) {
    const normalized = this.normalizeDocumentRowGroupRefs(record);
    const groupIds = normalizeGroupIds(normalized?.group_ids || []);
    if (groupIds.length === 0) return [];
    let missingGroupRefs = groupIds.filter((groupId) => !hasGroupKey(groupId));
    if (missingGroupRefs.length === 0) return [];
    if (typeof this.refreshGroups === 'function') {
      await this.refreshGroups({ force: true });
    }
    missingGroupRefs = groupIds.filter((groupId) => !hasGroupKey(groupId));
    if (missingGroupRefs.length === 0) return [];
    const loadedGroupCount = groupIds.length - missingGroupRefs.length;
    if (loadedGroupCount > 0) return [];
    return missingGroupRefs;
  },

  getEncryptableDocCommentGroupIds(record) {
    const normalized = this.normalizeDocumentRowGroupRefs(record);
    const groupIds = normalizeGroupIds(normalized?.group_ids || []);
    if (groupIds.length === 0) return [];
    const encryptableGroupIds = groupIds.filter((groupId) => hasGroupKey(groupId));
    const missingGroupIds = groupIds.filter((groupId) => !encryptableGroupIds.includes(groupId));
    if (missingGroupIds.length === 0) return encryptableGroupIds;
    this.error = `Document comment write is missing group keys: ${missingGroupIds.join(', ')}`;
    return null;
  },

  async getEncryptableDocCommentGroupIdsForWrite(record) {
    const normalized = this.normalizeDocumentRowGroupRefs(record);
    const groupIds = normalizeGroupIds(normalized?.group_ids || []);
    if (groupIds.length === 0) return [];

    let encryptableGroupIds = groupIds.filter((groupId) => hasGroupKey(groupId));
    if (encryptableGroupIds.length < groupIds.length && typeof this.refreshGroups === 'function') {
      await this.refreshGroups({ force: true });
      encryptableGroupIds = groupIds.filter((groupId) => hasGroupKey(groupId));
    }
    const missingGroupIds = groupIds.filter((groupId) => !encryptableGroupIds.includes(groupId));
    if (missingGroupIds.length === 0) return encryptableGroupIds;

    this.error = `Document comment write is missing group keys: ${missingGroupIds.join(', ')}`;
    return null;
  },

  async markDocRecordWriteFailed(table, record, error, options = {}) {
    if (!record?.record_id) return record;
    const syncFailedRecord = {
      ...record,
      sync_status: 'failed',
      updated_at: options.updated_at || record.updated_at || new Date().toISOString(),
    };
    if (table === 'directory') {
      await upsertDirectory(syncFailedRecord);
      this.patchDirectoryLocal(syncFailedRecord);
    } else {
      await upsertDocument(syncFailedRecord);
      this.patchDocumentLocal(syncFailedRecord);
    }
    const prefix = table === 'directory' ? 'Folder' : 'Document';
    this.error = error?.message || `${prefix} write is missing required group keys.`;
    return syncFailedRecord;
  },

  getEffectiveDirectoryShares(directoryOrId, seen = new Set()) {
    const directory = typeof directoryOrId === 'string'
      ? this.directories.find((item) => item.record_id === directoryOrId)
      : directoryOrId;
    if (!directory?.record_id || seen.has(directory.record_id)) return [];

    const nextSeen = new Set(seen);
    nextSeen.add(directory.record_id);
    const explicit = this.getExplicitDocShares(directory);
    const inherited = directory.parent_directory_id
      ? this.getInheritedDirectoryShares(directory.parent_directory_id, nextSeen)
      : [];
    return this.mergeDocShareLists(explicit, inherited);
  },

  getInheritedDirectoryShares(directoryOrId, seen = new Set()) {
    const directory = typeof directoryOrId === 'string'
      ? this.directories.find((item) => item.record_id === directoryOrId)
      : directoryOrId;
    if (!directory?.record_id) return [];
    return this.getEffectiveDirectoryShares(directory, seen)
      .map((share) => this.normalizeDocShare({ ...share }, directory.record_id))
      .filter(Boolean);
  },

  getEffectiveDocShares(item) {
    if (!item) return [];
    const explicit = this.getExplicitDocShares(item);
    const inherited = item.parent_directory_id
      ? this.getInheritedDirectoryShares(item.parent_directory_id)
      : [];
    return this.mergeDocShareLists(explicit, inherited);
  },

  getDocShareSubtitle(share) {
    if (!share) return '';
    const shortBase = this.getShortNpub(
      share.type === 'person'
        ? share.person_npub
        : (share.group_npub || share.via_group_npub || '')
    );
    const viaGroup = share.type === 'person' && share.via_group_npub
      ? this.getDocShareTitle({ type: 'group', label: '', group_npub: share.via_group_npub })
      : '';
    const base = viaGroup ? `${shortBase} · via ${viaGroup}` : shortBase;
    if (!this.isInheritedDocShare(share)) return base;
    const directory = this.directories.find((item) => item.record_id === share.inherited_from_directory_id);
    return directory?.title
      ? `${base} · inherited from ${directory.title}`
      : `${base} · inherited`;
  },

  getDocShareTitle(share) {
    if (!share) return '';
    if (share.type === 'person') return this.getSenderName(share.person_npub);
    const groupRef = share.group_id || share.group_npub || share.via_group_id || share.via_group_npub || '';
    const knownGroup = this.groups.find((group) => group.group_id === groupRef || group.group_npub === groupRef);
    return share.label || knownGroup?.name || 'Group';
  },

  getDocShareAvatar(share) {
    if (!share || share.type !== 'person') return null;
    return this.getSenderAvatar(share.person_npub);
  },

  isInheritedDocShare(shareOrKey) {
    const share = typeof shareOrKey === 'string'
      ? this.docEditorShares.find((item) => item.key === shareOrKey)
      : shareOrKey;
    return Boolean(share?.inherited || share?.inherited_from_directory_id);
  },

  openNewDocModal(type) {
    this.newDocModalType = type;
    this.newDocModalTitle = '';
    this.newDocModalScopeId = this.getDefaultDocScopeId(this.getDefaultParentDirectoryId());
    this.newDocModalSubmitting = false;
    this.scopePickerQuery = '';
  },

  closeNewDocModal() {
    this.newDocModalType = null;
    this.newDocModalTitle = '';
    this.newDocModalScopeId = null;
    this.newDocModalSubmitting = false;
    this.scopePickerQuery = '';
  },

  get newDocModalSelectedScope() {
    return this.newDocModalScopeId ? this.scopesMap.get(this.newDocModalScopeId) || null : null;
  },

  get newDocModalScopeLabel() {
    const scope = this.newDocModalSelectedScope;
    if (!scope) return '';
    return this.getScopeBreadcrumb(scope.record_id) || scope.title || 'Selected scope';
  },

  selectNewDocModalScope(scopeId) {
    const scope = this.scopesMap?.get(scopeId) || null;
    this.newDocModalScopeId = scope?.record_id || null;
  },

  async confirmNewDocModal() {
    const title = this.newDocModalTitle.trim();
    const modalType = this.newDocModalType;
    if (!title || !modalType || this.newDocModalSubmitting) return;
    if (!this.newDocModalScopeId) {
      this.error = 'Select a scope before creating a document or folder.';
      return;
    }
    this.newDocModalSubmitting = true;
    const scopeId = this.newDocModalScopeId;
    try {
      if (modalType === 'folder') {
        await this.createDirectory(title, { scopeId });
      } else {
        await this.createDocument(title, { scopeId });
      }
    } finally {
      this.closeNewDocModal();
      this.newDocModalSubmitting = false;
    }
  },

  getSelectedDirectoryChildren() {
    if (!this.selectedDirectory) return [];
    return [
      ...this.directories
        .filter((item) => item.parent_directory_id === this.selectedDirectory.record_id && item.record_state !== 'deleted')
        .map((item) => ({ type: 'directory', item })),
      ...this.documents
        .filter((item) => item.parent_directory_id === this.selectedDirectory.record_id && item.record_state !== 'deleted')
        .map((item) => ({ type: 'document', item })),
    ].sort((a, b) => String(a.item.title || '').localeCompare(String(b.item.title || '')));
  },

  getDocItemLocationLabel(item) {
    if (!item?.parent_directory_id) return 'Root';
    const parent = this.directories.find((directory) => directory.record_id === item.parent_directory_id);
    return parent?.title || 'Root';
  },

  getDocItemShareSummary(item) {
    if (!item) return 'Private';
    const shares = this.getEffectiveDocShares(item);
    if (shares.length === 0) return 'Private';
    return shares
      .map((share) => (share.type === 'person'
        ? this.getSenderName(share.person_npub)
        : (share.label || 'Group')))
      .join(', ');
  },

  addDocShareFromSuggestion(suggestion) {
    if (!suggestion) return;

    const nextShare = suggestion.type === 'person'
      ? {
        type: 'person',
        key: `person:${suggestion.npub}`,
        access: 'read',
        label: suggestion.label,
        person_npub: suggestion.npub,
        group_npub: null,
        via_group_npub: null,
      }
      : {
        type: 'group',
        key: `group:${suggestion.group_npub}`,
        access: 'read',
        label: suggestion.label,
        person_npub: null,
        group_id: suggestion.group_npub,
        group_npub: suggestion.group_npub,
        via_group_id: null,
        via_group_npub: null,
      };

    this.docEditorShares = this.mergeDocShareLists(this.docEditorShares, [nextShare]);
    this.docEditorSharesDirty = true;
    this.docShareQuery = '';
  },

  updateDocShareAccess(shareKey, access) {
    if (this.isInheritedDocShare(shareKey)) return;
    this.docEditorShares = this.docEditorShares.map((share) =>
      share.key === shareKey
        ? { ...share, access: access === 'write' ? 'write' : 'read' }
        : share
    );
    this.docEditorSharesDirty = true;
  },

  removeDocShare(shareKey) {
    if (this.isInheritedDocShare(shareKey)) return;
    this.docEditorShares = this.docEditorShares.filter((share) => share.key !== shareKey);
    this.docEditorSharesDirty = true;
  },

  async ensureDirectShareGroup(personNpub) {
    const ownerNpub = this.session?.npub;
    if (!ownerNpub) throw new Error('Sign in first');

    const existing = this.groups.find((group) => {
      const members = [...new Set(group.member_npubs ?? [])].sort();
      return members.length === 2
        && members[0] === [ownerNpub, personNpub].sort()[0]
        && members[1] === [ownerNpub, personNpub].sort()[1];
    });
    if (existing) {
      return existing.group_id || existing.group_npub;
    }

    const group = await this.createEncryptedGroup(
      `Direct: ${this.getSenderName(personNpub)}`,
      [personNpub],
    );
    await this.rememberPeople([personNpub], 'share');
    return group.group_id;
  },

  async materializeDocSharesForSync() {
    const shares = [];

    for (const share of this.docEditorShares) {
      if (share.type === 'person' && share.person_npub) {
        const viaGroup = share.via_group_id || share.via_group_npub || await this.ensureDirectShareGroup(share.person_npub);
        shares.push({
          ...share,
          via_group_id: viaGroup,
          via_group_npub: viaGroup,
        });
      } else if (share.type === 'group' && (share.group_id || share.group_npub)) {
        shares.push({
          ...share,
          group_id: share.group_id || share.group_npub || null,
        });
      }
    }

    return shares;
  },

  async saveDocShareTarget() {
    const target = this.activeDocShareTarget;
    if (!target) {
      this.error = 'Select a document or folder first';
      return;
    }
    if (!this.docEditorSharesDirty) {
      this.closeDocShareModal();
      return;
    }

    if (this.docShareTargetType === 'directory') {
      await this.saveSelectedDirectoryItem();
    } else {
      await this.saveSelectedDocItem({ autosave: false });
    }
    this.closeDocShareModal();
  },

  getDefaultParentDirectoryId() {
    if (this.currentFolderId) return this.currentFolderId;
    if (this.selectedDocument?.parent_directory_id) return this.selectedDocument.parent_directory_id;
    return null;
  },

  getDefaultDocScopeId(parentDirectoryId = null) {
    const inherited = this.getDirectoryDefaultScopeAssignment(parentDirectoryId);
    if (inherited?.scope_id && this.scopesMap?.has(inherited.scope_id)) return inherited.scope_id;
    if (this.selectedBoardScope?.record_id) return this.selectedBoardScope.record_id;
    if (this.selectedBoardId && this.scopesMap?.has(this.selectedBoardId)) return this.selectedBoardId;
    return null;
  },

  buildDocAccessForScope(scopeId, shares = []) {
    const scope = this.scopesMap?.get(scopeId) || null;
    if (!scope?.record_id) return null;
    const scopePolicyGroupIds = this.getResolvedScopePolicyGroupIds(scope.record_id);
    const scopeShares = this.buildScopeDefaultShares(scopePolicyGroupIds);
    const mergedShares = this.mergeDocShareLists(scopeShares, shares);
    const deliveryGroupIds = normalizeGroupIds([
      ...scopePolicyGroupIds,
      ...this.getShareGroupIds(mergedShares),
    ]);
    return {
      ...this.buildScopeAssignment(scope.record_id),
      scope_policy_group_ids: scopePolicyGroupIds,
      shares: mergedShares,
      group_ids: deliveryGroupIds,
      write_group_id: scopePolicyGroupIds[0] || deliveryGroupIds[0] || null,
    };
  },

  getDefaultPrivateShares() {
    const groupRef = this.memberPrivateGroupRef || this.memberPrivateGroupNpub;
    if (!groupRef) return [];
    return [{
      type: 'group',
      key: `group:${groupRef}`,
      access: 'write',
      label: this.memberPrivateGroup?.name || 'Private',
      person_npub: null,
      group_id: groupRef,
      group_npub: this.memberPrivateGroup?.group_npub || this.memberPrivateGroupNpub || groupRef,
      via_group_id: null,
      via_group_npub: null,
      inherited: false,
      inherited_from_directory_id: null,
    }];
  },

  getShareGroupIds,

  async createDirectory(title = 'New directory', options = {}) {
    const ownerNpub = this.workspaceOwnerNpub;
    if (!ownerNpub) {
      this.error = 'Sign in first';
      return;
    }

    const parentDirectoryId = this.getDefaultParentDirectoryId();
    const scopeId = options.scopeId || this.getDefaultDocScopeId(parentDirectoryId);
    const scopedAccess = this.buildDocAccessForScope(scopeId, this.getInheritedDirectoryShares(parentDirectoryId));
    if (!scopedAccess?.scope_id) {
      this.error = 'Select a scope before creating a folder.';
      return;
    }
    const recordId = crypto.randomUUID();
    const now = new Date().toISOString();
    let row = {
      record_id: recordId,
      owner_npub: ownerNpub,
      title,
      parent_directory_id: parentDirectoryId,
      ...scopedAccess,
      sync_status: 'pending',
      record_state: 'active',
      version: 1,
      updated_at: now,
    };
    row = this.normalizeDirectoryRowGroupRefs(row);

    await upsertDirectory(row);
    this.patchDirectoryLocal(row);
    try {
      const missingGroupRefs = await this.ensureDocGroupKeysLoaded(row);
      if (missingGroupRefs.length > 0) {
        throw new Error(`Folder write is missing group keys: ${missingGroupRefs.join(', ')}`);
      }
      await addPendingWrite({
        record_id: recordId,
        record_family_hash: recordFamilyHash('directory'),
        envelope: await this.buildManagedDirectoryEnvelope({
          record_id: recordId,
          owner_npub: ownerNpub,
          title: row.title,
          parent_directory_id: row.parent_directory_id,
          scope_id: row.scope_id ?? null,
          scope_l1_id: row.scope_l1_id ?? null,
          scope_l2_id: row.scope_l2_id ?? null,
          scope_l3_id: row.scope_l3_id ?? null,
          scope_l4_id: row.scope_l4_id ?? null,
          scope_l5_id: row.scope_l5_id ?? null,
          scope_policy_group_ids: row.scope_policy_group_ids ?? null,
          shares: row.shares,
          group_ids: row.group_ids,
          signature_npub: this.signingNpub,
          write_group_ref: this.getPreferredDocWriteGroupRef(row),
        }, row, { intent: 'create' }),
      });
    } catch (error) {
      await this.markDocRecordWriteFailed('directory', row, error);
      await this.refreshDirectories();
      this.navigateToFolder(recordId);
      return;
    }

    await this.refreshDirectories();
    this.navigateToFolder(recordId);
    await this.flushAndBackgroundSync();
  },

  async createDocument(title = 'Untitled document', options = {}) {
    const ownerNpub = this.workspaceOwnerNpub;
    if (!ownerNpub) {
      this.error = 'Sign in first';
      return;
    }

    const parentDirectoryId = this.getDefaultParentDirectoryId();
    const scopeId = options.scopeId || this.getDefaultDocScopeId(parentDirectoryId);
    const scopedAccess = this.buildDocAccessForScope(scopeId, this.getInheritedDirectoryShares(parentDirectoryId));
    if (!scopedAccess?.scope_id) {
      this.error = 'Select a scope before creating a document.';
      return;
    }
    const recordId = crypto.randomUUID();
    const now = new Date().toISOString();
    let row = {
      record_id: recordId,
      owner_npub: ownerNpub,
      title,
      content: '',
      parent_directory_id: parentDirectoryId,
      ...scopedAccess,
      sync_status: 'pending',
      record_state: 'active',
      version: 1,
      updated_at: now,
    };
    row = this.normalizeDocumentRowGroupRefs(row);

    await upsertDocument(row);
    this.patchDocumentLocal(row);
    try {
      const missingGroupRefs = await this.ensureDocGroupKeysLoaded(row);
      if (missingGroupRefs.length > 0) {
        throw new Error(`Document write is missing group keys: ${missingGroupRefs.join(', ')}`);
      }
      await addPendingWrite({
        record_id: recordId,
        record_family_hash: recordFamilyHash('document'),
        envelope: await this.buildManagedDocumentEnvelope({
          record_id: recordId,
          owner_npub: ownerNpub,
          title: row.title,
          content: row.content,
          parent_directory_id: row.parent_directory_id,
          scope_id: row.scope_id ?? null,
          scope_l1_id: row.scope_l1_id ?? null,
          scope_l2_id: row.scope_l2_id ?? null,
          scope_l3_id: row.scope_l3_id ?? null,
          scope_l4_id: row.scope_l4_id ?? null,
          scope_l5_id: row.scope_l5_id ?? null,
          scope_policy_group_ids: row.scope_policy_group_ids ?? null,
          shares: row.shares,
          group_ids: row.group_ids,
          signature_npub: this.signingNpub,
          write_group_ref: this.getPreferredDocWriteGroupRef(row),
        }, row, { intent: 'create' }),
      });
    } catch (error) {
      await this.markDocRecordWriteFailed('document', row, error);
      await this.refreshDocuments();
      this.openDoc(recordId);
      return;
    }

    await this.refreshDocuments();
    this.openDoc(recordId);
    await this.flushAndBackgroundSync();
  },

  async saveSelectedDirectoryItem() {
    this.error = null;
    const item = this.activeDocShareTarget;
    const ownerNpub = this.workspaceOwnerNpub;
    if (!item || this.docShareTargetType !== 'directory' || !ownerNpub) {
      this.error = 'Select a folder first';
      return;
    }
    if (!item.scope_id) {
      this.error = 'Select a scope before saving folder sharing.';
      return;
    }
    this.assertCanMutateLockManagedRecord(item, recordFamilyHash('directory'));
    await this.ensureLockManagedCheckout(item, recordFamilyHash('directory'), { intent: 'edit' });

    const currentSharesSerialized = this.serializeDocShares(this.getEffectiveDocShares(item));
    const editorSharesSerialized = this.serializeDocShares(this.docEditorShares || []);
    if (currentSharesSerialized === editorSharesSerialized) {
      this.docEditorSharesDirty = false;
      return item;
    }

    const shares = this.docEditorSharesDirty
      ? await this.materializeDocSharesForSync()
      : this.getStoredDocShares(item);
    const now = new Date().toISOString();
    const nextVersion = (item.version ?? 1) + 1;
    const draft = {
      ...item,
      shares,
      group_ids: this.getShareGroupIds(shares),
      write_group_id: item.write_group_id || null,
    };
    const scopePolicyPatch = item.scope_id
      ? (this.shouldRefreshScopedPolicy(draft, item.scope_id)
        ? this.buildScopedPolicyRepairPatch(draft, { scopeId: item.scope_id })
        : { scope_policy_group_ids: this.getResolvedScopePolicyGroupIds(item.scope_id) })
      : { scope_policy_group_ids: null };
    const updated = this.normalizeDirectoryRowGroupRefs({
      ...draft,
      ...scopePolicyPatch,
      sync_status: 'pending',
      version: nextVersion,
      updated_at: now,
    });

    await upsertDirectory(updated);
    this.patchDirectoryLocal(updated);
    try {
      const missingGroupRefs = await this.ensureDocGroupKeysLoaded(updated);
      if (missingGroupRefs.length > 0) {
        throw new Error(`Folder write is missing group keys: ${missingGroupRefs.join(', ')}`);
      }
      await addPendingWrite({
        record_id: item.record_id,
        record_family_hash: recordFamilyHash('directory'),
        envelope: await this.buildManagedDirectoryEnvelope({
          record_id: item.record_id,
          owner_npub: ownerNpub,
          title: updated.title,
          parent_directory_id: updated.parent_directory_id,
          scope_id: updated.scope_id ?? null,
          scope_l1_id: updated.scope_l1_id ?? null,
          scope_l2_id: updated.scope_l2_id ?? null,
          scope_l3_id: updated.scope_l3_id ?? null,
          scope_l4_id: updated.scope_l4_id ?? null,
          scope_l5_id: updated.scope_l5_id ?? null,
          scope_policy_group_ids: updated.scope_policy_group_ids ?? null,
          shares,
          group_ids: updated.group_ids,
          version: nextVersion,
          previous_version: item.version ?? 1,
          signature_npub: this.signingNpub,
          write_group_ref: this.getPreferredDocWriteGroupRef(updated),
        }, item, { intent: 'edit' }),
      });
    } catch (error) {
      await this.markDocRecordWriteFailed('directory', updated, error);
      throw error;
    }

    await this.flushAndBackgroundSync();
    await this.refreshDirectories();
    await this.refreshDocuments();
    this.docEditorSharesDirty = false;
    return updated;
  },

  async saveSelectedDocItem(options = {}) {
    const autosave = options.autosave === true;
    this.error = null;
    const item = this.selectedDocument;
    const ownerNpub = this.workspaceOwnerNpub;
    if (!item || !ownerNpub) {
      if (!autosave) this.error = 'Select a document first';
      return;
    }
    if (!item.scope_id) {
      this.docAutosaveState = autosave ? 'error' : this.docAutosaveState;
      if (!autosave) this.error = 'Select a scope before saving this document.';
      return;
    }
    this.assertCanMutateLockManagedRecord(item, recordFamilyHash('document'), { autosave });
    await this.ensureLockManagedCheckout(item, recordFamilyHash('document'), {
      autosave,
      intent: 'edit',
      reportError: autosave !== true,
    });

    const nextTitle = this.docEditorTitle.trim() || 'Untitled document';
    const currentSharesSerialized = this.serializeDocShares(this.getEffectiveDocShares(item));
    const editorSharesSerialized = this.serializeDocShares(this.docEditorShares || []);
    const hasChanges = nextTitle !== (item.title ?? 'Untitled document')
      || (this.docEditorContent || '') !== (item.content || '')
      || currentSharesSerialized !== editorSharesSerialized;
    if (!hasChanges) {
      this.docAutosaveState = 'saved';
      return;
    }

    const shares = this.docEditorSharesDirty
      ? await this.materializeDocSharesForSync()
      : this.getStoredDocShares(item);
    const now = new Date().toISOString();
    const nextVersion = (item.version ?? 1) + 1;
    this.docAutosaveState = autosave ? 'saving' : this.docAutosaveState;
    try {
      const draft = {
        ...item,
        title: nextTitle,
        content: this.docEditorContent,
        shares,
        group_ids: this.getShareGroupIds(shares),
        write_group_id: item.write_group_id || null,
      };
      const scopePolicyPatch = item.scope_id
        ? (this.shouldRefreshScopedPolicy(draft, item.scope_id)
          ? this.buildScopedPolicyRepairPatch(draft, { scopeId: item.scope_id })
          : { scope_policy_group_ids: this.getResolvedScopePolicyGroupIds(item.scope_id) })
        : { scope_policy_group_ids: null };
      const updated = this.normalizeDocumentRowGroupRefs({
        ...draft,
        ...scopePolicyPatch,
        sync_status: 'pending',
        version: nextVersion,
        updated_at: now,
      });
      await upsertDocument(updated);
      this.patchDocumentLocal(updated);
      const missingGroupRefs = await this.ensureDocGroupKeysLoaded(updated);
      if (missingGroupRefs.length > 0) {
        throw new Error(`Document write is missing group keys: ${missingGroupRefs.join(', ')}`);
      }
      await addPendingWrite({
        record_id: item.record_id,
        record_family_hash: recordFamilyHash('document'),
        envelope: await this.buildManagedDocumentEnvelope({
          record_id: item.record_id,
          owner_npub: ownerNpub,
          title: updated.title,
          content: updated.content,
          parent_directory_id: updated.parent_directory_id,
          scope_id: updated.scope_id ?? null,
          scope_l1_id: updated.scope_l1_id ?? null,
          scope_l2_id: updated.scope_l2_id ?? null,
          scope_l3_id: updated.scope_l3_id ?? null,
          scope_l4_id: updated.scope_l4_id ?? null,
          scope_l5_id: updated.scope_l5_id ?? null,
          scope_policy_group_ids: updated.scope_policy_group_ids ?? null,
          shares,
          group_ids: updated.group_ids,
          version: nextVersion,
          previous_version: item.version ?? 1,
          signature_npub: this.signingNpub,
          write_group_ref: this.getPreferredDocWriteGroupRef(updated),
        }, item, { intent: 'edit' }),
      });

      // Fire triggers for newly added @mentions in doc body
      const oldContent = item.content || '';
      const newContent = updated.content || '';
      if (newContent !== oldContent) {
        const oldMentions = new Set((oldContent.match(/@\[.*?\]\(mention:person:[^\)]+\)/g) || []));
        const newMentions = (newContent.match(/@\[.*?\]\(mention:person:[^\)]+\)/g) || []);
        const freshMentions = newMentions.filter((m) => !oldMentions.has(m));
        if (freshMentions.length > 0) {
          this._fireMentionTriggers(freshMentions.join(' '), `doc "${updated.title}"`);
        }
      }

      await this.flushAndBackgroundSync();
      await this.refreshDirectories();
      await this.refreshDocuments();
      this.docEditorSharesDirty = false;
      this.docAutosaveState = 'saved';
      this.ensureBackgroundSync(true);
      return updated;
    } catch (error) {
      if (this.selectedDocument?.record_id) {
        await this.markDocRecordWriteFailed('document', {
          ...this.selectedDocument,
          title: nextTitle,
          content: this.docEditorContent,
        }, error);
      }
      this.docAutosaveState = 'error';
      throw error;
    }
  },

  async openDocVersioning() {
    if (!this.selectedDocId || this.selectedDocType !== 'document') return;
    this.docVersioningOpen = true;
    this.docVersionHistory = [];
    this.docVersioningLoading = true;
    this.docVersioningError = null;
    this.docVersioningSelectedIndex = -1;
    this.docVersioningPreviewHtml = '';
    this.syncRoute();

    try {
      const ownerNpub = this.workspaceOwnerNpub || this.session?.npub;
      const viewerNpub = this.session?.npub;
      if (!ownerNpub) {
        this.docVersioningError = 'No workspace owner configured.';
        return;
      }
      const result = await fetchRecordHistory({
        record_id: this.selectedDocId,
        owner_npub: ownerNpub,
        viewer_npub: viewerNpub,
      });
      const versions = Array.isArray(result.versions) ? result.versions : (Array.isArray(result) ? result : []);
      if (versions.length === 0) {
        console.warn('[versioning] Tower returned 0 versions for', this.selectedDocId, '— owner_npub:', ownerNpub);
      }
      const decoded = [];
      for (const ver of versions) {
        try {
          const doc = await inboundDocument(ver);
          decoded.push({
            version: ver.version ?? doc.version ?? 1,
            title: doc.title || 'Untitled',
            content: doc.content || '',
            updated_at: ver.updated_at || doc.updated_at || '',
          });
        } catch (decryptErr) {
          console.warn('[versioning] decrypt failed for version', ver.version, decryptErr?.message || decryptErr);
          decoded.push({
            version: ver.version ?? 0,
            title: `Version ${ver.version ?? '?'} (encrypted)`,
            content: '',
            updated_at: ver.updated_at || '',
          });
        }
      }
      decoded.sort((a, b) => b.version - a.version);
      this.docVersionHistory = decoded;
      if (decoded.length > 0) this.selectDocVersion(0);
    } catch (error) {
      console.error('[versioning] failed to load history for', this.selectedDocId, error);
      this.docVersioningError = error?.status === 404
        ? 'Version history not available — Tower may need redeployment.'
        : `Failed to load version history: ${error?.message || error}`;
    } finally {
      this.docVersioningLoading = false;
    }
  },

  closeDocVersioning() {
    this.docVersioningOpen = false;
    this.docVersionHistory = [];
    this.docVersioningSelectedIndex = -1;
    this.docVersioningPreviewHtml = '';
    this.docVersioningError = null;
    this.docDiffMode = false;
    this.docDiffHunks = [];
    this.docDiffCompareIndex = -1;
    this.docDiffFromIndex = -1;
    this.docDiffToIndex = -1;
    this.syncRoute();
  },

  selectDocVersion(index) {
    if (index < 0 || index >= this.docVersionHistory.length) return;
    this.docVersioningSelectedIndex = index;
    const ver = this.docVersionHistory[index];
    this.docVersioningPreviewHtml = renderMarkdownToHtml(ver.content || '');
    if (this.docDiffMode) {
      this.docDiffToIndex = index;
      this.computeDocDiff();
    }
  },

  toggleDocDiffMode() {
    this.docDiffMode = !this.docDiffMode;
    if (this.docDiffMode) {
      // Default: "to" = selected version (or newest), "from" = next older
      const toIdx = this.docVersioningSelectedIndex >= 0 ? this.docVersioningSelectedIndex : 0;
      const fromIdx = Math.min(toIdx + 1, this.docVersionHistory.length - 1);
      this.docDiffToIndex = toIdx;
      this.docDiffFromIndex = toIdx !== fromIdx ? fromIdx : -1;
      this.computeDocDiff();
    }
  },

  setDocDiffCompareIndex(index) {
    if (index < 0 || index >= this.docVersionHistory.length) return;
    this.docDiffCompareIndex = index;
    this.docDiffFromIndex = index;
    if (this.docDiffMode) this.computeDocDiff();
  },

  setDocDiffFromIndex(index) {
    this.docDiffFromIndex = index;
    if (this.docDiffMode) this.computeDocDiff();
  },

  setDocDiffToIndex(index) {
    this.docDiffToIndex = index;
    // Also update the selected version index and preview to match
    if (index >= 0 && index < this.docVersionHistory.length) {
      this.docVersioningSelectedIndex = index;
      const ver = this.docVersionHistory[index];
      this.docVersioningPreviewHtml = renderMarkdownToHtml(ver.content || '');
    }
    if (this.docDiffMode) this.computeDocDiff();
  },

  computeDocDiff() {
    const toIdx = this.docDiffToIndex >= 0
      ? this.docDiffToIndex
      : this.docVersioningSelectedIndex;
    const selected = this.docVersionHistory[toIdx];
    if (!selected) { this.docDiffHunks = []; return; }

    const fromIdx = this.docDiffFromIndex >= 0
      ? this.docDiffFromIndex
      : (this.docDiffCompareIndex >= 0 ? this.docDiffCompareIndex : toIdx + 1);

    const older = this.docVersionHistory[fromIdx];
    const diffText = (v) => `# ${v.title}\n\n${v.content}`;

    if (!older) {
      this.docDiffHunks = [{ value: diffText(selected), added: true }];
      return;
    }

    this.docDiffHunks = diffLines(diffText(older), diffText(selected));
  },

  async restoreDocVersion() {
    const ver = this.docVersionHistory[this.docVersioningSelectedIndex];
    if (!ver || !this.selectedDocId) return;
    this.docEditorTitle = ver.title;
    this.docEditorContent = ver.content;
    this.docEditorBlocks = parseMarkdownBlocks(ver.content);
    this.docEditingBlockIndex = -1;
    this.docBlockBuffer = '';
    this.closeDocVersioning();
    await this.saveSelectedDocItem();
  },

  copyDocVersionSource() {
    const ver = this.docVersionHistory[this.docVersioningSelectedIndex];
    if (!ver) return;
    const fullMd = `# ${ver.title}\n\n${ver.content}`;
    navigator.clipboard.writeText(fullMd).catch(() => {});
  },

  exportDocMarkdown() {
    const doc = this.selectedDocument;
    if (!doc) return;
    const title = this.docEditorTitle || doc.title || 'document';
    const content = this.docEditorContent || doc.content || '';
    const fullMd = `# ${title}\n\n${content}`;
    const blob = new Blob([fullMd], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || 'document'}.md`;
    a.click();
    URL.revokeObjectURL(url);
  },

  async exportDocPDF() {
    const doc = this.selectedDocument;
    if (!doc) return;
    const title = this.docEditorTitle || doc.title || 'document';
    const content = this.docEditorContent || doc.content || '';
    const rendered = this.renderMarkdown(content);

    // Resolve storage-backed images to data: URLs so they survive cross-window
    // transfer into the print popup (blob: URLs are tied to the originating
    // document and are not accessible from a different browsing context).
    const resolverFn = async (objectId) => {
      const blobUrl = await this.resolveStorageImageUrl(objectId);
      try {
        const response = await fetch(blobUrl);
        const blob = await response.blob();
        return await blobToDataUrl(blob);
      } catch {
        // Fall back to the blob URL if data-URL conversion fails
        return blobUrl;
      }
    };
    const hydrated = await hydrateStorageImageMarkup(rendered, resolverFn);

    const printWindow = window.open('about:blank', '_blank');
    if (!printWindow) {
      this.error = 'Popup blocked — please allow popups for this site and try again.';
      return;
    }
    printWindow.document.write(buildDocPrintHtml(title, hydrated));
    printWindow.document.close();
    printWindow.onafterprint = () => printWindow.close();

    // Wait for all images to finish loading before triggering print, so that
    // storage-backed and remote images are rasterised into the PDF.
    const images = [...printWindow.document.querySelectorAll('img[src]')];
    if (images.length > 0) {
      await Promise.all(images.map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise((resolve) => { img.onload = resolve; img.onerror = resolve; }),
      ));
    }
    printWindow.print();
  },
};
