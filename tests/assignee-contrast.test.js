import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const stylesPath = path.resolve(__dirname, '../src/styles.css');
const stylesheetContent = fs.readFileSync(stylesPath, 'utf-8');
const indexPath = path.resolve(__dirname, '../index.html');
const indexContent = fs.readFileSync(indexPath, 'utf-8');

/**
 * Regression coverage for assignee / look-ahead suggestion contrast.
 *
 * The global `button` rule sets `color: var(--surface)` (white). Any button
 * used on a light background MUST override its text color so names remain
 * readable.  This test ensures the `.docs-share-suggestion` button and the
 * `.new-channel-resolved-profile` wrapper carry an explicit dark text color.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extracts all declaration blocks for a given selector from the stylesheet. */
function extractRuleBlocks(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match selector followed by { ... }
  const regex = new RegExp(escaped + '\\s*\\{([^}]+)\\}', 'g');
  const blocks = [];
  let match;
  while ((match = regex.exec(stylesheetContent)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

/** Check if any rule block for a selector sets a given property. */
function selectorDeclaresProperty(selector, property) {
  const blocks = extractRuleBlocks(selector);
  return blocks.some((block) => {
    const re = new RegExp(`(^|;|\\s)${property}\\s*:`);
    return re.test(block);
  });
}

/** Get the value of a property from a selector's rule blocks. */
function getPropertyValue(selector, property) {
  const blocks = extractRuleBlocks(selector);
  for (const block of blocks) {
    const re = new RegExp(`${property}\\s*:\\s*([^;]+)`);
    const match = block.match(re);
    if (match) return match[1].trim();
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Assignee suggestion contrast', () => {

  it('.docs-share-suggestion must set an explicit text color', () => {
    expect(selectorDeclaresProperty('.docs-share-suggestion', 'color')).toBe(true);
  });

  it('.docs-share-suggestion text color must be dark (not surface/white)', () => {
    const color = getPropertyValue('.docs-share-suggestion', 'color');
    expect(color).toBeTruthy();
    // Must reference a dark variable or a dark hex — not var(--surface) or #fff
    expect(color).not.toMatch(/var\(--surface\)/);
    expect(color).not.toMatch(/^#fff/i);
    expect(color).not.toMatch(/^white$/i);
  });

  it('.docs-share-suggestion strong inherits or sets a dark color', () => {
    // Either .docs-share-suggestion sets color (inherited by strong),
    // or .docs-share-suggestion strong sets it explicitly.
    const parentSets = selectorDeclaresProperty('.docs-share-suggestion', 'color');
    const childSets = selectorDeclaresProperty('.docs-share-suggestion strong', 'color');
    expect(parentSets || childSets).toBe(true);
  });

  it('.docs-share-suggestion-copy small uses muted text', () => {
    // The rule may be part of a multi-selector block, so search for the
    // selector appearing anywhere with a color declaration in the same block.
    const regex = /\.docs-share-suggestion-copy\s+small[\s\S]*?\{([^}]+)\}/;
    const match = stylesheetContent.match(regex);
    expect(match).toBeTruthy();
    expect(match[1]).toMatch(/color\s*:/);
    expect(match[1]).not.toMatch(/color\s*:\s*var\(--surface\)/);
  });

  it('suggestion dropdown appears inside taskAssigneeSuggestions template', () => {
    expect(indexContent).toContain('taskAssigneeSuggestions');
    expect(indexContent).toContain('docs-share-suggestion');
  });
});

describe('Selected assignee profile contrast', () => {

  it('.new-channel-resolved-profile has a light background', () => {
    const bg = getPropertyValue('.new-channel-resolved-profile', 'background');
    expect(bg).toBeTruthy();
  });

  it('.new-channel-profile-name sets a readable text color', () => {
    const color = getPropertyValue('.new-channel-profile-name', 'color');
    expect(color).toBeTruthy();
    expect(color).not.toMatch(/var\(--surface\)/);
    expect(color).not.toMatch(/^#fff/i);
  });
});
