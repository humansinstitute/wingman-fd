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
import { fetchRecordHistory } from './api.js';
import { inboundDocument } from './translators/docs.js';
import { renderMarkdownToHtml } from './markdown.js';

// ---------------------------------------------------------------------------
// Pure utility functions (no `this` dependency)
// ---------------------------------------------------------------------------

export function normalizeDocShare(share, inheritedFromDirectoryId = null) {
  if (!share) return null;
  const type = share.type === 'person' ? 'person' : 'group';
  const personNpub = share.person_npub || null;
  const groupNpub = share.group_npub || null;
  const viaGroupNpub = share.via_group_npub || null;
  const key = share.key || (type === 'person'
    ? `person:${personNpub}`
    : `group:${groupNpub || viaGroupNpub}`);
  if (!key) return null;

  const sourceDirectoryId = inheritedFromDirectoryId || share.inherited_from_directory_id || null;
  return {
    ...share,
    type,
    key,
    access: share.access === 'write' ? 'write' : 'read',
    person_npub: personNpub,
    group_npub: groupNpub,
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
      group_npub: share.group_npub || null,
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
    ? (share.via_group_npub || share.group_npub)
    : share.group_npub).filter(Boolean))];
}

export function getDocCommentSummary(comment) {
  const words = String(comment?.body || '').trim().split(/\s+/).filter(Boolean);
  if (words.length <= 7) return words.join(' ');
  return `${words.slice(0, 7).join(' ')}…`;
}

// ---------------------------------------------------------------------------
// Mixin methods — use `this` (the Alpine store). Spread into the store.
// ---------------------------------------------------------------------------

