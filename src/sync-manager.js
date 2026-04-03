/**
 * Sync lifecycle, repair, and quarantine methods extracted from app.js.
 *
 * The syncManagerMixin object contains methods and getters that use `this`
 * (the Alpine store) and should be spread into the store definition via applyMixins.
 */

import {
  getPendingWrites,
  getPendingWritesByFamilies,
  removePendingWrite,
  clearSyncState,
  clearRuntimeFamilies,
  clearSyncStateForFamilies,
  getSyncQuarantineEntries,
  deleteSyncQuarantineEntry,
  clearSyncQuarantineForFamilies,
  deleteRuntimeRecordByFamily,
  upsertTask,
  upsertDocument,
  upsertDirectory,
  upsertChannel,
  upsertMessage,
  getCommentsByTarget,
  upsertComment,
} from './db.js';
import { fetchRecordHistory, syncRecords } from './api.js';
import {
  runSync,
  flushOnly,
  pullRecordsForFamilies,
  pruneOnLogin,
  startWorkerFlushTimer,
  stopWorkerFlushTimer,
} from './sync-worker-client.js';
import { flightDeckLog } from './logging.js';
import { SYNC_FAMILY_OPTIONS, getSyncFamily, getSyncFamilyHashes } from './sync-families.js';
import { outboundTask } from './translators/tasks.js';
import { outboundDocument, outboundDirectory } from './translators/docs.js';
import { outboundChannel, outboundChatMessage } from './translators/chat.js';
import { hasGroupKey } from './crypto/group-keys.js';
import { outboundComment } from './translators/comments.js';

// ---------------------------------------------------------------------------
// Mixin — methods and getters that use `this` (the Alpine store)
// ---------------------------------------------------------------------------

