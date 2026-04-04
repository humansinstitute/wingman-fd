import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const stylesPath = path.resolve(__dirname, '../src/styles.css');
const stylesheetContent = fs.readFileSync(stylesPath, 'utf-8');
const indexPath = path.resolve(__dirname, '../index.html');
const indexContent = fs.readFileSync(indexPath, 'utf-8');

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

/** Check if any rule block for a selector sets a given property. */
function selectorDeclaresProperty(selector, property) {
  const blocks = extractRuleBlocks(selector);
  return blocks.some((block) => {
    const re = new RegExp(`(^|;|\\s)${property}\\s*:`);
    return re.test(block);
  });
}

/** Check if a CSS selector exists in the stylesheet. */
function selectorExists(selector) {
  return extractRuleBlocks(selector).length > 0;
}

// ---------------------------------------------------------------------------
// 1. btn-primary must have complete interactive states
// ---------------------------------------------------------------------------

describe('btn-primary interactive states', () => {
  it('btn-primary:hover exists', () => {
    expect(selectorExists('.btn-primary:hover')).toBe(true);
  });

  it('btn-primary:focus has outline or box-shadow for accessibility', () => {
    expect(selectorExists('.btn-primary:focus')).toBe(true);
    const declaresOutline = selectorDeclaresProperty('.btn-primary:focus', 'outline');
    const declaresShadow = selectorDeclaresProperty('.btn-primary:focus', 'box-shadow');
    expect(declaresOutline || declaresShadow).toBe(true);
  });

  it('btn-primary:disabled has reduced opacity and not-allowed cursor', () => {
    expect(selectorExists('.btn-primary:disabled')).toBe(true);
    expect(selectorDeclaresProperty('.btn-primary:disabled', 'opacity')).toBe(true);
    expect(selectorDeclaresProperty('.btn-primary:disabled', 'cursor')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Flow start confirmation — Start Run button uses btn-primary
// ---------------------------------------------------------------------------

describe('Start Run button in flow-start-confirm dialog', () => {
  it('Start Run button has btn-primary class', () => {
    // Find the flow-start-confirm-actions area and check the primary action button
    const confirmActionsRegex = /class="flow-start-confirm-actions"[\s\S]*?<button[^>]*class="[^"]*btn-primary[^"]*"[^>]*>[\s\S]*?Start Run/;
    expect(confirmActionsRegex.test(indexContent)).toBe(true);
  });

  it('Cancel button in flow-start-confirm has btn-secondary class', () => {
    // The cancel button in the confirm dialog should use btn-secondary
    const cancelRegex = /class="flow-start-confirm-actions"[\s\S]*?Cancel<\/button>/;
    expect(cancelRegex.test(indexContent)).toBe(true);
    // Specifically check the cancel button has a class
    const actionBlock = indexContent.match(/class="flow-start-confirm-actions"([\s\S]*?)<\/div>/);
    expect(actionBlock).toBeTruthy();
    const cancelBtnMatch = actionBlock[1].match(/<button[^>]*>[\s]*Cancel[\s]*<\/button>/);
    // Cancel button should have btn-secondary class
    const cancelWithClass = actionBlock[1].match(/<button[^>]*class="[^"]*btn-secondary[^"]*"[^>]*>[\s\S]*?Cancel/);
    expect(cancelWithClass).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 3. Flow card Start button uses established button system
// ---------------------------------------------------------------------------

describe('Flow card Start button styling', () => {
  it('flow card Start button uses btn-primary class', () => {
    // The "Start" button for individual flow cards should use btn-primary (not a one-off class)
    const flowStartBtns = indexContent.match(/title="Start a new run of this flow"[^>]*>[^<]*Start/g) || [];
    expect(flowStartBtns.length).toBeGreaterThan(0);
    // Check that the button's class includes btn-primary
    const btnTag = indexContent.match(/<button[^>]*title="Start a new run of this flow"[^>]*/);
    expect(btnTag).toBeTruthy();
    expect(btnTag[0]).toMatch(/btn-primary/);
  });

  it('btn-start-flow one-off class is not used', () => {
    // The one-off btn-start-flow class should be removed in favor of standard classes
    const hasOneOff = indexContent.match(/btn-start-flow/);
    expect(hasOneOff).toBeNull();
  });
});
