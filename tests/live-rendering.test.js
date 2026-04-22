import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const htmlPath = path.resolve(import.meta.dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf-8');

describe('Wingmen Live rendering hooks', () => {
  it('renders a real Live nav entry instead of only the external Autopilot link', () => {
    expect(html).toContain("navSection === 'live'");
    expect(html).toContain("navigateTo('live')");
    expect(html).toContain('sidebar-label">Live<');
  });

  it('renders drawer hooks for metadata and responsive takeover behavior', () => {
    expect(html).toContain('live-session-drawer');
    expect(html).toContain('live-session-drawer-backdrop');
    expect(html).toContain('openLiveDrawer()');
    expect(html).toContain('closeLiveDrawer()');
    expect(html).toContain('live-session-layout-desktop');
    expect(html).toContain('live-session-layout-mobile');
  });

  it('renders session metadata controls and Night Watch history modal hooks', () => {
    expect(html).toContain('live-session-goal-input');
    expect(html).toContain('live-session-next-action-input');
    expect(html).toContain('toggleLiveNightWatch');
    expect(html).toContain('live-related-records');
    expect(html).toContain('live-nightwatch-history-row');
    expect(html).toContain('openLiveNightWatchReportModal');
    expect(html).toContain('live-nightwatch-report-modal');
  });
});
