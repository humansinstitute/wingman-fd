/**
 * Scope management methods extracted from app.js.
 *
 * Pure utility functions are exported individually for direct testing.
 * The scopesManagerMixin object contains methods that use `this` (the Alpine store)
 * and should be spread into the store definition.
 */

import {
  getScopesByOwner,
  upsertScope,
  upsertTask,
  upsertDocument,
  upsertDirectory,
  upsertChannel,
  upsertFlow,
  upsertApproval,
  upsertReport,
  addPendingWrite,
} from './db.js';
import {
  outboundScope,
  resolveScopeChain,
  searchScopes,
  scopeBreadcrumb,
  scopeDepth,
  normalizeScopeLevel,
} from './translators/scopes.js';
import { outboundDocument, outboundDirectory } from './translators/docs.js';
import { outboundChannel } from './translators/chat.js';
import { outboundTask } from './translators/tasks.js';
import { outboundFlow } from './translators/flows.js';
import { outboundApproval } from './translators/approvals.js';
import { outboundReport } from './translators/reports.js';
import { recordFamilyHash } from './translators/chat.js';
import {
  buildScopeShares,
  buildScopeTags,
  defaultScopeGroupIds,
  deriveScopeHierarchy,
  normalizeGroupIds,
} from './scope-delivery.js';
import {
  toRaw,
  sameListBySignature,
} from './utils/state-helpers.js';
import {
  buildScopedPolicyRepairPatch,
  normalizeScopePolicyGroupIds,
  sameScopePolicyGroupIds,
  shouldRefreshScopedPolicy,
} from './scope-policy-helpers.js';

// ---------------------------------------------------------------------------
// Pure utility functions (no `this` dependency)
// ---------------------------------------------------------------------------

export function getAvailableParents(scopes, level) {
  const targetDepth = scopeDepth(level);
  if (targetDepth <= 1) return [];
  const parentDepth = targetDepth - 1;
  return scopes.filter(s => scopeDepth(s.level) === parentDepth && s.record_state !== 'deleted');
}

export function readScopeAssignment(record = null) {
  return {
    scope_id: record?.scope_id ?? null,
    scope_l1_id: record?.scope_l1_id ?? null,
    scope_l2_id: record?.scope_l2_id ?? null,
    scope_l3_id: record?.scope_l3_id ?? null,
    scope_l4_id: record?.scope_l4_id ?? null,
    scope_l5_id: record?.scope_l5_id ?? null,
  };
}

export function sameScopeAssignment(left = null, right = null) {
  const a = readScopeAssignment(left);
  const b = readScopeAssignment(right);
  return a.scope_id === b.scope_id
    && a.scope_l1_id === b.scope_l1_id
    && a.scope_l2_id === b.scope_l2_id
    && a.scope_l3_id === b.scope_l3_id
    && a.scope_l4_id === b.scope_l4_id
    && a.scope_l5_id === b.scope_l5_id;
}

