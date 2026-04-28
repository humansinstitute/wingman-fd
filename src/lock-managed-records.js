import { isFlightDeckCheckoutRequiredRecordFamily } from './record-checkout-policy.js';

function clean(value) {
  const normalized = String(value || '').trim();
  return normalized || '';
}

export function lockManagedRecordKey(recordId, recordFamilyHash) {
  const family = clean(recordFamilyHash);
  const record = clean(recordId);
  return family && record ? `${family}:${record}` : '';
}

export function isPhaseOneLockManagedFamily(recordFamilyHashOrFamily) {
  return isFlightDeckCheckoutRequiredRecordFamily(clean(recordFamilyHashOrFamily));
}

export function canActorEditOwnerOnlyLockManagedRecord({ actorNpub, creatorNpub } = {}) {
  const actor = clean(actorNpub);
  const creator = clean(creatorNpub);
  if (creator) return actor === creator;
  return Boolean(actor);
}

export function isCheckoutHeld(checkout = null, now = Date.now()) {
  const remainingMs = getCheckoutLeaseRemainingMs(checkout, now);
  if (remainingMs != null && remainingMs <= 0) return false;
  return clean(checkout?.state) === 'checked_out' && Boolean(clean(checkout?.checkout_id));
}

export function getCheckoutLeaseRemainingMs(checkout = null, now = Date.now()) {
  const leaseExpiresAt = clean(checkout?.lease_expires_at);
  if (!leaseExpiresAt) return null;
  const expiresAtMs = Date.parse(leaseExpiresAt);
  if (!Number.isFinite(expiresAtMs)) return null;
  return Math.max(0, expiresAtMs - now);
}

export function formatLeaseRemaining(checkout = null, now = Date.now()) {
  const remainingMs = getCheckoutLeaseRemainingMs(checkout, now);
  if (remainingMs == null) return '';
  if (remainingMs <= 0) return 'expired';
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s left`;
  if (seconds === 0) return `${minutes}m left`;
  return `${minutes}m ${seconds}s left`;
}

export function describeCheckoutHolder(checkout = null) {
  const checkedOutByUserNpub = clean(checkout?.checked_out_by_user_npub);
  const checkedOutByWorkspaceUserKeyNpub = clean(checkout?.checked_out_by_workspace_user_key_npub);
  return {
    userNpub: checkedOutByUserNpub || '',
    workspaceUserKeyNpub: checkedOutByWorkspaceUserKeyNpub || '',
    hasWorkspaceUserKey: Boolean(checkedOutByWorkspaceUserKeyNpub),
  };
}

export function checkoutErrorMessage(classification, checkout = null) {
  switch (classification) {
    case 'edit_policy_forbidden':
      return 'Read only for this checkout policy. Only the owner user can edit this record.';
    case 'record_checked_out': {
      const holder = describeCheckoutHolder(checkout);
      const lease = formatLeaseRemaining(checkout);
      const holderLabel = holder.userNpub || 'another user';
      return lease
        ? `Checked out by ${holderLabel}. ${lease}.`
        : `Checked out by ${holderLabel}.`;
    }
    case 'checkout_conflict':
      return 'Checkout state changed on Tower. Try acquiring the checkout again.';
    case 'checkout_not_owner':
      return 'This checkout belongs to a different actor.';
    case 'record_pull_forbidden':
      return 'You can read this record locally, but Tower denied a checkout refresh for your current identity.';
    case 'workspace_key_missing':
      return 'Workspace key missing. Bootstrap the workspace user key before editing.';
    case 'identity_alias_mismatch':
      return 'Checkout identity mismatch. Refresh the workspace identity and try again.';
    default:
      return 'Unable to acquire checkout for this record.';
  }
}
