import { beforeEach, describe, expect, it, vi } from 'vitest';

let activeSessionNpub = null;
let activeWorkspaceUserKeyNpub = null;

vi.mock('../src/crypto/group-keys.js', () => ({
  getActiveSessionNpub: vi.fn(() => activeSessionNpub),
}));

vi.mock('../src/crypto/workspace-keys.js', () => ({
  getActiveWorkspaceKeyNpub: vi.fn(() => activeWorkspaceUserKeyNpub),
}));

import {
  buildFlightDeckIdentityContext,
  buildGroupMemberIdentityFields,
  buildTowerIdentityFields,
  requireFlightDeckIdentityContext,
} from '../src/superbased/identity-context.js';

describe('Flight Deck Superbased identity context', () => {
  beforeEach(() => {
    activeSessionNpub = null;
    activeWorkspaceUserKeyNpub = null;
  });

  it('uses canonical names while accepting current Flight Deck state names', () => {
    activeWorkspaceUserKeyNpub = 'npub1workspaceuserkey';

    const context = buildFlightDeckIdentityContext({
      session: { npub: 'npub1realuser' },
      workspaceOwnerNpub: 'npub1workspaceservice',
    });

    expect(context).toEqual({
      userNpub: 'npub1realuser',
      actorNpub: 'npub1realuser',
      viewerNpub: 'npub1realuser',
      workspaceServiceNpub: 'npub1workspaceservice',
      workspaceUserKeyNpub: 'npub1workspaceuserkey',
      signerNpub: 'npub1workspaceuserkey',
    });
  });

  it('uses the real user for viewer semantics even when a workspace user key is active', () => {
    activeSessionNpub = 'npub1realuser';
    activeWorkspaceUserKeyNpub = 'npub1workspaceuserkey';

    const context = buildFlightDeckIdentityContext({
      workspaceServiceNpub: 'npub1workspaceservice',
    });

    expect(context.viewerNpub).toBe('npub1realuser');
    expect(context.viewerNpub).not.toBe('npub1workspaceuserkey');
  });

  it('uses the real user for group membership fields, never the workspace user key', () => {
    const memberFields = buildGroupMemberIdentityFields({
      userNpub: 'npub1realuser',
      workspaceServiceNpub: 'npub1workspaceservice',
      workspaceUserKeyNpub: 'npub1workspaceuserkey',
      signerNpub: 'npub1workspaceuserkey',
      viewerNpub: 'npub1realuser',
      actorNpub: 'npub1realuser',
    });

    expect(memberFields).toEqual({ member_npub: 'npub1realuser' });
  });

  it('does not fall back to the real user for signer semantics', () => {
    const context = buildFlightDeckIdentityContext({
      session: { npub: 'npub1realuser' },
      workspaceServiceNpub: 'npub1workspaceservice',
      signingNpub: 'npub1realuser',
    });

    expect(context.workspaceUserKeyNpub).toBeNull();
    expect(context.signerNpub).toBeNull();
  });

  it('fails clearly when a normal write identity is missing the workspace user key', () => {
    expect(() => requireFlightDeckIdentityContext({
      userNpub: 'npub1realuser',
      workspaceServiceNpub: 'npub1workspaceservice',
    })).toThrow(/workspaceUserKeyNpub/);
  });

  it('maps canonical context to Tower transition fields', () => {
    const fields = buildTowerIdentityFields({
      userNpub: 'npub1realuser',
      actorNpub: 'npub1realuser',
      viewerNpub: 'npub1realuser',
      workspaceServiceNpub: 'npub1workspaceservice',
      workspaceUserKeyNpub: 'npub1workspaceuserkey',
      signerNpub: 'npub1workspaceuserkey',
    });

    expect(fields).toEqual({
      owner_npub: 'npub1workspaceservice',
      workspace_service_npub: 'npub1workspaceservice',
      user_npub: 'npub1realuser',
      viewer_npub: 'npub1realuser',
      workspace_user_key_npub: 'npub1workspaceuserkey',
      signature_npub: 'npub1workspaceuserkey',
    });
  });
});