export const docsManagerMixin = {
  openDoc(recordId, options = {}) {
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
    this.docCommentBackfillAttemptsByDocId = {};
    this.clearDocCommentConnector();
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
      await this.backfillDocCommentsFromBackend(this.selectedDocId, recordFamilyHash('document'));
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
    if (!Number.isFinite(startLine)) return [];
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

    const now = new Date().toISOString();
    const recordId = crypto.randomUUID();
    const { attachments } = await this.materializeAudioDrafts({
      drafts,
      target_record_id: recordId,
      target_record_family_hash: recordFamilyHash('comment'),
      target_group_ids: toRaw(doc?.group_ids ?? []),
      write_group_npub: doc?.group_ids?.[0] || null,
    });
    const localRow = {
      record_id: recordId,
      owner_npub: this.workspaceOwnerNpub,
      target_record_id: doc.record_id,
      target_record_family_hash: recordFamilyHash('document'),
      parent_comment_id: null,
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
      target_group_ids: toRaw(doc?.group_ids ?? []),
      signature_npub: this.session.npub,
      write_group_npub: doc?.group_ids?.[0] || null,
    });
    await addPendingWrite({
      record_id: recordId,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });
    this._fireMentionTriggers(body, `doc comment on "${doc.title}"`);
    await this.performSync({ silent: true });
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

    const now = new Date().toISOString();
    const recordId = crypto.randomUUID();
    const { attachments } = await this.materializeAudioDrafts({
      drafts,
      target_record_id: recordId,
      target_record_family_hash: recordFamilyHash('comment'),
      target_group_ids: toRaw(doc?.group_ids ?? []),
      write_group_npub: doc?.group_ids?.[0] || null,
    });
    const localRow = {
      record_id: recordId,
      owner_npub: this.workspaceOwnerNpub,
      target_record_id: doc.record_id,
      target_record_family_hash: recordFamilyHash('document'),
      parent_comment_id: root.record_id,
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
      target_group_ids: toRaw(doc?.group_ids ?? []),
      signature_npub: this.session.npub,
      write_group_npub: doc?.group_ids?.[0] || null,
    });
    await addPendingWrite({
      record_id: recordId,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });
    this._fireMentionTriggers(body, `doc comment reply on "${doc.title}"`);
    await this.performSync({ silent: true });
  },

  async setDocCommentStatus(commentId, nextStatus) {
    const comment = this.getDocCommentById(commentId);
    const doc = this.selectedDocument;
    if (!comment || !doc || !this.session?.npub) return;
    const status = nextStatus === 'resolved' ? 'resolved' : 'open';
    if ((comment.comment_status || 'open') === status) return;

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
      target_group_ids: toRaw(doc?.group_ids ?? []),
      signature_npub: this.session.npub,
      write_group_npub: doc?.group_ids?.[0] || null,
    });
    await addPendingWrite({
      record_id: updated.record_id,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });
    await this.performSync({ silent: true });
    if (status === 'resolved') {
      this.selectedDocCommentId = null;
      this.newDocCommentReplyBody = '';
      this.clearDocCommentConnector();
      this.syncRoute();
    }
  },

  getDocCommentSummary,

  setDocEditorMode(mode) {
    const nextMode = mode === 'source' ? 'source' : mode === 'block' ? 'block' : 'preview';
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
      this.setDocEditorMode('block');
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
    const groupNpub = share.group_npub || share.via_group_npub || '';
    const knownGroup = this.groups.find((group) => group.group_id === groupNpub || group.group_npub === groupNpub);
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
    this.newDocModalSubmitting = false;
  },

  closeNewDocModal() {
    this.newDocModalType = null;
    this.newDocModalTitle = '';
    this.newDocModalSubmitting = false;
  },

  async confirmNewDocModal() {
    const title = this.newDocModalTitle.trim();
    const modalType = this.newDocModalType;
    if (!title || !modalType || this.newDocModalSubmitting) return;
    this.newDocModalSubmitting = true;
    this.closeNewDocModal();
    try {
      if (modalType === 'folder') {
        await this.createDirectory(title);
      } else {
        await this.createDocument(title);
      }
    } finally {
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
        group_npub: suggestion.group_npub,
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
        const viaGroup = share.via_group_npub || await this.ensureDirectShareGroup(share.person_npub);
        shares.push({
          ...share,
          via_group_npub: viaGroup,
        });
      } else if (share.type === 'group' && share.group_npub) {
        shares.push({ ...share });
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

  getDefaultPrivateShares() {
    const groupNpub = this.memberPrivateGroupNpub;
    if (!groupNpub) return [];
    return [{
      type: 'group',
      key: groupNpub,
      access: 'write',
      label: this.memberPrivateGroup?.name || 'Private',
      person_npub: null,
      group_npub: groupNpub,
      via_group_npub: null,
      inherited: false,
      inherited_from_directory_id: null,
    }];
  },

  getShareGroupIds,

  async createDirectory(title = 'New directory') {
    const ownerNpub = this.workspaceOwnerNpub;
    if (!ownerNpub) {
      this.error = 'Sign in first';
      return;
    }

    const recordId = crypto.randomUUID();
    const now = new Date().toISOString();
    const row = {
      record_id: recordId,
      owner_npub: ownerNpub,
      title,
      parent_directory_id: this.getDefaultParentDirectoryId(),
      scope_id: null,
      scope_product_id: null,
      scope_project_id: null,
      scope_deliverable_id: null,
      shares: this.getInheritedDirectoryShares(this.getDefaultParentDirectoryId()),
      group_ids: [],
      sync_status: 'pending',
      record_state: 'active',
      version: 1,
      updated_at: now,
    };
    if (row.shares.length === 0) row.shares = this.getDefaultPrivateShares();
    row.group_ids = this.getShareGroupIds(row.shares);

    await upsertDirectory(row);
    this.patchDirectoryLocal(row);
    await addPendingWrite({
      record_id: recordId,
      record_family_hash: recordFamilyHash('directory'),
      envelope: await outboundDirectory({
        record_id: recordId,
        owner_npub: ownerNpub,
        title: row.title,
        parent_directory_id: row.parent_directory_id,
        scope_id: row.scope_id ?? null,
        scope_product_id: row.scope_product_id ?? null,
        scope_project_id: row.scope_project_id ?? null,
        scope_deliverable_id: row.scope_deliverable_id ?? null,
        shares: row.shares,
        signature_npub: this.session?.npub,
        write_group_npub: row.group_ids?.[0] || null,
      }),
    });

    await this.refreshDirectories();
    this.navigateToFolder(recordId);
    await this.performSync({ silent: false });
  },

  async createDocument(title = 'Untitled document') {
    const ownerNpub = this.workspaceOwnerNpub;
    if (!ownerNpub) {
      this.error = 'Sign in first';
      return;
    }

    const recordId = crypto.randomUUID();
    const now = new Date().toISOString();
    const row = {
      record_id: recordId,
      owner_npub: ownerNpub,
      title,
      content: '',
      parent_directory_id: this.getDefaultParentDirectoryId(),
      shares: this.getInheritedDirectoryShares(this.getDefaultParentDirectoryId()),
      group_ids: [],
      sync_status: 'pending',
      record_state: 'active',
      version: 1,
      updated_at: now,
    };
    if (row.shares.length === 0) row.shares = this.getDefaultPrivateShares();
    row.group_ids = this.getShareGroupIds(row.shares);

    await upsertDocument(row);
    this.patchDocumentLocal(row);
    await addPendingWrite({
      record_id: recordId,
      record_family_hash: recordFamilyHash('document'),
      envelope: await outboundDocument({
        record_id: recordId,
        owner_npub: ownerNpub,
        title: row.title,
        content: row.content,
        parent_directory_id: row.parent_directory_id,
        shares: row.shares,
        signature_npub: this.session?.npub,
        write_group_npub: row.group_ids?.[0] || null,
      }),
    });

    await this.refreshDocuments();
    this.openDoc(recordId);
    await this.performSync({ silent: false });
  },

  async saveSelectedDirectoryItem() {
    this.error = null;
    const item = this.activeDocShareTarget;
    const ownerNpub = this.workspaceOwnerNpub;
    if (!item || this.docShareTargetType !== 'directory' || !ownerNpub) {
      this.error = 'Select a folder first';
      return;
    }

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
    const updated = {
      ...item,
      shares,
      group_ids: this.getShareGroupIds(shares),
      sync_status: 'pending',
      version: nextVersion,
      updated_at: now,
    };

    await upsertDirectory(updated);
    this.patchDirectoryLocal(updated);
    await addPendingWrite({
      record_id: item.record_id,
      record_family_hash: recordFamilyHash('directory'),
      envelope: await outboundDirectory({
        record_id: item.record_id,
        owner_npub: ownerNpub,
        title: updated.title,
        parent_directory_id: updated.parent_directory_id,
        scope_id: updated.scope_id ?? null,
        scope_product_id: updated.scope_product_id ?? null,
        scope_project_id: updated.scope_project_id ?? null,
        scope_deliverable_id: updated.scope_deliverable_id ?? null,
        shares,
        version: nextVersion,
        previous_version: item.version ?? 1,
        signature_npub: this.session?.npub,
        write_group_npub: updated.group_ids?.[0] || null,
      }),
    });

    await this.performSync({ silent: false });
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
      const updated = {
        ...item,
        title: nextTitle,
        content: this.docEditorContent,
        shares,
        group_ids: this.getShareGroupIds(shares),
        sync_status: 'pending',
        version: nextVersion,
        updated_at: now,
      };
      await upsertDocument(updated);
      this.patchDocumentLocal(updated);
      await addPendingWrite({
        record_id: item.record_id,
        record_family_hash: recordFamilyHash('document'),
        envelope: await outboundDocument({
          record_id: item.record_id,
          owner_npub: ownerNpub,
          title: updated.title,
          content: updated.content,
          parent_directory_id: updated.parent_directory_id,
          scope_id: updated.scope_id ?? null,
          scope_product_id: updated.scope_product_id ?? null,
          scope_project_id: updated.scope_project_id ?? null,
          scope_deliverable_id: updated.scope_deliverable_id ?? null,
          shares,
          version: nextVersion,
          previous_version: item.version ?? 1,
          signature_npub: this.session?.npub,
          write_group_npub: updated.group_ids?.[0] || null,
        }),
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

      await this.performSync({ silent: autosave, showBusy: !autosave });
      await this.refreshDirectories();
      await this.refreshDocuments();
      this.docEditorSharesDirty = false;
      this.docAutosaveState = 'saved';
      this.ensureBackgroundSync(true);
      return updated;
    } catch (error) {
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
      const ownerNpub = this.workspaceOwnerNpub || this.userNpub;
      const result = await fetchRecordHistory({
        record_id: this.selectedDocId,
        owner_npub: ownerNpub,
        viewer_npub: this.userNpub,
      });
      const versions = Array.isArray(result.versions) ? result.versions : (Array.isArray(result) ? result : []);
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
        } catch {
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
      this.docVersioningError = error?.status === 404
        ? 'Version history not available for this document.'
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
    this.syncRoute();
  },

  selectDocVersion(index) {
    if (index < 0 || index >= this.docVersionHistory.length) return;
    this.docVersioningSelectedIndex = index;
    const ver = this.docVersionHistory[index];
    this.docVersioningPreviewHtml = renderMarkdownToHtml(ver.content || '');
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

  exportDocPDF() {
    const doc = this.selectedDocument;
    if (!doc) return;
    const title = this.docEditorTitle || doc.title || 'document';
    const content = this.docEditorContent || doc.content || '';
    const rendered = this.renderMarkdown(content);
    const printWindow = window.open('about:blank', '_blank');
    if (!printWindow) {
      this.error = 'Popup blocked — please allow popups for this site and try again.';
      return;
    }
    printWindow.document.write(`<!DOCTYPE html>
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
  @media print { body { margin: 0; } }
</style>
</head><body><h1>${title}</h1>${rendered}</body></html>`);
    printWindow.document.close();
    printWindow.onafterprint = () => printWindow.close();
    setTimeout(() => printWindow.print(), 300);
  },
};
