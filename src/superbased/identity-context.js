import { getActiveSessionNpub } from '../crypto/group-keys.js';
import { getActiveWorkspaceKeyNpub } from '../crypto/workspace-keys.js';

function cleanNpub(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function firstNpub(...values) {
  for (const value of values) {
    const normalized = cleanNpub(value);
    if (normalized) return normalized;
  }
  return null;
}

function collectMissing(context, requirements) {
  const missing = [];
  if (requirements.requireUserNpub !== false && !context.userNpub) {
    missing.push('userNpub');
  }
  if (requirements.requireWorkspaceServiceNpub !== false && !context.workspaceServiceNpub) {
    missing.push('workspaceServiceNpub');
  }
  if (requirements.requireWorkspaceUserKeyNpub === true && !context.workspaceUserKeyNpub) {
    missing.push('workspaceUserKeyNpub');
  }
  return missing;
}

function identityError(missing) {
  const message = missing.includes('workspaceUserKeyNpub')
    ? 'Flight Deck identity context missing workspaceUserKeyNpub; bootstrap the workspace user key before normal record writes.'
    : `Flight Deck identity context missing ${missing.join(', ')}.`;
  const error = new Error(message);
  error.code = 'FD_IDENTITY_CONTEXT_MISSING';
  error.missing = missing;
  return error;
}

/**
 * Build the canonical Superbased identity context from current Flight Deck state.
 *
 * Legacy FD names are accepted at the boundary, but returned fields use the
 * canonical names from the Superbased identity model.
 */
export function buildFlightDeckIdentityContext(state = {}, options = {}) {
  const currentWorkspace = state.currentWorkspace || null;
  const connectionConfig = state.superbasedConnectionConfig || null;
  const session = state.session || null;

  const userNpub = firstNpub(
    state.userNpub,
    state.user_npub,
    session?.npub,
    getActiveSessionNpub(),
  );

  const workspaceServiceNpub = firstNpub(
    state.workspaceServiceNpub,
    state.workspace_service_npub,
    state.workspaceOwnerNpub,
    state.workspace_owner_npub,
    currentWorkspace?.workspaceServiceNpub,
    currentWorkspace?.workspace_service_npub,
    currentWorkspace?.workspaceOwnerNpub,
    currentWorkspace?.workspace_owner_npub,
    connectionConfig?.workspaceServiceNpub,
    connectionConfig?.workspace_service_npub,
    connectionConfig?.workspaceOwnerNpub,
    connectionConfig?.workspace_owner_npub,
    state.currentWorkspaceOwnerNpub,
    state.ownerNpub,
  );

  const workspaceUserKeyNpub = firstNpub(
    state.workspaceUserKeyNpub,
    state.workspace_user_key_npub,
    state.workspaceKeyNpub,
    state.workspace_key_npub,
    state.wsKeyNpub,
    state.ws_key_npub,
    getActiveWorkspaceKeyNpub(),
  );

  const context = {
    userNpub,
    actorNpub: userNpub,
    viewerNpub: userNpub,
    workspaceServiceNpub,
    workspaceUserKeyNpub,
    signerNpub: workspaceUserKeyNpub,
  };

  if (options.require === true || options.requireUserNpub || options.requireWorkspaceServiceNpub || options.requireWorkspaceUserKeyNpub) {
    const missing = collectMissing(context, options.require === true ? {
      requireUserNpub: true,
      requireWorkspaceServiceNpub: true,
      requireWorkspaceUserKeyNpub: true,
    } : options);
    if (missing.length > 0) throw identityError(missing);
  }

  return context;
}

export function requireFlightDeckIdentityContext(state = {}, options = {}) {
  return buildFlightDeckIdentityContext(state, {
    requireUserNpub: true,
    requireWorkspaceServiceNpub: true,
    requireWorkspaceUserKeyNpub: true,
    ...options,
  });
}

export function buildTowerIdentityFields(context) {
  const identity = buildFlightDeckIdentityContext(context || {});
  return {
    owner_npub: identity.workspaceServiceNpub,
    workspace_service_npub: identity.workspaceServiceNpub,
    user_npub: identity.userNpub,
    viewer_npub: identity.viewerNpub,
    workspace_user_key_npub: identity.workspaceUserKeyNpub,
    signature_npub: identity.signerNpub,
  };
}

export function buildGroupMemberIdentityFields(context) {
  const identity = buildFlightDeckIdentityContext(context || {});
  return {
    member_npub: identity.userNpub,
  };
}
