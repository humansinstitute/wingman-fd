import { recordFamilyHash as chatFamilyHash } from './translators/chat.js';
import { recordFamilyHash as reportFamilyHash } from './translators/reports.js';
import { recordFamilyHash as taskFamilyHash } from './translators/tasks.js';
import { recordFamilyHash as scheduleFamilyHash } from './translators/schedules.js';
import { recordFamilyHash as settingsFamilyHash } from './translators/settings.js';
import { recordFamilyHash as flowFamilyHash } from './translators/flows.js';
import { recordFamilyHash as approvalFamilyHash } from './translators/approvals.js';

export const SYNC_FAMILY_OPTIONS = Object.freeze([
  { id: 'settings', label: 'Workspace settings', hash: settingsFamilyHash('settings'), table: 'workspace_settings' },
  { id: 'channel', label: 'Channels', hash: chatFamilyHash('channel'), table: 'channels' },
  { id: 'chat_message', label: 'Chat messages', hash: chatFamilyHash('chat_message'), table: 'chat_messages' },
  { id: 'directory', label: 'Directories', hash: chatFamilyHash('directory'), table: 'directories' },
  { id: 'document', label: 'Documents', hash: chatFamilyHash('document'), table: 'documents' },
  { id: 'report', label: 'Reports', hash: reportFamilyHash('report'), table: 'reports' },
  { id: 'task', label: 'Tasks', hash: taskFamilyHash('task'), table: 'tasks' },
  { id: 'schedule', label: 'Schedules', hash: scheduleFamilyHash('schedule'), table: 'schedules' },
  { id: 'comment', label: 'Comments', hash: chatFamilyHash('comment'), table: 'comments' },
  { id: 'audio_note', label: 'Audio notes', hash: chatFamilyHash('audio_note'), table: 'audio_notes' },
  { id: 'scope', label: 'Scopes', hash: chatFamilyHash('scope'), table: 'scopes' },
  { id: 'flow', label: 'Flows', hash: flowFamilyHash('flow'), table: 'flows' },
  { id: 'approval', label: 'Approvals', hash: approvalFamilyHash('approval'), table: 'approvals' },
]);

export const DEFAULT_SYNC_FAMILY_IDS = Object.freeze(SYNC_FAMILY_OPTIONS.map((family) => family.id));

export const SYNC_FAMILY_MAP = Object.freeze(
  Object.fromEntries(SYNC_FAMILY_OPTIONS.map((family) => [family.id, family]))
);

export const SYNC_FAMILY_BY_HASH = Object.freeze(
  Object.fromEntries(SYNC_FAMILY_OPTIONS.map((family) => [family.hash, family]))
);

export function getSyncFamily(idOrHash) {
  if (!idOrHash) return null;
  return SYNC_FAMILY_MAP[idOrHash] || SYNC_FAMILY_BY_HASH[idOrHash] || null;
}

export function getSyncFamilyHash(id) {
  return getSyncFamily(id)?.hash ?? null;
}

export function getSyncFamilyHashes(ids = []) {
  return [...new Set(ids.map((id) => getSyncFamilyHash(id)).filter(Boolean))];
}

export function getSyncStateKeyForFamily(idOrHash) {
  const family = getSyncFamily(idOrHash);
  return family ? `sync_since:${family.hash}` : null;
}
