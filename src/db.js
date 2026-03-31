import Dexie from 'dexie';
import { getSyncFamily, getSyncStateKeyForFamily } from './sync-families.js';

// ---------------------------------------------------------------------------
// Shared DB — singleton, always open. Holds global (non-workspace) state.
// ---------------------------------------------------------------------------

const sharedDb = new Dexie('wingman-fd-shared');

sharedDb.version(1).stores({
  app_settings:        '++id',
  storage_image_cache: '&object_id, cached_at',
  profiles:            'pubkey',
  address_book:        'npub, last_used_at',
});

// ---------------------------------------------------------------------------
// Workspace DB — one per workspace identity key.
// Contains ALL record / sync tables.
// ---------------------------------------------------------------------------

let _currentWorkspaceDb = null;
let _currentWorkspaceDbKey = null;

const WORKSPACE_STORES = {
  workspace_settings: '&workspace_owner_npub, record_id, updated_at',
  channels:           'record_id, owner_npub, *group_ids, scope_id, scope_l1_id, scope_l2_id, scope_l3_id, scope_l4_id, scope_l5_id',
  chat_messages:      'record_id, channel_id, parent_message_id, sync_status, updated_at',
  groups:             'group_id, owner_npub, *member_npubs',
  documents:          'record_id, owner_npub, parent_directory_id, sync_status, updated_at, scope_id, scope_l1_id, scope_l2_id, scope_l3_id, scope_l4_id, scope_l5_id',
  directories:        'record_id, owner_npub, parent_directory_id, sync_status, updated_at',
  reports:            'record_id, owner_npub, declaration_type, surface, generated_at, updated_at, *group_ids, scope_id, scope_l1_id, scope_l2_id, scope_l3_id, scope_l4_id, scope_l5_id',
  tasks:              'record_id, owner_npub, parent_task_id, state, sync_status, updated_at, scope_id, scope_l1_id, scope_l2_id, scope_l3_id, scope_l4_id, scope_l5_id',
  schedules:          'record_id, owner_npub, active, repeat, updated_at, sync_status',
  comments:           'record_id, target_record_id, target_record_family_hash, parent_comment_id, updated_at',
  audio_notes:        'record_id, owner_npub, target_record_id, target_record_family_hash, transcript_status, sync_status, updated_at',
  scopes:             'record_id, owner_npub, level, parent_id, l1_id, l2_id, l3_id, l4_id, l5_id, updated_at',
  sync_quarantine:    '&key, family_hash, family_id, record_id, last_seen_at',
  pending_writes:     '++row_id, record_id, record_family_hash, created_at',
  sync_state:         'key',
  read_cursors:       '&record_id, cursor_key, viewer_npub, read_until',
};

