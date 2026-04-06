/**
 * WP3 Write Contract Diagnostics
 *
 * Validates signer and write-group consistency before sync.
 * Returns diagnostic messages for logging — does not throw.
 */

/**
 * Check whether a record needs a group write token.
 *
 * @param {object} record - The outbound record envelope
 * @param {string} ownerNpub - Workspace owner npub
 * @param {string} [signingNpub] - Active session signer (workspace key or real key)
 * @returns {boolean} true if group write token is required
 */
export function needsGroupWriteToken(record, ownerNpub, signingNpub) {
  const sigNpub = String(record?.signature_npub || '').trim();
  const owner = String(ownerNpub || '').trim();

  if (sigNpub === owner) return false;
  if (signingNpub && sigNpub === String(signingNpub).trim()) return false;

  return true;
}

/**
 * Validate signer and write-group consistency for a record.
 *
 * @param {object} record - The outbound record envelope
 * @param {string} ownerNpub - Workspace owner npub
 * @param {string} [signingNpub] - Active session signer (workspace key or real key)
 * @returns {string[]} Array of diagnostic warnings (empty = no issues)
 */
export function diagnoseWriteContract(record, ownerNpub, signingNpub) {
  const warnings = [];
  const sigNpub = String(record?.signature_npub || '').trim();
  const owner = String(ownerNpub || '').trim();
  const groupRef = String(record?.write_group_id || record?.write_group_npub || '').trim();

  if (!sigNpub) {
    warnings.push('record missing signature_npub');
  }

  const isOwnerWrite = sigNpub === owner
    || (signingNpub && sigNpub === String(signingNpub).trim());

  if (!isOwnerWrite && !groupRef) {
    warnings.push(
      `non-owner signer ${sigNpub} has no write_group_id or write_group_npub — Tower will reject`
    );
  }

  if (signingNpub && sigNpub !== owner && sigNpub !== String(signingNpub).trim()) {
    warnings.push(
      `signature_npub ${sigNpub} does not match owner ${owner} or session signer ${signingNpub}`
    );
  }

  return warnings;
}
