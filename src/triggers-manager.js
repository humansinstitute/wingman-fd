/**
 * Trigger management methods extracted from app.js.
 *
 * The triggersManagerMixin object contains methods that use `this` (the Alpine store)
 * and should be spread into the store definition.
 */

import { pubkeyToNpub } from './auth/nostr.js';
import { signAndPublishTrigger, npubToHex } from './nostr-trigger.js';

function isHexPubkey(value) {
  return /^[0-9a-f]{64}$/i.test(String(value || '').trim());
}

// ---------------------------------------------------------------------------
// Mixin — methods that use `this` (the Alpine store)
// ---------------------------------------------------------------------------

export const triggersManagerMixin = {

  get triggerBotSuggestions() {
    return this.findPeopleSuggestions(this.newTriggerBotQuery, []);
  },

  get triggerChannelOptions() {
    return (this.channels || [])
      .filter((channel) => channel?.record_state !== 'deleted')
      .map((channel) => ({
        id: String(channel.record_id || ''),
        label: this.getChannelLabel(channel),
      }))
      .filter((channel) => channel.id);
  },

  triggerTypeLabel(type) {
    const labels = {
      manual: 'Manual',
      chat_bot_tagged: 'Bot @tagged anywhere',
      chat_channel_message: 'Chat: Any message in channel',
    };
    return labels[type] || type;
  },

  selectTriggerBot(npub) {
    this.newTriggerBotNpub = npub;
    this.newTriggerBotQuery = '';
  },

  clearTriggerBot() {
    this.newTriggerBotNpub = '';
    this.newTriggerBotQuery = '';
  },

  onTriggerTypeChange() {
    if (this.newTriggerType !== 'chat_channel_message') {
      this.newTriggerChannelId = '';
    }
  },

  getTriggerChannelLabel(trigger) {
    const channelId = String(trigger?.channel_id || '').trim();
    if (!channelId) return 'Any channel';
    const channel = (this.channels || []).find((candidate) => candidate?.record_id === channelId);
    return channel ? this.getChannelLabel(channel) : `Channel ${channelId}`;
  },

  async resolveTriggerBotInput({ confirmHex = false } = {}) {
    const selectedNpub = this.newTriggerBotNpub.trim();
    if (selectedNpub) return selectedNpub;

    const query = this.newTriggerBotQuery.trim();
    if (!query) return '';

    if (query.startsWith('npub1')) {
      this.selectTriggerBot(query);
      return query;
    }

    if (isHexPubkey(query)) {
      const candidateNpub = await pubkeyToNpub(query.toLowerCase());
      if (confirmHex) {
        const confirmed = window.confirm(
          `You entered a hex pubkey for the bot.\n\nUse this npub instead?\n${candidateNpub}`,
        );
        if (!confirmed) return '';
      }
      this.selectTriggerBot(candidateNpub);
      return candidateNpub;
    }

    const normalizedQuery = query.toLowerCase();
    const suggestions = this.triggerBotSuggestions;
    const exactMatch = suggestions.find((person) => {
      const label = String(person.label || '').trim().toLowerCase();
      const subtitle = String(person.subtitle || '').trim().toLowerCase();
      return label === normalizedQuery || subtitle === normalizedQuery;
    });
    const fallbackMatch = suggestions.length === 1 ? suggestions[0] : null;
    const match = exactMatch || fallbackMatch;

    if (match?.npub) {
      this.selectTriggerBot(match.npub);
      return match.npub;
    }

    return '';
  },

  async handleTriggerBotEnter() {
    this.triggerError = null;
    const botNpub = await this.resolveTriggerBotInput({ confirmHex: true });
    if (!botNpub && this.newTriggerBotQuery.trim()) {
      this.triggerError = 'Select a bot from suggestions, paste an npub, or confirm the hex pubkey conversion.';
    }
  },

  async addTrigger() {
    this.triggerError = null;
    const name = this.newTriggerName.trim();
    const triggerId = this.newTriggerId.trim();
    const triggerType = this.newTriggerType;
    const channelId = triggerType === 'chat_channel_message'
      ? String(this.newTriggerChannelId || '').trim()
      : '';

    if (!name || !triggerId) {
      this.triggerError = 'Name and Trigger ID are required.';
      return;
    }

    const botNpub = await this.resolveTriggerBotInput({ confirmHex: true });
    if (!botNpub) {
      this.triggerError = this.newTriggerBotQuery.trim()
        ? 'Select a bot from suggestions, paste an npub, or confirm the hex pubkey conversion.'
        : 'Bot is required.';
      return;
    }

    let botPubkeyHex;
    try {
      botPubkeyHex = npubToHex(botNpub);
    } catch {
      this.triggerError = 'Invalid bot npub.';
      return;
    }

    const trigger = {
      id: crypto.randomUUID(),
      name,
      triggerType,
      trigger_id: triggerId,
      ...(channelId ? { channel_id: channelId } : {}),
      botNpub,
      botPubkeyHex,
      enabled: true,
      created_at: new Date().toISOString(),
    };

    this.workspaceTriggers = [...this.workspaceTriggers, trigger];

    try {
      await this.saveHarnessSettings({ triggerOnly: true });
    } catch (err) {
      // Roll back the optimistic local add
      this.workspaceTriggers = this.workspaceTriggers.filter((t) => t.id !== trigger.id);
      this.triggerError = `Failed to save trigger: ${err.message}`;
      return;
    }

    this.newTriggerType = 'manual';
    this.newTriggerName = '';
    this.newTriggerId = '';
    this.newTriggerChannelId = '';
    this.newTriggerBotNpub = '';
    this.newTriggerBotQuery = '';
    this.triggerSuccess = `Trigger "${name}" added.`;
    setTimeout(() => (this.triggerSuccess = null), 3000);
  },

  async removeTrigger(id) {
    const previous = [...this.workspaceTriggers];
    this.workspaceTriggers = this.workspaceTriggers.filter((t) => t.id !== id);
    try {
      await this.saveHarnessSettings({ triggerOnly: true });
    } catch (err) {
      this.workspaceTriggers = previous;
      this.triggerError = `Failed to remove trigger: ${err.message}`;
    }
  },

  async toggleTrigger(id) {
    const trigger = this.workspaceTriggers.find((t) => t.id === id);
    if (!trigger) return;
    const previousEnabled = trigger.enabled;
    trigger.enabled = !trigger.enabled;
    this.workspaceTriggers = [...this.workspaceTriggers];
    try {
      await this.saveHarnessSettings({ triggerOnly: true });
    } catch (err) {
      trigger.enabled = previousEnabled;
      this.workspaceTriggers = [...this.workspaceTriggers];
      this.triggerError = `Failed to toggle trigger: ${err.message}`;
    }
  },

  async fireTrigger(id) {
    const trigger = this.workspaceTriggers.find((t) => t.id === id);
    if (!trigger) return;

    this.triggerFiring = { ...this.triggerFiring, [id]: true };
    this.triggerError = null;

    try {
      const message = (this.triggerMessage[id] || '').trim();
      const result = await signAndPublishTrigger(
        trigger.trigger_id,
        trigger.botPubkeyHex,
        message,
      );

      if (result.relayResults.ok.length === 0) {
        this.triggerError = 'Failed to publish to any relay.';
      } else {
        this.triggerSuccess = `Trigger "${trigger.name}" fired to ${result.relayResults.ok.length} relay(s).`;
        this.triggerMessage = { ...this.triggerMessage, [id]: '' };
        setTimeout(() => (this.triggerSuccess = null), 3000);
      }
    } catch (err) {
      this.triggerError = `Fire failed: ${err.message}`;
    } finally {
      this.triggerFiring = { ...this.triggerFiring, [id]: false };
    }
  },

  async _checkTriggerRules(eventType, botPubkeyHex, contextMessage, eventMeta = {}) {
    const channelId = String(eventMeta?.channelId || '').trim();
    const triggers = (this.workspaceTriggers || []).filter(
      (t) => t.enabled
        && t.triggerType === eventType
        && t.botPubkeyHex === botPubkeyHex
        && (eventType !== 'chat_channel_message'
          || !String(t.channel_id || '').trim()
          || String(t.channel_id || '').trim() === channelId),
    );

    for (const trigger of triggers) {
      try {
        console.log(`[trigger] Auto-firing "${trigger.name}" (${eventType}) trigger_id=${trigger.trigger_id}`);
        const result = await signAndPublishTrigger(
          trigger.trigger_id,
          trigger.botPubkeyHex,
          contextMessage,
        );
        if (result.relayResults.ok.length > 0) {
          console.log(`[trigger] Published to ${result.relayResults.ok.length} relay(s)`);
        }
      } catch (err) {
        console.error(`[trigger] Auto-fire failed for "${trigger.name}":`, err.message);
      }
    }
  },

  _fireMentionTriggers(content, context, options = {}) {
    const channelId = String(options?.channelId || '').trim();
    const mentionRegex = /@\[.*?\]\(mention:person:([^\)]+)\)/g;
    const mentionedNpubs = [];
    let match;
    while ((match = mentionRegex.exec(content)) !== null) {
      mentionedNpubs.push(match[1]);
    }

    for (const trigger of (this.workspaceTriggers || [])) {
      if (!trigger.enabled || !trigger.botPubkeyHex || !trigger.botNpub) continue;

      // bot_tagged: bot was @mentioned anywhere
      if (trigger.triggerType === 'chat_bot_tagged' && mentionedNpubs.includes(trigger.botNpub)) {
        this._checkTriggerRules('chat_bot_tagged', trigger.botPubkeyHex,
          `Bot tagged in ${context}: ${content.slice(0, 200)}`);
      }

      // chat_channel_message: any message in a channel (only for chat context)
      if (trigger.triggerType === 'chat_channel_message' && context.startsWith('chat #')) {
        this._checkTriggerRules('chat_channel_message', trigger.botPubkeyHex,
          `New message in ${context}: ${content.slice(0, 200)}`,
          { channelId });
      }
    }
  },
};
