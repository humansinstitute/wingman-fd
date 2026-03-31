# PDF Export: Render Markdown Images

## Decision

Add image hydration to the document PDF export flow so that storage-backed
(`storage://…`) images resolve to actual URLs before the print window opens,
rather than being dropped as broken images.

## Context

`exportDocPDF()` renders markdown to HTML via `renderMarkdownToHtml`, which
outputs storage images as `<img data-storage-object-id="…">` with no `src`.
In the normal browser flow, `hydrateStorageImages()` (DOM-based, in
`storage-image-manager.js`) resolves these after render. The print window
never ran that hydration step, so storage images were invisible in exports.

## Approach

- Introduced a **pure async function** `hydrateStorageImageMarkup(html, resolverFn)`
  in `src/markdown.js` that operates on the HTML string directly (no DOM
  required). It finds all pending storage image tags via regex, calls the
  resolver for each object ID concurrently, and injects the resulting `src`.
- Made `exportDocPDF()` async and calls `hydrateStorageImageMarkup` with the
  store's existing `resolveStorageImageUrl` method before writing to the print
  window.
- Failed resolutions are marked with `md-storage-image-error` class and given
  a subtle visual treatment in the print stylesheet.

## Alternatives Considered

- **DOM-based hydration in the print window**: Would require waiting for image
  loads in the popup, more fragile timing with `window.print()`.
- **Embedding images as data URIs**: More self-contained but significantly
  larger HTML and slower for many images.

## Testing

8 unit tests in `tests/pdf-export-images.test.js` cover:
- Single and multiple storage image resolution
- Remote images left untouched
- Mixed storage + remote content
- Resolver failures (error class applied)
- Empty / no-image passthrough
- Alt text and label preservation