function createWorkspaceDb(workspaceDbKey) {
  const db = new Dexie(`wingman-fd-ws-${workspaceDbKey}`);
  const WORKSPACE_STORES_V2 = {
    workspace_settings: '&workspace_owner_npub, record_id, updated_at',
    channels:           'record_id, owner_npub, *group_ids, scope_id, scope_product_id, scope_project_id, scope_deliverable_id',
    chat_messages:      'record_id, channel_id, parent_message_id, sync_status, updated_at',
    groups:             'group_id, owner_npub, *member_npubs',
    documents:          'record_id, owner_npub, parent_directory_id, sync_status, updated_at, scope_id, scope_product_id, scope_project_id, scope_deliverable_id',
    directories:        'record_id, owner_npub, parent_directory_id, sync_status, updated_at',
    tasks:              'record_id, owner_npub, parent_task_id, state, sync_status, updated_at, scope_id, scope_product_id, scope_project_id, scope_deliverable_id',
    schedules:          'record_id, owner_npub, active, repeat, updated_at, sync_status',
    comments:           'record_id, target_record_id, target_record_family_hash, parent_comment_id, updated_at',
    audio_notes:        'record_id, owner_npub, target_record_id, target_record_family_hash, transcript_status, sync_status, updated_at',
    scopes:             'record_id, owner_npub, level, parent_id, product_id, project_id, updated_at',
    sync_quarantine:    '&key, family_hash, family_id, record_id, last_seen_at',
    pending_writes:     '++row_id, record_id, record_family_hash, created_at',
    sync_state:         'key',
    read_cursors:       '&record_id, cursor_key, viewer_npub, read_until',
  };
  // v1: original schema (without read_cursors)
  db.version(1).stores({
    workspace_settings: '&workspace_owner_npub, record_id, updated_at',
    channels:           'record_id, owner_npub, *group_ids, scope_id, scope_product_id, scope_project_id, scope_deliverable_id',
    chat_messages:      'record_id, channel_id, parent_message_id, sync_status, updated_at',
    groups:             'group_id, owner_npub, *member_npubs',
    documents:          'record_id, owner_npub, parent_directory_id, sync_status, updated_at, scope_id, scope_product_id, scope_project_id, scope_deliverable_id',
    directories:        'record_id, owner_npub, parent_directory_id, sync_status, updated_at',
    tasks:              'record_id, owner_npub, parent_task_id, state, sync_status, updated_at, scope_id, scope_product_id, scope_project_id, scope_deliverable_id',
    schedules:          'record_id, owner_npub, active, repeat, updated_at, sync_status',
    comments:           'record_id, target_record_id, target_record_family_hash, parent_comment_id, updated_at',
    audio_notes:        'record_id, owner_npub, target_record_id, target_record_family_hash, transcript_status, sync_status, updated_at',
    scopes:             'record_id, owner_npub, level, parent_id, product_id, project_id, updated_at',
    sync_quarantine:    '&key, family_hash, family_id, record_id, last_seen_at',
    pending_writes:     '++row_id, record_id, record_family_hash, created_at',
    sync_state:         'key',
  });
  // v2: add read_cursors for unread indicators
  db.version(2).stores(WORKSPACE_STORES_V2);
  // v3: add reports table
  db.version(3).stores({
    ...WORKSPACE_STORES_V2,
    reports: 'record_id, owner_npub, declaration_type, surface, generated_at, updated_at, *group_ids, scope_id, scope_product_id, scope_project_id, scope_deliverable_id',
  });
  // v4: canonical scope indexes (l1–l5 replacing product/project/deliverable)
  db.version(4).stores(WORKSPACE_STORES);
  return db;
}

export function openWorkspaceDb(workspaceDbKey) {
  if (!workspaceDbKey) throw new Error('workspaceDbKey is required to open a workspace database');
  if (_currentWorkspaceDbKey === workspaceDbKey && _currentWorkspaceDb) {
    return _currentWorkspaceDb;
  }
  if (_currentWorkspaceDb) {
    try { _currentWorkspaceDb.close(); } catch { /* already closed */ }
  }
  _currentWorkspaceDb = createWorkspaceDb(workspaceDbKey);
  _currentWorkspaceDbKey = workspaceDbKey;
  return _currentWorkspaceDb;
}

export function getWorkspaceDb() {
  if (!_currentWorkspaceDb) throw new Error('No workspace database open — call openWorkspaceDb(workspaceDbKey) first');
  return _currentWorkspaceDb;
}

export function getSharedDb() {
  return sharedDb;
}

