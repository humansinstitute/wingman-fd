import { describe, expect, it } from 'vitest';

import {
  buildWorkspaceKey,
  findWorkspaceByKey,
  mergeWorkspaceEntries,
  normalizeWorkspaceEntry,
  workspaceFromToken,
} from '../src/workspaces.js';

describe('workspace identity keys', () => {
  it('prefers service_npub when building workspace keys', () => {
    expect(buildWorkspaceKey({
      workspaceOwnerNpub: 'npub1workspace',
      serviceNpub: 'npub1service',
      directHttpsUrl: 'https://sb.example',
    })).toBe('service:npub1service::workspace:npub1workspace');
  });

  it('falls back to url-scoped keys when service_npub is missing', () => {
    expect(buildWorkspaceKey({
      workspaceOwnerNpub: 'npub1workspace',
      directHttpsUrl: 'https://sb.example/',
    })).toBe('url:https://sb.example::workspace:npub1workspace');
  });
});

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
      admin_group_id: 'admin-group-1',
      admin_group_npub: 'npub1admin',
    });

    expect(workspace).toMatchObject({
      workspaceOwnerNpub: 'npub1workspace',
      name: 'Other Stuff',
      description: 'Workspace profile',
      avatarUrl: 'storage://avatar-1',
      adminGroupId: 'admin-group-1',
      adminGroupNpub: 'npub1admin',
    });
  });

  it('recovers backend metadata from a saved connection token', () => {
    const token = btoa(JSON.stringify({
      type: 'superbased_connection',
      version: 2,
      direct_https_url: 'https://sb4.otherstuff.studio',
      service_npub: 'npub1service',
      workspace_owner_npub: 'npub1workspace',
      app_npub: 'npub1app',
      relays: ['wss://relay.example'],
    }));

    const workspace = normalizeWorkspaceEntry({
      workspace_owner_npub: 'npub1workspace',
      connection_token: token,
    });

    expect(workspace).toMatchObject({
      workspaceKey: 'service:npub1service::workspace:npub1workspace',
      workspaceOwnerNpub: 'npub1workspace',
      directHttpsUrl: 'https://sb4.otherstuff.studio',
      serviceNpub: 'npub1service',
      appNpub: 'npub1app',
      relayUrls: ['wss://relay.example'],
      connectionToken: token,
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

  it('keeps distinct entries for the same workspace pubkey on different services', () => {
    const merged = mergeWorkspaceEntries([], [
      {
        workspace_owner_npub: 'npub1workspace',
        direct_https_url: 'https://sb4.otherstuff.ai',
        service_npub: 'npub1servicea',
        name: 'Other Stuff',
      },
      {
        workspace_owner_npub: 'npub1workspace',
        direct_https_url: 'https://sb4.otherstuff.studio',
        service_npub: 'npub1serviceb',
        name: 'Other Stuff',
      },
    ]);

    expect(merged).toHaveLength(2);
    expect(merged.map((entry) => entry.workspaceKey).sort()).toEqual([
      'service:npub1servicea::workspace:npub1workspace',
      'service:npub1serviceb::workspace:npub1workspace',
    ]);
  });

  it('keeps distinct legacy entries for the same workspace pubkey when neither side has a service key', () => {
    const merged = mergeWorkspaceEntries([], [
      {
        workspace_owner_npub: 'npub1workspace',
        direct_https_url: 'https://sb4.otherstuff.ai',
        name: 'Other Stuff',
      },
      {
        workspace_owner_npub: 'npub1workspace',
        direct_https_url: 'https://sb4.otherstuff.studio',
        name: 'Other Stuff',
      },
    ]);

    expect(merged).toHaveLength(2);
    expect(merged.map((entry) => entry.workspaceKey).sort()).toEqual([
      'url:https://sb4.otherstuff.ai::workspace:npub1workspace',
      'url:https://sb4.otherstuff.studio::workspace:npub1workspace',
    ]);
  });

  it('finds a workspace by composite workspace key', () => {
    const workspaces = mergeWorkspaceEntries([], [
      {
        workspace_owner_npub: 'npub1workspace',
        direct_https_url: 'https://sb4.otherstuff.ai',
        service_npub: 'npub1servicea',
      },
      {
        workspace_owner_npub: 'npub1workspace',
        direct_https_url: 'https://sb4.otherstuff.studio',
        service_npub: 'npub1serviceb',
      },
    ]);

    const found = findWorkspaceByKey(workspaces, 'service:npub1serviceb::workspace:npub1workspace');
    expect(found?.directHttpsUrl).toBe('https://sb4.otherstuff.studio');
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
