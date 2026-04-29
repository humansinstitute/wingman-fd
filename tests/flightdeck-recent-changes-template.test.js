import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const INDEX_PATH = resolve(process.cwd(), 'index.html');

describe('flight deck recent changes template', () => {
  it('labels the activity panel and filters rows by record type', () => {
    const html = readFileSync(INDEX_PATH, 'utf8');

    expect(html).toContain('<h3>Recent Changes</h3>');
    expect(html).toContain('x-model="$store.chat.statusRecordTypeFilter" aria-label="Recent changes record type"');
    expect(html).toContain('x-for="option in $store.chat.statusRecordTypeOptions"');
    expect(html).toContain('x-for="item in $store.chat.filteredStatusRecentChanges"');
  });

  it('does not expose the removed calendar surface', () => {
    const html = readFileSync(INDEX_PATH, 'utf8');

    expect(html).not.toContain("navigateTo('calendar')");
    expect(html).not.toContain("navSection === 'calendar'");
    expect(html).not.toContain('<span class="sidebar-label">Calendar</span>');
  });

  it('moves schedules into settings instead of exposing a top-level section', () => {
    const html = readFileSync(INDEX_PATH, 'utf8');

    expect(html).not.toContain("navigateTo('schedules')");
    expect(html).not.toContain("navSection === 'schedules'");
    expect(html).not.toContain('<span class="sidebar-label">Schedules</span>');
    expect(html).toContain("settingsTab === 'schedules'");
  });

  it('moves scopes into settings instead of exposing a top-level section', () => {
    const html = readFileSync(INDEX_PATH, 'utf8');

    expect(html).not.toContain("navigateTo('scopes')");
    expect(html).not.toContain("navSection === 'scopes'");
    expect(html).not.toContain('<span class="sidebar-label">Scopes</span>');
    expect(html).toContain("settingsTab === 'scopes'");
  });

  it('moves flows into settings instead of exposing a top-level section', () => {
    const html = readFileSync(INDEX_PATH, 'utf8');

    expect(html).not.toContain("navigateTo('flows')");
    expect(html).not.toContain("navSection === 'flows'");
    expect(html).not.toContain('<span class="sidebar-label">Flows</span>');
    expect(html).toContain("settingsTab === 'flows'");
  });

  it('labels setup without changing the settings route', () => {
    const html = readFileSync(INDEX_PATH, 'utf8');

    expect(html).toContain('@click="$store.chat.navigateTo(\'settings\')">Setup</button>');
    expect(html).toContain('<span class="sidebar-label">Setup</span>');
    expect(html).not.toContain('<span class="sidebar-label">Settings</span>');
  });

  it('removes reports from the sidebar and routes report cards into reports', () => {
    const html = readFileSync(INDEX_PATH, 'utf8');

    expect(html).not.toContain('<span class="sidebar-label">Reports</span>');
    expect(html).toContain('class="flightdeck-report-card flightdeck-report-card-link"');
    expect(html).toContain('@click="$store.chat.selectedReportId = report.record_id; $store.chat.navigateTo(\'reports\')"');
  });

  it('renders chat channels as in-view tabs instead of sidebar rows', () => {
    const html = readFileSync(INDEX_PATH, 'utf8');

    expect(html).toContain('class="chat-channel-header" x-show="$store.chat.navSection === \'chat\'"');
    expect(html).toContain('class="chat-channel-tab-item"');
    expect(html).toContain('class="chat-channel-tab-scroll" role="tablist" aria-label="Chat channels"');
    expect(html).toContain('class="chat-channel-tab"');
    expect(html).toContain('class="chat-channel-menu chat-channel-tab-menu"');
    expect(html).not.toContain('class="chat-channel-tabs"');
    expect(html).not.toContain('class="sidebar-channels"');
    expect(html).not.toContain('class="sidebar-channel-item"');
  });
});
