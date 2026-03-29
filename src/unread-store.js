/**
 * Unread indicators mixin for the Alpine chat store.
 *
 * Tracks read cursors per nav section and per chat channel.
 * Shows red dots on nav items when a section has unseen updates.
 *
 * Cursor key patterns:
 *   chat:nav          - nav-level cursor for the Chat section
 *   chat:channel:<id> - per-channel cursor
 *   tasks:nav         - nav-level cursor for the Tasks section
 *   docs:nav          - nav-level cursor for the Docs section
 *
 * record_id is deterministic: hex(sha256(viewer_npub + cursor_key))
 */

import {
  upsertReadCursor,
  getAllReadCursors,
  getWorkspaceDb,
} from './db.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function sha256Hex(input) {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function cursorRecordId(viewerNpub, cursorKey) {
  return sha256Hex(viewerNpub + cursorKey);
}

// ---------------------------------------------------------------------------
// Pure helpers (testable without Alpine/Dexie)
// ---------------------------------------------------------------------------

/**
 * Given a list of tasks and a cursor map, return an object mapping record_id → true
 * for every task that has unread updates.
 *
 * A task is unread when its updated_at exceeds the more recent of:
 *   - its per-task cursor  (tasks:item:<id>)
 *   - the section cursor   (tasks:nav)
 *
 * If no tasks:nav cursor exists yet the user has never visited the section,
 * so nothing can be unread (avoids a wall of red on first load).
 */
export function computeUnreadTaskMap(tasks, cursorMap, viewerNpub) {
  const navReadUntil = cursorMap['tasks:nav'] || null;
  if (!navReadUntil) return {};

  const result = {};
  for (const task of tasks) {
    if (task.record_state === 'deleted') continue;
    const taskKey = `tasks:item:${task.record_id}`;
    const taskReadUntil = cursorMap[taskKey] || null;
    let effectiveReadUntil =
      taskReadUntil && taskReadUntil > navReadUntil
        ? taskReadUntil
        : navReadUntil;

    // Self-created tasks are implicitly "read" at creation time.
    // The creator already knows about the task they made, so treat
    // created_at as a floor for the read cursor.  If someone else
    // later updates the task (updated_at > created_at), it will
    // surface as unread again.
    if (
      viewerNpub &&
      task.owner_npub === viewerNpub &&
      task.created_at &&
      task.created_at > effectiveReadUntil
    ) {
      effectiveReadUntil = task.created_at;
    }

    if (task.updated_at > effectiveReadUntil) {
      result[task.record_id] = true;
    }
  }
  return result;
}

/**
 * Derive whether the tasks nav dot should show from the per-task unread map.
 * Returns true if at least one task is unread.
 */
export function hasUnreadTasks(unreadTaskItems) {
  return Object.values(unreadTaskItems).some((v) => v);
}

/**
 * Determine whether the tasks:nav cursor should be auto-seeded.
 * Returns true when tasks exist in the DB but no cursor has been set yet
 * (e.g. after cache clear + hard refresh).
 */
export function shouldSeedTasksNavCursor(tasks, cursorMap) {
  if (cursorMap['tasks:nav']) return false;
  return tasks.some((t) => t.record_state !== 'deleted');
}

// ---------------------------------------------------------------------------
// Mixin
// ---------------------------------------------------------------------------

