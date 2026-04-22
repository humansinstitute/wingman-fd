import { describe, expect, it, vi } from 'vitest';
import { applySelectedDocumentUpdate } from '../src/document-selection.js';

function createStore(overrides = {}) {
  const store = {
    selectedDocId: 'doc-1',
    documents: [{
      record_id: 'doc-1',
      record_state: 'active',
      title: 'Original title',
    }],
    applyDocuments: vi.fn((documents) => {
      store.documents = documents;
    }),
    loadDocEditorFromSelection: vi.fn(),
    ...overrides,
  };

  Object.defineProperty(store, 'selectedDocument', {
    configurable: true,
    get() {
      return this.documents.find((item) => item.record_id === this.selectedDocId) ?? null;
    },
  });

  return store;
}

describe('applySelectedDocumentUpdate', () => {
  it('keeps the editor state intact when the selected doc refreshes in place', () => {
    const store = createStore();

    applySelectedDocumentUpdate(store, {
      record_id: 'doc-1',
      record_state: 'active',
      title: 'Updated title',
    });

    expect(store.applyDocuments).toHaveBeenCalledTimes(1);
    expect(store.selectedDocument?.title).toBe('Updated title');
    expect(store.loadDocEditorFromSelection).not.toHaveBeenCalled();
  });

  it('resets the editor when the selected doc disappears', () => {
    const store = createStore();

    applySelectedDocumentUpdate(store, {
      record_id: 'doc-1',
      record_state: 'deleted',
      title: 'Deleted title',
    });

    expect(store.applyDocuments).toHaveBeenCalledTimes(1);
    expect(store.selectedDocument).toBeNull();
    expect(store.loadDocEditorFromSelection).toHaveBeenCalledTimes(1);
  });
});
