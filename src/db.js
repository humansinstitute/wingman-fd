import Dexie from 'dexie';

const db = new Dexie('CoworkerV4');

db.version(1).stores({
  app_settings:  '++id',
  channels:      'record_id, owner_npub, *group_ids',
  chat_messages: 'record_id, channel_id, parent_message_id, sync_status, updated_at',
  groups:        'group_id, owner_npub',
  pending_writes:'++row_id, record_id, record_family_hash, created_at',
  sync_state:    'key',
});

db.version(2).stores({
  app_settings:  '++id',
  channels:      'record_id, owner_npub, *group_ids',
  chat_messages: 'record_id, channel_id, parent_message_id, sync_status, updated_at',
  groups:        'group_id, owner_npub',
  pending_writes:'++row_id, record_id, record_family_hash, created_at',
  profiles:      'pubkey',
  sync_state:    'key',
});

db.version(3).stores({
  app_settings:  '++id',
  channels:      'record_id, owner_npub, *group_ids',
  chat_messages: 'record_id, channel_id, parent_message_id, sync_status, updated_at',
  groups:        'group_id, owner_npub, *member_npubs',
  documents:     'record_id, owner_npub, parent_directory_id, sync_status, updated_at',
  directories:   'record_id, owner_npub, parent_directory_id, sync_status, updated_at',
  pending_writes:'++row_id, record_id, record_family_hash, created_at',
  profiles:      'pubkey',
  address_book:  'npub, last_used_at',
  sync_state:    'key',
});

db.version(4).stores({
  app_settings:  '++id',
  channels:      'record_id, owner_npub, *group_ids',
  chat_messages: 'record_id, channel_id, parent_message_id, sync_status, updated_at',
  groups:        'group_id, owner_npub, *member_npubs',
  documents:     'record_id, owner_npub, parent_directory_id, sync_status, updated_at',
  directories:   'record_id, owner_npub, parent_directory_id, sync_status, updated_at',
  tasks:         'record_id, owner_npub, parent_task_id, state, sync_status, updated_at',
  comments:      'record_id, target_record_id, target_record_family_hash, parent_comment_id, updated_at',
  pending_writes:'++row_id, record_id, record_family_hash, created_at',
  profiles:      'pubkey',
  address_book:  'npub, last_used_at',
  sync_state:    'key',
});

db.version(5).stores({
  app_settings:  '++id',
  channels:      'record_id, owner_npub, *group_ids, scope_id, scope_product_id, scope_project_id, scope_deliverable_id',
  chat_messages: 'record_id, channel_id, parent_message_id, sync_status, updated_at',
  groups:        'group_id, owner_npub, *member_npubs',
  documents:     'record_id, owner_npub, parent_directory_id, sync_status, updated_at, scope_id, scope_product_id, scope_project_id, scope_deliverable_id',
  directories:   'record_id, owner_npub, parent_directory_id, sync_status, updated_at',
  tasks:         'record_id, owner_npub, parent_task_id, state, sync_status, updated_at, scope_id, scope_product_id, scope_project_id, scope_deliverable_id',
  comments:      'record_id, target_record_id, target_record_family_hash, parent_comment_id, updated_at',
  scopes:        'record_id, owner_npub, level, parent_id, product_id, project_id, updated_at',
  pending_writes:'++row_id, record_id, record_family_hash, created_at',
  profiles:      'pubkey',
  address_book:  'npub, last_used_at',
  sync_state:    'key',
});

