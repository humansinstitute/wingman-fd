import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// The decomposition note must exist and cover all required areas
// ---------------------------------------------------------------------------

const docPath = path.resolve(__dirname, '../docs/design/store-template-decomposition.md');

function getDoc() {
  if (!fs.existsSync(docPath)) throw new Error('Decomposition note not found at docs/design/store-template-decomposition.md');
  return fs.readFileSync(docPath, 'utf-8');
}

describe('Store and template decomposition plan exists', () => {
  it('document file exists at the expected path', () => {
    expect(fs.existsSync(docPath)).toBe(true);
  });

  it('is non-trivial (at least 200 lines)', () => {
    const lines = getDoc().split('\n').length;
    expect(lines).toBeGreaterThanOrEqual(200);
  });
});

describe('Decomposition plan covers shell responsibilities', () => {
  it('traces app lifecycle / init responsibilities', () => {
    const doc = getDoc();
    expect(doc).toMatch(/init|bootstrap|lifecycle/i);
  });

  it('identifies route activation as a shell concern', () => {
    const doc = getDoc();
    expect(doc).toMatch(/route|routing|navigat/i);
  });

  it('identifies section state as distinct from shell state', () => {
    const doc = getDoc();
    expect(doc).toMatch(/section.*(state|store)/i);
  });

  it('identifies transient UI state (modals, menus, editor buffers)', () => {
    const doc = getDoc();
    expect(doc).toMatch(/transient|modal|editor.*(state|buffer)/i);
  });

  it('identifies data subscriptions / liveQuery as a concern', () => {
    const doc = getDoc();
    expect(doc).toMatch(/liveQuery|subscription/i);
  });

  it('identifies side-effect orchestration (sync, crypto, background)', () => {
    const doc = getDoc();
    expect(doc).toMatch(/sync|side.?effect|orchestrat/i);
  });
});

describe('Decomposition plan proposes a first extraction seam', () => {
  it('names a specific first seam to extract', () => {
    const doc = getDoc();
    // Should identify what moves first
    expect(doc).toMatch(/first.*(seam|extract|move|split)/i);
  });

  it('describes what state remains shell-owned', () => {
    const doc = getDoc();
    expect(doc).toMatch(/shell.*(own|state|store|retain)/i);
  });

  it('describes what state moves to section stores', () => {
    const doc = getDoc();
    expect(doc).toMatch(/section.*(store|own)/i);
  });
});

describe('Decomposition plan includes implementation details', () => {
  it('lists file move targets', () => {
    const doc = getDoc();
    // Should reference specific source files
    expect(doc).toMatch(/src\/app\.js/);
    expect(doc).toMatch(/index\.html/);
  });

  it('defines ownership boundaries per section', () => {
    const doc = getDoc();
    // Should mention major sections: chat, tasks, docs at minimum
    expect(doc).toMatch(/chat/i);
    expect(doc).toMatch(/tasks/i);
    expect(doc).toMatch(/docs/i);
  });

  it('identifies template touch points', () => {
    const doc = getDoc();
    expect(doc).toMatch(/template|x-show|x-if|\$store\.chat/i);
  });

  it('discusses regression risks', () => {
    const doc = getDoc();
    expect(doc).toMatch(/regress|risk|break/i);
  });

  it('includes a test plan', () => {
    const doc = getDoc();
    expect(doc).toMatch(/test.*(plan|strateg|approach)/i);
  });

  it('specifies a patch order', () => {
    const doc = getDoc();
    expect(doc).toMatch(/patch.*(order|sequence)|order.*(patch|step)|step.*\d/i);
  });
});

describe('Decomposition plan is dispatchable', () => {
  it('is specific enough to reference concrete store properties', () => {
    const doc = getDoc();
    // Must mention actual state keys from the store
    expect(doc).toMatch(/navSection/);
    expect(doc).toMatch(/selectedWorkspaceKey|backendUrl|session/);
  });

  it('references existing manager modules', () => {
    const doc = getDoc();
    expect(doc).toMatch(/syncManagerMixin|workspaceManagerMixin|channelsManagerMixin/);
  });

  it('references section-live-queries.js as a key file', () => {
    const doc = getDoc();
    expect(doc).toMatch(/section-live-queries/);
  });

  it('does not require re-reading the as-built report to start work', () => {
    const doc = getDoc();
    // Should contain enough inline context about current line counts / structure
    expect(doc).toMatch(/4[,.]?5\d{2}|~4\.?5k/i); // app.js is ~4500 lines
    expect(doc).toMatch(/5[,.]?9\d{2}|~6k/i); // index.html is ~5950 lines
  });
});
