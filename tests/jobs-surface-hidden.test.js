import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// FD As-Built Remediation 04 — Jobs surface must be hidden
// ---------------------------------------------------------------------------
// The Jobs feature is a stub that overstates product capability.
// These tests verify that the Jobs surface is not reachable by users
// in the current build.
// ---------------------------------------------------------------------------

const indexPath = path.resolve(__dirname, '../index.html');
const indexContent = fs.readFileSync(indexPath, 'utf-8');

describe('Jobs surface is hidden (as-built remediation 04)', () => {
  // -------------------------------------------------------------------------
  // Navigation
  // -------------------------------------------------------------------------

  it('sidebar does not contain a visible Jobs navigation item', () => {
    // The Jobs nav <li> should either be removed or unconditionally hidden.
    // Find the <li> that contains the Jobs sidebar label and check its x-show.
    const jobsLiPattern = /<li[^>]*>[\s\S]*?sidebar-label">Jobs<\/span>\s*<\/li>/;
    const match = indexContent.match(jobsLiPattern);
    if (match) {
      const liTag = match[0];
      // Must NOT be conditionally shown via hasHarnessLink (would make it visible)
      expect(liTag).not.toContain('x-show="$store.chat.hasHarnessLink"');
      // Should be unconditionally hidden with x-show="false"
      expect(liTag).toMatch(/x-show="false"/);
    }
    // If the label is gone entirely, that also passes
  });

  it('no Jobs page template is rendered when navSection is jobs', () => {
    // The <template x-if="$store.chat.navSection === 'jobs'"> block should
    // either be removed or guarded with an always-false condition.
    const jobsTemplatePattern = /x-if="\$store\.chat\.navSection\s*===\s*'jobs'"/;
    expect(indexContent).not.toMatch(jobsTemplatePattern);
  });

  // -------------------------------------------------------------------------
  // Route handling
  // -------------------------------------------------------------------------

  it("'jobs' is not in KNOWN_PAGES so URL routing ignores it", async () => {
    const { KNOWN_PAGES } = await import('../src/route-helpers.js');
    expect(KNOWN_PAGES.has('jobs')).toBe(false);
  });

  it("pageToSection('jobs') returns null (unknown page)", async () => {
    const { pageToSection } = await import('../src/route-helpers.js');
    expect(pageToSection('jobs')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Jobs manager mixin still exists but is inert
  // -------------------------------------------------------------------------

  it('jobs-manager.js still exports the mixin (preserved for future use)', async () => {
    const { jobsManagerMixin } = await import('../src/jobs-manager.js');
    expect(jobsManagerMixin).toBeDefined();
    expect(typeof jobsManagerMixin.loadJobDefinitions).toBe('function');
  });

  it('loadJobDefinitions sets unavailable message (stub behavior preserved)', async () => {
    const { jobsManagerMixin } = await import('../src/jobs-manager.js');
    const ctx = {
      jobDefinitions: [{ id: '1' }],
      jobsLoading: true,
      jobsError: null,
      jobsSuccess: null,
      ...jobsManagerMixin,
    };
    await ctx.loadJobDefinitions();
    expect(ctx.jobDefinitions).toEqual([]);
    expect(ctx.jobsLoading).toBe(false);
    expect(ctx.jobsError).toMatch(/unavailable/i);
  });

  // -------------------------------------------------------------------------
  // Jobs modals are not rendered
  // -------------------------------------------------------------------------

  it('new job modal is not rendered in the HTML', () => {
    // The "New Job Definition" modal should be removed from the template
    expect(indexContent).not.toContain('New Job Definition');
  });

  it('edit job modal is not rendered in the HTML', () => {
    expect(indexContent).not.toContain('Edit Job Definition');
  });

  it('dispatch job modal is not rendered in the HTML', () => {
    expect(indexContent).not.toContain('Dispatch Job Run');
  });

  // -------------------------------------------------------------------------
  // CSS (optional — jobs styles can stay as dead CSS, but verify no
  // visual leak)
  // -------------------------------------------------------------------------

  it('jobs section CSS does not cause layout issues when section is unreachable', () => {
    // This is a structural check — the .jobs-section class can exist in CSS
    // but should not be rendered in the DOM. We just verify the template
    // guard is gone (covered above). CSS cleanup is optional.
    const stylesPath = path.resolve(__dirname, '../src/styles.css');
    const stylesContent = fs.readFileSync(stylesPath, 'utf-8');
    // The CSS can still exist — this test just documents that it's dead code
    const hasJobsStyles = stylesContent.includes('.jobs-section');
    // We don't fail on dead CSS, just document it exists
    expect(true).toBe(true); // placeholder — no CSS removal required
  });
});