export const unreadStoreMixin = {
  // Reactive unread flags — these drive the red dots in the nav
  _unreadChat: false,
  _unreadTasks: false,
  _unreadDocs: false,
  // Per-channel unread map: { channelId: boolean }
  _unreadChannels: {},
  // Per-task unread map: { taskRecordId: boolean }
  _unreadTaskItems: {},

  // Timer handle for periodic refresh
  _unreadRefreshTimer: null,

  get unreadChat() { return this._unreadChat; },
  get unreadTasks() { return this._unreadTasks; },
  get unreadDocs() { return this._unreadDocs; },

  isChannelUnread(channelId) {
    return this._unreadChannels[channelId] === true;
  },

  isTaskUnread(taskId) {
    return this._unreadTaskItems[taskId] === true;
  },

  /**
   * Boot unread tracking — call after workspace DB is open and session.npub is available.
   */
  async initUnreadTracking() {
    await this.refreshUnreadFlags();
    // Re-check every 30s so background syncs surface new dots
    if (this._unreadRefreshTimer) clearInterval(this._unreadRefreshTimer);
    this._unreadRefreshTimer = setInterval(() => this.refreshUnreadFlags(), 30_000);
  },

  teardownUnreadTracking() {
    if (this._unreadRefreshTimer) {
      clearInterval(this._unreadRefreshTimer);
      this._unreadRefreshTimer = null;
    }
  },

  /**
   * Re-compute all unread flags by comparing cursors against live data.
   */
  async refreshUnreadFlags() {
    const viewerNpub = this.session?.npub;
    if (!viewerNpub) return;

    try {
      const db = getWorkspaceDb();

      // Load all cursors for this viewer in one shot
      const cursors = await getAllReadCursors(viewerNpub);
      const cursorMap = {};
      for (const c of cursors) {
        cursorMap[c.cursor_key] = c.read_until;
      }

      // --- Chat nav ---
      const chatReadUntil = cursorMap['chat:nav'] || '1970-01-01T00:00:00.000Z';
      const allMessages = await db.chat_messages.where('updated_at').above(chatReadUntil).first();
      this._unreadChat = allMessages != null && allMessages.record_state !== 'deleted';

      // --- Tasks nav --- derived from per-task unread map (computed below)

      // --- Docs nav ---
      const docsReadUntil = cursorMap['docs:nav'] || '1970-01-01T00:00:00.000Z';
      const latestDoc = await db.documents.where('updated_at').above(docsReadUntil).first();
      this._unreadDocs = latestDoc != null && latestDoc.record_state !== 'deleted';

      // --- Per-channel unread ---
      const channels = this.channels || [];
      const newChannelMap = {};
      for (const ch of channels) {
        const key = `chat:channel:${ch.record_id}`;
        const chReadUntil = cursorMap[key] || '1970-01-01T00:00:00.000Z';
        const newerMsg = await db.chat_messages
          .where('channel_id').equals(ch.record_id)
          .and((m) => m.updated_at > chReadUntil && m.record_state !== 'deleted')
          .first();
        newChannelMap[ch.record_id] = newerMsg != null;
      }
      this._unreadChannels = newChannelMap;

      // --- Per-task unread ---
      const allTasks = await db.tasks.toArray();

      // Auto-seed tasks:nav cursor after cache clear so per-task
      // red borders can render.  Seed to the OLDEST active task's
      // updated_at so all tasks appear unread until the user opens them.
      // Seeding to `now` would mark everything as read immediately.
      if (shouldSeedTasksNavCursor(allTasks, cursorMap)) {
        const activeTasks = allTasks.filter((t) => t.record_state !== 'deleted');
        const oldest = activeTasks.reduce(
          (min, t) => (t.updated_at < min ? t.updated_at : min),
          activeTasks[0]?.updated_at || new Date().toISOString(),
        );
        // Seed one millisecond before the oldest task so it's included
        const seedTime = new Date(new Date(oldest).getTime() - 1).toISOString();
        const cursorKey = 'tasks:nav';
        const recordId = await cursorRecordId(viewerNpub, cursorKey);
        await upsertReadCursor({
          record_id: recordId,
          cursor_key: cursorKey,
          viewer_npub: viewerNpub,
          read_until: seedTime,
        });
        cursorMap[cursorKey] = seedTime;
      }

      this._unreadTaskItems = computeUnreadTaskMap(allTasks, cursorMap, viewerNpub);
      this._unreadTasks = hasUnreadTasks(this._unreadTaskItems);
    } catch (e) {
      // Swallow errors — unread flags are non-critical
      console.warn('[unread] refresh failed:', e?.message || e);
    }
  },

  /**
   * Mark a nav section as read (updates cursor to now).
   */
  async markSectionRead(section) {
    const viewerNpub = this.session?.npub;
    if (!viewerNpub) return;

    const keyMap = {
      chat: 'chat:nav',
      tasks: 'tasks:nav',
      docs: 'docs:nav',
    };
    const cursorKey = keyMap[section];
    if (!cursorKey) return;

    const recordId = await cursorRecordId(viewerNpub, cursorKey);
    const now = new Date().toISOString();
    await upsertReadCursor({
      record_id: recordId,
      cursor_key: cursorKey,
      viewer_npub: viewerNpub,
      read_until: now,
    });

    // Immediately clear the flag
    if (section === 'chat') this._unreadChat = false;
    if (section === 'tasks') this._unreadTasks = false;
    if (section === 'docs') this._unreadDocs = false;
  },

  /**
   * Mark a specific chat channel as read.
   */
  async markChannelRead(channelId) {
    const viewerNpub = this.session?.npub;
    if (!viewerNpub || !channelId) return;

    const cursorKey = `chat:channel:${channelId}`;
    const recordId = await cursorRecordId(viewerNpub, cursorKey);
    const now = new Date().toISOString();
    await upsertReadCursor({
      record_id: recordId,
      cursor_key: cursorKey,
      viewer_npub: viewerNpub,
      read_until: now,
    });

    // Also update nav-level chat cursor
    await this.markSectionRead('chat');

    // Immediately clear the channel flag
    this._unreadChannels = { ...this._unreadChannels, [channelId]: false };
  },

  /**
   * Mark a specific task as read.
   */
  async markTaskRead(taskId) {
    const viewerNpub = this.session?.npub;
    if (!viewerNpub || !taskId) return;

    const cursorKey = `tasks:item:${taskId}`;
    const recordId = await cursorRecordId(viewerNpub, cursorKey);
    const now = new Date().toISOString();
    await upsertReadCursor({
      record_id: recordId,
      cursor_key: cursorKey,
      viewer_npub: viewerNpub,
      read_until: now,
    });

    // Immediately clear the task flag and re-derive nav dot
    this._unreadTaskItems = { ...this._unreadTaskItems, [taskId]: false };
    this._unreadTasks = hasUnreadTasks(this._unreadTaskItems);
  },

  /**
   * Mark all tasks as read — advances tasks:nav cursor to now,
   * which clears every per-task unread indicator at once.
   */
  async markAllTasksRead() {
    const viewerNpub = this.session?.npub;
    if (!viewerNpub) return;

    await this.markSectionRead('tasks');
    this._unreadTaskItems = {};
    this._unreadTasks = false;
  },
};
