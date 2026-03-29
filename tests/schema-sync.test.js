import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/translators/record-crypto.js', () => ({
  decryptRecordPayload: vi.fn(async (record) => JSON.parse(record.owner_payload.ciphertext)),
  encryptOwnerPayload: vi.fn(async (_ownerNpub, payload) => ({ ciphertext: JSON.stringify(payload) })),
  buildGroupPayloads: vi.fn(async (groupNpubs, payload, canWriteByGroup) =>
    groupNpubs.map((group_npub) => ({
      group_npub,
      ciphertext: JSON.stringify(payload),
      write: canWriteByGroup instanceof Map ? canWriteByGroup.get(group_npub) === true : true,
    }))),
}));

import { APP_NPUB } from '../src/app-identity.js';
import { outboundAudioNote } from '../src/translators/audio-notes.js';
import { outboundChannel, outboundChatMessage } from '../src/translators/chat.js';
import { outboundComment } from '../src/translators/comments.js';
import { outboundDirectory, outboundDocument } from '../src/translators/docs.js';
import { outboundReport } from '../src/translators/reports.js';
import { outboundSchedule } from '../src/translators/schedules.js';
import { outboundScope } from '../src/translators/scopes.js';
import { outboundWorkspaceSettings } from '../src/translators/settings.js';
import { outboundTask } from '../src/translators/tasks.js';
import { validateAgainstSchema } from '../../sb-publisher/src/schema-validate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaDir = path.resolve(__dirname, '../../sb-publisher/schemas/flightdeck');

const expectedFamilies = [
  'audio_note',
  'channel',
  'chat_message',
  'comment',
  'directory',
  'document',
  'report',
  'schedule',
  'scope',
  'settings',
  'task',
];

function readManifest(family) {
  return JSON.parse(fs.readFileSync(path.join(schemaDir, `${family}-v1.json`), 'utf8'));
}

function assertMatchesPublishedSchema(family, payload) {
  const manifest = readManifest(family);
  const result = validateAgainstSchema(manifest.payload_schema, payload);
  expect(result.valid, `${family}: ${result.errors.join('; ')}`).toBe(true);
}

describe('published Flight Deck schema manifests', () => {
  it('cover every current Flight Deck record family', () => {
    const families = fs.readdirSync(schemaDir)
      .filter((file) => file.endsWith('-v1.json'))
      .map((file) => file.replace(/-v1\.json$/, ''))
      .sort();

    expect(families).toEqual(expectedFamilies);
  });

  it('validate real outbound Flight Deck payloads', async () => {
    const payloads = {
      audio_note: JSON.parse((await outboundAudioNote({
        record_id: 'audio-1',
        owner_npub: 'npub_owner',
        target_record_id: 'comment-1',
        target_record_family_hash: `${APP_NPUB}:comment`,
        storage_object_id: 'storage-1',
        target_group_ids: ['group-1'],
      })).owner_payload.ciphertext),
      channel: JSON.parse((await outboundChannel({
        record_id: 'channel-1',
        owner_npub: 'npub_owner',
        title: 'Ops',
        group_ids: ['group-1'],
        participant_npubs: ['npub_owner'],
      })).owner_payload.ciphertext),
      chat_message: JSON.parse((await outboundChatMessage({
        record_id: 'msg-1',
        owner_npub: 'npub_owner',
        channel_id: 'channel-1',
        body: 'Hello',
        channel_group_ids: ['group-1'],
      })).owner_payload.ciphertext),
      comment: JSON.parse((await outboundComment({
        record_id: 'comment-1',
        owner_npub: 'npub_owner',
        target_record_id: 'task-1',
        target_record_family_hash: `${APP_NPUB}:task`,
        body: 'Looks good',
        target_group_ids: ['group-1'],
      })).owner_payload.ciphertext),
      directory: JSON.parse((await outboundDirectory({
        record_id: 'dir-1',
        owner_npub: 'npub_owner',
        title: 'Projects',
        scope_id: 'product-1',
        scope_l1_id: 'product-1',
        scope_l2_id: null,
        scope_l3_id: null,
        scope_l4_id: null,
        scope_l5_id: null,
        shares: [],
      })).owner_payload.ciphertext),
      document: JSON.parse((await outboundDocument({
        record_id: 'doc-1',
        owner_npub: 'npub_owner',
        title: 'Spec',
        content: 'hello world',
        scope_id: 'scope-1',
        scope_l1_id: 'product-1',
        scope_l2_id: 'project-1',
        scope_l3_id: 'deliverable-1',
        scope_l4_id: null,
        scope_l5_id: null,
        shares: [],
      })).owner_payload.ciphertext),
      report: JSON.parse((await outboundReport({
        record_id: 'report-1',
        owner_npub: 'npub_owner',
        group_ids: ['group-1'],
        metadata: {
          title: 'Daily Users',
          generated_at: '2026-03-25T00:55:00Z',
          record_state: 'active',
          surface: 'flightdeck',
          scope: {
            id: 'deliverable-1',
            level: 'deliverable',
            l1_id: 'product-1',
            l2_id: 'project-1',
            l3_id: 'deliverable-1',
            l4_id: null,
            l5_id: null,
          },
        },
        data: {
          declaration_type: 'metric',
          payload: {
            label: 'Daily Users',
            value: 50,
            unit: 'per day',
          },
        },
      })).owner_payload.ciphertext),
      schedule: JSON.parse((await outboundSchedule({
        record_id: 'schedule-1',
        owner_npub: 'npub_owner',
        title: 'Daily wrap-up',
        time_start: '09:00',
        time_end: '09:30',
        days: ['mon'],
        timezone: 'Australia/Perth',
        shares: [],
        group_ids: ['group-1'],
      })).owner_payload.ciphertext),
      scope: JSON.parse((await outboundScope({
        record_id: 'scope-1',
        owner_npub: 'npub_owner',
        title: 'Flight Deck',
        description: 'Product scope',
        level: 'product',
        group_ids: ['group-1'],
      })).owner_payload.ciphertext),
      settings: JSON.parse((await outboundWorkspaceSettings({
        record_id: 'settings-1',
        owner_npub: 'npub_owner',
        workspace_owner_npub: 'npub_owner',
        wingman_harness_url: 'https://host.otherstuff.ai',
        group_ids: ['group-1'],
      })).owner_payload.ciphertext),
      task: JSON.parse((await outboundTask({
        record_id: 'task-1',
        owner_npub: 'npub_owner',
        title: 'Build board',
        description: 'Port v3',
        state: 'new',
        priority: 'rock',
        assigned_to_npub: 'npub_assignee',
        scope_id: 'deliverable-1',
        scope_l1_id: 'product-1',
        scope_l2_id: 'project-1',
        scope_l3_id: 'deliverable-1',
        scope_l4_id: null,
        scope_l5_id: null,
        shares: [],
        group_ids: ['group-1'],
      })).owner_payload.ciphertext),
    };

    for (const family of expectedFamilies) {
      assertMatchesPublishedSchema(family, payloads[family]);
    }
  });
});