export function getCurrentWorkspaceDbKey() {
  return _currentWorkspaceDbKey;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitizeForStorage(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

/** Shorthand — workspace db, throws if none open. */
function wsDb() {
  if (!_currentWorkspaceDb) throw new Error('No workspace database open — call openWorkspaceDb(workspaceDbKey) first');
  return _currentWorkspaceDb;
}

export function hasWorkspaceDb() {
  return _currentWorkspaceDb !== null;
}

export async function deleteWorkspaceDb(workspaceDbKey) {
  if (!workspaceDbKey) throw new Error('workspaceDbKey is required to delete a workspace database');
  if (_currentWorkspaceDbKey === workspaceDbKey && _currentWorkspaceDb) {
    _currentWorkspaceDb.close();
    _currentWorkspaceDb = null;
    _currentWorkspaceDbKey = null;
  }
  const dbName = `wingman-fd-ws-${workspaceDbKey}`;
  await Dexie.delete(dbName);
}

// ---------------------------------------------------------------------------
// Migration: move app_settings from old CoworkerV4 DB into shared DB.
// Called once on first load with the new code.
// ---------------------------------------------------------------------------

export async function migrateFromLegacyDb() {
  const legacyDbName = 'CoworkerV4';
  const databases = await Dexie.getDatabaseNames();
  if (!databases.includes(legacyDbName)) return false;

  const legacyDb = new Dexie(legacyDbName);
  legacyDb.version(10).stores({
    app_settings:       '++id',
    workspace_settings: '&workspace_owner_npub, record_id, updated_at',
    storage_image_cache:'&object_id, cached_at',
    channels:           'record_id, owner_npub, *group_ids, scope_id, scope_product_id, scope_project_id, scope_deliverable_id',
    chat_messages:      'record_id, channel_id, parent_message_id, sync_status, updated_at',
    groups:             'group_id, owner_npub, *member_npubs',
    documents:          'record_id, owner_npub, parent_directory_id, sync_status, updated_at, scope_id, scope_product_id, scope_project_id, scope_deliverable_id',
    directories:        'record_id, owner_npub, parent_directory_id, sync_status, updated_at',
    tasks:              'record_id, owner_npub, parent_task_id, state, sync_status, updated_at, scope_id, scope_product_id, scope_project_id, scope_deliverable_id',
    comments:           'record_id, target_record_id, target_record_family_hash, parent_comment_id, updated_at',
    audio_notes:        'record_id, owner_npub, target_record_id, target_record_family_hash, transcript_status, sync_status, updated_at',
    scopes:             'record_id, owner_npub, level, parent_id, product_id, project_id, updated_at',
    schedules:          'record_id, owner_npub, active, repeat, updated_at, sync_status',
    sync_quarantine:    '&key, family_hash, family_id, record_id, last_seen_at',
    pending_writes:     '++row_id, record_id, record_family_hash, created_at',
    profiles:           'pubkey',
    address_book:       'npub, last_used_at',
    sync_state:         'key',
  });

  try {
    await legacyDb.open();

    const settings = await legacyDb.app_settings.toCollection().first();
    if (settings) {
      const { id: _id, ...rest } = settings;
      await sharedDb.app_settings.add(rest);
    }

    const profiles = await legacyDb.profiles.toArray();
    if (profiles.length > 0) {
      await sharedDb.profiles.bulkPut(profiles);
    }

    const contacts = await legacyDb.address_book.toArray();
    if (contacts.length > 0) {
      await sharedDb.address_book.bulkPut(contacts);
    }

    const images = await legacyDb.storage_image_cache.toArray();
    if (images.length > 0) {
      await sharedDb.storage_image_cache.bulkPut(images);
    }

    legacyDb.close();
    await Dexie.delete(legacyDbName);
    return true;
  } catch (error) {
    console.warn('Legacy DB migration failed, will re-sync from server:', error?.message || error);
    try { legacyDb.close(); } catch { /* ignore */ }
    try { await Dexie.delete(legacyDbName); } catch { /* ignore */ }
    return false;
  }
}

// ---------------------------------------------------------------------------
// app_settings helpers — shared DB
// ---------------------------------------------------------------------------

export async function getSettings() {
  return sharedDb.app_settings.toCollection().first();
}

export async function saveSettings(settings) {
  const sanitized = sanitizeForStorage(settings);
  const existing = await sharedDb.app_settings.toCollection().first();
  if (existing) {
    return sharedDb.app_settings.update(existing.id, sanitized);
  }
  return sharedDb.app_settings.add(sanitized);
}

// ---------------------------------------------------------------------------
// workspace_settings helpers — workspace DB
// ---------------------------------------------------------------------------

export async function getWorkspaceSettings(workspaceOwnerNpub) {
  if (!workspaceOwnerNpub) return null;
  return wsDb().workspace_settings.get(workspaceOwnerNpub);
}

export async function getWorkspaceSettingsSnapshot(workspaceDbKey, workspaceOwnerNpub) {
  if (!workspaceDbKey || !workspaceOwnerNpub) return null;
  const tempDb = createWorkspaceDb(workspaceDbKey);
  try {
    await tempDb.open();
    return tempDb.workspace_settings.get(workspaceOwnerNpub);
  } catch {
    return null;
  } finally {
    tempDb.close();
  }
}

export async function upsertWorkspaceSettings(settings) {
  return wsDb().workspace_settings.put(sanitizeForStorage(settings));
}

// ---------------------------------------------------------------------------
// storage_image_cache helpers — shared DB
// ---------------------------------------------------------------------------

export async function getCachedStorageImage(objectId) {
  if (!objectId) return null;
  const entry = await sharedDb.storage_image_cache.get(objectId);
  if (entry) {
    // Touch cached_at so it acts as a last-accessed timestamp for LRU eviction
    sharedDb.storage_image_cache.update(objectId, { cached_at: Date.now() }).catch(() => {});
  }
  return entry;
}

export async function cacheStorageImage({ object_id, blob, content_type = '', cached_at = Date.now() }) {
  if (!object_id || !(blob instanceof Blob)) return null;
  const result = await sharedDb.storage_image_cache.put({
    object_id,
    blob,
    content_type,
    cached_at,
  });
  // Fire-and-forget eviction after caching a new entry
  evictStorageImageCache().catch(() => {});
  return result;
}

export async function evictStorageImageCache(maxEntries = 100) {
  const count = await sharedDb.storage_image_cache.count();
  if (count <= maxEntries) return 0;
  const excess = count - maxEntries;
  // sorted ascending by cached_at — oldest first
  const oldest = await sharedDb.storage_image_cache
    .orderBy('cached_at')
    .limit(excess)
    .primaryKeys();
  await sharedDb.storage_image_cache.bulkDelete(oldest);
  return oldest.length;
}

// ---------------------------------------------------------------------------
// channels — workspace DB
// ---------------------------------------------------------------------------

export async function getChannelsByOwner(ownerNpub) {
  const rows = await wsDb().channels.where('owner_npub').equals(ownerNpub).toArray();
  return rows.filter((row) => row.record_state !== 'deleted');
}

export async function upsertChannel(channel) {
  return wsDb().channels.put(sanitizeForStorage(channel));
}

export async function getChannelById(recordId) {
  return wsDb().channels.get(recordId);
}

// ---------------------------------------------------------------------------
// directories — workspace DB
// ---------------------------------------------------------------------------

export async function getDirectoriesByOwner(ownerNpub) {
  const rows = await wsDb().directories.where('owner_npub').equals(ownerNpub).toArray();
  return rows.filter((row) => row.record_state !== 'deleted');
}

export async function upsertDirectory(directory) {
  return wsDb().directories.put(sanitizeForStorage(directory));
}

export async function getDirectoryById(recordId) {
  return wsDb().directories.get(recordId);
}

// ---------------------------------------------------------------------------
// documents — workspace DB
// ---------------------------------------------------------------------------

export async function getDocumentsByOwner(ownerNpub) {
  const rows = await wsDb().documents.where('owner_npub').equals(ownerNpub).toArray();
  return rows.filter((row) => row.record_state !== 'deleted');
}

export async function upsertDocument(document) {
  return wsDb().documents.put(sanitizeForStorage(document));
}

export async function getDocumentById(recordId) {
  return wsDb().documents.get(recordId);
}

// ---------------------------------------------------------------------------
// chat_messages — workspace DB
// ---------------------------------------------------------------------------

export async function getMessagesByChannel(channelId) {
  const rows = await wsDb().chat_messages.where('channel_id').equals(channelId).sortBy('updated_at');
  return rows.filter((row) => row.record_state !== 'deleted');
}

export async function upsertMessage(msg) {
  return wsDb().chat_messages.put(sanitizeForStorage(msg));
}

export async function getMessageById(recordId) {
  return wsDb().chat_messages.get(recordId);
}

export async function getRecentChatMessagesSince(sinceIso) {
  const rows = await wsDb().chat_messages.where('updated_at').aboveOrEqual(sinceIso).toArray();
  return rows
    .filter((row) => row.record_state !== 'deleted')
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}

export async function getRecentDocumentChangesSince(sinceIso) {
  const rows = await wsDb().documents.where('updated_at').aboveOrEqual(sinceIso).toArray();
  return rows
    .filter((row) => row.record_state !== 'deleted')
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}

export async function getRecentDirectoryChangesSince(sinceIso) {
  const rows = await wsDb().directories.where('updated_at').aboveOrEqual(sinceIso).toArray();
  return rows
    .filter((row) => row.record_state !== 'deleted')
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}

// ---------------------------------------------------------------------------
// reports — workspace DB
// ---------------------------------------------------------------------------

export async function getReportsByOwner(ownerNpub) {
  const rows = await wsDb().reports.where('owner_npub').equals(ownerNpub).toArray();
  return rows.filter((row) => row.record_state !== 'deleted');
}

export async function getRecentReportChangesSince(sinceIso) {
  const rows = await wsDb().reports.where('updated_at').aboveOrEqual(sinceIso).toArray();
  return rows
    .filter((row) => row.record_state !== 'deleted')
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}

export async function upsertReport(report) {
  return wsDb().reports.put(sanitizeForStorage(report));
}

export async function getReportById(recordId) {
  return wsDb().reports.get(recordId);
}

// ---------------------------------------------------------------------------
// groups — workspace DB
// ---------------------------------------------------------------------------

export async function getGroupsByOwner(ownerNpub) {
  return wsDb().groups.where('owner_npub').equals(ownerNpub).toArray();
}

export async function getAllGroups() {
  return wsDb().groups.toArray();
}

export async function upsertGroup(group) {
  return wsDb().groups.put(sanitizeForStorage(group));
}

export async function deleteGroupById(groupId) {
  return wsDb().groups.delete(groupId);
}

// ---------------------------------------------------------------------------
// address book — shared DB
// ---------------------------------------------------------------------------

export async function upsertAddressBookPerson(entry) {
  const existing = await sharedDb.address_book.get(entry.npub);
  const merged = {
    npub: entry.npub,
    label: entry.label ?? existing?.label ?? null,
    avatar_url: entry.avatar_url ?? existing?.avatar_url ?? null,
    source: entry.source ?? existing?.source ?? 'unknown',
    last_used_at: entry.last_used_at ?? new Date().toISOString(),
  };
  return sharedDb.address_book.put(merged);
}

export async function getAddressBookPeople(query = '') {
  const all = await sharedDb.address_book.orderBy('last_used_at').reverse().toArray();
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return all;

  return all.filter((entry) =>
    String(entry.npub || '').toLowerCase().includes(needle)
    || String(entry.label || '').toLowerCase().includes(needle)
  );
}

// ---------------------------------------------------------------------------
// profiles — shared DB
// ---------------------------------------------------------------------------

const PROFILE_CACHE_HOURS = 24;

export async function cacheProfile(pubkey, profile) {
  return sharedDb.profiles.put({
    pubkey,
    profile: sanitizeForStorage(profile),
    cachedAt: Date.now(),
  });
}

export async function getCachedProfile(pubkey) {
  const row = await sharedDb.profiles.get(pubkey);
  if (!row) return null;

  const maxAge = PROFILE_CACHE_HOURS * 60 * 60 * 1000;
  if (Date.now() - row.cachedAt > maxAge) {
    await sharedDb.profiles.delete(pubkey);
    return null;
  }

  return row.profile;
}

// ---------------------------------------------------------------------------
// pending_writes — workspace DB
// ---------------------------------------------------------------------------

export async function addPendingWrite(write) {
  return wsDb().pending_writes.add(sanitizeForStorage({ ...write, created_at: new Date().toISOString() }));
}

export async function getPendingWrites() {
  return wsDb().pending_writes.toArray();
}

export async function getPendingWritesByFamilies(familyIds = []) {
  const hashes = [...new Set(familyIds.map((familyId) => getSyncFamily(familyId)?.hash).filter(Boolean))];
  if (hashes.length === 0) return [];
  return wsDb().pending_writes.where('record_family_hash').anyOf(hashes).toArray();
}

export async function removePendingWrite(rowId) {
  return wsDb().pending_writes.delete(rowId);
}

// ---------------------------------------------------------------------------
// sync_state — workspace DB
// ---------------------------------------------------------------------------

export async function getSyncState(key) {
  const row = await wsDb().sync_state.get(key);
  return row?.value ?? null;
}

export async function setSyncState(key, value) {
  return wsDb().sync_state.put({ key, value });
}

export async function deleteSyncState(key) {
  return wsDb().sync_state.delete(key);
}

export async function clearSyncStateForFamilies(familyIds = []) {
  const keys = [...new Set(familyIds.map((familyId) => getSyncStateKeyForFamily(familyId)).filter(Boolean))];
  if (keys.length === 0) return;
  await Promise.all(keys.map((key) => deleteSyncState(key)));
}

export async function clearSyncState() {
  return wsDb().sync_state.clear();
}

// ---------------------------------------------------------------------------
// sync_quarantine — workspace DB
// ---------------------------------------------------------------------------

export function syncQuarantineKey(familyHash, recordId) {
  return `${String(familyHash || '').trim()}:${String(recordId || '').trim()}`;
}

export async function getSyncQuarantineEntries() {
  const rows = await wsDb().sync_quarantine.orderBy('last_seen_at').reverse().toArray();
  return rows.filter((row) => row.record_state !== 'deleted');
}

export async function upsertSyncQuarantineEntry(entry) {
  const db = wsDb();
  const key = syncQuarantineKey(entry.family_hash, entry.record_id);
  const existing = await db.sync_quarantine.get(key);
  const now = new Date().toISOString();
  return db.sync_quarantine.put(sanitizeForStorage({
    ...existing,
    ...entry,
    key,
    first_seen_at: existing?.first_seen_at || entry.first_seen_at || now,
    last_seen_at: entry.last_seen_at || now,
    skip_count: Number(existing?.skip_count || 0) + 1,
    record_state: 'active',
  }));
}

export async function deleteSyncQuarantineEntry(familyHash, recordId) {
  return wsDb().sync_quarantine.delete(syncQuarantineKey(familyHash, recordId));
}

export async function clearSyncQuarantineForFamilies(familyIds = []) {
  const hashes = [...new Set(familyIds.map((familyId) => getSyncFamily(familyId)?.hash).filter(Boolean))];
  if (hashes.length === 0) return;
  await Promise.all(hashes.map((hash) => wsDb().sync_quarantine.where('family_hash').equals(hash).delete()));
}

// ---------------------------------------------------------------------------
// tasks — workspace DB
// ---------------------------------------------------------------------------

export async function getTasksByOwner(ownerNpub) {
  const rows = await wsDb().tasks.where('owner_npub').equals(ownerNpub).toArray();
  return rows.filter((row) => row.record_state !== 'deleted');
}

export async function getRecentTaskChangesSince(sinceIso) {
  const rows = await wsDb().tasks.where('updated_at').aboveOrEqual(sinceIso).toArray();
  return rows
    .filter((row) => row.record_state !== 'deleted')
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}

export async function upsertTask(task) {
  return wsDb().tasks.put(sanitizeForStorage(task));
}

export async function getTaskById(recordId) {
  return wsDb().tasks.get(recordId);
}

// ---------------------------------------------------------------------------
// schedules — workspace DB
// ---------------------------------------------------------------------------

export async function getSchedulesByOwner(ownerNpub) {
  const rows = await wsDb().schedules.where('owner_npub').equals(ownerNpub).toArray();
  return rows.filter((row) => row.record_state !== 'deleted');
}

export async function getRecentScheduleChangesSince(sinceIso) {
  const rows = await wsDb().schedules.where('updated_at').aboveOrEqual(sinceIso).toArray();
  return rows
    .filter((row) => row.record_state !== 'deleted')
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}

export async function upsertSchedule(schedule) {
  return wsDb().schedules.put(sanitizeForStorage(schedule));
}

export async function getScheduleById(recordId) {
  return wsDb().schedules.get(recordId);
}

// ---------------------------------------------------------------------------
// comments — workspace DB
// ---------------------------------------------------------------------------

export async function getCommentsByTarget(targetRecordId) {
  const rows = await wsDb().comments.where('target_record_id').equals(targetRecordId).toArray();
  return rows
    .filter((row) => row.record_state !== 'deleted')
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
}

export async function getRecentCommentsSince(sinceIso) {
  const rows = await wsDb().comments.where('updated_at').aboveOrEqual(sinceIso).toArray();
  return rows
    .filter((row) => row.record_state !== 'deleted')
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}

export async function upsertComment(comment) {
  return wsDb().comments.put(sanitizeForStorage(comment));
}

export async function deleteRuntimeRecordByFamily(familyIdOrHash, recordId) {
  const family = getSyncFamily(familyIdOrHash);
  const tableName = family?.table;
  if (!tableName || !recordId) return 0;
  const db = wsDb();
  const table = db[tableName];
  if (!table) return 0;
  return table.where('record_id').equals(recordId).delete();
}

// ---------------------------------------------------------------------------
// audio notes — workspace DB
// ---------------------------------------------------------------------------

export async function getAudioNotesByOwner(ownerNpub) {
  const rows = await wsDb().audio_notes.where('owner_npub').equals(ownerNpub).toArray();
  return rows.filter((row) => row.record_state !== 'deleted');
}

export async function upsertAudioNote(audioNote) {
  return wsDb().audio_notes.put(sanitizeForStorage(audioNote));
}

export async function getAudioNoteById(recordId) {
  return wsDb().audio_notes.get(recordId);
}

// ---------------------------------------------------------------------------
// scopes — workspace DB
// ---------------------------------------------------------------------------

export async function getScopesByOwner(ownerNpub) {
  const rows = await wsDb().scopes.where('owner_npub').equals(ownerNpub).toArray();
  return rows.filter((row) => row.record_state !== 'deleted');
}

export async function upsertScope(scope) {
  return wsDb().scopes.put(scope);
}

export async function getScopeById(recordId) {
  return wsDb().scopes.get(recordId);
}

// ---------------------------------------------------------------------------
// Bulk clear helpers — workspace DB
// ---------------------------------------------------------------------------

export async function clearRuntimeData() {
  const db = wsDb();
  await Promise.all([
    db.channels.clear(),
    db.chat_messages.clear(),
    db.documents.clear(),
    db.directories.clear(),
    db.reports.clear(),
    db.tasks.clear(),
    db.schedules.clear(),
    db.comments.clear(),
    db.audio_notes.clear(),
    db.scopes.clear(),
    db.sync_quarantine.clear(),
    db.groups.clear(),
    db.pending_writes.clear(),
    db.sync_state.clear(),
  ]);
}

export async function clearRuntimeFamilies(familyIds = []) {
  const tables = [...new Set(familyIds.map((familyId) => getSyncFamily(familyId)?.table).filter(Boolean))];
  if (tables.length === 0) return;
  const db = wsDb();
  await Promise.all(
    tables.map((tableName) => db[tableName]?.clear?.()).filter(Boolean)
  );
}

// ---------------------------------------------------------------------------
// read_cursors — workspace DB (for unread indicators)
// ---------------------------------------------------------------------------

export async function getReadCursor(recordId) {
  return wsDb().read_cursors.get(recordId);
}

export async function getReadCursorByKey(cursorKey, viewerNpub) {
  return wsDb().read_cursors
    .where('cursor_key').equals(cursorKey)
    .and((row) => row.viewer_npub === viewerNpub)
    .first();
}

export async function upsertReadCursor(cursor) {
  return wsDb().read_cursors.put(sanitizeForStorage(cursor));
}

export async function getAllReadCursors(viewerNpub) {
  return wsDb().read_cursors.where('viewer_npub').equals(viewerNpub).toArray();
}