export const syncManagerMixin = {

  get workspaceDbKey() {
    return this.currentWorkspaceKey || this.workspaceOwnerNpub || '';
  },

  // --- access pruning on login ---

  async runAccessPruneOnLogin() {
    if (!this.session?.npub || !this.workspaceOwnerNpub) return;
    await pruneOnLogin(this.session.npub, this.workspaceOwnerNpub, {
      workspaceDbKey: this.workspaceDbKey,
    });
  },

  // --- repair UI ---

  get repairFamilyOptions() {
    return SYNC_FAMILY_OPTIONS;
  },

  isRepairFamilySelected(familyId) {
    return this.repairSelectedFamilyIds.includes(familyId);
  },

  toggleRepairFamily(familyId) {
    this.repairError = null;
    this.repairNotice = '';
    if (this.isRepairFamilySelected(familyId)) {
      this.repairSelectedFamilyIds = this.repairSelectedFamilyIds.filter((candidate) => candidate !== familyId);
      return;
    }
    this.repairSelectedFamilyIds = [...this.repairSelectedFamilyIds, familyId];
  },

  selectAllRepairFamilies() {
    this.repairError = null;
    this.repairNotice = '';
    this.repairSelectedFamilyIds = SYNC_FAMILY_OPTIONS.map((family) => family.id);
  },

  clearRepairFamilies() {
    this.repairError = null;
    this.repairNotice = '';
    this.repairSelectedFamilyIds = [];
  },

  async probeTaskOnTowerAndRepair() {
    const taskId = String(this.repairTaskIdInput || '').trim();
    if (!taskId) {
      this.repairError = 'Enter a task ID.';
      return;
    }
    if (!this.workspaceOwnerNpub || !this.session?.npub) {
      this.repairError = 'Configure workspace sync first.';
      return;
    }

    this.repairError = null;
    this.repairNotice = '';
    this.repairTaskProbeBusy = true;
    try {
      const result = await fetchRecordHistory({
        record_id: taskId,
        owner_npub: this.workspaceOwnerNpub,
        viewer_npub: this.session.npub,
      });
      const versions = Array.isArray(result?.versions) ? result.versions : [];
      const localPresent = this.tasks.some((task) => task.record_id === taskId);

      if (versions.length === 0) {
        this.repairError = 'Task not found on Tower for the current workspace/user view.';
        return;
      }

      if (localPresent) {
        this.repairNotice = `Task exists on Tower with ${versions.length} version${versions.length === 1 ? '' : 's'} and is already present locally.`;
        return;
      }

      const repairResult = await this.restoreFamiliesFromSuperBased(['task'], { confirm: false });
      if (repairResult.cancelled) return;

      const repairedLocalPresent = this.tasks.some((task) => task.record_id === taskId);
      this.repairNotice = repairedLocalPresent
        ? `Task exists on Tower with ${versions.length} version${versions.length === 1 ? '' : 's'}. Rebuilt the Tasks family and restored it locally.`
        : `Task exists on Tower with ${versions.length} version${versions.length === 1 ? '' : 's'}. Rebuilt the Tasks family, but the task still did not materialize locally.`;
    } catch (error) {
      this.repairError = error?.message || 'Failed to probe task history on Tower.';
    } finally {
      this.repairTaskProbeBusy = false;
    }
  },

  getRecordStatusFamilyLabel(familyId) {
    return getSyncFamily(familyId)?.label || familyId || 'Record';
  },

  getLocalRecordsForStatusFamily(familyId) {
    switch (familyId) {
      case 'task':
        return this.tasks || [];
      case 'document':
        return this.documents || [];
      case 'directory':
        return this.directories || [];
      case 'channel':
        return this.channels || [];
      case 'chat_message':
        return this.messages || [];
      case 'schedule':
        return this.schedules || [];
      case 'scope':
        return this.scopes || [];
      case 'report':
        return this.reports || [];
      default:
        return [];
    }
  },

  getLocalStatusRecord(familyId, recordId) {
    return this.getLocalRecordsForStatusFamily(familyId).find((record) => record?.record_id === recordId) ?? null;
  },

  getRecordStatusChannelForRecord(localRecord, familyId) {
    if (!localRecord) return null;
    if (familyId === 'channel') return localRecord;
    if (familyId !== 'chat_message') return null;
    return this.channels.find((channel) => channel?.record_id === localRecord.channel_id) ?? null;
  },

  async getRecordStatusPendingWrites() {
    return getPendingWrites();
  },

  async removeRecordStatusPendingWrite(rowId) {
    return removePendingWrite(rowId);
  },

  async getRecordStatusRelatedComments(recordId, targetFamilyHash) {
    const comments = await getCommentsByTarget(recordId);
    return comments.filter((comment) => comment?.target_record_family_hash === targetFamilyHash);
  },

  isLocalStatusRecordPresent(familyId, recordId) {
    return Boolean(this.getLocalStatusRecord(familyId, recordId));
  },

  getRecordStatusWriteGroupRefFromRecord(localRecord, familyId) {
    if (!localRecord) return '';
    if (familyId === 'task') {
      return String(localRecord.board_group_id || localRecord.group_ids?.[0] || '').trim();
    }
    if (familyId === 'chat_message') {
      const channel = this.getRecordStatusChannelForRecord(localRecord, familyId);
      return String(channel?.group_ids?.[0] || '').trim();
    }
    return String(localRecord.group_ids?.[0] || '').trim();
  },

  resolveRecordStatusTaskScopeRef(localRecord) {
    if (!localRecord) return null;
    const scope = typeof this.getTaskBoardScopeFromTask === 'function'
      ? this.getTaskBoardScopeFromTask(localRecord)
      : null;
    return scope?.record_id
      || localRecord.scope_id
      || localRecord.scope_l5_id
      || localRecord.scope_l4_id
      || localRecord.scope_l3_id
      || localRecord.scope_l2_id
      || localRecord.scope_l1_id
      || null;
  },

  buildRecordStatusLocalRecord(localRecord, familyId, options = {}) {
    if (!localRecord) return null;
    if (familyId !== 'task') return localRecord;

    const bootstrap = options.bootstrap === true;
    const scopeRef = this.resolveRecordStatusTaskScopeRef(localRecord);
    const assignment = bootstrap && scopeRef && typeof this.buildTaskBoardAssignment === 'function'
      ? this.buildTaskBoardAssignment(scopeRef, localRecord)
      : null;
    const resolveGroup = (groupRef) => (
      typeof this.resolveGroupId === 'function'
        ? this.resolveGroupId(groupRef)
        : String(groupRef || '').trim() || null
    );
    const assignmentGroupIds = Array.isArray(assignment?.group_ids) ? assignment.group_ids : [];
    const localGroupIds = Array.isArray(localRecord.group_ids) ? localRecord.group_ids : [];
    const candidateGroupIds = [...new Set((assignmentGroupIds.length > 0 ? assignmentGroupIds : localGroupIds)
      .map((groupId) => resolveGroup(groupId))
      .filter(Boolean))];
    const resolvedBoardGroupId = resolveGroup(assignment?.board_group_id) || candidateGroupIds[0] || resolveGroup(localRecord.board_group_id);
    const nextGroupIds = resolvedBoardGroupId && !candidateGroupIds.includes(resolvedBoardGroupId)
      ? [resolvedBoardGroupId, ...candidateGroupIds]
      : candidateGroupIds;
    const nextShares = nextGroupIds.length > 0 && typeof this.buildScopeDefaultShares === 'function'
      ? this.buildScopeDefaultShares(nextGroupIds)
      : (assignment?.shares || localRecord.shares || []);

    return {
      ...localRecord,
      ...(assignment || {}),
      board_group_id: resolvedBoardGroupId || null,
      group_ids: nextGroupIds,
      shares: nextShares,
    };
  },

  getRecordStatusLocalVersion(localRecord) {
    const version = Number(localRecord?.version ?? 0);
    return Number.isFinite(version) && version > 0 ? version : 0;
  },

  getRecordStatusSubmitVersion(localRecord, options = {}) {
    const bootstrap = options.bootstrap === true;
    if (bootstrap) {
      return { version: 1, previousVersion: 0 };
    }
    const latestTowerVersion = Math.max(0, Number(this.recordStatusTowerLatestVersion ?? 0) || 0);
    const fallbackLocalVersion = Math.max(1, this.getRecordStatusLocalVersion(localRecord) || 1);
    const version = latestTowerVersion > 0 ? latestTowerVersion + 1 : fallbackLocalVersion;
    return {
      version,
      previousVersion: Math.max(0, version - 1),
    };
  },

  describeRecordStatusGroup(groupRef) {
    const resolvedGroupRef = typeof this.resolveGroupId === 'function' ? this.resolveGroupId(groupRef) : String(groupRef || '').trim();
    if (!resolvedGroupRef) return { ref: '', label: '', keyLoaded: false };
    const group = (this.groups || []).find((entry) => entry.group_id === resolvedGroupRef || entry.group_npub === resolvedGroupRef);
    return {
      ref: resolvedGroupRef,
      label: group?.name || resolvedGroupRef,
      keyLoaded: hasGroupKey(resolvedGroupRef),
    };
  },

  async refreshRecordStatusLocalContext() {
    const familyId = String(this.recordStatusFamilyId || '').trim();
    const recordId = String(this.recordStatusTargetId || '').trim();
    const rawLocalRecord = this.getLocalStatusRecord(familyId, recordId);
    const localRecord = this.buildRecordStatusLocalRecord(rawLocalRecord, familyId, { bootstrap: true });
    const groupInfo = this.describeRecordStatusGroup(this.getRecordStatusWriteGroupRefFromRecord(localRecord, familyId));
    const pendingWrites = await this.getRecordStatusPendingWrites();
    const familyHash = getSyncFamily(familyId)?.hash;

    this.recordStatusLocalPresent = Boolean(rawLocalRecord);
    this.recordStatusLocalVersion = this.getRecordStatusLocalVersion(rawLocalRecord);
    this.recordStatusLocalSyncStatus = String(rawLocalRecord?.sync_status || '').trim() || 'unknown';
    this.recordStatusWriteGroupRef = groupInfo.ref;
    this.recordStatusWriteGroupLabel = groupInfo.label;
    this.recordStatusWriteGroupKeyLoaded = groupInfo.keyLoaded;
    this.recordStatusPendingWriteCount = pendingWrites.filter((row) => row.record_id === recordId && row.record_family_hash === familyHash).length;
    return { localRecord, rawLocalRecord, groupInfo };
  },

  canForcePushRecordStatusTarget() {
    return Boolean(
      this.recordStatusTargetId
      && this.recordStatusFamilyId
      && this.recordStatusLocalPresent
      && (
        this.recordStatusTowerVersionCount === 0
        || this.recordStatusPendingWriteCount > 0
        || this.recordStatusLocalSyncStatus === 'pending'
        || this.recordStatusLocalSyncStatus === 'failed'
        || (
          Number(this.recordStatusLocalVersion || 0) > 0
          && Number(this.recordStatusLocalVersion || 0) !== Number(this.recordStatusTowerLatestVersion || 0)
        )
      )
    );
  },

  async buildRecordStatusEnvelope(localRecord, familyId, options = {}) {
    if (!localRecord) throw new Error('Local record not found.');

    const bootstrap = options.bootstrap === true;
    const effectiveLocalRecord = this.buildRecordStatusLocalRecord(localRecord, familyId, { bootstrap });
    const channelRecord = this.getRecordStatusChannelForRecord(effectiveLocalRecord, familyId);
    const ownerNpub = effectiveLocalRecord.owner_npub || channelRecord?.owner_npub || this.workspaceOwnerNpub;
    const { version, previousVersion } = this.getRecordStatusSubmitVersion(effectiveLocalRecord, { bootstrap });
    const signatureNpub = this.signingNpub || this.session?.npub || ownerNpub;
    // owner_npub is a workspace service identity, not a person's npub.
    // All writes are non-owner and need write_group_ref for Tower auth.
    const realUserNpub = String(this.session?.npub || '').trim();
    const isOwnerWrite = realUserNpub === String(ownerNpub || '').trim();

    if (familyId === 'task') {
      const candidateGroupIds = Array.isArray(effectiveLocalRecord.group_ids) ? effectiveLocalRecord.group_ids : [];
      const loadedGroupIds = candidateGroupIds.filter((groupId) => hasGroupKey(groupId));
      const nextGroupIds = loadedGroupIds.length > 0 ? loadedGroupIds : candidateGroupIds;
      const nextShares = loadedGroupIds.length > 0 && typeof this.buildScopeDefaultShares === 'function'
        ? this.buildScopeDefaultShares(loadedGroupIds)
        : (effectiveLocalRecord.shares || []);
      const writeGroupNpub = nextGroupIds[0] || effectiveLocalRecord.board_group_id || null;
      if (!writeGroupNpub) throw new Error('Task is missing a writable group.');
      return outboundTask({
        ...effectiveLocalRecord,
        owner_npub: ownerNpub,
        board_group_id: writeGroupNpub,
        group_ids: nextGroupIds,
        shares: nextShares,
        version,
        previous_version: previousVersion,
        signature_npub: signatureNpub,
        write_group_ref: isOwnerWrite ? null : writeGroupNpub,
      });
    }

    if (familyId === 'document') {
      const shares = typeof this.getEffectiveDocShares === 'function'
        ? this.getEffectiveDocShares(localRecord)
        : (localRecord.shares || []);
      const writeGroupNpub = localRecord.group_ids?.[0] || null;
      if (!writeGroupNpub) throw new Error('Document is missing a writable group.');
      return outboundDocument({
        ...localRecord,
        owner_npub: ownerNpub,
        shares,
        version,
        previous_version: previousVersion,
        signature_npub: signatureNpub,
        write_group_ref: isOwnerWrite ? null : writeGroupNpub,
      });
    }

    if (familyId === 'directory') {
      const shares = typeof this.getEffectiveDocShares === 'function'
        ? this.getEffectiveDocShares(localRecord)
        : (localRecord.shares || []);
      const writeGroupNpub = localRecord.group_ids?.[0] || null;
      if (!writeGroupNpub) throw new Error('Folder is missing a writable group.');
      return outboundDirectory({
        ...localRecord,
        owner_npub: ownerNpub,
        shares,
        version,
        previous_version: previousVersion,
        signature_npub: signatureNpub,
        write_group_ref: isOwnerWrite ? null : writeGroupNpub,
      });
    }

    if (familyId === 'channel') {
      const writeGroupRef = this.getRecordStatusWriteGroupRefFromRecord(effectiveLocalRecord, familyId);
      if (!writeGroupRef) throw new Error('Channel is missing a writable group.');
      return outboundChannel({
        ...effectiveLocalRecord,
        owner_npub: ownerNpub,
        group_ids: effectiveLocalRecord.group_ids ?? [],
        participant_npubs: effectiveLocalRecord.participant_npubs ?? [],
        version,
        previous_version: previousVersion,
        signature_npub: signatureNpub,
        write_group_ref: isOwnerWrite ? null : writeGroupRef,
      });
    }

    if (familyId === 'chat_message') {
      if (!channelRecord) throw new Error('Chat message channel is missing locally.');
      const writeGroupRef = this.getRecordStatusWriteGroupRefFromRecord(effectiveLocalRecord, familyId);
      if (!writeGroupRef) throw new Error('Chat message channel is missing a writable group.');
      return outboundChatMessage({
        record_id: effectiveLocalRecord.record_id,
        owner_npub: ownerNpub,
        channel_id: effectiveLocalRecord.channel_id,
        parent_message_id: effectiveLocalRecord.parent_message_id ?? null,
        body: effectiveLocalRecord.body ?? '',
        attachments: Array.isArray(effectiveLocalRecord.attachments) ? effectiveLocalRecord.attachments : [],
        channel_group_ids: channelRecord.group_ids ?? [],
        write_group_ref: isOwnerWrite ? null : writeGroupRef,
        version,
        previous_version: previousVersion,
        signature_npub: signatureNpub,
        record_state: effectiveLocalRecord.record_state ?? 'active',
      });
    }

    throw new Error(`Force push is not implemented for ${this.getRecordStatusFamilyLabel(familyId)} yet.`);
  },

  async markRecordStatusLocalRecordSynced(familyId, localRecord, options = {}) {
    if (!localRecord) return;

    const nextRecord = {
      ...localRecord,
      sync_status: 'synced',
      version: options.version ?? localRecord.version ?? 1,
    };

    if (familyId === 'task') {
      await upsertTask(nextRecord);
      this.tasks = this.tasks.map((entry) => entry.record_id === nextRecord.record_id ? nextRecord : entry);
      if (this.editingTask?.record_id === nextRecord.record_id) {
        this.editingTask = { ...nextRecord };
      }
      return;
    }

    if (familyId === 'document') {
      await upsertDocument(nextRecord);
      if (typeof this.patchDocumentLocal === 'function') this.patchDocumentLocal(nextRecord);
      return;
    }

    if (familyId === 'directory') {
      await upsertDirectory(nextRecord);
      if (typeof this.patchDirectoryLocal === 'function') this.patchDirectoryLocal(nextRecord);
      return;
    }

    if (familyId === 'channel') {
      await upsertChannel(nextRecord);
      this.channels = this.channels.map((entry) => entry.record_id === nextRecord.record_id ? nextRecord : entry);
      return;
    }

    if (familyId === 'chat_message') {
      await upsertMessage(nextRecord);
      if (typeof this.patchMessageLocal === 'function') this.patchMessageLocal(nextRecord);
      else this.messages = this.messages.map((entry) => entry.record_id === nextRecord.record_id ? nextRecord : entry);
    }
  },

  async markRecordStatusCommentsSynced(comments = []) {
    if (!Array.isArray(comments) || comments.length === 0) return;
    for (const comment of comments) {
      await upsertComment({
        ...comment,
        sync_status: 'synced',
        version: 1,
      });
    }
    if (this.activeTaskId && this.recordStatusFamilyId === 'task' && this.recordStatusTargetId === this.activeTaskId) {
      await this.loadTaskComments(this.activeTaskId);
    }
    if (this.docsEditorOpen && this.selectedDocId && this.recordStatusTargetId === this.selectedDocId) {
      await this.loadDocComments(this.selectedDocId);
    }
  },

  async buildRecordStatusCommentEnvelope(comment, options = {}) {
    const targetGroupIds = Array.isArray(options.targetGroupIds) ? options.targetGroupIds : [];
    return outboundComment({
      ...comment,
      version: 1,
      previous_version: 0,
      target_group_ids: targetGroupIds,
      signature_npub: this.session?.npub,
      write_group_ref: null,
    });
  },

  async openRecordStatusModal(target = {}) {
    const familyId = String(target?.familyId || '').trim();
    const recordId = String(target?.recordId || '').trim();
    const label = String(target?.label || '').trim();

    this.recordStatusModalOpen = true;
    this.recordStatusFamilyId = familyId;
    this.recordStatusTargetId = recordId;
    this.recordStatusTargetLabel = label;
    this.recordStatusError = null;
    this.recordStatusNotice = '';
    this.recordStatusTowerVersionCount = 0;
    this.recordStatusTowerLatestVersion = 0;
    this.recordStatusTowerUpdatedAt = '';
    await this.refreshRecordStatusLocalContext();

    await this.checkRecordStatusOnTower();
  },

  closeRecordStatusModal() {
    this.recordStatusModalOpen = false;
    this.recordStatusFamilyId = '';
    this.recordStatusTargetId = '';
    this.recordStatusTargetLabel = '';
    this.recordStatusBusy = false;
    this.recordStatusSyncBusy = false;
    this.recordStatusError = null;
    this.recordStatusNotice = '';
    this.recordStatusTowerVersionCount = 0;
    this.recordStatusTowerLatestVersion = 0;
    this.recordStatusTowerUpdatedAt = '';
    this.recordStatusLocalPresent = false;
    this.recordStatusLocalVersion = 0;
    this.recordStatusLocalSyncStatus = '';
    this.recordStatusPendingWriteCount = 0;
    this.recordStatusWriteGroupRef = '';
    this.recordStatusWriteGroupLabel = '';
    this.recordStatusWriteGroupKeyLoaded = false;
  },

  async checkRecordStatusOnTower() {
    const familyId = String(this.recordStatusFamilyId || '').trim();
    const recordId = String(this.recordStatusTargetId || '').trim();
    const familyLabel = this.getRecordStatusFamilyLabel(familyId);
    const targetLabel = this.recordStatusTargetLabel || `${familyLabel} record`;

    if (!familyId || !recordId) {
      this.recordStatusError = 'Select a record first.';
      return;
    }
    if (!this.workspaceOwnerNpub || !this.session?.npub) {
      this.recordStatusError = 'Configure workspace sync first.';
      return;
    }

    this.recordStatusBusy = true;
    this.recordStatusError = null;
    this.recordStatusNotice = '';
    try {
      const result = await fetchRecordHistory({
        record_id: recordId,
        owner_npub: this.workspaceOwnerNpub,
        viewer_npub: this.session.npub,
      });
      const versions = Array.isArray(result?.versions) ? result.versions : [];
      const latestVersionNumber = versions.reduce((latest, current) => {
        const version = Number(current?.version ?? 0) || 0;
        return version > latest ? version : latest;
      }, 0);
      const latestVersion = versions.reduce((latest, current) => {
        if (!latest) return current;
        const currentTime = Date.parse(current?.updated_at || '') || 0;
        const latestTime = Date.parse(latest?.updated_at || '') || 0;
        return currentTime >= latestTime ? current : latest;
      }, null);

      this.recordStatusTowerVersionCount = versions.length;
      this.recordStatusTowerLatestVersion = latestVersionNumber;
      this.recordStatusTowerUpdatedAt = latestVersion?.updated_at || '';
      await this.refreshRecordStatusLocalContext();

      if (versions.length === 0) {
        if (this.recordStatusLocalPresent) {
          this.recordStatusNotice = `${targetLabel} is missing on Tower. You can force submit this local snapshot as version 1.`;
        } else {
          this.recordStatusError = `${targetLabel} is not on Tower for the current workspace/user view.`;
        }
        return;
      }

      this.recordStatusNotice = this.recordStatusLocalPresent
        ? `${targetLabel} is on Tower with ${versions.length} version${versions.length === 1 ? '' : 's'}, and the local copy is present.`
        : `${targetLabel} is on Tower with ${versions.length} version${versions.length === 1 ? '' : 's'}, but the local copy is missing.`;
    } catch (error) {
      this.recordStatusError = error?.message || 'Failed to check record status on Tower.';
    } finally {
      this.recordStatusBusy = false;
    }
  },

  async forcePushRecordStatusTarget() {
    const familyId = String(this.recordStatusFamilyId || '').trim();
    const recordId = String(this.recordStatusTargetId || '').trim();
    const rawLocalRecord = this.getLocalStatusRecord(familyId, recordId);
    const localRecord = this.buildRecordStatusLocalRecord(rawLocalRecord, familyId, { bootstrap: true });
    if (!familyId || !recordId) {
      this.recordStatusError = 'Select a record first.';
      return;
    }
    if (!rawLocalRecord || !localRecord) {
      this.recordStatusError = 'No local record is available to push.';
      return;
    }
    if (!this.workspaceOwnerNpub || !this.session?.npub) {
      this.recordStatusError = 'Configure workspace sync first.';
      return;
    }

    const familyLabel = this.getRecordStatusFamilyLabel(familyId);
    const bootstrap = this.recordStatusTowerVersionCount === 0;
    const { version: submittedVersion } = this.getRecordStatusSubmitVersion(localRecord, { bootstrap });
    this.recordStatusSyncBusy = true;
    this.recordStatusError = null;
    try {
      const targetFamilyHash = getSyncFamily(familyId)?.hash || null;
      const relatedComments = bootstrap && targetFamilyHash
        ? await this.getRecordStatusRelatedComments(recordId, targetFamilyHash)
        : [];
      const relevantRecordIds = new Set([recordId, ...relatedComments.map((comment) => comment.record_id)]);
      const pendingWrites = (await this.getRecordStatusPendingWrites())
        .filter((row) => relevantRecordIds.has(row.record_id));
      const envelope = await this.buildRecordStatusEnvelope(localRecord, familyId, { bootstrap });
      const commentEnvelopes = [];
      const targetGroupIds = Array.isArray(localRecord.group_ids) ? [...localRecord.group_ids] : [];

      for (const comment of relatedComments
        .slice()
        .sort((left, right) => {
          if (left.parent_comment_id && !right.parent_comment_id) return 1;
          if (!left.parent_comment_id && right.parent_comment_id) return -1;
          return String(left.created_at || left.updated_at || '').localeCompare(String(right.created_at || right.updated_at || ''));
        })) {
        commentEnvelopes.push(await this.buildRecordStatusCommentEnvelope(comment, { targetGroupIds }));
      }

      await syncRecords({
        owner_npub: this.workspaceOwnerNpub,
        records: [envelope, ...commentEnvelopes],
      });
      for (const row of pendingWrites) {
        if (row?.row_id != null) await this.removeRecordStatusPendingWrite(row.row_id);
      }

      await this.markRecordStatusLocalRecordSynced(familyId, localRecord, { version: submittedVersion });
      await this.markRecordStatusCommentsSynced(relatedComments);
      await this.checkRecordStatusOnTower();
      if (!this.recordStatusError) {
        const commentSuffix = relatedComments.length > 0
          ? ` Recreated ${relatedComments.length} local ${relatedComments.length === 1 ? 'comment' : 'comments'} too.`
          : '';
        this.recordStatusNotice = pendingWrites.length > 0
          ? `Force-submitted the current local snapshot as ${familyLabel} version ${submittedVersion} and cleared ${pendingWrites.length} stale pending ${pendingWrites.length === 1 ? 'write' : 'writes'}.${commentSuffix}`
          : `Force-submitted the current local snapshot as ${familyLabel} version ${submittedVersion}.${commentSuffix}`;
      }
    } catch (error) {
      this.recordStatusError = error?.message || 'Failed to force push this record to Tower.';
    } finally {
      await this.refreshRecordStatusLocalContext();
      this.recordStatusSyncBusy = false;
    }
  },

  // --- sync quarantine ---

  get hasSyncQuarantine() {
    return this.syncQuarantine.length > 0;
  },

  syncQuarantineFamilyLabel(entry) {
    return getSyncFamily(entry?.family_id || entry?.family_hash)?.label || entry?.family_id || entry?.family_hash || 'Unknown family';
  },

  syncQuarantineRecordLabel(entry) {
    const recordId = String(entry?.record_id || '').trim();
    if (!recordId) return 'Unknown record';
    return recordId.length > 16 ? `${recordId.slice(0, 8)}…${recordId.slice(-4)}` : recordId;
  },

  formatSyncQuarantineTimestamp(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString();
  },

  async refreshSyncQuarantine() {
    this.syncQuarantine = await getSyncQuarantineEntries();
    return this.syncQuarantine;
  },

  // --- sync lifecycle ---

  getSyncCadenceMs() {
    if (!this.session?.npub || !this.backendUrl) return null;
    if (typeof document !== 'undefined' && document.hidden) return null;
    if (this.navSection === 'chat' && this.selectedChannelId) return this.FAST_SYNC_MS;
    if (this.navSection === 'docs') return this.FAST_SYNC_MS;
    if (this.navSection === 'tasks') return this.FAST_SYNC_MS;
    if (this.navSection === 'calendar') return this.FAST_SYNC_MS;
    if (this.navSection === 'schedules') return this.FAST_SYNC_MS;
    if (this.navSection === 'scopes') return this.FAST_SYNC_MS;
    return this.IDLE_SYNC_MS;
  },

  stopBackgroundSync() {
    if (this.backgroundSyncTimer) {
      clearTimeout(this.backgroundSyncTimer);
      this.backgroundSyncTimer = null;
    }
    if (this.visibilityHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
    stopWorkerFlushTimer();
  },

  scheduleBackgroundSync(delayMs = null) {
    if (this.backgroundSyncTimer) clearTimeout(this.backgroundSyncTimer);
    const cadence = delayMs ?? this.getSyncCadenceMs();
    if (!cadence) {
      this.backgroundSyncTimer = null;
      return;
    }
    this.backgroundSyncTimer = setTimeout(() => {
      this.backgroundSyncTimer = null;
      this.backgroundSyncTick();
    }, cadence);
  },

  ensureBackgroundSync(runSoon = false) {
    if (!this.visibilityHandler && typeof document !== 'undefined') {
      this.visibilityHandler = () => this.ensureBackgroundSync(true);
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }
    // Start the independent worker flush timer for low-latency outbox delivery
    if (this.session?.npub && this.backendUrl && this.workspaceOwnerNpub) {
      startWorkerFlushTimer(this.workspaceOwnerNpub, this.backendUrl, this.workspaceDbKey);
    }
    // Show catch-up overlay when data is stale:
    // - first sync ever (no lastSuccessAt)
    // - returning after a long break (10+ hours)
    // - SSE catch-up-required (handled separately via catchUpSyncActive = true)
    if (runSoon && this.session?.npub && this.backendUrl) {
      const STALE_THRESHOLD_MS = 10 * 60 * 60 * 1000; // 10 hours
      const lastSync = this.syncSession.lastSuccessAt;
      if (!lastSync || (Date.now() - lastSync) > STALE_THRESHOLD_MS) {
        this.catchUpSyncActive = true;
      }
    }
    this.scheduleBackgroundSync(runSoon ? 50 : null);
  },

  async backgroundSyncTick() {
    const cadence = this.getSyncCadenceMs();
    if (!cadence) return;

    if (this.backgroundSyncInFlight) {
      this.scheduleBackgroundSync(cadence);
      return;
    }

    this.backgroundSyncInFlight = true;
    try {
      await this.performSync({ silent: true });
      // checkForStaleness removed — heartbeat in runSync replaces it
      this.syncBackoffMs = 0;
    } catch (error) {
      this.syncBackoffMs = Math.min(Math.max((this.syncBackoffMs || 0) * 2, 1000), 30000);
      flightDeckLog('error', 'sync', 'background sync failed', {
        backendUrl: this.backendUrl || null,
        ownerNpub: this.workspaceOwnerNpub || null,
        error: error?.message || String(error),
        nextRetryMs: this.syncBackoffMs,
      });
    } finally {
      this.backgroundSyncInFlight = false;
      this.catchUpSyncActive = false;
      this.scheduleBackgroundSync(this.syncBackoffMs || null);
    }
  },

  // --- sync session UI ---

  updateSyncSession(updates) {
    Object.assign(this.syncSession, updates);
  },

  syncProgressLabel() {
    const s = this.syncSession;
    if (s.phase === 'idle' || s.phase === 'done') return '';
    if (s.phase === 'checking') return 'Checking...';
    if (s.phase === 'pushing') return `Pushing ${s.pushed} / ${s.pushTotal}`;
    if (s.phase === 'pulling') {
      if (s.heartbeat && s.totalFamilies === 0) return 'Up to date';
      const familyPart = s.currentFamily ? `Fetching ${s.currentFamily}` : 'Pulling';
      const suffix = s.heartbeat ? ' (heartbeat)' : '';
      return `${familyPart} (${s.completedFamilies} / ${s.totalFamilies} collections)${suffix}`;
    }
    if (s.phase === 'applying') return 'Applying...';
    if (s.phase === 'error') return 'Sync error';
    return '';
  },

  syncProgressPercent() {
    const s = this.syncSession;
    if (s.phase === 'pushing' && s.pushTotal > 0) return Math.round((s.pushed / s.pushTotal) * 50);
    if (s.phase === 'pulling' && s.totalFamilies > 0) return 50 + Math.round((s.completedFamilies / s.totalFamilies) * 45);
    if (s.phase === 'applying' || s.phase === 'done') return 100;
    if (s.phase === 'checking') return 5;
    return 0;
  },

  lastSyncTimeLabel() {
    const t = this.syncSession.lastSuccessAt;
    if (!t) return 'Never';
    const diff = Date.now() - t;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    return new Date(t).toLocaleTimeString();
  },

  // --- sync execution ---

  async performSync({ silent = false, showBusy = !silent } = {}) {
    if (!this.session?.npub || !this.backendUrl) {
      if (!silent) this.error = 'Configure settings first';
      return { pushed: 0, pulled: 0 };
    }

    if (!silent) this.error = null;
    if (showBusy) this.syncing = true;
    this.updateSyncSession({ state: 'syncing', phase: 'checking', startedAt: Date.now(), error: null, pushed: 0, pushTotal: 0, pulled: 0, completedFamilies: 0, totalFamilies: 0, currentFamily: null });
    flightDeckLog('info', 'sync', 'sync started', {
      silent,
      showBusy,
      backendUrl: this.backendUrl,
      ownerNpub: this.workspaceOwnerNpub || null,
      viewerNpub: this.session?.npub || null,
    });

    const onProgress = (update) => {
      this.updateSyncSession(update);
    };

    let result = null;
    let syncError = null;
    let refreshUnread = !silent;
    let refreshRecentChanges = !silent && this.navSection === 'status';

    try {
      await this.refreshGroups({
        minIntervalMs: silent ? this.BACKGROUND_GROUP_REFRESH_MS : 0,
      });
      if (
        !this.hasForcedInitialBackfill
        && this.groups.length > 0
        && this.channels.length === 0
        && this.messages.length === 0
        && this.documents.length === 0
        && this.directories.length === 0
        && this.tasks.length === 0
        && this.taskComments.length === 0
      ) {
        await clearSyncState();
        this.hasForcedInitialBackfill = true;
      }
      result = await runSync(this.workspaceOwnerNpub, this.session.npub, onProgress, {
        authMethod: this.session?.method || '',
        backendUrl: this.backendUrl,
        workspaceDbKey: this.workspaceDbKey,
      });
      const hasRemoteDataChanges = (result?.pulled ?? 0) > 0 || (result?.pruned ?? 0) > 0;
      refreshUnread = refreshUnread || hasRemoteDataChanges;
      refreshRecentChanges = refreshRecentChanges || (hasRemoteDataChanges && this.navSection === 'status');
      this.updateSyncSession({ phase: 'applying' });
      if (!silent || hasRemoteDataChanges) {
        await this.refreshWorkspaceSettings({ overwriteInput: !this.wingmanHarnessDirty });
        await this.ensureTaskFamilyBackfill();
        await this.ensureTaskBoardScopeSetup();
        if (this.docsEditorOpen && this.selectedDocId) {
          await this.loadDocComments(this.selectedDocId);
        }
      }
      this.updateSyncSession({ phase: 'done', finishedAt: Date.now(), lastSuccessAt: Date.now(), state: 'synced' });
    } catch (error) {
      syncError = error;
      if (!silent) this.error = error.message;
      this.updateSyncSession({ phase: 'error', state: 'error', error: error.message, finishedAt: Date.now() });
      flightDeckLog('error', 'sync', 'sync failed', {
        backendUrl: this.backendUrl,
        ownerNpub: this.workspaceOwnerNpub || null,
        error: error?.message || String(error),
      });
    } finally {
      if (showBusy) this.syncing = false;
      await this.refreshSyncStatus({ refreshUnread });
      if (refreshRecentChanges) {
        await this.refreshStatusRecentChanges({ hasNewData: true });
      }
    }

    if (syncError) throw syncError;

    flightDeckLog('info', 'sync', 'sync completed', {
      backendUrl: this.backendUrl,
      ownerNpub: this.workspaceOwnerNpub || null,
      pushed: result?.pushed ?? 0,
      pulled: result?.pulled ?? 0,
      syncStatus: this.syncStatus,
    });
    return result;
  },

  async syncNow() {
    try {
      await this.performSync({ silent: false });
    } catch (e) {
      // performSync already surfaced the error state
    }
    this.ensureBackgroundSync();
  },

  /**
   * Flush pending writes to Tower and schedule a background sync.
   * Much faster than performSync — does NOT heartbeat or pull, so the
   * caller returns almost immediately after the write reaches the server.
   * SSE + the next background tick handle inbound updates.
   */
  async flushAndBackgroundSync() {
    if (!this.session?.npub || !this.backendUrl) return { pushed: 0 };
    try {
      const result = await flushOnly(this.workspaceOwnerNpub, null, {
        backendUrl: this.backendUrl,
        workspaceDbKey: this.workspaceDbKey,
      });
      if ((result?.pushed ?? 0) > 0) {
        await this.refreshSyncStatus({ refreshUnread: false });
      }
      return result;
    } catch (error) {
      flightDeckLog('error', 'sync', 'flush-only failed, falling back to background sync', {
        error: error?.message || String(error),
      });
      return { pushed: 0 };
    } finally {
      this.ensureBackgroundSync(true);
    }
  },

  async refreshSyncStatus(options = {}) {
    const refreshUnread = options.refreshUnread !== false;
    if (this.syncing) {
      this.syncStatus = 'syncing';
      return;
    }
    const pending = await getPendingWrites();
    const quarantine = await this.refreshSyncQuarantine();
    if (pending.length > 0) {
      this.syncStatus = 'unsynced';
    } else if (quarantine.length > 0) {
      this.syncStatus = 'quarantined';
    } else if (this.syncSession.state === 'error') {
      this.syncStatus = 'error';
    } else {
      this.syncStatus = 'synced';
    }
    if (pending.length > 0) {
      flightDeckLog('debug', 'sync', 'pending writes remain after sync status refresh', {
        pendingCount: pending.length,
        pending: pending.slice(0, 10).map((row) => ({
          recordId: row.record_id,
          family: row.record_family_hash,
          createdAt: row.created_at,
        })),
      });
    }
    // Refresh unread indicators after sync status settles
    if (refreshUnread && typeof this.refreshUnreadFlags === 'function') {
      this.refreshUnreadFlags();
    }
  },

  // checkForStaleness removed — heartbeat-first sync in runSync replaces it

  // --- task family backfill ---

  async ensureTaskFamilyBackfill() {
    if (this.hasForcedTaskFamilyBackfill) return false;
    if (!this.session?.npub || !this.backendUrl || !this.workspaceOwnerNpub) return false;
    if (this.tasks.length > 0) return false;
    if (this.groups.length === 0) return false;
    if (this.scopes.length === 0 && !this.selectedBoardId) return false;

    this.hasForcedTaskFamilyBackfill = true;
    flightDeckLog('info', 'sync', 'forcing full task-family backfill on empty local task cache', {
      backendUrl: this.backendUrl,
      ownerNpub: this.workspaceOwnerNpub,
      scopesCount: this.scopes.length,
      selectedBoardId: this.selectedBoardId || null,
    });

    await clearSyncStateForFamilies(['task']);
    await this.pullFamiliesFromBackend(['task'], { forceFull: true });
    await this.refreshTasks();

    flightDeckLog('info', 'sync', 'task-family backfill completed', {
      ownerNpub: this.workspaceOwnerNpub,
      taskCount: this.tasks.length,
    });

    return true;
  },

  // --- repair / restore ---

  async restoreFamiliesFromSuperBased(familyIds, options = {}) {
    const dedupedFamilyIds = [...new Set((familyIds || []).filter(Boolean))];
    if (dedupedFamilyIds.length === 0) {
      throw new Error('Select at least one record family.');
    }

    const pending = await getPendingWritesByFamilies(dedupedFamilyIds);
    if (pending.length > 0) {
      const blockingFamilies = [...new Set(
        pending
          .map((row) => getSyncFamily(row.record_family_hash)?.label)
          .filter(Boolean)
      )];
      throw new Error(`Cannot restore while unsynced local changes exist in: ${blockingFamilies.join(', ')}. Sync or resolve them first.`);
    }

    if (options.confirm !== false && typeof window !== 'undefined') {
      const labels = dedupedFamilyIds.map((familyId) => getSyncFamily(familyId)?.label || familyId);
      const confirmed = window.confirm(`Restore ${labels.join(', ')} from SuperBased? This clears local cache for the selected families and rebuilds it from the backend.`);
      if (!confirmed) return { cancelled: true, restored: 0 };
    }

    await clearRuntimeFamilies(dedupedFamilyIds);
    await clearSyncStateForFamilies(dedupedFamilyIds);
    await clearSyncQuarantineForFamilies(dedupedFamilyIds);
    await this.pullFamiliesFromBackend(dedupedFamilyIds, { forceFull: true });
    await this.refreshStateForFamilies(dedupedFamilyIds);
    await this.refreshSyncQuarantine();
    return { cancelled: false, restored: dedupedFamilyIds.length };
  },

  async pullFamiliesFromBackend(familyIds, options = {}) {
    if (!this.session?.npub || !this.backendUrl || !this.workspaceOwnerNpub) {
      throw new Error('Configure settings first');
    }
    const hashes = getSyncFamilyHashes(familyIds);
    if (hashes.length === 0) return { pulled: 0 };
    return pullRecordsForFamilies(this.workspaceOwnerNpub, this.session.npub, hashes, {
      ...options,
      authMethod: this.session?.method || '',
      backendUrl: this.backendUrl,
      workspaceDbKey: this.workspaceDbKey,
    });
  },

  async refreshStateForFamilies(familyIds = []) {
    const selected = new Set(familyIds);
    if (selected.has('settings')) {
      await this.refreshWorkspaceSettings({ overwriteInput: !this.wingmanHarnessDirty });
    }
    if (selected.has('channel')) await this.refreshChannels();
    if (selected.has('chat_message')) await this.refreshMessages();
    if (selected.has('audio_note')) await this.refreshAudioNotes();
    if (selected.has('directory')) await this.refreshDirectories();
    if (selected.has('document')) await this.refreshDocuments();
    if (selected.has('task')) await this.refreshTasks();
    if (selected.has('schedule')) await this.refreshSchedules();
    if (selected.has('scope')) await this.refreshScopes();
    if (selected.has('task') || selected.has('scope')) await this.ensureTaskBoardScopeSetup();
    if (selected.has('comment') && this.activeTaskId) {
      await this.loadTaskComments(this.activeTaskId);
    }
    if ((selected.has('comment') || selected.has('audio_note')) && this.docsEditorOpen && this.selectedDocId) {
      await this.loadDocComments(this.selectedDocId);
    }
    await this.refreshStatusRecentChanges({ hasNewData: true, force: true });
    await this.refreshSyncStatus();
  },

  async restoreSelectedFamiliesFromSuperBased() {
    const familyIds = [...new Set(this.repairSelectedFamilyIds)];
    if (familyIds.length === 0) {
      this.repairError = 'Select at least one record family.';
      return;
    }

    this.repairError = null;
    this.repairNotice = '';

    this.repairBusy = true;
    try {
      const result = await this.restoreFamiliesFromSuperBased(familyIds);
      if (result.cancelled) return;
      this.repairNotice = `Restored ${result.restored} record ${result.restored === 1 ? 'family' : 'families'} from SuperBased.`;
    } catch (error) {
      this.repairError = error?.message || 'Failed to restore selected record families.';
    } finally {
      this.repairBusy = false;
    }
  },

  // --- quarantine actions ---

  async dismissSyncQuarantineIssue(entry) {
    this.syncQuarantineError = null;
    this.syncQuarantineNotice = '';
    this.syncQuarantineBusy = true;
    try {
      await deleteSyncQuarantineEntry(entry.family_hash, entry.record_id);
      await this.refreshSyncStatus();
      this.syncQuarantineNotice = `Dismissed quarantine issue for ${this.syncQuarantineRecordLabel(entry)}.`;
    } catch (error) {
      this.syncQuarantineError = error?.message || 'Failed to dismiss quarantine issue.';
    } finally {
      this.syncQuarantineBusy = false;
    }
  },

  async retrySyncQuarantineIssue(entry) {
    const familyId = getSyncFamily(entry?.family_id || entry?.family_hash)?.id;
    if (!familyId) {
      this.syncQuarantineError = 'Unknown sync family for this quarantine issue.';
      return;
    }

    this.syncQuarantineError = null;
    this.syncQuarantineNotice = '';
    this.syncQuarantineBusy = true;
    try {
      const result = await this.restoreFamiliesFromSuperBased([familyId], { confirm: false });
      if (result.cancelled) return;
      this.syncQuarantineNotice = `Rebuilt ${this.syncQuarantineFamilyLabel(entry)} from SuperBased.`;
    } catch (error) {
      this.syncQuarantineError = error?.message || 'Failed to retry quarantined family.';
    } finally {
      this.syncQuarantineBusy = false;
    }
  },

  async deleteLocalQuarantinedRecord(entry) {
    const family = getSyncFamily(entry?.family_id || entry?.family_hash);
    if (!family?.id) {
      this.syncQuarantineError = 'Unknown sync family for this quarantine issue.';
      return;
    }

    if (typeof window !== 'undefined') {
      const confirmed = window.confirm(`Delete local ${this.syncQuarantineFamilyLabel(entry)} record ${this.syncQuarantineRecordLabel(entry)}? This only affects browser state.`);
      if (!confirmed) return;
    }

    this.syncQuarantineError = null;
    this.syncQuarantineNotice = '';
    this.syncQuarantineBusy = true;
    try {
      await deleteRuntimeRecordByFamily(family.id, entry.record_id);
      await deleteSyncQuarantineEntry(entry.family_hash, entry.record_id);
      await this.refreshStateForFamilies([family.id]);
      await this.refreshSyncStatus();
      this.syncQuarantineNotice = `Deleted local ${this.syncQuarantineFamilyLabel(entry)} record ${this.syncQuarantineRecordLabel(entry)}.`;
    } catch (error) {
      this.syncQuarantineError = error?.message || 'Failed to delete local quarantined record.';
    } finally {
      this.syncQuarantineBusy = false;
    }
  },
};
