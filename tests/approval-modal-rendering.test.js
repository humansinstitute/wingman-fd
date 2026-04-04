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
  const divStart = indexContent.lastIndexOf('<div', start);
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
    expect(modalHtml).toMatch(/approval-linked-tasks[\s\S]*?@click/);
  });

  it('clicking a task navigates via navigateToLinkedTask', () => {
    expect(modalHtml).toMatch(/approval-linked-tasks[\s\S]*?navigateToLinkedTask/);
  });

  it('clicking a task closes the approval modal', () => {
    expect(modalHtml).toMatch(/approval-linked-tasks[\s\S]*?showApprovalDetail\s*=\s*false/);
  });
});

// ---------------------------------------------------------------------------
// 2. Brief renders with markdown (mention links via renderMarkdownToHtml)
// ---------------------------------------------------------------------------

describe('brief renders with clickable references', () => {
  it('brief section uses x-html for rich rendering', () => {
    expect(modalHtml).toMatch(/class="approval-detail-section"[\s\S]*?Brief[\s\S]*?x-html/);
  });

  it('brief rendering calls approvalBriefHtml which uses renderMarkdownToHtml', () => {
    expect(modalHtml).toMatch(/approvalBriefHtml/);
    // Verify flows-manager imports renderMarkdownToHtml
    const fmContent = fs.readFileSync(path.resolve(__dirname, '../src/flows-manager.js'), 'utf-8');
    expect(fmContent).toMatch(/import.*renderMarkdownToHtml.*from.*markdown/);
    expect(fmContent).toMatch(/approvalBriefHtml[\s\S]*?renderMarkdownToHtml/);
  });

  it('brief click handler closes modal on mention-link click', () => {
    expect(modalHtml).toMatch(/handleBriefLinkClick/);
    const fmContent = fs.readFileSync(path.resolve(__dirname, '../src/flows-manager.js'), 'utf-8');
    expect(fmContent).toMatch(/handleBriefLinkClick[\s\S]*?mention-link[\s\S]*?showApprovalDetail\s*=\s*false/);
  });
});

// ---------------------------------------------------------------------------
// 3. Artifacts section resolves titles and is clickable
// ---------------------------------------------------------------------------

describe('artifacts section resolves and is clickable', () => {
  it('artifact list items have click handlers', () => {
    expect(modalHtml).toMatch(/approval-artifact-list[\s\S]*?@click/);
  });

  it('clicking an artifact navigates via navigateToArtifact', () => {
    expect(modalHtml).toMatch(/approval-artifact-list[\s\S]*?navigateToArtifact/);
  });
});

// ---------------------------------------------------------------------------
// 4. flows-manager imports approval-helpers for artifact resolution
// ---------------------------------------------------------------------------

describe('approval modal wires helper functions', () => {
  it('flows-manager imports resolveArtifactRef from approval-helpers', () => {
    const fmContent = fs.readFileSync(path.resolve(__dirname, '../src/flows-manager.js'), 'utf-8');
    expect(fmContent).toMatch(/resolveArtifactRef.*from.*approval-helpers/);
  });
});
