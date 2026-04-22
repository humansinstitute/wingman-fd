import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/translators/record-crypto.js', () => ({
  decryptRecordPayload: vi.fn(async (record) => JSON.parse(record.owner_payload.ciphertext)),
  encryptOwnerPayload: vi.fn(async (_ownerNpub, payload) => ({ ciphertext: JSON.stringify(payload) })),
  buildGroupPayloads: vi.fn(async (groupRefs, payload) =>
    groupRefs.map((group_id) => ({ group_id, ciphertext: JSON.stringify(payload), write: true }))),
}));

import {
  inboundAgentChatTrigger,
  outboundAgentChatTrigger,
  recordFamilyHash,
} from '../src/translators/agent-chat-trigger.js';
import { APP_NPUB } from '../src/app-identity.js';

describe('agent chat trigger translator', () => {
  it('materializes an inbound trigger record', async () => {
    const row = await inboundAgentChatTrigger({
      record_id: 'agent-chat-trigger:npub_workspace',
      owner_npub: 'npub_workspace',
      version: 4,
      updated_at: '2026-04-08T00:00:00.000Z',
      owner_payload: {
        ciphertext: JSON.stringify({
          app_namespace: APP_NPUB,
          collection_space: 'agent_chat_trigger',
          schema_version: 1,
          record_id: 'agent-chat-trigger:npub_workspace',
          data: {
            workspace_owner_npub: 'npub_workspace',
            type: 'agent_chat_trigger_v1',
            enabled: false,
            scope: 'workspace',
            target_group_id: 'group-1',
            target_group_npub: 'npub1group',
            updated_at: '2026-04-08T00:00:00.000Z',
          },
        }),
      },
      group_payloads: [{ group_id: 'admin-group-1', ciphertext: '{}', write: true }],
    });

    expect(row.workspace_owner_npub).toBe('npub_workspace');
    expect(row.record_id).toBe('agent-chat-trigger:npub_workspace');
    expect(row.type).toBe('agent_chat_trigger_v1');
    expect(row.enabled).toBe(false);
    expect(row.scope).toBe('workspace');
    expect(row.target_group_id).toBe('group-1');
    expect(row.target_group_npub).toBe('npub1group');
    expect(row.group_ids).toEqual(['admin-group-1']);
    expect(row.sync_status).toBe('synced');
    expect(row.version).toBe(4);
  });

  it('builds an outbound trigger envelope', async () => {
    const envelope = await outboundAgentChatTrigger({
      record_id: 'agent-chat-trigger:npub_workspace',
      owner_npub: 'npub_workspace',
      workspace_owner_npub: 'npub_workspace',
      enabled: true,
      target_group_id: 'group-1',
      target_group_npub: 'npub1group',
      group_ids: ['admin-group-1'],
      signature_npub: 'npub1admin',
      updated_at: '2026-04-08T00:00:00.000Z',
    });

    expect(envelope.record_family_hash).toBe(`${APP_NPUB}:agent_chat_trigger`);
    expect(envelope.group_payloads).toHaveLength(1);
    expect(envelope.group_payloads[0].group_id).toBe('admin-group-1');
    expect(envelope.signature_npub).toBe('npub1admin');

    const payload = JSON.parse(envelope.owner_payload.ciphertext);
    expect(payload.collection_space).toBe('agent_chat_trigger');
    expect(payload.data.type).toBe('agent_chat_trigger_v1');
    expect(payload.data.enabled).toBe(true);
    expect(payload.data.scope).toBe('workspace');
    expect(payload.data.target_group_id).toBe('group-1');
    expect(payload.data.target_group_npub).toBe('npub1group');
  });

  it('builds record family hashes for agent chat triggers', () => {
    expect(recordFamilyHash('agent_chat_trigger')).toBe(`${APP_NPUB}:agent_chat_trigger`);
  });
});
