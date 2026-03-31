import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const stylesPath = path.resolve(__dirname, '../src/styles.css');
const stylesheetContent = fs.readFileSync(stylesPath, 'utf-8');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extracts all declaration blocks for a given selector from the stylesheet. */
function extractRuleBlocks(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escaped + '\\s*\\{([^}]+)\\}', 'g');
  const blocks = [];
  let match;
  while ((match = regex.exec(stylesheetContent)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

/** Get the value of a property from a selector's rule blocks (first match). */
function getPropertyValue(selector, property) {
  const blocks = extractRuleBlocks(selector);
  for (const block of blocks) {
    const re = new RegExp(`${property}\\s*:\\s*([^;]+)`);
    const match = block.match(re);
    if (match) return match[1].trim();
  }
  return null;
}

/** Check if any rule block for a selector sets a given property. */
function selectorDeclaresProperty(selector, property) {
  const blocks = extractRuleBlocks(selector);
  return blocks.some((block) => {
    const re = new RegExp(`(^|;|\\s)${property}\\s*:`);
    return re.test(block);
  });
}

/** Parse CSS padding shorthand and return { top, right, bottom, left }. */
function parsePaddingShorthand(value) {
  const parts = value.split(/\s+/);
  if (parts.length === 1) return { top: parts[0], right: parts[0], bottom: parts[0], left: parts[0] };
  if (parts.length === 2) return { top: parts[0], right: parts[1], bottom: parts[0], left: parts[1] };
  if (parts.length === 3) return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[1] };
  return { top: parts[0], right: parts[1], bottom: parts[2], left: parts[3] };
}

// ---------------------------------------------------------------------------
// Tests: outer chrome pinned to edges (no horizontal padding)
// ---------------------------------------------------------------------------

describe('Flight Deck outer chrome — pinned to window edges', () => {

  it('body must not have left/right padding (outer chrome flush)', () => {
    const padding = getPropertyValue('body', 'padding');
    expect(padding).toBeTruthy();
    const parsed = parsePaddingShorthand(padding);
    expect(parsed.left).toBe('0');
    expect(parsed.right).toBe('0');
  });

  it('body still has max-width constraint', () => {
    const maxWidth = getPropertyValue('body', 'max-width');
    expect(maxWidth).toBeTruthy();
  });

  it('body still has vertical padding for top/bottom spacing', () => {
    const padding = getPropertyValue('body', 'padding');
    expect(padding).toBeTruthy();
    const parsed = parsePaddingShorthand(padding);
    expect(parsed.top).not.toBe('0');
  });

  it('.sidebar border-right is preserved for visual separation', () => {
    expect(selectorDeclaresProperty('.sidebar', 'border-right')).toBe(true);
  });

  it('.sidebar has no left margin or padding (pinned to left edge)', () => {
    const padding = getPropertyValue('.sidebar', 'padding');
    if (padding) {
      const parsed = parsePaddingShorthand(padding);
      expect(parsed.left).toBe('0');
    }
    const marginLeft = getPropertyValue('.sidebar', 'margin-left');
    if (marginLeft !== null) {
      expect(marginLeft).toBe('0');
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: main content area has horizontal padding (restored)
// ---------------------------------------------------------------------------

describe('Flight Deck main content — horizontal padding restored', () => {

  it('.main-content must have non-zero left padding', () => {
    const paddingLeft = getPropertyValue('.main-content', 'padding-left');
    const padding = getPropertyValue('.main-content', 'padding');
    // Either padding-left or the left component of shorthand padding must be > 0
    if (paddingLeft !== null) {
      expect(paddingLeft).not.toBe('0');
    } else if (padding !== null) {
      const parsed = parsePaddingShorthand(padding);
      expect(parsed.left).not.toBe('0');
    } else {
      // No padding at all — fail
      expect(paddingLeft ?? padding).not.toBeNull();
    }
  });

  it('.main-content must have non-zero right padding', () => {
    const paddingRight = getPropertyValue('.main-content', 'padding-right');
    const padding = getPropertyValue('.main-content', 'padding');
    if (paddingRight !== null) {
      expect(paddingRight).not.toBe('0');
    } else if (padding !== null) {
      const parsed = parsePaddingShorthand(padding);
      expect(parsed.right).not.toBe('0');
    } else {
      expect(paddingRight ?? padding).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Mobile responsive padding
// ---------------------------------------------------------------------------

describe('Mobile responsive padding', () => {

  it('mobile .main-content keeps padding-left: 0 for tight screens', () => {
    // The mobile media query should reset padding-left to 0
    const mobileRegex = /@media[^{]*max-width[^{]*\{[^}]*\.main-content\s*\{([^}]+)\}/s;
    const match = stylesheetContent.match(mobileRegex);
    if (match) {
      expect(match[1]).toMatch(/padding-left\s*:\s*0/);
    }
    // If no mobile override exists, that's acceptable
  });

  it('no media query re-introduces left/right body padding', () => {
    const mediaBodyRegex = /@media[^{]*\{[^}]*body\s*\{([^}]+)\}/gs;
    let match;
    while ((match = mediaBodyRegex.exec(stylesheetContent)) !== null) {
      const block = match[1];
      const paddingMatch = block.match(/(?:^|;|\s)padding\s*:\s*([^;]+)/);
      if (paddingMatch) {
        const parsed = parsePaddingShorthand(paddingMatch[1].trim());
        expect(parsed.left).toBe('0');
        expect(parsed.right).toBe('0');
      }
      const plMatch = block.match(/padding-left\s*:\s*([^;]+)/);
      if (plMatch) {
        expect(plMatch[1].trim()).toBe('0');
      }
      const prMatch = block.match(/padding-right\s*:\s*([^;]+)/);
      if (prMatch) {
        expect(prMatch[1].trim()).toBe('0');
      }
    }
  });
});
