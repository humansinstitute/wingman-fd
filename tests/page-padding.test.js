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

// ---------------------------------------------------------------------------
// Tests: page-level padding removal
// ---------------------------------------------------------------------------

describe('Flight Deck page padding', () => {

  it('body must not have left/right padding', () => {
    const padding = getPropertyValue('body', 'padding');
    expect(padding).toBeTruthy();
    // Parse padding shorthand — should have 0 for left and right
    // Accepted forms: "Xrem 0", "Xrem 0 Yrem 0", "Xrem 0 Yrem"
    // Left/right values (2nd and 4th in shorthand) must be 0
    const parts = padding.split(/\s+/);
    if (parts.length === 2) {
      // top/bottom left/right
      expect(parts[1]).toBe('0');
    } else if (parts.length === 4) {
      // top right bottom left
      expect(parts[1]).toBe('0');
      expect(parts[3]).toBe('0');
    } else if (parts.length === 1) {
      expect(parts[0]).toBe('0');
    } else if (parts.length === 3) {
      // top left/right bottom
      expect(parts[1]).toBe('0');
    }
  });

  it('.main-content must not have left padding', () => {
    const paddingLeft = getPropertyValue('.main-content', 'padding-left');
    // Should either be 0 or not declared (inheriting 0)
    if (paddingLeft !== null) {
      expect(paddingLeft).toBe('0');
    }
  });

  it('.main-content must not have right padding', () => {
    const paddingRight = getPropertyValue('.main-content', 'padding-right');
    if (paddingRight !== null) {
      expect(paddingRight).toBe('0');
    }
  });

  it('.status-section must not have arbitrary right padding', () => {
    const padding = getPropertyValue('.status-section', 'padding');
    if (padding) {
      const parts = padding.split(/\s+/);
      // right value (2nd in 4-value shorthand, or 2nd in 2-value) should be 0
      if (parts.length === 4) {
        expect(parts[1]).toBe('0');
      } else if (parts.length === 2) {
        expect(parts[1]).toBe('0');
      }
    }
  });

  it('body still has max-width constraint', () => {
    const maxWidth = getPropertyValue('body', 'max-width');
    expect(maxWidth).toBeTruthy();
  });

  it('body still has vertical padding for top/bottom spacing', () => {
    const padding = getPropertyValue('body', 'padding');
    expect(padding).toBeTruthy();
    const parts = padding.split(/\s+/);
    // First value (top) should be non-zero
    expect(parts[0]).not.toBe('0');
  });

  it('.sidebar border-right is preserved for visual separation', () => {
    expect(selectorDeclaresProperty('.sidebar', 'border-right')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Mobile responsive padding
// ---------------------------------------------------------------------------

describe('Mobile responsive padding', () => {

  it('mobile .main-content still has padding-left: 0', () => {
    // The mobile media query should keep padding-left at 0
    // We check that the mobile rule still exists
    const mobileRegex = /@media[^{]*max-width[^{]*\{[^}]*\.main-content\s*\{([^}]+)\}/s;
    const match = stylesheetContent.match(mobileRegex);
    if (match) {
      expect(match[1]).toMatch(/padding-left\s*:\s*0/);
    }
    // If no mobile override exists, that's fine — desktop is already 0
  });

  it('no media query re-introduces left/right body padding', () => {
    // Find all body rules inside media queries and verify none add horizontal padding
    const mediaBodyRegex = /@media[^{]*\{[^}]*body\s*\{([^}]+)\}/gs;
    let match;
    while ((match = mediaBodyRegex.exec(stylesheetContent)) !== null) {
      const block = match[1];
      const paddingMatch = block.match(/(?:^|;|\s)padding\s*:\s*([^;]+)/);
      if (paddingMatch) {
        const parts = paddingMatch[1].trim().split(/\s+/);
        if (parts.length === 1) {
          // Single value applies to all sides — left/right must be 0
          expect(parts[0]).toBe('0');
        } else if (parts.length === 2) {
          expect(parts[1]).toBe('0');
        } else if (parts.length === 3) {
          expect(parts[1]).toBe('0');
        } else if (parts.length === 4) {
          expect(parts[1]).toBe('0');
          expect(parts[3]).toBe('0');
        }
      }
      // Also check padding-left / padding-right individually
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
