import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const INDEX_PATH = resolve(process.cwd(), 'index.html');

describe('settings sharing template', () => {
  it('renders sharing groups from currentWorkspaceGroups', () => {
    const html = readFileSync(INDEX_PATH, 'utf8');

    expect(html).toContain('x-show="$store.chat.currentWorkspaceGroups.length === 0">No groups yet. Create one to start sharing.</p>');
    expect(html).toContain('x-show="$store.chat.currentWorkspaceGroups.length > 0"');
    expect(html).toContain('<template x-for="group in $store.chat.currentWorkspaceGroups" :key="group.group_id">');
    expect(html).toContain('x-model="$store.chat.shareInviteGroupId" :disabled="$store.chat.shareInvitePending || $store.chat.currentWorkspaceGroups.length === 0"');
    expect(html).toContain('x-show="$store.chat.currentWorkspaceGroups.length === 0">Create a group first.</p>');
  });
});
