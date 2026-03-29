/**
 * Image preview modal for Flight Deck.
 *
 * Clicking a rendered markdown image (`.md-storage-image`) opens a larger
 * preview overlay. The overlay is dismissed by clicking the backdrop, pressing
 * Escape, or clicking the close button.
 */

let overlayEl = null;
let imgEl = null;
let captionEl = null;
let open = false;

// ---- public API -----------------------------------------------------------

export function isImageModalOpen() {
  return open;
}

export function openImageModal(src, alt) {
  if (!overlayEl) return;
  imgEl.src = src;
  imgEl.alt = alt || '';
  captionEl.textContent = alt || '';
  overlayEl.setAttribute('aria-hidden', 'false');
  open = true;
}

export function closeImageModal() {
  if (!overlayEl) return;
  overlayEl.setAttribute('aria-hidden', 'true');
  imgEl.src = '';
  imgEl.alt = '';
  captionEl.textContent = '';
  open = false;
}

// ---- event handlers -------------------------------------------------------

function onKeyDown(e) {
  if (e.key === 'Escape' && open) {
    closeImageModal();
  }
}

function onOverlayClick(e) {
  // Close when clicking backdrop or close button, but not the image itself
  if (e.target === overlayEl || e.target.classList.contains('image-preview-close')) {
    closeImageModal();
  }
}

function onDocumentClick(e) {
  const img = e.target.closest('img.md-storage-image');
  if (!img) return;
  // Skip images still loading or errored
  if (img.classList.contains('md-storage-image-pending')) return;
  if (img.classList.contains('md-storage-image-error')) return;
  // Need a real src to preview
  const src = img.src || img.currentSrc;
  if (!src) return;
  openImageModal(src, img.alt || '');
}

// ---- init / teardown ------------------------------------------------------

export function initImageModal() {
  if (typeof document === 'undefined') return () => {};

  // Build the overlay DOM
  overlayEl = document.createElement('div');
  overlayEl.id = 'image-preview-overlay';
  overlayEl.className = 'image-preview-overlay';
  overlayEl.setAttribute('aria-hidden', 'true');

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'image-preview-close';
  closeBtn.setAttribute('aria-label', 'Close preview');
  closeBtn.textContent = '\u00d7'; // ×

  imgEl = document.createElement('img');
  imgEl.className = 'image-preview-img';

  captionEl = document.createElement('span');
  captionEl.className = 'image-preview-caption';

  overlayEl.appendChild(closeBtn);
  overlayEl.appendChild(imgEl);
  overlayEl.appendChild(captionEl);
  document.body.appendChild(overlayEl);

  // Attach listeners
  overlayEl.addEventListener('click', onOverlayClick);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('click', onDocumentClick);

  // Return cleanup function
  return function cleanup() {
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('click', onDocumentClick);
    if (overlayEl && overlayEl.parentNode) {
      overlayEl.removeEventListener('click', onOverlayClick);
      overlayEl.parentNode.removeChild(overlayEl);
    }
    overlayEl = null;
    imgEl = null;
    captionEl = null;
    open = false;
  };
}
