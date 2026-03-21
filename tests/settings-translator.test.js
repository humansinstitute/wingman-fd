import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/translators/record-crypto.js', () => ({
  decryptRecordPayload: vi.fn(async (record) => JSON.parse(record.owner_payload.ciphertext)),
  encryptOwnerPayload: vi.fn(async (_ownerNpub, payload) => ({ ciphertext: JSON.stringify(payload) })),
  buildGroupPayloads: vi.fn(async (groupNpubs, payload) =>
    groupNpubs.map((group_npub) => ({ group_npub, ciphertext: JSON.stringify(payload), write: true }))),
}));

import {
  inboundWorkspaceSettings,
  outboundWorkspaceSettings,
  recordFamilyHash,
  normalizeHarnessUrl,
} from '../src/translators/settings.js';
import { APP_NPUB } from '../src/app-identity.js';

describe('settings translator', () => {
  it('materializes a workspace settings record into a local row', async () => {
    const row = await inboundWorkspaceSettings({
      record_id: 'workspace-settings:npub_workspace',
      owner_npub: 'npub_workspace',
      version: 2,
      updated_at: '2026-03-16T00:00:00Z',
      owner_payload: {
        ciphertext: JSON.stringify({
          app_namespace: APP_NPUB,
          collection_space: 'settings',
          schema_version: 1,
          record_id: 'workspace-settings:npub_workspace',
          data: {
            workspace_owner_npub: 'npub_workspace',
            workspace_name: 'Other Stuff',
            workspace_description: 'Workspace profile',
            workspace_avatar_url: 'storage://avatar-1',
            wingman_harness_url: 'wm21.otherstuff.ai',
          },
        }),
      },
      group_payloads: [{ group_npub: 'gpub_workspace', ciphertext: '{}', write: true }],
    });

    expect(row.workspace_owner_npub).toBe('npub_workspace');
    expect(row.record_id).toBe('workspace-settings:npub_workspace');
    expect(row.workspace_name).toBe('Other Stuff');
    expect(row.workspace_description).toBe('Workspace profile');
    expect(row.workspace_avatar_url).toBe('storage://avatar-1');
    expect(row.wingman_harness_url).toBe('https://wm21.otherstuff.ai');
    expect(row.group_ids).toEqual(['gpub_workspace']);
    expect(row.sync_status).toBe('synced');
    expect(row.version).toBe(2);
  });

  it('builds a settings envelope with normalized harness url', async () => {
    const envelope = await outboundWorkspaceSettings({
      record_id: 'workspace-settings:npub_workspace',
      owner_npub: 'npub_workspace',
      workspace_owner_npub: 'npub_workspace',
      workspace_name: 'Other Stuff',
      workspace_description: 'Workspace profile',
      workspace_avatar_url: 'storage://avatar-1',
      wingman_harness_url: 'wm3.otherstuff.ai',
      group_ids: ['gpub_workspace'],
      signature_npub: 'npub_member',
    });

    expect(envelope.record_family_hash).toBe(`${APP_NPUB}:settings`);
    expect(envelope.group_payloads).toHaveLength(1);
    expect(envelope.group_payloads[0].group_npub).toBe('gpub_workspace');
    expect(envelope.signature_npub).toBe('npub_member');

    const payload = JSON.parse(envelope.owner_payload.ciphertext);
    expect(payload.collection_space).toBe('settings');
    expect(payload.data.workspace_owner_npub).toBe('npub_workspace');
    expect(payload.data.workspace_name).toBe('Other Stuff');
    expect(payload.data.workspace_description).toBe('Workspace profile');
    expect(payload.data.workspace_avatar_url).toBe('storage://avatar-1');
    expect(payload.data.wingman_harness_url).toBe('https://wm3.otherstuff.ai');
  });

  it('returns empty string for invalid harness urls', () => {
    expect(normalizeHarnessUrl('')).toBe('');
    expect(normalizeHarnessUrl('https://')).toBe('');
  });

  it('builds record family hashes for settings', () => {
    expect(recordFamilyHash('settings')).toBe(`${APP_NPUB}:settings`);
  });
});
