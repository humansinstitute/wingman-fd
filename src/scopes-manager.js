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
  upsertDocument,
  upsertDirectory,
  upsertChannel,
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
import { recordFamilyHash } from './translators/chat.js';
import {
  buildScopeLineage,
  buildScopeShares,
  buildScopeTags,
  defaultScopeGroupIds,
  deriveScopeHierarchy,
  findActiveDirectoryByScopeId,
  findActiveRootDirectoryByTitle,
  normalizeGroupIds,
} from './scope-delivery.js';
import {
  toRaw,
  sameListBySignature,
} from './utils/state-helpers.js';

// ---------------------------------------------------------------------------
// Pure utility functions (no `this` dependency)
// ---------------------------------------------------------------------------

export function findDirectoryByParentAndTitle(directories, parentDirectoryId, title) {
  const needle = String(title || '').trim().toLowerCase();
  return directories.find((directory) =>
    directory?.record_state !== 'deleted'
    && (directory.parent_directory_id || null) === (parentDirectoryId || null)
    && String(directory.title || '').trim().toLowerCase() === needle
  ) || null;
}

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

// ---------------------------------------------------------------------------
// Mixin — methods that reference `this` (the Alpine store)
// ---------------------------------------------------------------------------

export const scopesManagerMixin = {

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
    this.showNewScopeForm = false;
  },

  closeScopePicker() {
    this.showScopePicker = false;
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
    let shares = this.getStoredDocShares(doc);
    if (scopeId) {
      const scope = this.scopesMap.get(scopeId);
      if (scope) {
        const scopeShares = this.buildScopeDefaultShares(this.getScopeShareGroupIds(scope));
        shares = this.mergeDocShareLists(shares, scopeShares);
      }
    }
    const groupIds = this.getShareGroupIds(shares);
    const updated = {
      ...doc,
      ...scopeAssignment,
      shares,
      group_ids: groupIds,
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
    let shares = this.getStoredDocShares(dir);
    if (scopeId) {
      const scope = this.scopesMap.get(scopeId);
      if (scope) {
        const scopeShares = this.buildScopeDefaultShares(this.getScopeShareGroupIds(scope));
        shares = this.mergeDocShareLists(shares, scopeShares);
      }
    }
    const groupIds = this.getShareGroupIds(shares);
    const updated = toRaw({
      ...dir,
      ...scopeAssignment,
      shares,
      group_ids: groupIds,
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
    this.closeScopePicker();
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
    this.closeScopePicker();
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

  findDirectoryByParentAndTitle(parentDirectoryId, title) {
    return findDirectoryByParentAndTitle(this.directories, parentDirectoryId, title);
  },

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

  async ensureProductsRootDirectory(scopeGroupIds = []) {
    const ownerNpub = this.workspaceOwnerNpub;
    if (!ownerNpub || !this.session?.npub) return null;

    const desiredShares = this.buildScopeDefaultShares(scopeGroupIds);
    const existing = findActiveRootDirectoryByTitle(this.directories, 'Products');
    if (existing) {
      const mergedShares = this.mergeDocShareLists(this.getStoredDocShares(existing), desiredShares);
      const mergedGroupIds = this.getShareGroupIds(mergedShares);
      const nextParentId = null;
      const hasChanges = JSON.stringify(this.getStoredDocShares(existing)) !== JSON.stringify(mergedShares)
        || JSON.stringify(existing.group_ids || []) !== JSON.stringify(mergedGroupIds)
        || (existing.parent_directory_id || null) !== nextParentId;
      if (!hasChanges) return existing;

      const updated = toRaw({
        ...existing,
        parent_directory_id: nextParentId,
        shares: mergedShares,
        group_ids: mergedGroupIds,
        sync_status: 'pending',
        version: (existing.version ?? 1) + 1,
        updated_at: new Date().toISOString(),
      });
      await this.queueDirectoryRecord(updated, existing);
      return updated;
    }

    const now = new Date().toISOString();
    const shares = desiredShares.length > 0 ? desiredShares : this.getDefaultPrivateShares();
    const created = toRaw({
      record_id: crypto.randomUUID(),
      owner_npub: ownerNpub,
      title: 'Products',
      parent_directory_id: null,
      scope_id: null,
      scope_l1_id: null,
      scope_l2_id: null,
      scope_l3_id: null,
      scope_l4_id: null,
      scope_l5_id: null,
      shares,
      group_ids: this.getShareGroupIds(shares),
      sync_status: 'pending',
      record_state: 'active',
      version: 1,
      updated_at: now,
    });
    await this.queueDirectoryRecord(created, null);
    return created;
  },

  async ensureScopedDirectory(scope, parentDirectoryId, inheritedGroupIds = []) {
    const ownerNpub = this.workspaceOwnerNpub;
    if (!ownerNpub || !scope?.record_id || !this.session?.npub) return null;

    const existing = findActiveDirectoryByScopeId(this.directories, scope.record_id)
      || this.findDirectoryByParentAndTitle(parentDirectoryId, scope.title);
    const folderGroupIds = normalizeGroupIds([
      ...this.getScopeShareGroupIds(scope),
      ...normalizeGroupIds(inheritedGroupIds),
    ]);
    const shares = this.buildScopeDefaultShares(folderGroupIds);
    const tags = buildScopeTags(scope);

    if (existing) {
      const nextShares = shares.length > 0 ? shares : this.getStoredDocShares(existing);
      const nextGroupIds = this.getShareGroupIds(nextShares);
      const hasChanges = existing.title !== scope.title
        || (existing.parent_directory_id || null) !== (parentDirectoryId || null)
        || JSON.stringify(this.getStoredDocShares(existing)) !== JSON.stringify(nextShares)
        || JSON.stringify(existing.group_ids || []) !== JSON.stringify(nextGroupIds)
        || (existing.scope_id || null) !== (tags.scope_id || null)
        || (existing.scope_l1_id || null) !== (tags.scope_l1_id || null)
        || (existing.scope_l2_id || null) !== (tags.scope_l2_id || null)
        || (existing.scope_l3_id || null) !== (tags.scope_l3_id || null)
        || (existing.scope_l4_id || null) !== (tags.scope_l4_id || null)
        || (existing.scope_l5_id || null) !== (tags.scope_l5_id || null);
      if (!hasChanges) return existing;

      const updated = toRaw({
        ...existing,
        title: scope.title,
        parent_directory_id: parentDirectoryId || null,
        ...tags,
        shares: nextShares,
        group_ids: nextGroupIds,
        sync_status: 'pending',
        version: (existing.version ?? 1) + 1,
        updated_at: new Date().toISOString(),
      });
      await this.queueDirectoryRecord(updated, existing);
      return updated;
    }

    const now = new Date().toISOString();
    const created = toRaw({
      record_id: crypto.randomUUID(),
      owner_npub: ownerNpub,
      title: scope.title,
      parent_directory_id: parentDirectoryId || null,
      ...tags,
      shares,
      group_ids: this.getShareGroupIds(shares),
      sync_status: 'pending',
      record_state: 'active',
      version: 1,
      updated_at: now,
    });
    await this.queueDirectoryRecord(created, null);
    return created;
  },

  async ensureScopeDirectoryChain(scope) {
    if (!scope?.record_id) return null;
    const lineage = buildScopeLineage(scope, this.scopesMap);
    if (lineage.length === 0) return null;

    const currentGroupIds = this.getScopeShareGroupIds(scope);
    const root = await this.ensureProductsRootDirectory(currentGroupIds);
    let parentDirectoryId = root?.record_id || null;

    for (const entry of lineage) {
      const directory = await this.ensureScopedDirectory(entry, parentDirectoryId, currentGroupIds);
      parentDirectoryId = directory?.record_id || parentDirectoryId;
    }

    return parentDirectoryId;
  },

  // --- scope CRUD ---

  async addScope() {
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
    await this.ensureScopeDirectoryChain(localRow);
    await this.flushAndBackgroundSync();
    await this.refreshDirectories();
    await this.refreshScopes();
  },

  startNewScope(level = 'l1', parentId = null) {
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
    const scope = this.scopesMap.get(scopeId);
    if (!scope) return;
    this.editingScopeId = scopeId;
    this.editingScopeTitle = scope.title;
    this.editingScopeDescription = scope.description || '';
    this.editingScopeAssignedGroupIds = this.getScopeShareGroupIds(scope);
    this.editingScopeGroupQuery = '';
  },

  cancelEditScope() {
    this.editingScopeId = null;
    this.editingScopeTitle = '';
    this.editingScopeDescription = '';
    this.editingScopeAssignedGroupIds = [];
    this.editingScopeGroupQuery = '';
  },

  async saveEditScope() {
    if (!this.editingScopeId || !this.session?.npub) return;
    const scope = this.scopes.find(s => s.record_id === this.editingScopeId);
    if (!scope) return;

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
    await this.ensureScopeDirectoryChain(updated);
    await this.flushAndBackgroundSync();
    await this.refreshDirectories();
  },

  async deleteScope(scopeId) {
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
