import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const INDEX_PATH = resolve(process.cwd(), 'index.html');

describe('flight deck attention feed template', () => {
  it('labels the attention panel and renders grouped attention cards', () => {
    const html = readFileSync(INDEX_PATH, 'utf8');

    expect(html).toContain('<h3>Needs Attention</h3>');
    expect(html).toContain('x-text="$store.chat.attentionFeedSummary"');
    expect(html).toContain('x-for="group in $store.chat.attentionFeedGroups"');
    expect(html).toContain('x-for="item in group.items"');
    expect(html).toContain('@click="$store.chat.openAttentionItem(item)"');
    expect(html).toContain('@change="$store.chat.refreshStatusRecentChanges({ force: true })"');
  });

  it('uses the side column for timing instead of duplicating approvals', () => {
    const html = readFileSync(INDEX_PATH, 'utf8');

    expect(html).toContain('<h3>Timing</h3>');
    expect(html).toContain('x-show="$store.chat.statusTimingFeed.upcoming.length > 0"');
    expect(html).toContain('x-show="$store.chat.statusTimingFeed.justGone.length > 0"');
    expect(html).toContain('@click="$store.chat.openTimingItem(item)"');
    expect(html).not.toContain('class="flightdeck-side-panel flightdeck-approvals-panel"');
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

  it('orders opportunities below people and above setup in the sidebar', () => {
    const html = readFileSync(INDEX_PATH, 'utf8');
    const peopleIndex = html.indexOf('<span class="sidebar-label">People</span>');
    const opportunitiesIndex = html.indexOf('<span class="sidebar-label">Opportunities</span>');
    const setupIndex = html.indexOf('<span class="sidebar-label">Setup</span>');

    expect(peopleIndex).toBeGreaterThan(-1);
    expect(opportunitiesIndex).toBeGreaterThan(peopleIndex);
    expect(setupIndex).toBeGreaterThan(opportunitiesIndex);
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
    expect(html).toContain('draggable="true"');
    expect(html).toContain('@dragstart="$store.chat.startChannelTabDrag(ch.record_id, $event)"');
    expect(html).toContain('@drop.prevent="$store.chat.dropChannelTab(ch.record_id, $event)"');
    expect(html).toContain('class="chat-channel-menu chat-channel-tab-menu"');
    expect(html).toContain('class="chat-channel-menu-button"');
    expect(html).toContain('@click.stop.prevent="$store.chat.openChannelSettings()"');
    expect(html).not.toContain('class="chat-channel-tabs"');
    expect(html).not.toContain('class="sidebar-channels"');
    expect(html).not.toContain('class="sidebar-channel-item"');
  });
});
