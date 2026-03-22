/**
 * Storage image hydration and caching methods extracted from app.js.
 *
 * The storageImageManagerMixin object contains methods that use `this` (the Alpine store)
 * and should be spread into the store definition.
 */

import Alpine from 'alpinejs';
import {
  getCachedStorageImage,
  cacheStorageImage,
} from './db.js';
import { downloadStorageObjectBlob } from './api.js';
import { storageImageCacheKey } from './utils/state-helpers.js';

// ---------------------------------------------------------------------------
// Mixin — methods that use `this` (the Alpine store)
// ---------------------------------------------------------------------------

export const storageImageManagerMixin = {

  scheduleStorageImageHydration() {
    if (this._storageImageHydrateScheduled || typeof window === 'undefined') return;
    this._storageImageHydrateScheduled = true;
    window.requestAnimationFrame(() => {
      this._storageImageHydrateScheduled = false;
      this.hydrateStorageImages();
      this.scheduleChatPreviewMeasurement();
    });
  },

  revokeStorageImageObjectUrls() {
    for (const url of Object.values(this.storageImageUrlCache || {})) {
      if (typeof url === 'string' && url.startsWith('blob:')) URL.revokeObjectURL(url);
    }
    this.storageImageUrlCache = {};
    this.storageImageLoadPromises = {};
  },

  rememberStorageImageUrl(cacheKey, url) {
    const previous = this.storageImageUrlCache?.[cacheKey];
    if (previous && previous !== url && previous.startsWith('blob:')) {
      URL.revokeObjectURL(previous);
    }
    this.storageImageUrlCache = {
      ...(this.storageImageUrlCache || {}),
      [cacheKey]: url,
    };
    return url;
  },

  async resolveStorageImageUrl(objectId, options = {}) {
    const backendUrl = String(options?.backendUrl || '').trim();
    const cacheKey = storageImageCacheKey(objectId, backendUrl);
    const existing = this.storageImageUrlCache?.[cacheKey];
    if (existing) return existing;

    const pending = this.storageImageLoadPromises?.[cacheKey];
    if (pending) return pending;

    const loadPromise = (async () => {
      let cached = await getCachedStorageImage(cacheKey);
      if (!cached && cacheKey !== objectId) {
        cached = await getCachedStorageImage(objectId);
        if (cached?.blob instanceof Blob && cached.blob.size > 0) {
          await cacheStorageImage({
            object_id: cacheKey,
            blob: cached.blob,
            content_type: cached.content_type || 'application/octet-stream',
          });
        }
      }
      if (cached?.blob instanceof Blob && cached.blob.size > 0) {
        return this.rememberStorageImageUrl(cacheKey, URL.createObjectURL(cached.blob));
      }

      const blob = await downloadStorageObjectBlob(objectId, { backendUrl });
      if (!(blob instanceof Blob) || blob.size === 0) {
        throw new Error(`No image data returned for ${objectId}`);
      }
      await cacheStorageImage({
        object_id: cacheKey,
        blob,
        content_type: blob.type || 'application/octet-stream',
      });
      return this.rememberStorageImageUrl(cacheKey, URL.createObjectURL(blob));
    })();

    this.storageImageLoadPromises = {
      ...(this.storageImageLoadPromises || {}),
      [cacheKey]: loadPromise,
    };

    try {
      return await loadPromise;
    } finally {
      const next = { ...(this.storageImageLoadPromises || {}) };
      delete next[cacheKey];
      this.storageImageLoadPromises = next;
    }
  },

  hydrateStorageImages() {
    if (typeof document === 'undefined') return;
    const images = [...document.querySelectorAll('img[data-storage-object-id]')];
    for (const image of images) {
      const objectId = String(image.dataset.storageObjectId || '').trim();
      if (!objectId || image.dataset.storageResolved === 'true') continue;
      image.dataset.storageResolved = 'pending';
      this.resolveStorageImageUrl(objectId)
        .then((url) => {
          const chatFeedAnchor = this.captureScrollAnchor({
            containerSelector: '[data-chat-feed]',
            itemSelector: '[data-message-id]',
            itemAttribute: 'data-message-id',
          });
          const threadRepliesAnchor = this.captureScrollAnchor({
            containerSelector: '[data-thread-replies]',
            itemSelector: '[data-thread-message-id]',
            itemAttribute: 'data-thread-message-id',
          });
          image.src = url;
          image.dataset.storageResolved = 'true';
          image.classList.remove('md-storage-image-pending');
          this.scheduleChatPreviewMeasurement();
          this.restoreScrollAnchor(chatFeedAnchor);
          this.restoreScrollAnchor(threadRepliesAnchor);
        })
        .catch(() => {
          const chatFeedAnchor = this.captureScrollAnchor({
            containerSelector: '[data-chat-feed]',
            itemSelector: '[data-message-id]',
            itemAttribute: 'data-message-id',
          });
          const threadRepliesAnchor = this.captureScrollAnchor({
            containerSelector: '[data-thread-replies]',
            itemSelector: '[data-thread-message-id]',
            itemAttribute: 'data-thread-message-id',
          });
          image.dataset.storageResolved = 'error';
          image.classList.add('md-storage-image-error');
          this.scheduleChatPreviewMeasurement();
          this.restoreScrollAnchor(chatFeedAnchor);
          this.restoreScrollAnchor(threadRepliesAnchor);
        });
    }
  },

  captureScrollAnchor({ containerSelector, itemSelector, itemAttribute }) {
    if (typeof document === 'undefined') return null;
    const container = document.querySelector(containerSelector);
    if (!container) return null;

    const containerRect = container.getBoundingClientRect();
    const items = [...container.querySelectorAll(itemSelector)];
    const anchorItem = items.find((item) => item.getBoundingClientRect().bottom > containerRect.top + 1) || null;

    return {
      containerSelector,
      itemSelector,
      itemAttribute,
      itemId: anchorItem?.getAttribute(itemAttribute) || '',
      offsetTop: anchorItem ? anchorItem.getBoundingClientRect().top - containerRect.top : 0,
      atBottom: (container.scrollHeight - container.clientHeight - container.scrollTop) <= 8,
    };
  },

  restoreScrollAnchor(anchor) {
    if (!anchor || typeof window === 'undefined' || typeof document === 'undefined') return;
    Alpine.nextTick(() => {
      window.requestAnimationFrame(() => {
        const container = document.querySelector(anchor.containerSelector);
        if (!container) return;

        if (anchor.atBottom) {
          container.scrollTop = container.scrollHeight;
          return;
        }

        if (!anchor.itemId) return;

        const item = [...container.querySelectorAll(anchor.itemSelector)]
          .find((candidate) => candidate.getAttribute(anchor.itemAttribute) === anchor.itemId);
        if (!item) return;

        const containerRect = container.getBoundingClientRect();
        const itemRect = item.getBoundingClientRect();
        container.scrollTop += (itemRect.top - containerRect.top) - anchor.offsetTop;
      });
    });
  },
};
