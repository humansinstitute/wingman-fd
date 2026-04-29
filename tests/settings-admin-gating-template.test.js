import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const INDEX_PATH = resolve(process.cwd(), 'index.html');

describe('settings admin gating template', () => {
  it('hides admin-only settings tabs and panes behind canAdminWorkspace', () => {
    const html = readFileSync(INDEX_PATH, 'utf8');

    expect(html).toContain('x-show="$store.chat.canAdminWorkspace" class="settings-tab" :class="{ active: $store.chat.settingsTab === \'workspace\' }"');
    expect(html).toContain('x-show="$store.chat.canAdminWorkspace" class="settings-tab" :class="{ active: $store.chat.settingsTab === \'automation\' }"');
    expect(html).toContain('x-show="$store.chat.canAdminWorkspace" class="settings-tab" :class="{ active: $store.chat.settingsTab === \'schedules\' }"');
    expect(html).toContain('x-show="$store.chat.canAdminWorkspace" class="settings-tab" :class="{ active: $store.chat.settingsTab === \'scopes\' }"');
    expect(html).toContain('x-show="$store.chat.canAdminWorkspace" class="settings-tab" :class="{ active: $store.chat.settingsTab === \'sharing\' }"');
    expect(html).toContain('<div class="settings-tab-content" x-show="$store.chat.canAdminWorkspace && $store.chat.settingsTab === \'workspace\'">');
    expect(html).toContain('<div class="settings-tab-content" x-show="$store.chat.canAdminWorkspace && $store.chat.settingsTab === \'automation\'">');
    expect(html).toContain('<div class="settings-tab-content" x-show="$store.chat.canAdminWorkspace && $store.chat.settingsTab === \'schedules\'">');
    expect(html).toContain('<div class="settings-tab-content" x-show="$store.chat.canAdminWorkspace && $store.chat.settingsTab === \'scopes\'">');
    expect(html).toContain('<div class="settings-tab-content" x-show="$store.chat.canAdminWorkspace && $store.chat.settingsTab === \'sharing\'">');
  });

  it('keeps flows visible as a regular settings tab', () => {
    const html = readFileSync(INDEX_PATH, 'utf8');

    expect(html).toContain('class="settings-tab" :class="{ active: $store.chat.settingsTab === \'flows\' }"');
    expect(html).toContain('<div class="settings-tab-content" x-show="$store.chat.settingsTab === \'flows\'">');
  });

  it('hides scope management controls behind canAdminWorkspace', () => {
    const html = readFileSync(INDEX_PATH, 'utf8');

    expect(html).toContain('<div class="scope-create-bar" x-show="$store.chat.canAdminWorkspace">');
    expect(html).toContain('<div class="scope-card-actions" x-show="$store.chat.canAdminWorkspace">');
  });
});
