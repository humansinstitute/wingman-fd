/**
 * Trigger management methods extracted from app.js.
 *
 * The triggersManagerMixin object contains methods that use `this` (the Alpine store)
 * and should be spread into the store definition.
 */

import { signAndPublishTrigger, npubToHex } from './nostr-trigger.js';

// ---------------------------------------------------------------------------
// Mixin — methods that use `this` (the Alpine store)
// ---------------------------------------------------------------------------

export const triggersManagerMixin = {

  get triggerBotSuggestions() {
    return this.findPeopleSuggestions(this.newTriggerBotQuery, []);
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

  async addTrigger() {
    this.triggerError = null;
    const name = this.newTriggerName.trim();
    const triggerId = this.newTriggerId.trim();
    const triggerType = this.newTriggerType;

    // Allow direct npub entry: if no bot was selected from suggestions,
    // check if the query field contains a valid npub
    let botNpub = this.newTriggerBotNpub.trim();
    if (!botNpub) {
      const query = this.newTriggerBotQuery.trim();
      if (query.startsWith('npub1')) {
        botNpub = query;
      }
    }

    if (!name || !triggerId || !botNpub) {
      this.triggerError = 'Name, Trigger ID, and Bot are all required.';
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

  async _checkTriggerRules(eventType, botPubkeyHex, contextMessage) {
    const triggers = (this.workspaceTriggers || []).filter(
      (t) => t.enabled && t.triggerType === eventType && t.botPubkeyHex === botPubkeyHex,
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

  _fireMentionTriggers(content, context) {
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
          `New message in ${context}: ${content.slice(0, 200)}`);
      }
    }
  },
};
