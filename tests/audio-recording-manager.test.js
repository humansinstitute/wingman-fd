import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAudioNotesByOwner: vi.fn(),
  upsertAudioNote: vi.fn(),
  addPendingWrite: vi.fn(),
  prepareStorageObject: vi.fn(),
  uploadStorageObject: vi.fn(),
  completeStorageObject: vi.fn(),
  downloadStorageObject: vi.fn(),
  outboundAudioNote: vi.fn(),
  encryptAudioBlob: vi.fn(),
  decryptAudioBytes: vi.fn(),
  measureAudioDuration: vi.fn(),
  hasGroupKey: vi.fn(),
}));

vi.mock('../src/db.js', () => ({
  getAudioNotesByOwner: mocks.getAudioNotesByOwner,
  upsertAudioNote: mocks.upsertAudioNote,
  addPendingWrite: mocks.addPendingWrite,
}));

vi.mock('../src/api.js', () => ({
  prepareStorageObject: mocks.prepareStorageObject,
  uploadStorageObject: mocks.uploadStorageObject,
  completeStorageObject: mocks.completeStorageObject,
  downloadStorageObject: mocks.downloadStorageObject,
}));

vi.mock('../src/translators/audio-notes.js', () => ({
  outboundAudioNote: mocks.outboundAudioNote,
}));

vi.mock('../src/audio-notes.js', () => ({
  encryptAudioBlob: mocks.encryptAudioBlob,
  decryptAudioBytes: mocks.decryptAudioBytes,
  measureAudioDuration: mocks.measureAudioDuration,
}));

vi.mock('../src/crypto/group-keys.js', () => ({
  hasGroupKey: mocks.hasGroupKey,
}));

import { audioRecordingManagerMixin } from '../src/audio-recording-manager.js';

function createStore(overrides = {}) {
  return Object.assign(Object.create(audioRecordingManagerMixin), {
    audioNotes: [],
    error: null,
    resolveGroupId: (value) => String(value || '').trim() || null,
    ...overrides,
  });
}

