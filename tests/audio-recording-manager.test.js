import { describe, expect, it } from 'vitest';

import { audioRecordingManagerMixin } from '../src/audio-recording-manager.js';

function createStore(overrides = {}) {
  return Object.assign(Object.create(audioRecordingManagerMixin), {
    audioNotes: [],
    ...overrides,
  });
}

describe('audioRecordingManagerMixin', () => {
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

  it('falls back to selected document groups when the doc comment filter is unavailable', () => {
    const store = createStore({
      selectedDocument: {
        record_id: 'doc-1',
        group_ids: ['group-a', 'group-b'],
      },
    });

    expect(store.getAudioRecorderStorageGroupIds('doc-comment')).toEqual(['group-a', 'group-b']);
  });
});
