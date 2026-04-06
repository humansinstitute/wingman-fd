import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../src/nostr-trigger.js', () => ({
  signAndPublishTrigger: vi.fn(async () => ({
    relayResults: { ok: ['wss://relay.primal.net'], failed: [] },
  })),
  npubToHex: vi.fn((npub) => {
    if (!String(npub || '').startsWith('npub1')) throw new Error('invalid');
    return 'a'.repeat(64);
  }),
}));

vi.mock('../src/auth/nostr.js', () => ({
  pubkeyToNpub: vi.fn(async (hex) => `npub1${String(hex).slice(0, 59)}`),
}));

import { triggersManagerMixin } from '../src/triggers-manager.js';
import { signAndPublishTrigger } from '../src/nostr-trigger.js';

function bindMethod(methodName, storeOverrides = {}) {
  const store = {
    newTriggerType: 'manual',
    newTriggerName: '',
    newTriggerId: '',
    newTriggerChannelId: '',
    newTriggerBotNpub: '',
    newTriggerBotQuery: '',
    channels: [],
    workspaceTriggers: [],
    triggerError: null,
    triggerSuccess: null,
    saveHarnessSettings: vi.fn(async () => {}),
    findPeopleSuggestions: vi.fn(() => []),
    ...storeOverrides,
  };

  const descriptors = Object.getOwnPropertyDescriptors(triggersManagerMixin);
  for (const [key, desc] of Object.entries(descriptors)) {
    if (Object.prototype.hasOwnProperty.call(storeOverrides, key)) continue;
    Object.defineProperty(store, key, desc);
  }

  const method = store[methodName];
  if (typeof method === 'function') {
    return { fn: method.bind(store), store };
  }
  return { store };
}

describe('triggersManagerMixin', () => {
  beforeEach(() => {
    globalThis.window = globalThis;
    window.confirm = vi.fn(() => true);
    vi.mocked(signAndPublishTrigger).mockClear();
  });

  it('converts a hex bot pubkey to npub after confirmation when adding a trigger', async () => {
    const { fn, store } = bindMethod('addTrigger', {
      newTriggerName: 'Chat Trigger',
      newTriggerId: 'trigger-123',
      newTriggerBotQuery: 'a'.repeat(64),
    });

    await fn();

    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(store.saveHarnessSettings).toHaveBeenCalledWith({ triggerOnly: true });
    expect(store.workspaceTriggers).toHaveLength(1);
    expect(store.workspaceTriggers[0].botNpub).toMatch(/^npub1/);
    expect(store.workspaceTriggers[0].botPubkeyHex).toBe('a'.repeat(64));
    expect(store.triggerError).toBeNull();
  });

  it('selects an exact bot name match from suggestions on enter', async () => {
    const { fn, store } = bindMethod('handleTriggerBotEnter', {
      newTriggerBotQuery: 'Wingman 21',
      findPeopleSuggestions: vi.fn(() => [
        { npub: 'npub1wingman21', label: 'Wingman 21', subtitle: 'npub1wingman21' },
        { npub: 'npub1wingman22', label: 'Wingman 22', subtitle: 'npub1wingman22' },
      ]),
    });

    await fn();

    expect(store.newTriggerBotNpub).toBe('npub1wingman21');
    expect(store.newTriggerBotQuery).toBe('');
    expect(store.triggerError).toBeNull();
  });

  it('stores a selected channel on chat channel triggers', async () => {
    const { fn, store } = bindMethod('addTrigger', {
      newTriggerType: 'chat_channel_message',
      newTriggerName: 'Ops Trigger',
      newTriggerId: 'trigger-ops',
      newTriggerChannelId: 'chan-ops',
      newTriggerBotNpub: 'npub1botops',
    });

    await fn();

    expect(store.workspaceTriggers).toHaveLength(1);
    expect(store.workspaceTriggers[0].channel_id).toBe('chan-ops');
  });

  it('fires chat channel triggers only for the configured channel', async () => {
    const { fn } = bindMethod('_fireMentionTriggers', {
      workspaceTriggers: [{
        id: 't1',
        name: 'Ops Channel Trigger',
        triggerType: 'chat_channel_message',
        trigger_id: 'trigger-ops',
        channel_id: 'chan-ops',
        botNpub: 'npub1botops',
        botPubkeyHex: 'a'.repeat(64),
        enabled: true,
      }],
    });

    fn('hello world', 'chat #ops', { channelId: 'chan-other' });
    expect(signAndPublishTrigger).not.toHaveBeenCalled();

    fn('hello world', 'chat #ops', { channelId: 'chan-ops' });
    expect(signAndPublishTrigger).toHaveBeenCalledWith(
      'trigger-ops',
      'a'.repeat(64),
      'New message in chat #ops: hello world',
    );
  });
});
