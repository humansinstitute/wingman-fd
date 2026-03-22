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
  if (level === 'product') return [];
  if (level === 'project') return scopes.filter(s => s.level === 'product' && s.record_state !== 'deleted');
  if (level === 'deliverable') return scopes.filter(s => s.level === 'project' && s.record_state !== 'deleted');
  return [];
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
      if (normalized !== scope) {
        await upsertScope(normalized);
      }
    }
    if (!sameListBySignature(this.scopes, normalizedScopes)) {
      this.scopes = normalizedScopes;
    }
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
    return [...(r.product || []), ...(r.project || []), ...(r.deliverable || [])];
  },

  getScopeBreadcrumb(scopeId) {
    return scopeBreadcrumb(scopeId, this.scopesMap);
  },

  getScopeLabel(scopeId) {
    const scope = this.scopesMap.get(scopeId);
    return scope ? scope.title : '';
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
      scope_product_id: null,
      scope_project_id: null,
      scope_deliverable_id: null,
    });
    this.closeScopePicker();
    await this.saveEditingTask();
  },

  async selectScopeForDoc(scopeId) {
    const doc = this.selectedDocument;
    if (!doc || !this.session?.npub) return;
    const chain = resolveScopeChain(scopeId, this.scopesMap);
    const updated = {
      ...doc,
      scope_id: scopeId,
      scope_product_id: chain.scope_product_id,
      scope_project_id: chain.scope_project_id,
      scope_deliverable_id: chain.scope_deliverable_id,
    };
    this.patchDocumentLocal(updated);
    await upsertDocument(updated);
    this.closeScopePicker();
    await this._pushDocScopeUpdate(updated);
  },

  async clearDocScope() {
    const doc = this.selectedDocument;
    if (!doc || !this.session?.npub) return;
    const updated = {
      ...doc,
      scope_id: null,
      scope_product_id: null,
      scope_project_id: null,
      scope_deliverable_id: null,
    };
    this.patchDocumentLocal(updated);
    await upsertDocument(updated);
    this.closeScopePicker();
    await this._pushDocScopeUpdate(updated);
  },

  async _pushDocScopeUpdate(doc) {
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
      signature_npub: this.session.npub,
      write_group_npub: updated.group_ids?.[0] || null,
    });
    await addPendingWrite({
      record_id: updated.record_id,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });
    await this.performSync({ silent: true });
  },

  async selectScopeForChannel(scopeId) {
    const ch = this.selectedChannel;
    if (!ch || !this.session?.npub) return;
    const chain = resolveScopeChain(scopeId, this.scopesMap);
    const updated = toRaw({
      ...ch,
      scope_id: scopeId,
      scope_product_id: chain.scope_product_id,
      scope_project_id: chain.scope_project_id,
      scope_deliverable_id: chain.scope_deliverable_id,
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
      scope_product_id: null,
      scope_project_id: null,
      scope_deliverable_id: null,
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
      signature_npub: this.session.npub,
      write_group_npub: updated.group_ids?.[0] || null,
    });
    await addPendingWrite({
      record_id: updated.record_id,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });
    await this.performSync({ silent: true });
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
      signature_npub: this.session?.npub,
      write_group_npub: row.group_ids?.[0] || null,
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
      scope_product_id: null,
      scope_project_id: null,
      scope_deliverable_id: null,
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
        || (existing.scope_product_id || null) !== (tags.scope_product_id || null)
        || (existing.scope_project_id || null) !== (tags.scope_project_id || null)
        || (existing.scope_deliverable_id || null) !== (tags.scope_deliverable_id || null);
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
    const level = this.newScopeLevel;
    const parentId = this.newScopeParentId || null;
    const hierarchy = deriveScopeHierarchy({
      level,
      parentId,
      scopesMap: this.scopesMap,
    });
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
      product_id: hierarchy.product_id,
      project_id: hierarchy.project_id,
      group_ids: groupIds,
      sync_status: 'pending',
      record_state: 'active',
      version: 1,
      created_at: now,
      updated_at: now,
    };

    await upsertScope(localRow);
    this.scopes = [...this.scopes, localRow];
    this.newScopeTitle = '';
    this.newScopeDescription = '';
    this.newScopeLevel = 'product';
    this.newScopeParentId = null;
    this.newScopeAssignedGroupIds = [];
    this.newScopeGroupQuery = '';
    this.showNewScopeForm = false;

    const envelope = await outboundScope({
      ...localRow,
      signature_npub: this.session.npub,
      write_group_npub: localRow.group_ids?.[0] || null,
    });
    await addPendingWrite({
      record_id: recordId,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });
    await this.ensureScopeDirectoryChain(localRow);
    await this.performSync({ silent: false });
    await this.refreshDirectories();
    await this.refreshScopes();
  },

  startNewScope(level = 'product', parentId = null) {
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
      signature_npub: this.session.npub,
      write_group_npub: updated.group_ids?.[0] || null,
    });
    await addPendingWrite({
      record_id: updated.record_id,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });
    await this.ensureScopeDirectoryChain(updated);
    await this.performSync({ silent: true });
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
      signature_npub: this.session.npub,
      record_state: 'deleted',
      write_group_npub: updated.group_ids?.[0] || null,
    });
    await addPendingWrite({
      record_id: scopeId,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });
    await this.performSync({ silent: false });
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
    if (level === 'product') this.newScopeParentId = null;
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
