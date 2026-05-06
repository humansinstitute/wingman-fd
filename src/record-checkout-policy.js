import {
  createRecordCheckoutPolicyResolver,
  isCheckoutRequiredRecordFamily,
  resolveRecordCheckoutPolicy,
} from '@nostr-superbased/core/records';

const CHECKOUT_REQUIRED = 'checkout_required';
const OPTIMISTIC_WRITE = 'optimistic_write';
const VALID_POLICIES = new Set([CHECKOUT_REQUIRED, OPTIMISTIC_WRITE]);

function clean(value) {
  const normalized = String(value || '').trim();
  return normalized || '';
}

function normalizePolicy(value) {
  return VALID_POLICIES.has(value) ? value : null;
}

function normalizePolicyMap(map = {}) {
  const entries = Object.entries(map || {})
    .map(([key, policy]) => [clean(key), normalizePolicy(policy)])
    .filter(([key, policy]) => Boolean(key && policy));
  return Object.fromEntries(entries);
}

export const FLIGHT_DECK_RECORD_CHECKOUT_POLICY_CONFIG = Object.freeze({
  recordFamilyHashes: Object.freeze({}),
  familySuffixes: Object.freeze({
    document: CHECKOUT_REQUIRED,
    directory: CHECKOUT_REQUIRED,
    task: OPTIMISTIC_WRITE,
    chat: OPTIMISTIC_WRITE,
    chat_message: OPTIMISTIC_WRITE,
    channel: OPTIMISTIC_WRITE,
    comment: OPTIMISTIC_WRITE,
    scope: OPTIMISTIC_WRITE,
    flow: OPTIMISTIC_WRITE,
    approval: OPTIMISTIC_WRITE,
  }),
});

export function normalizeFlightDeckRecordCheckoutPolicyConfig(config = {}) {
  const source = config || {};
  return {
    recordFamilyHashes: {
      ...FLIGHT_DECK_RECORD_CHECKOUT_POLICY_CONFIG.recordFamilyHashes,
      ...normalizePolicyMap(source.recordFamilyHashes),
    },
    familySuffixes: {
      ...FLIGHT_DECK_RECORD_CHECKOUT_POLICY_CONFIG.familySuffixes,
      ...normalizePolicyMap(source.familySuffixes),
    },
  };
}

export function createFlightDeckRecordCheckoutPolicyResolver(config = {}) {
  return createRecordCheckoutPolicyResolver(normalizeFlightDeckRecordCheckoutPolicyConfig(config));
}

export function resolveFlightDeckRecordCheckoutPolicy(recordFamilyHash, config = {}, input = {}) {
  return resolveRecordCheckoutPolicy(
    clean(recordFamilyHash),
    normalizeFlightDeckRecordCheckoutPolicyConfig(config),
    input,
  );
}

export function isFlightDeckCheckoutRequiredRecordFamily(recordFamilyHash, config = {}) {
  return isCheckoutRequiredRecordFamily(
    clean(recordFamilyHash),
    normalizeFlightDeckRecordCheckoutPolicyConfig(config),
  );
}

export function stripCheckoutForOptimisticWrite(record, config = {}) {
  if (!record || typeof record !== 'object') return record;
  const policy = resolveFlightDeckRecordCheckoutPolicy(record.record_family_hash, config, {
    recordId: record.record_id,
  });
  if (policy !== OPTIMISTIC_WRITE) return record;
  const { checkout: _checkout, ...recordWithoutCheckout } = record;
  return recordWithoutCheckout;
}
