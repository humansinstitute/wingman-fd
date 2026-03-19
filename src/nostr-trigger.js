import { finalizeEvent, nip44, SimplePool } from 'nostr-tools';
import { getMemorySecret, decodeNpub } from './auth/nostr.js';

const TRIGGER_KIND = 9256;
const RELAYS = ['wss://relay.primal.net', 'wss://relay.damus.io'];

function normalizeSecret(secret) {
  if (secret instanceof Uint8Array) return secret;
  if (typeof secret === 'string') {
    return Uint8Array.from(secret.match(/.{1,2}/g) || [], (byte) => parseInt(byte, 16));
  }
  throw new Error('Secret key is required.');
}

/**
 * Sign and publish a kind 9256 trigger event.
 * Encrypts the trigger payload (NIP-44) to the bot's pubkey.
 *
 * @param {string} triggerId - The job UUID from the scheduler
 * @param {string} botPubkeyHex - The bot's pubkey (hex, 64 chars)
 * @param {string} [message] - Optional context message
 * @returns {{ event: Object, relayResults: { ok: string[], failed: string[] } }}
 */
export async function signAndPublishTrigger(triggerId, botPubkeyHex, message = '') {
  const secret = getMemorySecret();

  if (!secret) {
    // Extension (NIP-07) path
    if (!window.nostr?.nip44?.encrypt || !window.nostr?.signEvent) {
      throw new Error('Trigger publishing requires NIP-07 extension with NIP-44 support, or a direct key.');
    }
    const payload = JSON.stringify({
      type: 'trigger',
      trigger_id: triggerId,
      ...(message ? { message } : {}),
    });

    const encrypted = await window.nostr.nip44.encrypt(botPubkeyHex, payload);
    const unsigned = {
      kind: TRIGGER_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', botPubkeyHex]],
      content: encrypted,
    };
    const signedEvent = await window.nostr.signEvent(unsigned);
    const relayResults = await publishToRelays(signedEvent, RELAYS);
    return { event: signedEvent, relayResults };
  }

  // Direct key path
  const payload = JSON.stringify({
    type: 'trigger',
    trigger_id: triggerId,
    ...(message ? { message } : {}),
  });

  const conversationKey = nip44.getConversationKey(normalizeSecret(secret), botPubkeyHex);
  const encrypted = nip44.encrypt(payload, conversationKey);

  const signedEvent = finalizeEvent({
    kind: TRIGGER_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', botPubkeyHex]],
    content: encrypted,
  }, normalizeSecret(secret));

  const relayResults = await publishToRelays(signedEvent, RELAYS);
  return { event: signedEvent, relayResults };
}

async function publishToRelays(event, relays) {
  const ok = [];
  const failed = [];
  const pool = new SimplePool();

  try {
    const results = await Promise.allSettled(
      relays.map(async (relay) => {
        try {
          await Promise.race([
            pool.publish([relay], event),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
          ]);
          return { relay, success: true };
        } catch {
          return { relay, success: false };
        }
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.success) {
        ok.push(result.value.relay);
      } else {
        const relay = result.status === 'fulfilled' ? result.value.relay : 'unknown';
        failed.push(relay);
      }
    }
  } finally {
    pool.close(relays);
  }

  return { ok, failed };
}

/**
 * Convert npub to hex pubkey for trigger storage.
 */
export function npubToHex(npub) {
  return decodeNpub(npub);
}
