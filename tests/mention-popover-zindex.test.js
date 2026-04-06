import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Tests that the @mention typeahead popover renders above modal overlays.
 *
 * Bug: when typing @flow inside the flow editor modal, the mention suggestion
 * list appeared behind the modal because .mention-popover had z-index: 200
 * while .flow-editor-overlay had z-index: 1000.
 *
 * Fix: .mention-popover z-index must exceed the modal overlay z-index.
 */

function loadCSS() {
  const cssPath = resolve(__dirname, '../src/styles.css');
  return readFileSync(cssPath, 'utf-8');
}

function extractZIndex(css, selector) {
  // Find the rule block for the given selector and extract its z-index value.
  // Handles comma-separated selectors like ".a, .b { ... }".
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match the selector (possibly among comma-separated peers) then capture the block
  const blockRe = new RegExp(
    `(?:^|\\})\\s*(?:[^{}]*,\\s*)?${escaped}(?:\\s*,[^{]*)?\\s*\\{([^}]*)\\}`,
    'ms',
  );
  const match = css.match(blockRe);
  if (!match) return null;
  const zMatch = match[1].match(/z-index:\s*(\d+)/);
  return zMatch ? parseInt(zMatch[1], 10) : null;
}

describe('mention popover z-index layering', () => {
  const css = loadCSS();

  it('mention-popover z-index is defined', () => {
    const z = extractZIndex(css, '.mention-popover');
    expect(z).not.toBeNull();
    expect(z).toBeGreaterThan(0);
  });

  it('flow-editor-overlay z-index is defined', () => {
    const z = extractZIndex(css, '.flow-editor-overlay');
    expect(z).not.toBeNull();
    expect(z).toBeGreaterThan(0);
  });

  it('mention-popover z-index exceeds flow-editor-overlay z-index', () => {
    const mentionZ = extractZIndex(css, '.mention-popover');
    const overlayZ = extractZIndex(css, '.flow-editor-overlay');
    expect(mentionZ).toBeGreaterThan(overlayZ);
  });

  it('mention-popover uses position: fixed for viewport-relative placement', () => {
    const escaped = '.mention-popover'.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const blockRe = new RegExp(
      `(?:^|\\})\\s*(?:[^{}]*,\\s*)?${escaped}(?:\\s*,[^{]*)?\\s*\\{([^}]*)\\}`,
      'ms',
    );
    const match = css.match(blockRe);
    expect(match).not.toBeNull();
    expect(match[1]).toMatch(/position:\s*fixed/);
  });
});
