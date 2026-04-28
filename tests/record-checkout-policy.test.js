import { describe, expect, it } from 'vitest';

import {
  createFlightDeckRecordCheckoutPolicyResolver,
  isFlightDeckCheckoutRequiredRecordFamily,
  resolveFlightDeckRecordCheckoutPolicy,
  stripCheckoutForOptimisticWrite,
} from '../src/record-checkout-policy.js';

describe('Flight Deck record checkout policy registry', () => {
  it('defaults document and directory to checkout_required', () => {
    expect(resolveFlightDeckRecordCheckoutPolicy('coworker:document')).toBe('checkout_required');
    expect(resolveFlightDeckRecordCheckoutPolicy('coworker:directory')).toBe('checkout_required');
    expect(isFlightDeckCheckoutRequiredRecordFamily('coworker:document')).toBe(true);
    expect(isFlightDeckCheckoutRequiredRecordFamily('coworker:directory')).toBe(true);
  });

  it('defaults task, chat, and comment families to optimistic_write', () => {
    for (const family of ['task', 'chat', 'chat_message', 'channel', 'comment']) {
      expect(resolveFlightDeckRecordCheckoutPolicy(`coworker:${family}`)).toBe('optimistic_write');
      expect(isFlightDeckCheckoutRequiredRecordFamily(`coworker:${family}`)).toBe(false);
    }
  });

  it('can opt a future family into checkout_required through config only', () => {
    const config = { familySuffixes: { task: 'checkout_required' } };
    const resolver = createFlightDeckRecordCheckoutPolicyResolver(config);

    expect(resolver({ recordFamilyHash: 'coworker:task', recordId: 'task-1' })).toBe('checkout_required');
    expect(isFlightDeckCheckoutRequiredRecordFamily('coworker:task', config)).toBe(true);
    expect(resolveFlightDeckRecordCheckoutPolicy('coworker:comment', config)).toBe('optimistic_write');
  });

  it('strips stale checkout metadata from optimistic_write records', () => {
    const record = {
      record_id: 'task-1',
      record_family_hash: 'coworker:task',
      checkout: { checkout_id: 'stale-checkout', consume_on_success: true },
    };

    expect(stripCheckoutForOptimisticWrite(record)).toEqual({
      record_id: 'task-1',
      record_family_hash: 'coworker:task',
    });
  });
});