function sameNormalizedGroupIds(left = [], right = []) {
  const a = normalizeGroupIds(left);
  const b = normalizeGroupIds(right);
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

const SCOPE_REPAIR_FAMILY_OPTIONS = Object.freeze([
  { id: 'tasks', label: 'Tasks' },
  { id: 'documents', label: 'Documents' },
  { id: 'directories', label: 'Folders' },
  { id: 'flows', label: 'Flows' },
  { id: 'approvals', label: 'Approvals' },
  { id: 'channels', label: 'Channels' },
  { id: 'reports', label: 'Reports' },
]);

// ---------------------------------------------------------------------------
// Mixin — methods that reference `this` (the Alpine store)
// ---------------------------------------------------------------------------

export const scopesManagerMixin = {

  buildScopeRepairProgressRows(counts = {}) {
    return SCOPE_REPAIR_FAMILY_OPTIONS.map((family) => ({
      id: family.id,
      label: family.label,
      status: 'pending',
      total: Math.max(0, Number(counts?.[family.id] || 0) || 0),
      processed: 0,
      rewritten: 0,
    }));
  },

  initializeScopeRepairProgress(counts = {}) {
    const rows = this.buildScopeRepairProgressRows(counts);
    const totalRecords = rows.reduce((sum, family) => sum + family.total, 0);
    this.scopeRepairProgress = rows;
    this.scopeRepairSession = {
      phase: 'preparing',
      startedAt: Date.now(),
      finishedAt: null,
      currentFamily: null,
      completedFamilies: 0,
      totalFamilies: rows.length,
      processedRecords: 0,
      rewrittenRecords: 0,
      totalRecords,
      error: null,
    };
    this.showScopeRepairModal = true;
  },

  syncScopeRepairSessionFromRows() {
    const rows = Array.isArray(this.scopeRepairProgress) ? this.scopeRepairProgress : [];
    const activeFamily = rows.find((family) => family.status === 'active') || null;
    const completedFamilies = rows.filter((family) => family.status === 'done').length;
    const processedRecords = rows.reduce((sum, family) => sum + (Number(family.processed || 0) || 0), 0);
    const rewrittenRecords = rows.reduce((sum, family) => sum + (Number(family.rewritten || 0) || 0), 0);
    Object.assign(this.scopeRepairSession, {
      currentFamily: activeFamily?.label || null,
      completedFamilies,
      processedRecords,
      rewrittenRecords,
    });
  },

  markScopeRepairProgress(familyId, status, updates = {}) {
    const targetId = String(familyId || '').trim();
    if (!targetId || !Array.isArray(this.scopeRepairProgress) || this.scopeRepairProgress.length === 0) return;
    this.scopeRepairProgress = this.scopeRepairProgress.map((family) => (
      family.id !== targetId
        ? family
        : {
          ...family,
          status,
          processed: updates.processed ?? family.processed ?? 0,
          rewritten: updates.rewritten ?? family.rewritten ?? 0,
        }
    ));
    this.syncScopeRepairSessionFromRows();
  },

  closeScopeRepairModal() {
    if (this.scopeRepairSession?.phase === 'preparing' || this.scopeRepairSession?.phase === 'rewriting') return;
    this.showScopeRepairModal = false;
  },

  scopeRepairProgressLabel() {
    const session = this.scopeRepairSession || {};
    if (session.phase === 'idle') return '';
    if (session.phase === 'preparing') return 'Preparing scope rewrite…';
    if (session.phase === 'rewriting') {
      return session.currentFamily
        ? `Rewriting ${session.currentFamily.toLowerCase()}…`
        : 'Rewriting scoped records…';
    }
    if (session.phase === 'done') return 'Scope rewrite complete.';
    if (session.phase === 'error') return 'Scope rewrite failed.';
    return '';
  },

  scopeRepairProgressPercent() {
    const session = this.scopeRepairSession || {};
    const totalFamilies = Math.max(0, Number(session.totalFamilies || 0) || 0);
    if (session.phase === 'done') return 100;
    if (!totalFamilies) return session.phase === 'preparing' ? 5 : 0;
    const activeFamily = (this.scopeRepairProgress || []).find((family) => family.status === 'active') || null;
    let activeFraction = 0;
    if (activeFamily) {
      const total = Math.max(0, Number(activeFamily.total || 0) || 0);
      const processed = Math.max(0, Number(activeFamily.processed || 0) || 0);
      activeFraction = total > 0 ? Math.min(processed / total, 1) : 0;
    }
    const completedFamilies = Math.max(0, Number(session.completedFamilies || 0) || 0);
    return Math.round(((completedFamilies + activeFraction) / totalFamilies) * 100);
  },

  // --- scope apply / refresh ---

  async applyScopes(scopes = []) {
    const normalizedScopes = [];
    for (const scope of (Array.isArray(scopes) ? scopes : [])) {
      const normalized = this.normalizeScopeRowGroupRefs(scope);
      normalizedScopes.push(normalized);
    }
    if (!sameListBySignature(this.scopes, normalizedScopes)) {
      this.scopes = normalizedScopes;
    }
    this.scopesLoaded = true;
  },

  async refreshScopes() {
    const ownerNpub = this.workspaceOwnerNpub;
    if (!ownerNpub) return;
    await this.applyScopes(await getScopesByOwner(ownerNpub));
  },

  resolveScopeRecord(scopeOrId) {
    if (!scopeOrId) return null;
    if (typeof scopeOrId === 'object' && scopeOrId.record_id) return scopeOrId;
    return this.scopesMap.get(scopeOrId) || null;
  },

  getResolvedScopePolicyGroupIds(scopeOrId) {
    const scope = this.resolveScopeRecord(scopeOrId);
    return normalizeScopePolicyGroupIds(scope?.group_ids || [], (groupId) => this.resolveGroupId(groupId));
  },

  buildScopedPolicyRepairPatch(record, options = {}) {
    const scope = this.resolveScopeRecord(options.scopeId ?? record?.scope_id);
    if (!scope?.record_id) {
      return {
        scope_policy_group_ids: null,
      };
    }
    return buildScopedPolicyRepairPatch({
      record,
      previousScopeGroupIds: options.previousScopeGroupIds || [],
      nextScopeGroupIds: this.getResolvedScopePolicyGroupIds(scope),
      groups: this.groups || [],
      resolveGroupId: (groupId) => this.resolveGroupId(groupId),
      includeBoardGroupId: options.includeBoardGroupId === true,
      fallbackPolicyGroupIds: options.fallbackPolicyGroupIds || [],
    });
  },

  shouldRefreshScopedPolicy(record, scopeOrId, options = {}) {
    return shouldRefreshScopedPolicy(record, this.getResolvedScopePolicyGroupIds(scopeOrId), {
      resolveGroupId: (groupId) => this.resolveGroupId(groupId),
      allowLegacyGroupFallback: options.allowLegacyGroupFallback === true,
    });
  },

  get editingScopeHasGroupChanges() {
    const scope = this.editingScope;
    if (!scope?.record_id) return false;
    return !sameScopePolicyGroupIds(
      this.getScopeShareGroupIds(scope),
      this.editingScopeAssignedGroupIds,
      (groupId) => this.resolveGroupId(groupId),
    );
  },

  // --- scope picker / navigation ---

  get scopePickerResults() {
    return searchScopes(this.scopePickerQuery, this.scopes, this.scopesMap);
  },

  get scopePickerFlat() {
    const r = this.scopePickerResults;
    return [...(r.l1 || []), ...(r.l2 || []), ...(r.l3 || []), ...(r.l4 || []), ...(r.l5 || [])];
  },

  scopePickerFlatFor(query) {
    const r = searchScopes(query, this.scopes, this.scopesMap);
    return [...(r.l1 || []), ...(r.l2 || []), ...(r.l3 || []), ...(r.l4 || []), ...(r.l5 || [])];
  },

  getScopeBreadcrumb(scopeId) {
    return scopeBreadcrumb(scopeId, this.scopesMap);
  },

  getScopeLabel(scopeId) {
    const scope = this.scopesMap.get(scopeId);
    return scope ? scope.title : '';
  },

  getScopeForItem(item) {
    if (!item?.scope_id) return null;
    return this.scopesMap.get(item.scope_id) || null;
  },

  getScopePillLabel(item) {
    return this.getScopeForItem(item)?.title || '';
  },

  getScopePillLevel(item) {
    return this.getScopeForItem(item)?.level || '';
  },

  getScopePillTitle(item) {
    const scope = this.getScopeForItem(item);
    if (!scope) return '';
    const breadcrumb = this.getScopeBreadcrumb(scope.record_id);
    return breadcrumb || scope.title || '';
  },

  buildScopeAssignment(scopeId) {
    if (!scopeId) return readScopeAssignment(null);
    const chain = resolveScopeChain(scopeId, this.scopesMap);
    return {
      scope_id: scopeId,
      scope_l1_id: chain.scope_l1_id,
      scope_l2_id: chain.scope_l2_id,
      scope_l3_id: chain.scope_l3_id,
      scope_l4_id: chain.scope_l4_id,
      scope_l5_id: chain.scope_l5_id,
    };
  },

  getDirectoryDefaultScopeAssignment(directoryOrId = null) {
    if (!directoryOrId) return readScopeAssignment(null);
    const directory = typeof directoryOrId === 'string'
      ? this.directories.find((item) => item.record_id === directoryOrId)
      : directoryOrId;
    return readScopeAssignment(directory);
  },

  hasSameScopeAssignment(left = null, right = null) {
    return sameScopeAssignment(left, right);
  },

  resolveDocScopeTarget(target = null) {
    if (target === 'current-folder') {
      return this.currentFolder
        ? { type: 'directory', item: this.currentFolder }
        : { type: null, item: null };
    }
    if (target?.type === 'bulk-documents') {
      const ids = [...new Set((target.ids || []).filter(Boolean))];
      return ids.length > 0
        ? { type: 'bulk-documents', item: null, ids }
        : { type: null, item: null };
    }
    if (target?.type === 'document' || target?.type === 'directory') {
      return { type: target.type, item: target.item || null };
    }
    if (this.selectedDocument) return { type: 'document', item: this.selectedDocument };
    if (this.currentFolder) return { type: 'directory', item: this.currentFolder };
    if (this.selectedDirectory) return { type: 'directory', item: this.selectedDirectory };
    return { type: null, item: null };
  },

  get activeDocScopeTarget() {
    if (this.docScopeTargetType === 'document') {
      return this.documents.find((item) => item.record_id === this.docScopeTargetId) ?? this.selectedDocument ?? null;
    }
    if (this.docScopeTargetType === 'directory') {
      return this.directories.find((item) => item.record_id === this.docScopeTargetId) ?? null;
    }
    return null;
  },

  get activeDocScopeTargets() {
    if (this.docScopeTargetType !== 'bulk-documents') return [];
    const selectedIds = new Set(this.docScopeTargetIds);
    return this.documents.filter((item) => selectedIds.has(item.record_id) && item.record_state !== 'deleted');
  },

  get activeDocScopeTargetTypeLabel() {
    if (this.docScopeTargetType === 'bulk-documents') return 'Document scope';
    return this.docScopeTargetType === 'directory' ? 'Folder default scope' : 'Document scope';
  },

  get activeDocScopeTargetName() {
    if (this.docScopeTargetType === 'bulk-documents') {
      const count = this.activeDocScopeTargets.length;
      if (count === 0) return '';
      return `${count} document${count === 1 ? '' : 's'} selected`;
    }
    const target = this.activeDocScopeTarget;
    if (!target) return '';
    return target.title || (this.docScopeTargetType === 'directory' ? 'Untitled folder' : 'Untitled document');
  },

  get activeDocScopeModalSelection() {
    if (!this.docScopeModalSelectedId) return null;
    return this.scopesMap.get(this.docScopeModalSelectedId) || null;
  },

  get docScopeModalHasChanges() {
    if (this.docScopeTargetType === 'bulk-documents') {
      return this.activeDocScopeTargets.some((item) => (item.scope_id || null) !== (this.docScopeModalSelectedId || null));
    }
    return (this.docScopeModalSelectedId || null) !== (this.activeDocScopeTarget?.scope_id || null);
  },

  openDocScopeModal(target = null) {
    const resolved = this.resolveDocScopeTarget(target);
    if (!resolved.item && resolved.type !== 'bulk-documents') {
      this.error = 'Select a document or folder first';
      return;
    }
    this.closeScopePicker();
    this.docScopeTargetType = resolved.type;
    this.docScopeTargetId = resolved.item?.record_id || '';
    this.docScopeTargetIds = resolved.ids || [];
    if (resolved.type === 'bulk-documents') {
      const docs = this.documents.filter((item) => (resolved.ids || []).includes(item.record_id) && item.record_state !== 'deleted');
      const firstScopeId = docs[0]?.scope_id || null;
      this.docScopeModalSelectedId = docs.every((item) => (item.scope_id || null) === firstScopeId)
        ? firstScopeId
        : null;
    } else {
      this.docScopeModalSelectedId = resolved.item.scope_id || null;
    }
    this.docScopeModalSubmitting = false;
    this.scopePickerQuery = '';
    this.showDocScopeModal = true;
  },

  closeDocScopeModal() {
    this.showDocScopeModal = false;
    this.docScopeTargetType = '';
    this.docScopeTargetId = '';
    this.docScopeTargetIds = [];
    this.docScopeModalSelectedId = null;
    this.docScopeModalSubmitting = false;
    this.scopePickerQuery = '';
  },

  async saveDocScopeModal() {
    const target = this.activeDocScopeTarget;
    if (this.docScopeModalSubmitting) return;
    if (this.docScopeTargetType === 'bulk-documents' && this.activeDocScopeTargets.length === 0) return;
    if (this.docScopeTargetType !== 'bulk-documents' && !target) return;
    this.docScopeModalSubmitting = true;
    try {
      if (this.docScopeTargetType === 'bulk-documents') {
        for (const item of this.activeDocScopeTargets) {
          await this.updateDocScope(item, this.docScopeModalSelectedId, { sync: false });
        }
        await this.flushAndBackgroundSync();
      } else if (this.docScopeTargetType === 'directory') {
        await this.updateDirectoryScope(target, this.docScopeModalSelectedId);
      } else {
        await this.updateDocScope(target, this.docScopeModalSelectedId);
      }
      this.closeDocScopeModal();
    } finally {
      this.docScopeModalSubmitting = false;
    }
  },

  openScopePicker() {
    this.scopePickerQuery = '';
    this.showScopePicker = true;
    this.showChannelScopePicker = false;
    this.showNewScopeForm = false;
  },

  closeScopePicker() {
    this.showScopePicker = false;
    this.scopePickerQuery = '';
    this.showNewScopeForm = false;
  },

  openChannelScopePicker() {
    this.scopePickerQuery = '';
    this.showChannelScopePicker = true;
    this.showScopePicker = false;
    this.showNewScopeForm = false;
  },

  closeChannelScopePicker() {
    this.showChannelScopePicker = false;
    this.scopePickerQuery = '';
    this.showNewScopeForm = false;
  },

  // --- scope assignment (task, doc, channel) ---

  async selectScopeForTask(scopeId) {
    if (!this.editingTask || !this.session?.npub) return;
    Object.assign(this.editingTask, this.buildTaskBoardAssignment(scopeId, this.editingTask));
    this.closeScopePicker();
    await this.saveEditingTask();
  },

  async clearTaskScope() {
    if (!this.editingTask || !this.session?.npub) return;
    Object.assign(this.editingTask, {
      scope_id: null,
      scope_l1_id: null,
      scope_l2_id: null,
      scope_l3_id: null,
      scope_l4_id: null,
      scope_l5_id: null,
    });
    this.closeScopePicker();
    await this.saveEditingTask();
  },

  async selectScopeForDoc(scopeId) {
    const doc = this.selectedDocument;
    if (!doc || !this.session?.npub) return;
    await this.updateDocScope(doc, scopeId);
    this.closeScopePicker();
  },

  async clearDocScope() {
    const doc = this.selectedDocument;
    if (!doc || !this.session?.npub) return;
    await this.updateDocScope(doc, null);
    this.closeScopePicker();
  },

  async updateDocScope(doc, scopeId, options = {}) {
    if (!doc || !this.session?.npub) return;
    const scopeAssignment = this.buildScopeAssignment(scopeId);
    const previousScopeGroupIds = doc.scope_id ? this.getResolvedScopePolicyGroupIds(doc.scope_id) : [];
    const patch = scopeId
      ? this.buildScopedPolicyRepairPatch(doc, {
        scopeId,
        previousScopeGroupIds,
      })
      : {
        shares: this.getStoredDocShares(doc),
        group_ids: this.getShareGroupIds(this.getStoredDocShares(doc)),
        scope_policy_group_ids: null,
      };
    const updated = {
      ...doc,
      ...scopeAssignment,
      ...patch,
    };
    this.patchDocumentLocal(updated);
    await upsertDocument(updated);
    await this._pushDocScopeUpdate(updated, options);
  },

  async _pushDocScopeUpdate(doc, options = {}) {
    const ownerNpub = this.workspaceOwnerNpub;
    const nextVersion = (doc.version ?? 1) + 1;
    const updated = toRaw({
      ...doc,
      version: nextVersion,
      sync_status: 'pending',
      updated_at: new Date().toISOString(),
    });
    await upsertDocument(updated);
    this.patchDocumentLocal(updated);
    const envelope = await outboundDocument({
      ...updated,
      previous_version: doc.version ?? 1,
      signature_npub: this.signingNpub,
      write_group_ref: updated.group_ids?.[0] || null,
    });
    await addPendingWrite({
      record_id: updated.record_id,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });
    if (options.sync !== false) {
      await this.flushAndBackgroundSync();
    }
  },

  async selectScopeForDirectory(scopeId) {
    const dir = this.currentFolder;
    if (!dir || !this.session?.npub) return;
    await this.updateDirectoryScope(dir, scopeId);
    this.closeScopePicker();
  },

  async clearDirectoryScope() {
    const dir = this.currentFolder;
    if (!dir || !this.session?.npub) return;
    await this.updateDirectoryScope(dir, null);
    this.closeScopePicker();
  },

  async updateDirectoryScope(dir, scopeId) {
    if (!dir || !this.session?.npub) return;
    const scopeAssignment = this.buildScopeAssignment(scopeId);
    const previousScopeGroupIds = dir.scope_id ? this.getResolvedScopePolicyGroupIds(dir.scope_id) : [];
    const patch = scopeId
      ? this.buildScopedPolicyRepairPatch(dir, {
        scopeId,
        previousScopeGroupIds,
      })
      : {
        shares: this.getStoredDocShares(dir),
        group_ids: this.getShareGroupIds(this.getStoredDocShares(dir)),
        scope_policy_group_ids: null,
      };
    const updated = toRaw({
      ...dir,
      ...scopeAssignment,
      ...patch,
      version: (dir.version ?? 1) + 1,
      sync_status: 'pending',
      updated_at: new Date().toISOString(),
    });
    await this.queueDirectoryRecord(updated, dir);
    await this.flushAndBackgroundSync();
  },

  async selectScopeForChannel(scopeId) {
    const ch = this.selectedChannel;
    if (!ch || !this.session?.npub) return;
    const chain = resolveScopeChain(scopeId, this.scopesMap);
    const updated = toRaw({
      ...ch,
      scope_id: scopeId,
      scope_l1_id: chain.scope_l1_id,
      scope_l2_id: chain.scope_l2_id,
      scope_l3_id: chain.scope_l3_id,
      scope_l4_id: chain.scope_l4_id,
      scope_l5_id: chain.scope_l5_id,
    });
    await upsertChannel(updated);
    this.channels = this.channels.map(c => c.record_id === updated.record_id ? updated : c);
    this.closeChannelScopePicker();
    await this._pushChannelScopeUpdate(updated);
  },

  async clearChannelScope() {
    const ch = this.selectedChannel;
    if (!ch || !this.session?.npub) return;
    const updated = toRaw({
      ...ch,
      scope_id: null,
      scope_l1_id: null,
      scope_l2_id: null,
      scope_l3_id: null,
      scope_l4_id: null,
      scope_l5_id: null,
    });
    await upsertChannel(updated);
    this.channels = this.channels.map(c => c.record_id === updated.record_id ? updated : c);
    this.closeChannelScopePicker();
    await this._pushChannelScopeUpdate(updated);
  },

  async _pushChannelScopeUpdate(ch) {
    const nextVersion = (ch.version ?? 1) + 1;
    const updated = toRaw({
      ...ch,
      version: nextVersion,
      sync_status: 'pending',
      updated_at: new Date().toISOString(),
    });
    await upsertChannel(updated);
    this.channels = this.channels.map(c => c.record_id === updated.record_id ? updated : c);
    const envelope = await outboundChannel({
      ...updated,
      previous_version: ch.version ?? 1,
      signature_npub: this.signingNpub,
      write_group_ref: updated.group_ids?.[0] || null,
    });
    await addPendingWrite({
      record_id: updated.record_id,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });
    await this.flushAndBackgroundSync();
  },

  // --- directory helpers ---

  getScopeShareGroupIds(scope) {
    return normalizeGroupIds(scope?.group_ids).map((groupId) => this.resolveGroupId(groupId)).filter(Boolean);
  },

  buildScopeDefaultShares(groupIds = []) {
    return buildScopeShares(
      normalizeGroupIds(groupIds).map((groupId) => this.resolveGroupId(groupId)).filter(Boolean),
      this.groups,
    );
  },

  async queueDirectoryRecord(row, previous = null) {
    await upsertDirectory(row);
    this.patchDirectoryLocal(row);
    const envelope = await outboundDirectory({
      ...row,
      version: row.version ?? 1,
      previous_version: previous?.version ?? 0,
      signature_npub: this.signingNpub,
      write_group_ref: row.group_ids?.[0] || null,
    });
    await addPendingWrite({
      record_id: row.record_id,
      record_family_hash: recordFamilyHash('directory'),
      envelope,
    });
    return row;
  },

  // --- scope CRUD ---

  async addScope() {
    if (!this.canAdminWorkspace) {
      this.error = 'Only workspace admins can manage scopes.';
      return;
    }
    const title = String(this.newScopeTitle || '').trim();
    if (!title || !this.session?.npub) return;

    const now = new Date().toISOString();
    const recordId = crypto.randomUUID();
    const ownerNpub = this.workspaceOwnerNpub;
    const parentId = this.newScopeParentId || null;
    const hierarchy = deriveScopeHierarchy({
      parentId,
      scopesMap: this.scopesMap,
    });
    const level = hierarchy?.level ?? 'l1';
    const groupIds = normalizeGroupIds(this.newScopeAssignedGroupIds)
      .map((groupId) => this.resolveGroupId(groupId))
      .filter(Boolean);
    if (groupIds.length === 0) {
      this.error = 'Add at least one group for the scope.';
      return;
    }

    const localRow = {
      record_id: recordId,
      owner_npub: ownerNpub,
      title,
      description: this.newScopeDescription || '',
      level,
      parent_id: hierarchy.parent_id,
      l1_id: hierarchy.l1_id,
      l2_id: hierarchy.l2_id,
      l3_id: hierarchy.l3_id,
      l4_id: hierarchy.l4_id,
      l5_id: hierarchy.l5_id,
    };
    localRow[`${level}_id`] = recordId;
    Object.assign(localRow, {
      group_ids: groupIds,
      sync_status: 'pending',
      record_state: 'active',
      version: 1,
      created_at: now,
      updated_at: now,
    });

    await upsertScope(localRow);
    this.scopes = [...this.scopes, localRow];
    this.newScopeTitle = '';
    this.newScopeDescription = '';
    this.newScopeLevel = 'l1';
    this.newScopeParentId = null;
    this.newScopeAssignedGroupIds = [];
    this.newScopeGroupQuery = '';
    this.showNewScopeForm = false;

    const envelope = await outboundScope({
      ...localRow,
      signature_npub: this.signingNpub,
      write_group_ref: localRow.group_ids?.[0] || null,
    });
    await addPendingWrite({
      record_id: recordId,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });
    await this.flushAndBackgroundSync();
    await this.refreshDirectories();
    await this.refreshScopes();
  },

  startNewScope(level = 'l1', parentId = null) {
    if (!this.canAdminWorkspace) {
      this.error = 'Only workspace admins can manage scopes.';
      return;
    }
    this.newScopeLevel = level;
    this.newScopeParentId = parentId;
    this.newScopeTitle = '';
    this.newScopeDescription = '';
    this.newScopeAssignedGroupIds = this.getDefaultScopeGroupIds(level, parentId);
    this.newScopeGroupQuery = '';
    this.showNewScopeForm = true;
  },

  cancelNewScope() {
    this.showNewScopeForm = false;
    this.newScopeTitle = '';
    this.newScopeDescription = '';
    this.newScopeAssignedGroupIds = [];
    this.newScopeGroupQuery = '';
  },

  startEditScope(scopeId) {
    if (!this.canAdminWorkspace) {
      this.error = 'Only workspace admins can manage scopes.';
      return;
    }
    const scope = this.scopesMap.get(scopeId);
    if (!scope) return;
    this.editingScopeId = scopeId;
    this.editingScopeTitle = scope.title;
    this.editingScopeDescription = scope.description || '';
    this.editingScopeAssignedGroupIds = this.getScopeShareGroupIds(scope);
    this.editingScopeGroupQuery = '';
    this.scopePolicyRepairSummary = '';
    this.scopePolicyRepairBusy = false;
  },

  cancelEditScope() {
    this.editingScopeId = null;
    this.editingScopeTitle = '';
    this.editingScopeDescription = '';
    this.editingScopeAssignedGroupIds = [];
    this.editingScopeGroupQuery = '';
    this.scopePolicyRepairSummary = '';
    this.scopePolicyRepairBusy = false;
  },

  async saveEditScope(options = {}) {
    if (!this.canAdminWorkspace) {
      this.error = 'Only workspace admins can manage scopes.';
      return;
    }
    if (!this.editingScopeId || !this.session?.npub) return;
    const scope = this.scopes.find(s => s.record_id === this.editingScopeId);
    if (!scope) return;
    const repairScopedRecords = options.repairScopedRecords === true;
    const previousScopeGroupIds = this.getScopeShareGroupIds(scope);

    const nextVersion = (scope.version ?? 1) + 1;
    const updated = toRaw({
      ...scope,
      title: this.editingScopeTitle,
      description: this.editingScopeDescription,
      group_ids: normalizeGroupIds(this.editingScopeAssignedGroupIds)
        .map((groupId) => this.resolveGroupId(groupId))
        .filter(Boolean),
      version: nextVersion,
      sync_status: 'pending',
      updated_at: new Date().toISOString(),
    });
    if (updated.group_ids.length === 0) {
      this.error = 'Add at least one group for the scope.';
      return;
    }

    await upsertScope(updated);
    this.scopes = this.scopes.map(s => s.record_id === updated.record_id ? updated : s);
    this.editingScopeId = null;
    this.editingScopeTitle = '';
    this.editingScopeDescription = '';
    this.editingScopeAssignedGroupIds = [];
    this.editingScopeGroupQuery = '';

    const envelope = await outboundScope({
      ...updated,
      previous_version: scope.version ?? 1,
      signature_npub: this.signingNpub,
      write_group_ref: updated.group_ids?.[0] || null,
    });
    await addPendingWrite({
      record_id: updated.record_id,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });
    const groupIdsChanged = !sameScopePolicyGroupIds(
      previousScopeGroupIds,
      updated.group_ids,
      (groupId) => this.resolveGroupId(groupId),
    );
    if (repairScopedRecords && groupIdsChanged) {
      this.scopePolicyRepairBusy = true;
      try {
        const summary = await this.reencryptScopedRecordsForScope(scope, updated);
        this.scopePolicyRepairSummary = summary.message;
      } catch (error) {
        this.error = error?.message || 'Failed to reapply scope group crypto.';
      } finally {
        this.scopePolicyRepairBusy = false;
      }
    } else if (!repairScopedRecords) {
      this.scopePolicyRepairSummary = '';
    }
    await this.flushAndBackgroundSync();
    await this.refreshDirectories();
  },

  async reapplyScopeGroupCrypto(scopeId) {
    if (!this.canAdminWorkspace) {
      this.error = 'Only workspace admins can manage scopes.';
      return;
    }
    const scope = this.resolveScopeRecord(scopeId);
    if (!scope?.record_id || this.scopePolicyRepairBusy) return;

    this.scopePolicyRepairBusy = true;
    this.scopePolicyRepairSummary = '';
    try {
      const summary = await this.reencryptScopedRecordsForScope(scope, scope);
      const scopeLabel = String(scope.title || 'Scope').trim() || 'Scope';
      this.scopePolicyRepairSummary = `${scopeLabel}: ${summary.message}`;
      await this.flushAndBackgroundSync();
    } catch (error) {
      this.error = error?.message || 'Failed to reapply scope group crypto.';
    } finally {
      this.scopePolicyRepairBusy = false;
    }
  },

  hasScopedPolicyRepairChanges(record, patch, options = {}) {
    if (!record || !patch) return false;
    if (!sameNormalizedGroupIds(record.group_ids || [], patch.group_ids || [])) return true;
    if (!sameNormalizedGroupIds(record.scope_policy_group_ids || [], patch.scope_policy_group_ids || [])) return true;
    if (options.includeBoardGroupId === true) {
      if ((record.board_group_id || null) !== (patch.board_group_id || null)) return true;
    }
    return JSON.stringify(record.shares || []) !== JSON.stringify(patch.shares || []);
  },

  async repairScopedTaskRecord(task, previousScopeGroupIds = [], nextScope = null) {
    const patch = this.buildScopedPolicyRepairPatch(task, {
      scopeId: nextScope?.record_id || task.scope_id,
      previousScopeGroupIds,
      includeBoardGroupId: true,
      fallbackPolicyGroupIds: task.group_ids || [],
    });
    if (!this.hasScopedPolicyRepairChanges(task, patch, { includeBoardGroupId: true })) return false;

    const updated = toRaw({
      ...task,
      ...patch,
      version: (task.version ?? 1) + 1,
      sync_status: 'pending',
      updated_at: new Date().toISOString(),
    });
    await upsertTask(updated);
    this.tasks = this.tasks.map((entry) => entry.record_id === updated.record_id ? updated : entry);
    if (this.editingTask?.record_id === updated.record_id) {
      this.editingTask = { ...updated };
    }
    const envelope = await outboundTask({
      ...updated,
      previous_version: task.version ?? 1,
      signature_npub: this.signingNpub,
      write_group_ref: updated.board_group_id || updated.group_ids?.[0] || null,
    });
    await addPendingWrite({
      record_id: updated.record_id,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });
    return true;
  },

  async repairScopedDocumentRecord(item, previousScopeGroupIds = [], nextScope = null) {
    const patch = this.buildScopedPolicyRepairPatch(item, {
      scopeId: nextScope?.record_id || item.scope_id,
      previousScopeGroupIds,
      fallbackPolicyGroupIds: item.group_ids || [],
    });
    if (!this.hasScopedPolicyRepairChanges(item, patch)) return false;

    const updated = toRaw({
      ...item,
      ...patch,
      version: (item.version ?? 1) + 1,
      sync_status: 'pending',
      updated_at: new Date().toISOString(),
    });
    await upsertDocument(updated);
    this.patchDocumentLocal(updated);
    const envelope = await outboundDocument({
      record_id: updated.record_id,
      owner_npub: updated.owner_npub,
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
      shares: updated.shares,
      version: updated.version,
      previous_version: item.version ?? 1,
      signature_npub: this.signingNpub,
      write_group_ref: updated.group_ids?.[0] || null,
    });
    await addPendingWrite({
      record_id: updated.record_id,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });
    return true;
  },

  async repairScopedDirectoryRecord(item, previousScopeGroupIds = [], nextScope = null) {
    const patch = this.buildScopedPolicyRepairPatch(item, {
      scopeId: nextScope?.record_id || item.scope_id,
      previousScopeGroupIds,
      fallbackPolicyGroupIds: item.group_ids || [],
    });
    if (!this.hasScopedPolicyRepairChanges(item, patch)) return false;

    const updated = toRaw({
      ...item,
      ...patch,
      version: (item.version ?? 1) + 1,
      sync_status: 'pending',
      updated_at: new Date().toISOString(),
    });
    await upsertDirectory(updated);
    this.patchDirectoryLocal(updated);
    const envelope = await outboundDirectory({
      record_id: updated.record_id,
      owner_npub: updated.owner_npub,
      title: updated.title,
      parent_directory_id: updated.parent_directory_id,
      scope_id: updated.scope_id ?? null,
      scope_l1_id: updated.scope_l1_id ?? null,
      scope_l2_id: updated.scope_l2_id ?? null,
      scope_l3_id: updated.scope_l3_id ?? null,
      scope_l4_id: updated.scope_l4_id ?? null,
      scope_l5_id: updated.scope_l5_id ?? null,
      scope_policy_group_ids: updated.scope_policy_group_ids ?? null,
      shares: updated.shares,
      version: updated.version,
      previous_version: item.version ?? 1,
      signature_npub: this.signingNpub,
      write_group_ref: updated.group_ids?.[0] || null,
    });
    await addPendingWrite({
      record_id: updated.record_id,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });
    return true;
  },

  async repairScopedFlowRecord(flow, previousScopeGroupIds = [], nextScope = null) {
    const patch = this.buildScopedPolicyRepairPatch(flow, {
      scopeId: nextScope?.record_id || flow.scope_id,
      previousScopeGroupIds,
      fallbackPolicyGroupIds: flow.group_ids || [],
    });
    if (!this.hasScopedPolicyRepairChanges(flow, patch)) return false;

    const updated = toRaw({
      ...flow,
      ...patch,
      version: (flow.version ?? 1) + 1,
      sync_status: 'pending',
      updated_at: new Date().toISOString(),
    });
    await upsertFlow(updated);
    this.flows = this.flows.map((entry) => entry.record_id === updated.record_id ? updated : entry);
    const envelope = await outboundFlow({
      ...updated,
      previous_version: flow.version ?? 1,
      signature_npub: this.signingNpub,
      write_group_ref: updated.group_ids?.[0] || null,
    });
    await addPendingWrite({
      record_id: updated.record_id,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });
    return true;
  },

  async repairScopedApprovalRecord(approval, previousScopeGroupIds = [], nextScope = null) {
    const patch = this.buildScopedPolicyRepairPatch(approval, {
      scopeId: nextScope?.record_id || approval.scope_id,
      previousScopeGroupIds,
      fallbackPolicyGroupIds: approval.group_ids || [],
    });
    if (!this.hasScopedPolicyRepairChanges(approval, patch)) return false;

    const updated = toRaw({
      ...approval,
      ...patch,
      version: (approval.version ?? 1) + 1,
      sync_status: 'pending',
      updated_at: new Date().toISOString(),
    });
    await upsertApproval(updated);
    this.approvals = this.approvals.map((entry) => entry.record_id === updated.record_id ? updated : entry);
    const envelope = await outboundApproval({
      ...updated,
      previous_version: approval.version ?? 1,
      signature_npub: this.signingNpub,
      write_group_ref: updated.group_ids?.[0] || null,
    });
    await addPendingWrite({
      record_id: updated.record_id,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });
    return true;
  },

  async repairScopedChannelRecord(channel, nextScope = null) {
    const nextGroupIds = this.getResolvedScopePolicyGroupIds(nextScope?.record_id || channel.scope_id);
    if (sameNormalizedGroupIds(channel.group_ids || [], nextGroupIds)) return false;

    const updated = toRaw({
      ...channel,
      group_ids: nextGroupIds,
      version: (channel.version ?? 1) + 1,
      sync_status: 'pending',
      updated_at: new Date().toISOString(),
    });
    await upsertChannel(updated);
    this.channels = this.channels.map((entry) => entry.record_id === updated.record_id ? updated : entry);
    const envelope = await outboundChannel({
      ...updated,
      previous_version: channel.version ?? 1,
      signature_npub: this.signingNpub,
      write_group_ref: updated.group_ids?.[0] || null,
    });
    await addPendingWrite({
      record_id: updated.record_id,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });
    return true;
  },

  async repairScopedReportRecord(report, nextScope = null) {
    const nextGroupIds = this.getResolvedScopePolicyGroupIds(nextScope?.record_id || report.scope_id);
    if (sameNormalizedGroupIds(report.group_ids || [], nextGroupIds)) return false;

    const updated = toRaw({
      ...report,
      group_ids: nextGroupIds,
      version: (report.version ?? 1) + 1,
      sync_status: 'pending',
      updated_at: new Date().toISOString(),
    });
    await upsertReport(updated);
    this.reports = this.reports.map((entry) => entry.record_id === updated.record_id ? updated : entry);
    if (this.selectedReportId === updated.record_id) {
      await this.applySelectedReport(updated);
    }
    const envelope = await outboundReport({
      ...updated,
      metadata: updated.metadata,
      data: {
        declaration_type: updated.declaration_type,
        payload: updated.payload,
      },
      previous_version: report.version ?? 1,
      signature_npub: this.signingNpub,
      write_group_ref: updated.group_ids?.[0] || null,
    });
    await addPendingWrite({
      record_id: updated.record_id,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });
    return true;
  },

  async reencryptScopedRecordsForScope(previousScope, nextScope) {
    const scopeId = nextScope?.record_id;
    if (!scopeId) return { total: 0, message: 'No scoped records were re-encrypted.' };

    const families = [
      {
        id: 'tasks',
        records: (this.tasks || []).filter((item) => item?.scope_id === scopeId && item.record_state !== 'deleted'),
        repair: (record, previousScopeGroupIdsArg) => this.repairScopedTaskRecord(record, previousScopeGroupIdsArg, nextScope),
      },
      {
        id: 'documents',
        records: (this.documents || []).filter((item) => item?.scope_id === scopeId && item.record_state !== 'deleted'),
        repair: (record, previousScopeGroupIdsArg) => this.repairScopedDocumentRecord(record, previousScopeGroupIdsArg, nextScope),
      },
      {
        id: 'directories',
        records: (this.directories || []).filter((item) => item?.scope_id === scopeId && item.record_state !== 'deleted'),
        repair: (record, previousScopeGroupIdsArg) => this.repairScopedDirectoryRecord(record, previousScopeGroupIdsArg, nextScope),
      },
      {
        id: 'flows',
        records: (this.flows || []).filter((item) => item?.scope_id === scopeId && item.record_state !== 'deleted'),
        repair: (record, previousScopeGroupIdsArg) => this.repairScopedFlowRecord(record, previousScopeGroupIdsArg, nextScope),
      },
      {
        id: 'approvals',
        records: (this.approvals || []).filter((item) => item?.scope_id === scopeId && item.record_state !== 'deleted'),
        repair: (record, previousScopeGroupIdsArg) => this.repairScopedApprovalRecord(record, previousScopeGroupIdsArg, nextScope),
      },
      {
        id: 'channels',
        records: (this.channels || []).filter((item) => item?.scope_id === scopeId && item.record_state !== 'deleted'),
        repair: (record) => this.repairScopedChannelRecord(record, nextScope),
      },
      {
        id: 'reports',
        records: (this.reports || []).filter((item) => item?.scope_id === scopeId && item.record_state !== 'deleted'),
        repair: (record) => this.repairScopedReportRecord(record, nextScope),
      },
    ];
    const counts = Object.fromEntries(families.map((family) => [family.id, family.records.length]));
    this.initializeScopeRepairProgress(counts);
    const previousScopeGroupIds = previousScope?.record_id && previousScope.record_id !== scopeId
      ? this.getScopeShareGroupIds(previousScope)
      : [];
    const summary = {
      tasks: 0,
      documents: 0,
      directories: 0,
      flows: 0,
      approvals: 0,
      channels: 0,
      reports: 0,
    };

    Object.assign(this.scopeRepairSession, { phase: 'rewriting', error: null });

    try {
      for (const family of families) {
        this.markScopeRepairProgress(family.id, 'active', { processed: 0, rewritten: 0 });
        for (let index = 0; index < family.records.length; index += 1) {
          const changed = await family.repair(family.records[index], previousScopeGroupIds);
          if (changed) summary[family.id] += 1;
          this.markScopeRepairProgress(family.id, 'active', {
            processed: index + 1,
            rewritten: summary[family.id],
          });
        }
        this.markScopeRepairProgress(family.id, 'done', {
          processed: family.records.length,
          rewritten: summary[family.id],
        });
      }
      Object.assign(this.scopeRepairSession, {
        phase: 'done',
        finishedAt: Date.now(),
        currentFamily: null,
        error: null,
      });
    } catch (error) {
      const activeFamilyId = this.scopeRepairProgress.find((family) => family.status === 'active')?.id || null;
      if (activeFamilyId) this.markScopeRepairProgress(activeFamilyId, 'error');
      Object.assign(this.scopeRepairSession, {
        phase: 'error',
        finishedAt: Date.now(),
        error: error?.message || 'Failed to reapply scope group crypto.',
      });
      throw error;
    }

    const total = Object.values(summary).reduce((count, value) => count + value, 0);
    return {
      ...summary,
      total,
      message: total > 0
        ? `Re-encrypted ${total} scoped record${total === 1 ? '' : 's'} (${summary.tasks} tasks, ${summary.documents} docs, ${summary.directories} folders, ${summary.flows} flows, ${summary.approvals} approvals, ${summary.channels} channels, ${summary.reports} reports).`
        : 'No scoped records needed re-encryption.',
    };
  },

  async deleteScope(scopeId) {
    if (!this.canAdminWorkspace) {
      this.error = 'Only workspace admins can manage scopes.';
      return;
    }
    const scope = this.scopes.find(s => s.record_id === scopeId);
    if (!scope || !this.session?.npub) return;

    const nextVersion = (scope.version ?? 1) + 1;
    const updated = toRaw({
      ...scope,
      record_state: 'deleted',
      version: nextVersion,
      sync_status: 'pending',
      updated_at: new Date().toISOString(),
    });

    await upsertScope(updated);
    this.scopes = this.scopes.filter(s => s.record_id !== scopeId);

    const envelope = await outboundScope({
      ...updated,
      previous_version: scope.version ?? 1,
      signature_npub: this.signingNpub,
      record_state: 'deleted',
      write_group_ref: updated.group_ids?.[0] || null,
    });
    await addPendingWrite({
      record_id: scopeId,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });
    await this.flushAndBackgroundSync();
  },

  getAvailableParents(level) {
    return getAvailableParents(this.scopes, level);
  },

  // --- scope form helpers ---

  getDefaultScopeGroupIds(level = this.newScopeLevel, parentId = this.newScopeParentId || null) {
    return defaultScopeGroupIds({
      level,
      parentId,
      scopesMap: this.scopesMap,
      fallbackGroupId: this.memberPrivateGroupRef || this.scopeAssignableGroups[0]?.groupId || null,
    }).map((groupId) => this.resolveGroupId(groupId));
  },

  syncNewScopePermissionDefaults() {
    this.newScopeAssignedGroupIds = this.getDefaultScopeGroupIds(this.newScopeLevel, this.newScopeParentId || null);
    this.newScopeGroupQuery = '';
  },

  handleNewScopeLevelChange(level) {
    this.newScopeLevel = level;
    if (level === 'l1') this.newScopeParentId = null;
    this.syncNewScopePermissionDefaults();
  },

  handleNewScopeParentChange(parentId) {
    this.newScopeParentId = parentId || null;
    this.syncNewScopePermissionDefaults();
  },

  handleNewScopeGroupInput(value) {
    this.newScopeGroupQuery = value;
  },

  addNewScopeGroup(groupId) {
    const nextGroupId = this.resolveGroupId(groupId);
    if (!nextGroupId) return;
    this.newScopeAssignedGroupIds = normalizeGroupIds([
      ...this.newScopeAssignedGroupIds,
      nextGroupId,
    ]);
    this.newScopeGroupQuery = '';
  },

  removeNewScopeGroup(groupId) {
    const targetGroupId = this.resolveGroupId(groupId);
    this.newScopeAssignedGroupIds = this.newScopeAssignedGroupIds.filter((value) => this.resolveGroupId(value) !== targetGroupId);
    this.newScopeGroupQuery = '';
  },

  handleEditingScopeGroupInput(value) {
    this.editingScopeGroupQuery = value;
  },

  addEditingScopeGroup(groupId) {
    const nextGroupId = this.resolveGroupId(groupId);
    if (!nextGroupId) return;
    this.editingScopeAssignedGroupIds = normalizeGroupIds([
      ...this.editingScopeAssignedGroupIds,
      nextGroupId,
    ]);
    this.editingScopeGroupQuery = '';
  },

  removeEditingScopeGroup(groupId) {
    const targetGroupId = this.resolveGroupId(groupId);
    this.editingScopeAssignedGroupIds = this.editingScopeAssignedGroupIds.filter((value) => this.resolveGroupId(value) !== targetGroupId);
    this.editingScopeGroupQuery = '';
  },
};
