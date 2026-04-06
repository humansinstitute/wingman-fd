function clean(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

export function getPrivateGroupRef({ memberPrivateGroup = null, currentWorkspace = null } = {}) {
  return clean(memberPrivateGroup?.group_id)
    || clean(currentWorkspace?.privateGroupId)
    || clean(memberPrivateGroup?.group_npub)
    || clean(currentWorkspace?.privateGroupNpub)
    || null;
}

export function getPrivateGroupNpub({ memberPrivateGroup = null, currentWorkspace = null } = {}) {
  return clean(memberPrivateGroup?.group_npub)
    || clean(currentWorkspace?.privateGroupNpub)
    || null;
}

export function getWorkspaceSettingsGroupRef({ memberPrivateGroup = null, currentWorkspace = null } = {}) {
  return clean(currentWorkspace?.adminGroupId)
    || clean(currentWorkspace?.adminGroupNpub)
    || clean(currentWorkspace?.defaultGroupId)
    || clean(currentWorkspace?.defaultGroupNpub)
    || getPrivateGroupRef({ memberPrivateGroup, currentWorkspace })
    || getPrivateGroupNpub({ memberPrivateGroup, currentWorkspace })
    || null;
}

export function getWorkspaceSettingsGroupNpub({ memberPrivateGroup = null, currentWorkspace = null } = {}) {
  return clean(currentWorkspace?.adminGroupNpub)
    || clean(currentWorkspace?.defaultGroupNpub)
    || getPrivateGroupNpub({ memberPrivateGroup, currentWorkspace })
    || null;
}
