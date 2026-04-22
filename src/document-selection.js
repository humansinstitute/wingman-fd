export function applySelectedDocumentUpdate(store, document = null) {
  const recordId = String(store.selectedDocId || '').trim();
  if (!recordId) return;
  const nextDocuments = store.documents.filter((item) => item?.record_id !== recordId);
  if (document && document.record_state !== 'deleted') {
    nextDocuments.push(document);
  }
  store.applyDocuments(nextDocuments);
  if (!store.selectedDocument) {
    store.loadDocEditorFromSelection();
  }
}
