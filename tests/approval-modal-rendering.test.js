import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const indexPath = path.resolve(__dirname, '../index.html');
const indexContent = fs.readFileSync(indexPath, 'utf-8');

// ---------------------------------------------------------------------------
// Helper: extract the approval detail modal block
// ---------------------------------------------------------------------------

function getApprovalModalHtml() {
  const start = indexContent.indexOf('approval-detail-overlay');
  if (start === -1) throw new Error('approval-detail-overlay not found');
  // Walk back to the opening <div
  const divStart = indexContent.lastIndexOf('<div', start);
  // Find the matching close — count nested divs
  let depth = 0;
  let cursor = divStart;
  while (cursor < indexContent.length) {
    const nextOpen = indexContent.indexOf('<div', cursor + 1);
    const nextClose = indexContent.indexOf('</div>', cursor + 1);
    if (nextClose === -1) break;
    if (cursor === divStart) {
      depth = 1;
      cursor = divStart + 4;
      continue;
    }
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++;
      cursor = nextOpen + 4;
    } else {
      depth--;
      if (depth === 0) return indexContent.slice(divStart, nextClose + 6);
      cursor = nextClose + 6;
    }
  }
  throw new Error('Could not find closing tag for approval-detail-overlay');
}

const modalHtml = getApprovalModalHtml();

// ---------------------------------------------------------------------------
// 1. Linked tasks are clickable
// ---------------------------------------------------------------------------

describe('linked tasks are clickable in approval modal', () => {
  it('task list items have a click handler', () => {
    // The linked tasks section should have click/navigation wiring
    expect(modalHtml).toMatch(/approval-linked-tasks[\s\S]*?@click/);
  });

  it('clicking a task navigates via navigateToLinkedTask or openTaskDetail', () => {
    expect(modalHtml).toMatch(/approval-linked-tasks[\s\S]*?(navigateToLinkedTask|openTaskDetail)/);
  });

  it('clicking a task closes the approval modal', () => {
    // The click handler should set showApprovalDetail = false
    expect(modalHtml).toMatch(/approval-linked-tasks[\s\S]*?showApprovalDetail\s*=\s*false/);
  });
});

// ---------------------------------------------------------------------------
// 2. Brief renders with clickable references (x-html, not x-text)
// ---------------------------------------------------------------------------

describe('brief renders with clickable references', () => {
  it('brief section uses x-html for rich rendering', () => {
    // The brief paragraph should use x-html to render links inside text
    expect(modalHtml).toMatch(/class="approval-detail-section"[\s\S]*?Brief[\s\S]*?x-html/);
  });

  it('brief rendering calls approvalBriefHtml helper via store', () => {
    // The template calls $store.chat.approvalBriefHtml which wraps renderBriefHtml
    expect(modalHtml).toMatch(/approvalBriefHtml/);
  });
});

// ---------------------------------------------------------------------------
// 3. Artifacts section resolves titles and is clickable
// ---------------------------------------------------------------------------

describe('artifacts section resolves and is clickable', () => {
  it('artifact list items have click handlers', () => {
    expect(modalHtml).toMatch(/approval-artifact-list[\s\S]*?@click/);
  });

  it('artifact items display resolved titles when available', () => {
    // Should reference resolveArtifactRef or equivalent for title resolution
    expect(modalHtml).toMatch(/resolveArtifactRef|resolved.*title|\.title/);
  });

  it('clicking an artifact navigates via navigateToArtifact', () => {
    // The template calls $store.chat.navigateToArtifact which routes by type
    expect(modalHtml).toMatch(/approval-artifact-list[\s\S]*?navigateToArtifact/);
  });
});

// ---------------------------------------------------------------------------
// 4. Modal x-data imports helpers
// ---------------------------------------------------------------------------

describe('approval modal wires helper functions', () => {
  it('flows-manager imports approval-helpers for store methods', () => {
    // The helpers are imported in flows-manager.js and exposed as store methods
    const fs = require('fs');
    const fmPath = require('path').resolve(__dirname, '../src/flows-manager.js');
    const fmContent = fs.readFileSync(fmPath, 'utf-8');
    expect(fmContent).toMatch(/approval-helpers/);
  });
});
