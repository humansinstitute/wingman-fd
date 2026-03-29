# Image Modal: Chat & Thread Coverage

**Date:** 2026-03-29
**Task:** 38cd714b-3c44-4530-880b-da6b5500dded
**Scope:** d5713ab5-3274-4507-b675-a3ca21d02717

## Decision

Extend image modal test coverage to explicitly verify that clicking images in chat feed messages and thread replies opens the preview modal. No code changes were needed to `image-modal.js` itself — the existing document-level delegation already covers these contexts.

## Analysis

The image modal module (`src/image-modal.js`) attaches a single `document.addEventListener('click', ...)` handler that targets `img.md-storage-image` elements anywhere in the DOM tree. Since chat messages (line 1555 of `index.html`), thread parent messages (line 1678), and thread replies (line 1728) all render via `renderMarkdown()` which produces `md-storage-image` class images, the modal already works in these contexts.

No `@click.stop` or `event.stopPropagation()` exists on the chat content or thread content areas that would block event bubbling to the document listener.

## Files Changed

- `tests/image-modal.test.js` — added 6 tests covering chat feed, thread parent, thread reply, pending-in-chat, hydrated storage image in chat, and remote image in thread
- `tests/markdown.test.js` — added 3 tests verifying rendered markup for chat/thread image contexts
- `docs/log/image-modal-chat-thread.md` — this decision log

## Trade-offs

- No runtime code changes required — the delegation pattern chosen in the original implementation already generalizes to all rendering surfaces.
- Tests use realistic DOM structures matching `index.html` layout to catch regressions if the DOM structure changes.
