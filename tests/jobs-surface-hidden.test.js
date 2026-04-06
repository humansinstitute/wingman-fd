import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const indexPath = path.resolve(__dirname, '../index.html');
const indexContent = fs.readFileSync(indexPath, 'utf-8');

// ---------------------------------------------------------------------------
// 1. Sidebar nav item must not be visible
// ---------------------------------------------------------------------------

describe('Jobs nav item is hidden', () => {
  it('sidebar does not contain a visible Jobs nav item', () => {
    // The Jobs <li> should have x-show="false" or be removed entirely.
    // It must NOT have x-show="$store.chat.hasHarnessLink" gating the jobs item.
    const jobsNavRe = /x-show="\$store\.chat\.hasHarnessLink"[^>]*jobs/i;
    expect(indexContent).not.toMatch(jobsNavRe);

    // Confirm x-show="false" is present on the jobs nav <li>
    const hiddenJobsNav = /x-show="false"[\s\S]*?sidebar-label">Jobs</;
    expect(indexContent).toMatch(hiddenJobsNav);
  });
});

// ---------------------------------------------------------------------------
// 2. Jobs page template does not render
// ---------------------------------------------------------------------------

describe('Jobs page template is disabled', () => {
  it('no Jobs page template renders when navSection is jobs', () => {
    // The template guard should NOT be navSection === 'jobs'
    const activeJobsTemplate = /<template\s+x-if="\$store\.chat\.navSection\s*===\s*'jobs'">/;
    expect(indexContent).not.toMatch(activeJobsTemplate);
  });

  it('jobs template uses a false guard', () => {
    // Should be x-if="false && \'jobs-hidden\'" or similar
    expect(indexContent).toMatch(/x-if="false\s*&&\s*'jobs-hidden'"/);
  });
});

// ---------------------------------------------------------------------------
// 3. Route helpers no longer recognize jobs
// ---------------------------------------------------------------------------

describe('jobs removed from route helpers', () => {
  it("'jobs' is not in KNOWN_PAGES", async () => {
    const { KNOWN_PAGES } = await import('../src/route-helpers.js');
    expect(KNOWN_PAGES.has('jobs')).toBe(false);
  });

  it("pageToSection('jobs') returns null", async () => {
    const { pageToSection } = await import('../src/route-helpers.js');
    expect(pageToSection('jobs')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. jobs-manager.js mixin still exports (preserved for future)
// ---------------------------------------------------------------------------

describe('jobs-manager.js mixin preserved', () => {
  it('jobsManagerMixin is still exported', async () => {
    const mod = await import('../src/jobs-manager.js');
    expect(mod.jobsManagerMixin).toBeDefined();
    expect(typeof mod.jobsManagerMixin.loadJobDefinitions).toBe('function');
  });

  it('loadJobDefinitions sets unavailable message', async () => {
    const { jobsManagerMixin } = await import('../src/jobs-manager.js');
    const ctx = {
      jobDefinitions: [],
      jobsLoading: true,
      jobsError: null,
      jobsSuccess: 'ok',
      ...jobsManagerMixin,
    };
    // Bind setJobsUnavailable so loadJobDefinitions can call it
    ctx.setJobsUnavailable = jobsManagerMixin.setJobsUnavailable.bind(ctx);
    ctx.loadJobDefinitions = jobsManagerMixin.loadJobDefinitions.bind(ctx);
    await ctx.loadJobDefinitions();
    expect(ctx.jobsError).toBeTruthy();
    expect(ctx.jobsLoading).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Job modals removed from HTML
// ---------------------------------------------------------------------------

describe('Job modals removed from HTML', () => {
  it('New Job modal is not in the HTML', () => {
    expect(indexContent).not.toContain('showNewJobModal');
  });

  it('Edit Job modal is not in the HTML', () => {
    expect(indexContent).not.toContain('showEditJobModal');
  });

  it('Dispatch Job modal is not in the HTML', () => {
    expect(indexContent).not.toContain('showDispatchModal');
  });
});
