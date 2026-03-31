import { describe, expect, it } from 'vitest';

import { renderMarkdownToHtml, hydrateStorageImageMarkup } from '../src/markdown.js';

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
