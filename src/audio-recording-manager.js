/**
 * Audio recording and playback management methods extracted from app.js.
 *
 * The audioRecordingManagerMixin object contains methods that use `this` (the Alpine store)
 * and should be spread into the store definition.
 */

import {
  getAudioNotesByOwner,
  upsertAudioNote,
  addPendingWrite,
} from './db.js';
import {
  prepareStorageObject,
  uploadStorageObject,
  completeStorageObject,
  downloadStorageObject,
} from './api.js';
import { outboundAudioNote } from './translators/audio-notes.js';
import {
  buildStoragePrepareBody,
  normalizeStorageGroupIds as normalizeStorageAccessGroupIds,
} from './storage-payloads.js';
import { decryptAudioBytes, encryptAudioBlob, measureAudioDuration } from './audio-notes.js';
import { sameListBySignature } from './utils/state-helpers.js';

// ---------------------------------------------------------------------------
// Mixin — methods that use `this` (the Alpine store)
// ---------------------------------------------------------------------------

export const audioRecordingManagerMixin = {

  get audioNotesById() {
    return new Map(this.audioNotes.map((note) => [note.record_id, note]));
  },

  getAudioNote(recordId) {
    return this.audioNotesById.get(recordId) || null;
  },

  getAudioAttachmentNote(attachment) {
    const recordId = String(attachment?.audio_note_record_id || '').trim();
    if (!recordId) return null;
    return this.getAudioNote(recordId);
  },

  getAudioAttachmentPreview(attachment) {
    const note = this.getAudioAttachmentNote(attachment);
    if (note?.transcript_preview) return note.transcript_preview;
    if (note?.summary) return note.summary;
    if (note?.title) return note.title;
    return attachment?.title || 'Voice note';
  },

  formatAudioDuration(seconds) {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${mins}:${String(secs).padStart(2, '0')}`;
  },

  getAudioRecorderKindLabel(context = this.audioRecorderContext) {
    return context === 'chat' || context === 'thread' ? 'Chat' : 'Comment';
  },

  getAudioRecorderDefaultTitle(context = this.audioRecorderContext) {
    const label = this.getAudioRecorderKindLabel(context);
    const now = new Date();
    const date = now.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
    const time = now.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
    return `${label} Voice: ${date} - ${time}`;
  },

  getAudioDraftsForContext(context) {
    if (context === 'chat') return this.messageAudioDrafts;
    if (context === 'thread') return this.threadAudioDrafts;
    if (context === 'task-comment') return this.taskCommentAudioDrafts;
    if (context === 'doc-comment') return this.docCommentAudioDrafts;
    if (context === 'doc-reply') return this.docCommentReplyAudioDrafts;
    return [];
  },

  setAudioDraftsForContext(context, drafts) {
    if (context === 'chat') this.messageAudioDrafts = drafts;
    else if (context === 'thread') this.threadAudioDrafts = drafts;
    else if (context === 'task-comment') this.taskCommentAudioDrafts = drafts;
    else if (context === 'doc-comment') this.docCommentAudioDrafts = drafts;
    else if (context === 'doc-reply') this.docCommentReplyAudioDrafts = drafts;
  },

  async openAudioRecorder(context) {
    this.audioRecorderContext = context;
    this.audioRecorderState = 'idle';
    this.audioRecorderError = null;
    this.audioRecorderDurationSeconds = 0;
    this.audioRecorderStatusLabel = '';
    this.audioRecorderTitle = this.getAudioRecorderDefaultTitle(context);
    this.clearAudioRecorderPreview();
    this.showAudioRecorderModal = true;
    await Promise.resolve();
    await this.startAudioRecording();
  },

  async startAudioRecording() {
    this.audioRecorderError = null;
    this.audioRecorderStatusLabel = '';
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      this._audioRecorderChunks = [];
      this._audioRecorderStream = stream;
      this._audioRecorder = new MediaRecorder(stream, { mimeType });
      this._audioRecorderStartedAt = Date.now();
      this._audioRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) this._audioRecorderChunks.push(event.data);
      };
      this._audioRecorder.onerror = () => {
        this.audioRecorderError = 'Recording failed.';
        this.audioRecorderState = 'idle';
      };
      this._audioRecorder.start();
      this.audioRecorderState = 'recording';
      this.audioRecorderStatusLabel = 'Recording…';
    } catch (error) {
      this.audioRecorderError = error?.message || 'Could not access microphone.';
    }
  },

  async stopAudioRecording() {
    if (!this._audioRecorder || this.audioRecorderState !== 'recording') return;

    const recorder = this._audioRecorder;
    const stream = this._audioRecorderStream;

    this.audioRecorderState = 'processing';
    this.audioRecorderStatusLabel = 'Preparing recording…';

    await new Promise((resolve) => {
      recorder.onstop = resolve;
      recorder.stop();
    });
    stream?.getTracks?.().forEach((track) => track.stop());

    const mimeType = recorder.mimeType || 'audio/webm;codecs=opus';
    const blob = new Blob(this._audioRecorderChunks || [], { type: mimeType });
    this._audioRecorder = null;
    this._audioRecorderStream = null;
    this._audioRecorderChunks = [];

    const durationFromClock = Math.max(1, Math.round((Date.now() - (this._audioRecorderStartedAt || Date.now())) / 1000));
    const measured = await measureAudioDuration(blob);
    this.clearAudioRecorderPreview();
    this._audioRecorderBlob = blob;
    this.audioRecorderDurationSeconds = measured || durationFromClock;
    this.audioRecorderPreviewUrl = URL.createObjectURL(blob);
    await this.attachRecordedAudioDraft();
  },

  clearAudioRecorderPreview() {
    if (this.audioRecorderPreviewUrl) {
      URL.revokeObjectURL(this.audioRecorderPreviewUrl);
    }
    this.audioRecorderPreviewUrl = '';
    this._audioRecorderBlob = null;
  },

  closeAudioRecorder() {
    if (this._audioRecorder && this.audioRecorderState === 'recording') {
      try {
        this._audioRecorder.stop();
      } catch {}
    }
    this._audioRecorderStream?.getTracks?.().forEach((track) => track.stop());
    this._audioRecorder = null;
    this._audioRecorderStream = null;
    this._audioRecorderChunks = [];
    this.audioRecorderContext = null;
    this.audioRecorderState = 'idle';
    this.audioRecorderStatusLabel = '';
    this.audioRecorderError = null;
    this.audioRecorderDurationSeconds = 0;
    this.audioRecorderTitle = '';
    this.clearAudioRecorderPreview();
    this.showAudioRecorderModal = false;
  },

  async attachRecordedAudioDraft() {
    if (!this._audioRecorderBlob || !this.audioRecorderContext || !this.workspaceOwnerNpub) return;
    this.audioRecorderError = null;
    this.audioRecorderState = 'uploading';
    this.audioRecorderStatusLabel = 'Encrypting and uploading…';

    try {
      const encrypted = await encryptAudioBlob(this._audioRecorderBlob);
      const prepared = await prepareStorageObject(buildStoragePrepareBody({
        ownerNpub: this.workspaceOwnerNpub,
        accessGroupIds: this.getAudioRecorderStorageGroupIds(this.audioRecorderContext),
        contentType: this._audioRecorderBlob.type || 'audio/webm;codecs=opus',
        sizeBytes: encrypted.encryptedBytes.byteLength,
        fileName: `${(this.audioRecorderTitle || this.getAudioRecorderDefaultTitle()).replace(/[^a-zA-Z0-9._-]/g, '_')}.webm`,
      }));
      await uploadStorageObject(
        prepared,
        encrypted.encryptedBytes,
        this._audioRecorderBlob.type || 'audio/webm;codecs=opus',
      );
      await completeStorageObject(prepared.object_id, {
        size_bytes: encrypted.encryptedBytes.byteLength,
      });

      const draft = {
        draft_id: crypto.randomUUID(),
        kind: 'audio',
        title: this.audioRecorderTitle || 'Voice note',
        storage_object_id: prepared.object_id,
        mime_type: this._audioRecorderBlob.type || 'audio/webm;codecs=opus',
        duration_seconds: this.audioRecorderDurationSeconds || null,
        size_bytes: encrypted.encryptedBytes.byteLength,
        media_encryption: encrypted.mediaEncryption,
        transcript_status: 'pending',
        transcript_preview: null,
      };
      const nextDrafts = [...this.getAudioDraftsForContext(this.audioRecorderContext), draft];
      this.setAudioDraftsForContext(this.audioRecorderContext, nextDrafts);
      this.closeAudioRecorder();
    } catch (error) {
      this.audioRecorderError = error?.message || 'Failed to upload voice note.';
      this.audioRecorderState = 'ready';
      this.audioRecorderStatusLabel = 'Upload failed. Retry upload when ready.';
    }
  },

  removeAudioDraft(context, draftId) {
    this.setAudioDraftsForContext(
      context,
      this.getAudioDraftsForContext(context).filter((draft) => draft.draft_id !== draftId),
    );
  },

  async materializeAudioDrafts({ drafts = [], target_record_id = null, target_record_family_hash = null, target_group_ids = [], write_group_npub = null }) {
    const audioNotes = [];
    const attachments = [];

    for (const draft of drafts) {
      const recordId = crypto.randomUUID();
      const now = new Date().toISOString();
      const localRow = {
        record_id: recordId,
        owner_npub: this.workspaceOwnerNpub,
        target_record_id,
        target_record_family_hash,
        title: draft.title || 'Voice note',
        storage_object_id: draft.storage_object_id,
        mime_type: draft.mime_type || 'audio/webm;codecs=opus',
        duration_seconds: draft.duration_seconds ?? null,
        size_bytes: draft.size_bytes ?? 0,
        media_encryption: draft.media_encryption,
        waveform_preview: draft.waveform_preview || [],
        transcript_status: draft.transcript_status || 'pending',
        transcript_preview: draft.transcript_preview || null,
        transcript: null,
        summary: null,
        sender_npub: this.session?.npub,
        group_ids: [...target_group_ids],
        sync_status: 'pending',
        record_state: 'active',
        version: 1,
        created_at: now,
        updated_at: now,
      };
      await upsertAudioNote(localRow);
      audioNotes.push(localRow);
      attachments.push({
        kind: 'audio',
        audio_note_record_id: recordId,
        title: localRow.title,
        duration_seconds: localRow.duration_seconds,
      });

      const envelope = await outboundAudioNote({
        ...localRow,
        target_group_ids,
        signature_npub: this.signingNpub,
        write_group_npub,
      });
      await addPendingWrite({
        record_id: recordId,
        record_family_hash: envelope.record_family_hash,
        envelope,
      });
    }

    if (audioNotes.length > 0) {
      this.audioNotes = [...this.audioNotes, ...audioNotes]
        .sort((a, b) => String(a.updated_at || '').localeCompare(String(b.updated_at || '')));
    }

    return { audioNotes, attachments };
  },

  async playAudioAttachment(attachment) {
    const note = this.getAudioAttachmentNote(attachment);
    if (!note?.storage_object_id || !note?.media_encryption) return;
    try {
      const encryptedBytes = await downloadStorageObject(note.storage_object_id);
      const blob = await decryptAudioBytes(encryptedBytes, note.media_encryption, note.mime_type);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      audio.onerror = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch (error) {
      this.error = error?.message || 'Could not play voice note.';
    }
  },

  async applyAudioNotes(audioNotes = []) {
    const nextAudioNotes = Array.isArray(audioNotes) ? audioNotes : [];
    if (!sameListBySignature(this.audioNotes, nextAudioNotes, (note) => [
      String(note?.record_id || ''),
      String(note?.updated_at || ''),
      String(note?.version ?? ''),
      String(note?.record_state || ''),
      String(note?.transcript_status || ''),
    ].join('|'))) {
      this.audioNotes = nextAudioNotes;
    }

    for (const note of nextAudioNotes) {
      await this.rememberPeople([note.sender_npub], 'audio-note');
    }
  },

  async refreshAudioNotes() {
    const ownerNpub = this.workspaceOwnerNpub;
    if (!ownerNpub) return;
    await this.applyAudioNotes(await getAudioNotesByOwner(ownerNpub));
  },

  getAudioRecorderStorageGroupIds(context = this.audioRecorderContext) {
    if (context === 'chat' || context === 'thread') {
      return normalizeStorageAccessGroupIds(this.selectedChannel?.group_ids ?? []);
    }
    if (context === 'task-comment') {
      return normalizeStorageAccessGroupIds(this.editingTask?.group_ids ?? []);
    }
    if (context === 'doc-comment' || context === 'doc-reply') {
      return normalizeStorageAccessGroupIds(this.selectedDocument?.group_ids ?? []);
    }
    return [];
  },
};
