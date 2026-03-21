import { describe, expect, it } from 'vitest';

import { mergeWorkspaceEntries, normalizeWorkspaceEntry, workspaceFromToken } from '../src/workspaces.js';

describe('workspace entry normalization', () => {
  it('keeps missing names empty so placeholders stay render-only', () => {
    const workspace = normalizeWorkspaceEntry({
      workspace_owner_npub: 'npub1workspace',
    });

    expect(workspace).toMatchObject({
      workspaceOwnerNpub: 'npub1workspace',
      name: '',
      description: '',
      avatarUrl: null,
    });
  });

  it('accepts workspace profile fields from snake_case payloads', () => {
    const workspace = normalizeWorkspaceEntry({
      workspace_owner_npub: 'npub1workspace',
      workspace_name: 'Other Stuff',
      workspace_description: 'Workspace profile',
      workspace_avatar_url: 'storage://avatar-1',
    });

    expect(workspace).toMatchObject({
      workspaceOwnerNpub: 'npub1workspace',
      name: 'Other Stuff',
      description: 'Workspace profile',
      avatarUrl: 'storage://avatar-1',
    });
  });

  it('preserves existing metadata when incoming workspace payloads are partial', () => {
    const existing = [{
      workspaceOwnerNpub: 'npub1workspace',
      name: 'Other Stuff',
      description: 'Main workspace',
      avatarUrl: 'storage://avatar-1',
      directHttpsUrl: 'https://sb.example',
      serviceNpub: 'npub1service',
      appNpub: 'npub1app',
      relayUrls: ['wss://relay.example'],
      connectionToken: 'token-1',
    }];

    const merged = mergeWorkspaceEntries(existing, [{
      workspace_owner_npub: 'npub1workspace',
      direct_https_url: 'https://tower.example',
    }]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      workspaceOwnerNpub: 'npub1workspace',
      name: 'Other Stuff',
      description: 'Main workspace',
      avatarUrl: 'storage://avatar-1',
      directHttpsUrl: 'https://tower.example',
    });
  });

  it('applies explicit clears from workspace settings payloads without wiping other fields', () => {
    const existing = [{
      workspaceOwnerNpub: 'npub1workspace',
      name: 'Other Stuff',
      description: 'Main workspace',
      avatarUrl: 'storage://avatar-1',
      directHttpsUrl: 'https://sb.example',
      serviceNpub: 'npub1service',
      appNpub: 'npub1app',
      relayUrls: ['wss://relay.example'],
      connectionToken: 'token-1',
    }];

    const merged = mergeWorkspaceEntries(existing, [{
      workspace_owner_npub: 'npub1workspace',
      workspace_description: '',
      workspace_avatar_url: null,
    }]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      workspaceOwnerNpub: 'npub1workspace',
      name: 'Other Stuff',
      description: '',
      avatarUrl: null,
      directHttpsUrl: 'https://sb.example',
    });
  });

  it('does not let token-derived workspace metadata erase an existing workspace name', () => {
    const existing = [{
      workspaceOwnerNpub: 'npub1workspaceowner',
      name: 'Named workspace',
      directHttpsUrl: 'https://sb.example',
      serviceNpub: 'npub1service',
      appNpub: 'npub1app',
      relayUrls: [],
      connectionToken: 'token-1',
    }];

    const token = btoa(JSON.stringify({
      kind: 30078,
      pubkey: 'f'.repeat(64),
      sig: 'sig',
      tags: [
        ['d', 'superbased-token'],
        ['service_npub', 'npub1service'],
        ['workspace_owner', 'npub1workspaceowner'],
        ['app_npub', 'npub1app'],
        ['backend_url', 'https://sb.example'],
      ],
    }));
    const tokenWorkspace = workspaceFromToken(token);

    const merged = mergeWorkspaceEntries(existing, [tokenWorkspace]);

    expect(merged[0]).toMatchObject({
      workspaceOwnerNpub: 'npub1workspaceowner',
      name: 'Named workspace',
      directHttpsUrl: 'https://sb.example',
      connectionToken: token,
    });
  });

  it('uses the workspace name embedded in a token when present', () => {
    const token = btoa(JSON.stringify({
      kind: 30078,
      pubkey: 'f'.repeat(64),
      sig: 'sig',
      tags: [
        ['d', 'superbased-token'],
        ['service_npub', 'npub1service'],
        ['workspace_owner', 'npub1workspaceowner'],
        ['workspace_name', 'Other Stuff'],
        ['app_npub', 'npub1app'],
        ['backend_url', 'https://sb.example'],
      ],
    }));

    expect(workspaceFromToken(token)).toMatchObject({
      workspaceOwnerNpub: 'npub1workspaceowner',
      name: 'Other Stuff',
      directHttpsUrl: 'https://sb.example',
    });
  });
});
