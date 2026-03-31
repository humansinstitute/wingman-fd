import { describe, expect, it } from 'vitest';

import { renderMarkdownToHtml, hydrateStorageImageMarkup } from '../src/markdown.js';
import { buildDocPrintHtml, blobToDataUrl } from '../src/docs-manager.js';

describe('hydrateStorageImageMarkup', () => {
  it('replaces pending storage images with resolved src URLs', async () => {
    const html = renderMarkdownToHtml('![photo](storage://obj-1)');
    expect(html).toContain('data-storage-object-id="obj-1"');
    expect(html).not.toContain('src=');

    const result = await hydrateStorageImageMarkup(html, async (objectId) => {
      return `https://cdn.example.com/resolved/${objectId}.png`;
    });

    expect(result).toContain('src="https://cdn.example.com/resolved/obj-1.png"');
    expect(result).not.toContain('md-storage-image-pending');
  });

  it('handles multiple storage images', async () => {
    const html = renderMarkdownToHtml([
      '![first](storage://img-a)',
      '![second](storage://img-b)',
    ].join('\n'));

    const result = await hydrateStorageImageMarkup(html, async (objectId) => {
      return `blob:resolved-${objectId}`;
    });

    expect(result).toContain('src="blob:resolved-img-a"');
    expect(result).toContain('src="blob:resolved-img-b"');
  });

  it('leaves remote images untouched', async () => {
    const html = renderMarkdownToHtml('![remote](https://example.com/pic.jpg)');

    const result = await hydrateStorageImageMarkup(html, async () => {
      throw new Error('should not be called');
    });

    expect(result).toContain('src="https://example.com/pic.jpg"');
  });

  it('handles mixed storage and remote images', async () => {
    const html = renderMarkdownToHtml([
      '![stored](storage://obj-x)',
      '![remote](https://example.com/photo.png)',
    ].join('\n'));

    const result = await hydrateStorageImageMarkup(html, async (objectId) => {
      return `https://resolved/${objectId}`;
    });

    expect(result).toContain('src="https://resolved/obj-x"');
    expect(result).toContain('src="https://example.com/photo.png"');
  });

  it('keeps image markup when resolver fails, adds error class', async () => {
    const html = renderMarkdownToHtml('![broken](storage://missing-obj)');

    const result = await hydrateStorageImageMarkup(html, async () => {
      throw new Error('not found');
    });

    // Image should still be present but marked as error
    expect(result).toContain('data-storage-object-id="missing-obj"');
    expect(result).toContain('md-storage-image-error');
    expect(result).not.toContain('md-storage-image-pending');
  });

  it('returns original html when no storage images present', async () => {
    const html = '<p>No images here</p>';
    const result = await hydrateStorageImageMarkup(html, async () => {
      throw new Error('should not be called');
    });
    expect(result).toBe(html);
  });

  it('returns empty string for empty input', async () => {
    const result = await hydrateStorageImageMarkup('', async () => 'url');
    expect(result).toBe('');
  });

  it('preserves alt text and label after hydration', async () => {
    const html = renderMarkdownToHtml('![my screenshot](storage://obj-99)');

    const result = await hydrateStorageImageMarkup(html, async () => {
      return 'https://cdn.example.com/resolved.png';
    });

    expect(result).toContain('alt="my screenshot"');
    expect(result).toContain('my screenshot</span>');
  });
});

describe('hydrateStorageImageMarkup for PDF export', () => {
  it('data: URLs survive hydration and are valid in print context', async () => {
    const html = renderMarkdownToHtml('![diagram](storage://obj-pdf)');

    // Simulate a resolver that returns data: URLs (as used in PDF export)
    const fakeDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
    const result = await hydrateStorageImageMarkup(html, async () => fakeDataUrl);

    expect(result).toContain(`src="${fakeDataUrl}"`);
    expect(result).not.toContain('md-storage-image-pending');
    expect(result).toContain('data-storage-object-id="obj-pdf"');
  });

  it('mixed storage data-URLs and remote https images both have src', async () => {
    const html = renderMarkdownToHtml([
      '![stored](storage://obj-1)',
      '![remote](https://cdn.example.com/photo.jpg)',
      '![stored2](storage://obj-2)',
    ].join('\n'));

    const result = await hydrateStorageImageMarkup(html, async (objectId) => {
      return `data:image/png;base64,fake-${objectId}`;
    });

    expect(result).toContain('src="data:image/png;base64,fake-obj-1"');
    expect(result).toContain('src="data:image/png;base64,fake-obj-2"');
    expect(result).toContain('src="https://cdn.example.com/photo.jpg"');

    // Ensure no pending images remain
    expect(result).not.toContain('md-storage-image-pending');
  });

  it('partial failures hydrate successful images and mark failed ones', async () => {
    const html = renderMarkdownToHtml([
      '![good](storage://obj-ok)',
      '![bad](storage://obj-fail)',
    ].join('\n'));

    const result = await hydrateStorageImageMarkup(html, async (objectId) => {
      if (objectId === 'obj-fail') throw new Error('unavailable');
      return 'data:image/png;base64,resolved-ok';
    });

    expect(result).toContain('src="data:image/png;base64,resolved-ok"');
    expect(result).toContain('md-storage-image-error');
    // The good image should have a data URL src and its object id
    expect(result).toContain('src="data:image/png;base64,resolved-ok"');
    expect(result).toContain('data-storage-object-id="obj-ok"');
  });
});

describe('buildDocPrintHtml', () => {
  it('wraps title and body content in a complete HTML document', () => {
    const html = buildDocPrintHtml('My Doc', '<p>Hello</p>');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<title>My Doc</title>');
    expect(html).toContain('<h1>My Doc</h1>');
    expect(html).toContain('<p>Hello</p>');
    expect(html).toContain('</html>');
  });

  it('includes print media styles', () => {
    const html = buildDocPrintHtml('Test', '<p>body</p>');
    expect(html).toContain('@media print');
  });

  it('includes image styling for max-width and error state', () => {
    const html = buildDocPrintHtml('Test', '<img src="x" />');
    expect(html).toContain('img { max-width: 100%');
    expect(html).toContain('md-storage-image-error');
  });

  it('produces HTML with resolved data-URL images intact', () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
    const body = `<img src="${dataUrl}" alt="test" />`;
    const html = buildDocPrintHtml('Images Doc', body);
    expect(html).toContain(`src="${dataUrl}"`);
  });
});

describe('blobToDataUrl', () => {
  it('converts a Blob to a data URL string', async () => {
    const blob = new Blob(['hello world'], { type: 'text/plain' });
    const dataUrl = await blobToDataUrl(blob);
    expect(dataUrl).toMatch(/^data:text\/plain;base64,/);
    // Decode and verify content
    const encoded = dataUrl.split(',')[1];
    const decoded = atob(encoded);
    expect(decoded).toBe('hello world');
  });

  it('preserves image MIME type in data URL', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes
    const blob = new Blob([bytes], { type: 'image/png' });
    const dataUrl = await blobToDataUrl(blob);
    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('handles empty blob', async () => {
    const blob = new Blob([], { type: 'application/octet-stream' });
    const dataUrl = await blobToDataUrl(blob);
    expect(dataUrl).toMatch(/^data:application\/octet-stream;base64,/);
  });
});
