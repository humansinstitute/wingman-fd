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