db.version(6).stores({
  app_settings:  '++id',
  channels:      'record_id, owner_npub, *group_ids, scope_id, scope_product_id, scope_project_id, scope_deliverable_id',
  chat_messages: 'record_id, channel_id, parent_message_id, sync_status, updated_at',
  groups:        'group_id, owner_npub, *member_npubs',
  documents:     'record_id, owner_npub, parent_directory_id, sync_status, updated_at, scope_id, scope_product_id, scope_project_id, scope_deliverable_id',
  directories:   'record_id, owner_npub, parent_directory_id, sync_status, updated_at',
  tasks:         'record_id, owner_npub, parent_task_id, state, sync_status, updated_at, scope_id, scope_product_id, scope_project_id, scope_deliverable_id',
  comments:      'record_id, target_record_id, target_record_family_hash, parent_comment_id, updated_at',
  audio_notes:   'record_id, owner_npub, target_record_id, target_record_family_hash, transcript_status, sync_status, updated_at',
  scopes:        'record_id, owner_npub, level, parent_id, product_id, project_id, updated_at',
  pending_writes:'++row_id, record_id, record_family_hash, created_at',
  profiles:      'pubkey',
  address_book:  'npub, last_used_at',
  sync_state:    'key',
});

db.version(7).stores({
  app_settings:       '++id',
  workspace_settings: '&workspace_owner_npub, record_id, updated_at',
  channels:           'record_id, owner_npub, *group_ids, scope_id, scope_product_id, scope_project_id, scope_deliverable_id',
  chat_messages:      'record_id, channel_id, parent_message_id, sync_status, updated_at',
  groups:             'group_id, owner_npub, *member_npubs',
  documents:          'record_id, owner_npub, parent_directory_id, sync_status, updated_at, scope_id, scope_product_id, scope_project_id, scope_deliverable_id',
  directories:        'record_id, owner_npub, parent_directory_id, sync_status, updated_at',
  tasks:              'record_id, owner_npub, parent_task_id, state, sync_status, updated_at, scope_id, scope_product_id, scope_project_id, scope_deliverable_id',
  comments:           'record_id, target_record_id, target_record_family_hash, parent_comment_id, updated_at',
  audio_notes:        'record_id, owner_npub, target_record_id, target_record_family_hash, transcript_status, sync_status, updated_at',
  scopes:             'record_id, owner_npub, level, parent_id, product_id, project_id, updated_at',
  pending_writes:     '++row_id, record_id, record_family_hash, created_at',
  profiles:           'pubkey',
  address_book:       'npub, last_used_at',
  sync_state:         'key',
});

db.version(8).stores({
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
  pending_writes:     '++row_id, record_id, record_family_hash, created_at',
  profiles:           'pubkey',
  address_book:       'npub, last_used_at',
  sync_state:         'key',
});

db.version(9).stores({
  app_settings:       '++id',
  workspace_settings: '&workspace_owner_npub, record_id, updated_at',
  storage_image_cache:'&object_id, cached_at',
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
  pending_writes:     '++row_id, record_id, record_family_hash, created_at',
  profiles:           'pubkey',
  address_book:       'npub, last_used_at',
  sync_state:         'key',
});

db.version(9).stores({
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
  pending_writes:     '++row_id, record_id, record_family_hash, created_at',
  profiles:           'pubkey',
  address_book:       'npub, last_used_at',
  sync_state:         'key',
});

export default db;

