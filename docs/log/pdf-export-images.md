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

### Reopened issue (2026-03-31)

The initial fix added `hydrateStorageImageMarkup` which resolved storage
images to blob: URLs. Two remaining problems caused images to still be
missing from the printed PDF:

1. **blob: URLs are not cross-window portable.** `URL.createObjectURL()`
   creates URLs bound to the originating document. The print popup is a
   separate browsing context and cannot access them.
2. **Race condition.** `setTimeout(() => printWindow.print(), 300)` fires
   before images finish loading — the browser rasterises blank placeholders.

## Approach

- Introduced a **pure async function** `hydrateStorageImageMarkup(html, resolverFn)`
  in `src/markdown.js` that operates on the HTML string directly (no DOM
  required). It finds all pending storage image tags via regex, calls the
  resolver for each object ID concurrently, and injects the resulting `src`.
- Added `blobToDataUrl(blob)` helper in `docs-manager.js` to convert blobs
  into self-contained `data:` URLs that work in any browsing context.
- The PDF export resolver now converts blob URLs → data URLs before injection,
  making images portable to the print popup window.
- Extracted `buildDocPrintHtml(title, bodyHtml)` as a pure testable function.
- Replaced `setTimeout(…, 300)` with `Promise.all` over image `onload` events
  so `window.print()` only fires after every image has finished loading.
- Failed resolutions are marked with `md-storage-image-error` class and given
  a subtle visual treatment in the print stylesheet.

## Alternatives Considered

- **DOM-based hydration in the print window**: Would require waiting for image
  loads in the popup, more fragile timing with `window.print()`.
- **Keep blob: URLs and wait longer**: Would still fail because blob URLs are
  fundamentally not accessible cross-window.

## Testing

18 unit tests in `tests/pdf-export-images.test.js` cover:
- Single and multiple storage image resolution
- Remote images left untouched
- Mixed storage + remote content
- Resolver failures (error class applied)
- Empty / no-image passthrough
- Alt text and label preservation
- Data URL hydration for PDF context
- Mixed data-URL storage + https remote images
- Partial failure (some images resolve, some error)
- `buildDocPrintHtml` output structure, styles, and data-URL integrity
- `blobToDataUrl` conversion with text, image, and empty blobs