describe('audioRecordingManagerMixin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasGroupKey.mockImplementation((groupId) => String(groupId || '').startsWith('shared'));
    mocks.encryptAudioBlob.mockResolvedValue({
      encryptedBytes: new Uint8Array([1, 2, 3]),
      mediaEncryption: { scheme: 'aes-gcm', key_b64: 'key', iv_b64: 'iv' },
    });
    mocks.prepareStorageObject.mockResolvedValue({ object_id: 'storage-1' });
    mocks.outboundAudioNote.mockImplementation(async (payload) => ({
      record_id: payload.record_id,
      owner_npub: payload.owner_npub,
      record_family_hash: 'app:audio_note',
      write_group_id: payload.write_group_ref,
      group_payloads: payload.target_group_ids.map((group_id) => ({ group_id })),
      payload,
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the document comment encryptable group subset for storage upload access', () => {
    const store = createStore({
      selectedDocument: {
        record_id: 'doc-1',
        group_ids: ['group-readable', 'group-inaccessible'],
      },
      getEncryptableDocCommentGroupIds: () => ['group-readable'],
    });

    expect(store.getAudioRecorderStorageGroupIds('doc-comment')).toEqual(['group-readable']);
    expect(store.getAudioRecorderStorageGroupIds('doc-reply')).toEqual(['group-readable']);
  });

  it('blocks doc comment audio storage upload when comment group keys are incomplete', () => {
    const store = createStore({
      selectedDocument: {
        record_id: 'doc-1',
        group_ids: ['group-readable', 'group-inaccessible'],
      },
      getEncryptableDocCommentGroupIds: () => null,
    });

    expect(store.getAudioRecorderStorageGroupIds('doc-comment')).toBeNull();
  });

  it('falls back to selected document groups when the doc comment filter is unavailable', () => {
    const store = createStore({
      selectedDocument: {
        record_id: 'doc-1',
        group_ids: ['group-a', 'group-b'],
      },
    });

    expect(store.getAudioRecorderStorageGroupIds('doc-comment')).toEqual(['group-a', 'group-b']);
  });

  it('uses the active task when recording a task comment in read mode', () => {
    const store = createStore({
      activeTaskId: 'task-1',
      editingTask: null,
      tasks: [{
        record_id: 'task-1',
        group_ids: ['shared-task', 'private-task'],
      }],
    });

    expect(store.getAudioRecorderStorageGroupIds('task-comment')).toEqual(['shared-task']);
  });

  it('uploads chat voice-note storage to the same encryptable group subset used by group members', async () => {
    const store = createStore({
      workspaceOwnerNpub: 'npub-workspace',
      audioRecorderContext: 'chat',
      audioRecorderTitle: 'Team voice note',
      audioRecorderDurationSeconds: 12,
      messageAudioDrafts: [],
      selectedChannel: {
        record_id: 'channel-1',
        group_ids: ['shared-channel', 'private-channel'],
      },
      _audioRecorderBlob: new Blob(['voice'], { type: 'audio/webm;codecs=opus' }),
    });

    await store.attachRecordedAudioDraft();

    expect(mocks.prepareStorageObject).toHaveBeenCalledWith(expect.objectContaining({
      owner_npub: 'npub-workspace',
      owner_group_id: 'shared-channel',
      access_group_ids: ['shared-channel'],
      content_type: 'audio/webm;codecs=opus',
      size_bytes: 3,
    }));
    expect(mocks.uploadStorageObject).toHaveBeenCalledWith(
      { object_id: 'storage-1' },
      new Uint8Array([1, 2, 3]),
      'audio/webm;codecs=opus',
    );
    expect(mocks.completeStorageObject).toHaveBeenCalledWith('storage-1', { size_bytes: 3 });
    expect(store.messageAudioDrafts).toHaveLength(1);
    expect(store.messageAudioDrafts[0]).toMatchObject({
      kind: 'audio',
      title: 'Team voice note',
      storage_object_id: 'storage-1',
      media_encryption: { scheme: 'aes-gcm', key_b64: 'key', iv_b64: 'iv' },
    });
  });

  it('materializes audio notes with matching group payload and storage access assumptions', async () => {
    const store = createStore({
      workspaceOwnerNpub: 'npub-workspace',
      signingNpub: 'npub-signer',
      session: { npub: 'npub-user' },
      audioNotes: [],
      currentWorkspaceContentGroups: [
        { group_id: 'shared-channel', member_npubs: ['npub-user'] },
        { group_id: 'private-channel', private_member_npub: 'npub-other' },
      ],
    });

    const result = await store.materializeAudioDrafts({
      drafts: [{
        title: 'Team voice note',
        storage_object_id: 'storage-1',
        mime_type: 'audio/webm;codecs=opus',
        duration_seconds: 12,
        size_bytes: 3,
        media_encryption: { scheme: 'aes-gcm', key_b64: 'key', iv_b64: 'iv' },
      }],
      target_record_id: 'message-1',
      target_record_family_hash: 'app:chat_message',
      target_group_ids: ['shared-channel', 'private-channel'],
      write_group_ref: 'shared-channel',
    });

    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]).toMatchObject({
      kind: 'audio',
      title: 'Team voice note',
      duration_seconds: 12,
    });
    expect(mocks.upsertAudioNote).toHaveBeenCalledWith(expect.objectContaining({
      owner_npub: 'npub-workspace',
      target_record_id: 'message-1',
      target_record_family_hash: 'app:chat_message',
      group_ids: ['shared-channel'],
      sender_npub: 'npub-user',
      storage_object_id: 'storage-1',
    }));
    expect(mocks.outboundAudioNote).toHaveBeenCalledWith(expect.objectContaining({
      owner_npub: 'npub-workspace',
      target_record_id: 'message-1',
      target_record_family_hash: 'app:chat_message',
      target_group_ids: ['shared-channel'],
      signature_npub: 'npub-signer',
      write_group_ref: 'shared-channel',
    }));
    expect(mocks.addPendingWrite).toHaveBeenCalledWith(expect.objectContaining({
      record_family_hash: 'app:audio_note',
      envelope: expect.objectContaining({
        group_payloads: [{ group_id: 'shared-channel' }],
      }),
    }));
  });

  it('plays a group-visible voice note by downloading and decrypting the stored object', async () => {
    const play = vi.fn().mockResolvedValue(undefined);
    const createObjectURL = vi.fn(() => 'blob:voice-note');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('Audio', vi.fn(() => ({ play })));
    vi.stubGlobal('URL', {
      ...globalThis.URL,
      createObjectURL,
      revokeObjectURL,
    });
    const encryptedBytes = new Uint8Array([9, 8, 7]);
    const decryptedBlob = new Blob(['voice'], { type: 'audio/webm;codecs=opus' });
    mocks.downloadStorageObject.mockResolvedValue(encryptedBytes);
    mocks.decryptAudioBytes.mockResolvedValue(decryptedBlob);

    const store = createStore({
      audioNotes: [{
        record_id: 'audio-1',
        storage_object_id: 'storage-1',
        media_encryption: { scheme: 'aes-gcm', key_b64: 'key', iv_b64: 'iv' },
        mime_type: 'audio/webm;codecs=opus',
      }],
    });

    await store.playAudioAttachment({ kind: 'audio', audio_note_record_id: 'audio-1' });

    expect(mocks.downloadStorageObject).toHaveBeenCalledWith('storage-1');
    expect(mocks.decryptAudioBytes).toHaveBeenCalledWith(
      encryptedBytes,
      { scheme: 'aes-gcm', key_b64: 'key', iv_b64: 'iv' },
      'audio/webm;codecs=opus',
    );
    expect(createObjectURL).toHaveBeenCalledWith(decryptedBlob);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('refreshes audio notes before playback when the synced comment attachment arrives first', async () => {
    const play = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('Audio', vi.fn(() => ({ play })));
    vi.stubGlobal('URL', {
      ...globalThis.URL,
      createObjectURL: vi.fn(() => 'blob:voice-note'),
      revokeObjectURL: vi.fn(),
    });
    mocks.downloadStorageObject.mockResolvedValue(new Uint8Array([9, 8, 7]));
    mocks.decryptAudioBytes.mockResolvedValue(new Blob(['voice'], { type: 'audio/webm;codecs=opus' }));
    const store = createStore({
      audioNotes: [],
      refreshAudioNotes: vi.fn(async function refreshAudioNotes() {
        this.audioNotes = [{
          record_id: 'audio-after-refresh',
          storage_object_id: 'storage-after-refresh',
          media_encryption: { scheme: 'aes-gcm', key_b64: 'key', iv_b64: 'iv' },
          mime_type: 'audio/webm;codecs=opus',
        }];
      }),
    });

    await store.playAudioAttachment({ kind: 'audio', audio_note_record_id: 'audio-after-refresh' });

    expect(store.refreshAudioNotes).toHaveBeenCalledTimes(1);
    expect(mocks.downloadStorageObject).toHaveBeenCalledWith('storage-after-refresh');
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('force-pulls audio notes before playback when the note is still missing after refresh', async () => {
    const play = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('Audio', vi.fn(() => ({ play })));
    vi.stubGlobal('URL', {
      ...globalThis.URL,
      createObjectURL: vi.fn(() => 'blob:voice-note'),
      revokeObjectURL: vi.fn(),
    });
    mocks.downloadStorageObject.mockResolvedValue(new Uint8Array([9, 8, 7]));
    mocks.decryptAudioBytes.mockResolvedValue(new Blob(['voice'], { type: 'audio/webm;codecs=opus' }));
    const store = createStore({
      audioNotes: [],
      refreshAudioNotes: vi.fn(async function refreshAudioNotes() {
        if (this._audioNotePulled) {
          this.audioNotes = [{
            record_id: 'audio-after-pull',
            storage_object_id: 'storage-after-pull',
            media_encryption: { scheme: 'aes-gcm', key_b64: 'key', iv_b64: 'iv' },
            mime_type: 'audio/webm;codecs=opus',
          }];
        }
      }),
      pullFamiliesFromBackend: vi.fn(async function pullFamiliesFromBackend() {
        this._audioNotePulled = true;
      }),
    });

    await store.playAudioAttachment({ kind: 'audio', audio_note_record_id: 'audio-after-pull' });

    expect(store.refreshAudioNotes).toHaveBeenCalledTimes(2);
    expect(store.pullFamiliesFromBackend).toHaveBeenCalledWith(['audio_note'], { forceFull: true });
    expect(mocks.downloadStorageObject).toHaveBeenCalledWith('storage-after-pull');
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('reports unavailable audio when the attachment note is not present locally or remotely', async () => {
    const store = createStore({
      audioNotes: [],
      refreshAudioNotes: vi.fn().mockResolvedValue(undefined),
      pullFamiliesFromBackend: vi.fn().mockResolvedValue(undefined),
    });

    await store.playAudioAttachment({ kind: 'audio', audio_note_record_id: 'missing-audio' });

    expect(store.refreshAudioNotes).toHaveBeenCalledTimes(2);
    expect(store.pullFamiliesFromBackend).toHaveBeenCalledWith(['audio_note'], { forceFull: true });
    expect(mocks.downloadStorageObject).not.toHaveBeenCalled();
    expect(store.error).toBe('Voice note is not available yet. Sync audio notes and try again.');
  });
});
