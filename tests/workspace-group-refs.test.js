import { describe, expect, it } from 'vitest';

import {
  getPrivateGroupNpub,
  getPrivateGroupRef,
  getWorkspaceSettingsGroupNpub,
  getWorkspaceSettingsGroupRef,
} from '../src/workspace-group-refs.js';

describe('workspace group refs', () => {
  const currentWorkspace = {
    defaultGroupId: '67f9a29d-60ba-458e-adea-d27555e53be1',
    defaultGroupNpub: 'npub1workspace_shared',
    adminGroupId: '99f9a29d-60ba-458e-adea-d27555e53be1',
    adminGroupNpub: 'npub1workspace_admin',
    privateGroupId: 'f2d2f1d9-9b27-4694-b6ef-5ab4d66fa9d7',
    privateGroupNpub: 'npub1workspace_private',
  };

  const memberPrivateGroup = {
    group_id: 'f2d2f1d9-9b27-4694-b6ef-5ab4d66fa9d7',
    group_npub: 'npub1workspace_private',
  };

  it('prefers npubs for storage and current-epoch write helpers', () => {
    expect(getPrivateGroupNpub({ memberPrivateGroup, currentWorkspace })).toBe('npub1workspace_private');
    expect(getWorkspaceSettingsGroupNpub({ memberPrivateGroup, currentWorkspace })).toBe('npub1workspace_admin');
  });

  it('preserves stable refs for board and assignment helpers', () => {
    expect(getPrivateGroupRef({ memberPrivateGroup, currentWorkspace })).toBe('f2d2f1d9-9b27-4694-b6ef-5ab4d66fa9d7');
    expect(getWorkspaceSettingsGroupRef({ memberPrivateGroup, currentWorkspace })).toBe('99f9a29d-60ba-458e-adea-d27555e53be1');
  });

  it('falls back to ids when only ids are available', () => {
    expect(getPrivateGroupNpub({
      currentWorkspace: { privateGroupId: currentWorkspace.privateGroupId },
    })).toBeNull();
    expect(getWorkspaceSettingsGroupNpub({
      currentWorkspace: { defaultGroupId: currentWorkspace.defaultGroupId },
    })).toBeNull();
    expect(getWorkspaceSettingsGroupNpub({
      currentWorkspace: { adminGroupId: currentWorkspace.adminGroupId },
    })).toBeNull();
  });

  it('still returns stable refs when only ids are available', () => {
    expect(getPrivateGroupRef({
      currentWorkspace: { privateGroupId: currentWorkspace.privateGroupId },
    })).toBe(currentWorkspace.privateGroupId);
    expect(getWorkspaceSettingsGroupRef({
      currentWorkspace: { defaultGroupId: currentWorkspace.defaultGroupId },
    })).toBe(currentWorkspace.defaultGroupId);
    expect(getWorkspaceSettingsGroupRef({
      currentWorkspace: { adminGroupId: currentWorkspace.adminGroupId },
    })).toBe(currentWorkspace.adminGroupId);
  });
});
