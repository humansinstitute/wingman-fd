import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const indexPath = path.resolve(__dirname, '../index.html');
const indexContent = fs.readFileSync(indexPath, 'utf-8');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Find all x-if template boundaries for a given navSection and return their
 * start/end character offsets.  This lets us check whether a piece of markup
 * lives inside or outside a particular section guard.
 */
function findSectionBoundaries(section) {
  // Match: <template x-if="$store.chat.navSection === 'flows'">
  const openRe = new RegExp(
    `<template\\s+x-if="\\$store\\.chat\\.navSection\\s*===\\s*'${section}'"\\s*>`,
    'g',
  );
  const ranges = [];
  let match;
  while ((match = openRe.exec(indexContent)) !== null) {
    const start = match.index;
    // Walk forward counting nested <template / </template> to find the
    // matching close tag.
    let depth = 1;
    let cursor = start + match[0].length;
    while (depth > 0 && cursor < indexContent.length) {
      const nextOpen = indexContent.indexOf('<template', cursor);
      const nextClose = indexContent.indexOf('</template>', cursor);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        cursor = nextOpen + 9; // skip past '<template'
      } else {
        depth--;
        if (depth === 0) {
          ranges.push({ start, end: nextClose + '</template>'.length });
        }
        cursor = nextClose + '</template>'.length;
      }
    }
  }
  return ranges;
}

function isInsideSection(substring, section) {
  const idx = indexContent.indexOf(substring);
  if (idx === -1) return false;
  const ranges = findSectionBoundaries(section);
  return ranges.some((r) => idx >= r.start && idx < r.end);
}

// ---------------------------------------------------------------------------
// 1. Approval detail modal must NOT be scoped inside a single section
// ---------------------------------------------------------------------------

describe('approval detail modal is globally accessible', () => {
  it('approval-detail-overlay exists in index.html', () => {
    expect(indexContent).toContain('approval-detail-overlay');
  });

  it('modal is NOT inside the flows section template', () => {
    expect(isInsideSection('approval-detail-overlay', 'flows')).toBe(false);
  });

  it('modal is NOT inside the status section template', () => {
    expect(isInsideSection('approval-detail-overlay', 'status')).toBe(false);
  });

  it('modal is NOT inside any other navSection template', () => {
    const sections = ['chat', 'tasks', 'docs', 'reports', 'calendar', 'schedules', 'scopes', 'people', 'settings'];
    for (const sec of sections) {
      expect(isInsideSection('approval-detail-overlay', sec)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Click handlers on approval cards set the right store properties
// ---------------------------------------------------------------------------

describe('approval card click handlers wire to modal state', () => {
  it('status page approval cards set activeApprovalId and showApprovalDetail', () => {
    // The status section approval card should have the click wiring
    const statusRanges = findSectionBoundaries('status');
    expect(statusRanges.length).toBeGreaterThan(0);
    const statusHtml = statusRanges.map((r) => indexContent.slice(r.start, r.end)).join('');

    expect(statusHtml).toContain('flightdeck-approval-card');
    expect(statusHtml).toContain('activeApprovalId');
    expect(statusHtml).toContain('showApprovalDetail');
  });

  it('flows page approval cards set activeApprovalId and showApprovalDetail', () => {
    const flowsRanges = findSectionBoundaries('flows');
    expect(flowsRanges.length).toBeGreaterThan(0);
    const flowsHtml = flowsRanges.map((r) => indexContent.slice(r.start, r.end)).join('');

    expect(flowsHtml).toContain('flows-approval-card');
    expect(flowsHtml).toContain('activeApprovalId');
    expect(flowsHtml).toContain('showApprovalDetail');
  });
});

// ---------------------------------------------------------------------------
// 3. Modal uses showApprovalDetail for visibility
// ---------------------------------------------------------------------------

describe('approval detail modal visibility binding', () => {
  it('overlay uses x-show="$store.chat.showApprovalDetail"', () => {
    expect(indexContent).toMatch(/approval-detail-overlay[^>]*x-show="\$store\.chat\.showApprovalDetail"/);
  });

  it('overlay can be dismissed by clicking backdrop', () => {
    expect(indexContent).toMatch(/approval-detail-overlay[^>]*@click\.self="[^"]*showApprovalDetail\s*=\s*false/);
  });
});

// ---------------------------------------------------------------------------
// 4. Modal looks up approval from store.approvals by activeApprovalId
// ---------------------------------------------------------------------------

describe('approval detail modal data binding', () => {
  it('modal derives approval from $store.chat.approvals using activeApprovalId', () => {
    // The x-data getter should look up by activeApprovalId in the approvals array
    expect(indexContent).toMatch(/approval-detail-overlay[\s\S]*?activeApprovalId[\s\S]*?approvals\.find/);
  });

  it('panel guards on approval being non-null', () => {
    expect(indexContent).toMatch(/approval-detail-panel[^>]*x-show="approval"/);
  });
});

// ---------------------------------------------------------------------------
// 5. Approval detail modal has action buttons
// ---------------------------------------------------------------------------

describe('approval detail modal actions', () => {
  it('has approve button', () => {
    expect(indexContent).toMatch(/approval-detail-actions[\s\S]*?approveApproval/);
  });

  it('has reject button', () => {
    expect(indexContent).toMatch(/approval-detail-actions[\s\S]*?rejectApproval/);
  });

  it('has improve button', () => {
    expect(indexContent).toMatch(/approval-detail-actions[\s\S]*?improveApproval/);
  });
});
