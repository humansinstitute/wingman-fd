/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Dynamic import so the module sees the jsdom globals
let initImageModal, openImageModal, closeImageModal, isImageModalOpen;

beforeEach(async () => {
  // Re-import fresh module each run to reset module-level state
  vi.resetModules();
  const mod = await import('../src/image-modal.js');
  initImageModal = mod.initImageModal;
  openImageModal = mod.openImageModal;
  closeImageModal = mod.closeImageModal;
  isImageModalOpen = mod.isImageModalOpen;
});

describe('image-modal', () => {
  let cleanup;

  beforeEach(() => {
    document.body.innerHTML = '';
    cleanup = initImageModal();
  });

  afterEach(() => {
    if (cleanup) cleanup();
    document.body.innerHTML = '';
  });

  it('initImageModal appends the overlay element to body', () => {
    const overlay = document.getElementById('image-preview-overlay');
    expect(overlay).toBeTruthy();
    expect(overlay.getAttribute('aria-hidden')).toBe('true');
  });

  it('openImageModal shows overlay with the given image src', () => {
    openImageModal('https://example.com/photo.png', 'A photo');
    const overlay = document.getElementById('image-preview-overlay');
    const img = overlay.querySelector('img');
    expect(overlay.getAttribute('aria-hidden')).toBe('false');
    expect(img.src).toBe('https://example.com/photo.png');
    expect(img.alt).toBe('A photo');
    expect(isImageModalOpen()).toBe(true);
  });

  it('closeImageModal hides the overlay', () => {
    openImageModal('https://example.com/photo.png', 'A photo');
    closeImageModal();
    const overlay = document.getElementById('image-preview-overlay');
    expect(overlay.getAttribute('aria-hidden')).toBe('true');
    expect(isImageModalOpen()).toBe(false);
  });

  it('clicking the overlay backdrop closes the modal', () => {
    openImageModal('https://example.com/photo.png', 'A photo');
    const overlay = document.getElementById('image-preview-overlay');
    overlay.click();
    expect(overlay.getAttribute('aria-hidden')).toBe('true');
  });

  it('pressing Escape closes the modal', () => {
    openImageModal('https://example.com/photo.png', 'A photo');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(isImageModalOpen()).toBe(false);
  });

  it('Escape does nothing when modal is already closed', () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(isImageModalOpen()).toBe(false);
  });

  it('clicking an md-storage-image inside the document opens the modal', () => {
    const container = document.createElement('div');
    container.innerHTML = '<span class="md-storage-image-wrap"><img class="md-storage-image" src="https://example.com/abc.png" alt="test image" /></span>';
    document.body.appendChild(container);

    const img = container.querySelector('img');
    img.click();

    expect(isImageModalOpen()).toBe(true);
    const overlay = document.getElementById('image-preview-overlay');
    const previewImg = overlay.querySelector('.image-preview-img');
    expect(previewImg.src).toBe('https://example.com/abc.png');
    expect(previewImg.alt).toBe('test image');
  });

  it('does not open modal for images without md-storage-image class', () => {
    const container = document.createElement('div');
    container.innerHTML = '<img class="other-image" src="https://example.com/x.png" alt="other" />';
    document.body.appendChild(container);

    const img = container.querySelector('img');
    img.click();

    expect(isImageModalOpen()).toBe(false);
  });

  it('does not open modal for pending storage images', () => {
    const container = document.createElement('div');
    container.innerHTML = '<span class="md-storage-image-wrap"><img class="md-storage-image md-storage-image-pending" data-storage-object-id="img-1" alt="loading" /></span>';
    document.body.appendChild(container);

    const img = container.querySelector('img');
    img.click();

    expect(isImageModalOpen()).toBe(false);
  });

  it('does not open modal for errored storage images', () => {
    const container = document.createElement('div');
    container.innerHTML = '<span class="md-storage-image-wrap"><img class="md-storage-image md-storage-image-error" alt="error" /></span>';
    document.body.appendChild(container);

    const img = container.querySelector('img');
    img.click();

    expect(isImageModalOpen()).toBe(false);
  });

  it('cleanup removes the overlay and listeners', () => {
    cleanup();
    cleanup = null;
    const overlay = document.getElementById('image-preview-overlay');
    expect(overlay).toBeNull();
  });
});