function sanitizeForStorage(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

// --- app_settings helpers ---

export async function getSettings() {
  return db.app_settings.toCollection().first();
}

export async function saveSettings(settings) {
  const sanitized = sanitizeForStorage(settings);
  const existing = await db.app_settings.toCollection().first();
  if (existing) {
    return db.app_settings.update(existing.id, sanitized);
  }
  return db.app_settings.add(sanitized);
}

// --- workspace_settings helpers ---

export async function getWorkspaceSettings(workspaceOwnerNpub) {
  if (!workspaceOwnerNpub) return null;
  return db.workspace_settings.get(workspaceOwnerNpub);
}

export async function upsertWorkspaceSettings(settings) {
  return db.workspace_settings.put(sanitizeForStorage(settings));
}

// --- storage_image_cache helpers ---

export async function getCachedStorageImage(objectId) {
  if (!objectId) return null;
  return db.storage_image_cache.get(objectId);
}

export async function cacheStorageImage({ object_id, blob, content_type = '', cached_at = Date.now() }) {
  if (!object_id || !(blob instanceof Blob)) return null;
  return db.storage_image_cache.put({
    object_id,
    blob,
    content_type,
    cached_at,
  });
}

// --- channels ---

export async function getChannelsByOwner(ownerNpub) {
  const rows = await db.channels.where('owner_npub').equals(ownerNpub).toArray();
  return rows.filter((row) => row.record_state !== 'deleted');
}

export async function upsertChannel(channel) {
  return db.channels.put(sanitizeForStorage(channel));
}

export async function getChannelById(recordId) {
  return db.channels.get(recordId);
}

// --- directories ---

export async function getDirectoriesByOwner(ownerNpub) {
  const rows = await db.directories.where('owner_npub').equals(ownerNpub).toArray();
  return rows.filter((row) => row.record_state !== 'deleted');
}

export async function upsertDirectory(directory) {
  return db.directories.put(sanitizeForStorage(directory));
}

export async function getDirectoryById(recordId) {
  return db.directories.get(recordId);
}

// --- documents ---

export async function getDocumentsByOwner(ownerNpub) {
  const rows = await db.documents.where('owner_npub').equals(ownerNpub).toArray();
  return rows.filter((row) => row.record_state !== 'deleted');
}

export async function upsertDocument(document) {
  return db.documents.put(sanitizeForStorage(document));
}

export async function getDocumentById(recordId) {
  return db.documents.get(recordId);
}

// --- chat_messages ---

export async function getMessagesByChannel(channelId) {
  const rows = await db.chat_messages.where('channel_id').equals(channelId).sortBy('updated_at');
  return rows.filter((row) => row.record_state !== 'deleted');
}

export async function upsertMessage(msg) {
  return db.chat_messages.put(sanitizeForStorage(msg));
}

export async function getMessageById(recordId) {
  return db.chat_messages.get(recordId);
}

export async function getRecentChatMessagesSince(sinceIso) {
  const rows = await db.chat_messages.where('updated_at').aboveOrEqual(sinceIso).toArray();
  return rows
    .filter((row) => row.record_state !== 'deleted')
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}

export async function getRecentDocumentChangesSince(sinceIso) {
  const rows = await db.documents.where('updated_at').aboveOrEqual(sinceIso).toArray();
  return rows
    .filter((row) => row.record_state !== 'deleted')
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}

export async function getRecentDirectoryChangesSince(sinceIso) {
  const rows = await db.directories.where('updated_at').aboveOrEqual(sinceIso).toArray();
  return rows
    .filter((row) => row.record_state !== 'deleted')
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}

// --- groups ---

export async function getGroupsByOwner(ownerNpub) {
  return db.groups.where('owner_npub').equals(ownerNpub).toArray();
}

export async function getAllGroups() {
  return db.groups.toArray();
}

export async function upsertGroup(group) {
  return db.groups.put(sanitizeForStorage(group));
}

export async function deleteGroupById(groupId) {
  return db.groups.delete(groupId);
}

// --- address book ---

export async function upsertAddressBookPerson(entry) {
  const existing = await db.address_book.get(entry.npub);
  const merged = {
    npub: entry.npub,
    label: entry.label ?? existing?.label ?? null,
    avatar_url: entry.avatar_url ?? existing?.avatar_url ?? null,
    source: entry.source ?? existing?.source ?? 'unknown',
    last_used_at: entry.last_used_at ?? new Date().toISOString(),
  };
  return db.address_book.put(merged);
}

export async function getAddressBookPeople(query = '') {
  const all = await db.address_book.orderBy('last_used_at').reverse().toArray();
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return all;

  return all.filter((entry) =>
    String(entry.npub || '').toLowerCase().includes(needle)
    || String(entry.label || '').toLowerCase().includes(needle)
  );
}

// --- profiles ---

const PROFILE_CACHE_HOURS = 24;

export async function cacheProfile(pubkey, profile) {
  return db.profiles.put({
    pubkey,
    profile: sanitizeForStorage(profile),
    cachedAt: Date.now(),
  });
}

export async function getCachedProfile(pubkey) {
  const row = await db.profiles.get(pubkey);
  if (!row) return null;

  const maxAge = PROFILE_CACHE_HOURS * 60 * 60 * 1000;
  if (Date.now() - row.cachedAt > maxAge) {
    await db.profiles.delete(pubkey);
    return null;
  }

  return row.profile;
}

// --- pending_writes ---

export async function addPendingWrite(write) {
  return db.pending_writes.add(sanitizeForStorage({ ...write, created_at: new Date().toISOString() }));
}

export async function getPendingWrites() {
  return db.pending_writes.toArray();
}

export async function removePendingWrite(rowId) {
  return db.pending_writes.delete(rowId);
}

// --- sync_state ---

export async function getSyncState(key) {
  const row = await db.sync_state.get(key);
  return row?.value ?? null;
}

export async function setSyncState(key, value) {
  return db.sync_state.put({ key, value });
}

export async function clearSyncState() {
  return db.sync_state.clear();
}

// --- tasks ---

export async function getTasksByOwner(ownerNpub) {
  const rows = await db.tasks.where('owner_npub').equals(ownerNpub).toArray();
  return rows.filter((row) => row.record_state !== 'deleted');
}

export async function getRecentTaskChangesSince(sinceIso) {
  const rows = await db.tasks.where('updated_at').aboveOrEqual(sinceIso).toArray();
  return rows
    .filter((row) => row.record_state !== 'deleted')
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}

export async function upsertTask(task) {
  return db.tasks.put(sanitizeForStorage(task));
}

export async function getTaskById(recordId) {
  return db.tasks.get(recordId);
}

// --- schedules ---

export async function getSchedulesByOwner(ownerNpub) {
  const rows = await db.schedules.where('owner_npub').equals(ownerNpub).toArray();
  return rows.filter((row) => row.record_state !== 'deleted');
}

export async function getRecentScheduleChangesSince(sinceIso) {
  const rows = await db.schedules.where('updated_at').aboveOrEqual(sinceIso).toArray();
  return rows
    .filter((row) => row.record_state !== 'deleted')
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}

export async function upsertSchedule(schedule) {
  return db.schedules.put(sanitizeForStorage(schedule));
}

export async function getScheduleById(recordId) {
  return db.schedules.get(recordId);
}

// --- comments ---

export async function getCommentsByTarget(targetRecordId) {
  const rows = await db.comments.where('target_record_id').equals(targetRecordId).toArray();
  return rows
    .filter((row) => row.record_state !== 'deleted')
    .sort((a, b) => String(a.updated_at || '').localeCompare(String(b.updated_at || '')));
}

export async function getRecentCommentsSince(sinceIso) {
  const rows = await db.comments.where('updated_at').aboveOrEqual(sinceIso).toArray();
  return rows
    .filter((row) => row.record_state !== 'deleted')
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}

export async function upsertComment(comment) {
  return db.comments.put(sanitizeForStorage(comment));
}

// --- audio notes ---

export async function getAudioNotesByOwner(ownerNpub) {
  const rows = await db.audio_notes.where('owner_npub').equals(ownerNpub).toArray();
  return rows.filter((row) => row.record_state !== 'deleted');
}

export async function upsertAudioNote(audioNote) {
  return db.audio_notes.put(sanitizeForStorage(audioNote));
}

export async function getAudioNoteById(recordId) {
  return db.audio_notes.get(recordId);
}

// --- scopes ---

export async function getScopesByOwner(ownerNpub) {
  const rows = await db.scopes.where('owner_npub').equals(ownerNpub).toArray();
  return rows.filter((row) => row.record_state !== 'deleted');
}

export async function upsertScope(scope) {
  return db.scopes.put(scope);
}

export async function getScopeById(recordId) {
  return db.scopes.get(recordId);
}

export async function clearRuntimeData() {
  await Promise.all([
    db.channels.clear(),
    db.chat_messages.clear(),
    db.documents.clear(),
    db.directories.clear(),
    db.tasks.clear(),
    db.schedules.clear(),
    db.comments.clear(),
    db.audio_notes.clear(),
    db.scopes.clear(),
    db.groups.clear(),
    db.pending_writes.clear(),
    db.sync_state.clear(),
  ]);
}
