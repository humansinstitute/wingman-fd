import { beforeEach, describe, expect, it, vi } from 'vitest';

let storedCreds = null;
const { refreshCredentialExpiryMock } = vi.hoisted(() => ({
  refreshCredentialExpiryMock: vi.fn(async () => {}),
}));

vi.mock('../src/auth/secure-store.js', () => ({
  storeCredentials: vi.fn(async (record) => {
    storedCreds = { ...(storedCreds || {}), ...record };
  }),
  getStoredCredentials: vi.fn(async () => storedCreds),
  clearCredentials: vi.fn(async () => {
    storedCreds = null;
  }),
  refreshCredentialExpiry: refreshCredentialExpiryMock,
}));

vi.mock('nostr-tools', () => ({
  generateSecretKey: () => new Uint8Array(32).fill(1),
  getPublicKey: () => 'a'.repeat(64),
  finalizeEvent: (template) => ({
    ...template,
    id: 'test-id',
    sig: 'test-sig',
    pubkey: 'a'.repeat(64),
  }),
  nip19: {
    decode: (value) => {
      if (!value.startsWith('nsec1')) throw new Error('invalid');
      return { type: 'nsec', data: new Uint8Array(32).fill(2) };
    },
    npubEncode: (hex) => `npub1${hex.slice(0, 59)}`,
    nsecEncode: () => 'nsec1mocksecret',
  },
  nip44: {
    getConversationKey: () => 'conversation-key',
    encrypt: (plaintext) => `enc:${plaintext}`,
    decrypt: (ciphertext) => ciphertext.replace(/^enc:/, ''),
  },
}));

vi.mock('nostr-tools/nip46', () => ({
  parseBunkerInput: async () => ({ relay: 'wss://relay.test' }),
  BunkerSigner: class {
    async connect() {}
    async signEvent(event) {
      return { ...event, pubkey: 'b'.repeat(64), id: 'bunker-id', sig: 'bunker-sig' };
    }
  },
}));

import {
  APP_TAG,
  LOGIN_KIND,
  STORAGE_KEYS,
  buildUnsignedEvent,
  createNip98AuthHeader,
  bytesToHex,
  clearAutoLogin,
  clearMemoryCredentials,
  decodeNsec,
  getAutoLoginMethod,
  getMemoryPubkey,
  hexToBytes,
  pubkeyToNpub,
  setAutoLogin,
  setMemoryPubkey,
  signLoginEvent,
  waitForExtensionSigner,
} from '../src/auth/nostr.js';

describe('auth/nostr helpers', () => {
  beforeEach(() => {
    storedCreds = null;
    globalThis.window = globalThis;
    localStorage.clear();
    clearMemoryCredentials();
    refreshCredentialExpiryMock.mockClear();
    delete window.nostr;
  });

  it('buildUnsignedEvent creates a login event with method tag', () => {
    const event = buildUnsignedEvent('ephemeral');
    expect(event.kind).toBe(LOGIN_KIND);
    expect(event.tags).toContainEqual(['app', APP_TAG]);
    expect(event.tags).toContainEqual(['method', 'ephemeral']);
  });

  it('hexToBytes and bytesToHex round-trip', () => {
    const original = 'deadbeef';
    expect(bytesToHex(hexToBytes(original))).toBe(original);
  });

  it('decodeNsec accepts nsec values', () => {
    const secret = decodeNsec('nsec1test');
    expect(secret).toBeInstanceOf(Uint8Array);
    expect(secret.length).toBe(32);
  });

  it('setAutoLogin persists and clearAutoLogin removes auth keys', async () => {
    setAutoLogin('ephemeral', 'f'.repeat(64));
    expect(getAutoLoginMethod()).toBe('ephemeral');
    expect(localStorage.getItem(STORAGE_KEYS.AUTO_LOGIN_PUBKEY)).toBe('f'.repeat(64));

    await clearAutoLogin();
    expect(getAutoLoginMethod()).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.AUTO_LOGIN_PUBKEY)).toBeNull();
  });

  it('login with extension uses the browser signer pubkey', async () => {
    window.nostr = {
      getPublicKey: vi.fn(async () => 'c'.repeat(64)),
      signEvent: vi.fn(async (event) => ({ ...event, id: 'ext-id', sig: 'ext-sig' })),
    };

    const event = await signLoginEvent('extension');
    expect(event.pubkey).toBe('c'.repeat(64));
  });

  it('rejects extension auth if the signer pubkey changed since login', async () => {
    window.nostr = {
      getPublicKey: vi.fn(async () => 'c'.repeat(64)),
      signEvent: vi.fn(async (event) => ({ ...event, id: 'ext-id', sig: 'ext-sig' })),
    };

    await signLoginEvent('extension');

    window.nostr.getPublicKey = vi.fn(async () => 'd'.repeat(64));
    window.nostr.signEvent = vi.fn(async (event) => ({ ...event, pubkey: 'd'.repeat(64), id: 'ext-id-2', sig: 'ext-sig-2' }));

    await expect(
      createNip98AuthHeader('https://example.test/api/v4/storage/obj-1/complete', 'POST', { ok: true }),
    ).rejects.toThrow('NIP-07 signer pubkey changed since login. Sign in again.');
  });

  it('waits briefly for a late-injected extension signer', async () => {
    setTimeout(() => {
      window.nostr = {
        getPublicKey: vi.fn(async () => 'd'.repeat(64)),
        signEvent: vi.fn(async (event) => ({ ...event, id: 'late-id', sig: 'late-sig' })),
      };
    }, 20);

    await expect(waitForExtensionSigner(250, 10)).resolves.toBe(true);
  });

  it('createNip98AuthHeader signs a request with the current session', async () => {
    await signLoginEvent('ephemeral');
    const header = await createNip98AuthHeader('https://example.test/api/v4/records', 'GET');
    expect(header.startsWith('Nostr ')).toBe(true);
    const encoded = header.slice(6);
    const event = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    expect(event.kind).toBe(LOGIN_KIND);
    expect(event.tags).toContainEqual(['u', 'https://example.test/api/v4/records']);
    expect(event.tags).toContainEqual(['method', 'GET']);
    expect(refreshCredentialExpiryMock).toHaveBeenCalledTimes(1);
  });

  it('pubkeyToNpub returns an npub string', async () => {
    setMemoryPubkey('a'.repeat(64));
    expect(getMemoryPubkey()).toBe('a'.repeat(64));
    const npub = await pubkeyToNpub('a'.repeat(64));
    expect(npub.startsWith('npub1')).toBe(true);
  });
});
