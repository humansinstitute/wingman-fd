import { describe, expect, it } from 'vitest';

import { renderMarkdownToHtml } from '../src/markdown.js';

describe('renderMarkdownToHtml', () => {
  it('renders richer markdown blocks and safe links', () => {
    const html = renderMarkdownToHtml([
      '# Title',
      '',
      '- item one',
      '- [x] done',
      '',
      '> quoted',
      '',
      '```js',
      'const value = 1;',
      '```',
      '',
      '| a | b |',
      '| - | - |',
      '| 1 | 2 |',
      '',
      '[link](https://example.com)',
    ].join('\n'));

    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<ul>');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<pre><code class="language-js">');
    expect(html).toContain('<table>');
    expect(html).toContain('href="https://example.com/"');
  });

  it('renders storage and remote images', () => {
    const html = renderMarkdownToHtml([
      '![stored](storage://image-1)',
      '![remote](https://example.com/demo.png)',
    ].join('\n'));

    expect(html).toContain('data-storage-object-id="image-1"');
    expect(html).toContain('src="https://example.com/demo.png"');
  });

  it('rendered images have md-storage-image class for modal click targeting', () => {
    const storageHtml = renderMarkdownToHtml('![pic](storage://img-42)');
    expect(storageHtml).toContain('class="md-storage-image');

    const remoteHtml = renderMarkdownToHtml('![pic](https://example.com/photo.jpg)');
    expect(remoteHtml).toContain('class="md-storage-image"');
  });

  it('chat message with storage image renders clickable markup for modal', () => {
    const html = renderMarkdownToHtml('Check this out ![screenshot](storage://obj-abc123)');
    expect(html).toContain('class="md-storage-image md-storage-image-pending"');
    expect(html).toContain('data-storage-object-id="obj-abc123"');
    expect(html).toContain('class="md-storage-image-wrap"');
  });

  it('chat message with remote image renders clickable markup for modal', () => {
    const html = renderMarkdownToHtml('Look at this ![photo](https://cdn.example.com/pic.jpg)');
    expect(html).toContain('class="md-storage-image"');
    expect(html).toContain('src="https://cdn.example.com/pic.jpg"');
    expect(html).toContain('class="md-storage-image-wrap"');
  });

  it('thread reply with mixed content and image renders modal-compatible markup', () => {
    const html = renderMarkdownToHtml([
      'Here is my reply with an image:',
      '',
      '![attachment](storage://thread-img-1)',
      '',
      'And some more text after.',
    ].join('\n'));
    expect(html).toContain('data-storage-object-id="thread-img-1"');
    expect(html).toContain('class="md-storage-image md-storage-image-pending"');
    expect(html).toContain('Here is my reply');
    expect(html).toContain('And some more text after.');
  });

  it('escapes raw html and strips unsafe javascript links', () => {
    const html = renderMarkdownToHtml([
      '<script>alert(1)</script>',
      '',
      '[bad](javascript:alert(1))',
    ].join('\n'));

    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('javascript:alert(1)');
    expect(html).toContain('>bad<');
  });
});
