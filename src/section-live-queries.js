import {
  getAddressBookPeople,
  getChannelsByOwner,
  getMessagesByChannel,
  getAudioNotesByOwner,
  getDirectoriesByOwner,
  getDocumentById,
  getWindowedDocumentsByOwner,
  getReportById,
  getWindowedReportsByOwner,
  getTaskById,
  getWindowedTasksByOwner,
  getSchedulesByOwner,
  getScopesByOwner,
  getCommentsByTarget,
} from './db.js';
import { recordFamilyHash } from './translators/chat.js';

const SECTION_STATE = new WeakMap();

function getSectionState(store) {
  let state = SECTION_STATE.get(store);
  if (!state) {
    state = {
      shared: new Map(),
      workspace: new Map(),
      detail: new Map(),
      workspaceKey: '',
      workspaceOwnerNpub: '',
    };
    SECTION_STATE.set(store, state);
  }
  return state;
}

function stopSubscription(store, subscription) {
  if (!subscription || typeof store?.stopLiveSubscription !== 'function') return;
  store.stopLiveSubscription(subscription);
}

function syncBucket(store, bucket, specs) {
  const desiredKeys = new Set();

  for (const spec of specs) {
    if (!spec?.key) continue;
    desiredKeys.add(spec.key);
    if (bucket.has(spec.key)) continue;
    const subscription = store.createLiveSubscription(spec.query, spec.onNext);
    bucket.set(spec.key, subscription);
  }

  for (const [key, subscription] of bucket.entries()) {
    if (desiredKeys.has(key)) continue;
    stopSubscription(store, subscription);
    bucket.delete(key);
  }
}

function stopBucket(store, bucket) {
  for (const subscription of bucket.values()) {
    stopSubscription(store, subscription);
  }
  bucket.clear();
}

function buildSharedSpecs() {
  return [
    {
      key: 'address-book',
      query: () => getAddressBookPeople(),
      onNext: (people) => this.applyAddressBookPeople(people),
    },
  ];
}

function buildWorkspaceSpecs(store) {
  const ownerNpub = String(store?.workspaceOwnerNpub || '').trim();
  if (!ownerNpub) return [];

  switch (store?.navSection) {
    case 'status':
      return [
        {
          key: 'status:reports',
          query: () => getWindowedReportsByOwner(ownerNpub),
          onNext: (reports) => store.applyReports(reports),
        },
        {
          key: 'status:scopes',
          query: () => getScopesByOwner(ownerNpub),
          onNext: (scopes) => store.applyScopes(scopes),
        },
      ];
    case 'chat':
      return [
        {
          key: 'chat:channels',
          query: () => getChannelsByOwner(ownerNpub),
          onNext: (channels) => store.applyChannels(channels),
        },
        {
          key: 'chat:audio-notes',
          query: () => getAudioNotesByOwner(ownerNpub),
          onNext: (audioNotes) => store.applyAudioNotes(audioNotes),
        },
      ];
    case 'docs':
      return [
        {
          key: 'docs:directories',
          query: () => getDirectoriesByOwner(ownerNpub),
          onNext: (directories) => store.applyDirectories(directories),
        },
        {
          key: 'docs:documents',
          query: () => getWindowedDocumentsByOwner(ownerNpub),
          onNext: (documents) => store.applyDocuments(documents),
        },
        {
          key: 'docs:scopes',
          query: () => getScopesByOwner(ownerNpub),
          onNext: (scopes) => store.applyScopes(scopes),
        },
      ];
    case 'tasks':
      return [
        {
          key: 'tasks:tasks',
          query: () => getWindowedTasksByOwner(ownerNpub),
          onNext: (tasks) => store.applyTasks(tasks),
        },
        {
          key: 'tasks:scopes',
          query: () => getScopesByOwner(ownerNpub),
          onNext: (scopes) => store.applyScopes(scopes),
        },
      ];
    case 'calendar':
      return [
        {
          key: 'calendar:tasks',
          query: () => getWindowedTasksByOwner(ownerNpub),
          onNext: (tasks) => store.applyTasks(tasks),
        },
        {
          key: 'calendar:schedules',
          query: () => getSchedulesByOwner(ownerNpub),
          onNext: (schedules) => store.applySchedules(schedules),
        },
        {
          key: 'calendar:scopes',
          query: () => getScopesByOwner(ownerNpub),
          onNext: (scopes) => store.applyScopes(scopes),
        },
      ];
    case 'reports':
      return [
        {
          key: 'reports:reports',
          query: () => getWindowedReportsByOwner(ownerNpub),
          onNext: (reports) => store.applyReports(reports),
        },
        {
          key: 'reports:scopes',
          query: () => getScopesByOwner(ownerNpub),
          onNext: (scopes) => store.applyScopes(scopes),
        },
      ];
    case 'schedules':
      return [
        {
          key: 'schedules:schedules',
          query: () => getSchedulesByOwner(ownerNpub),
          onNext: (schedules) => store.applySchedules(schedules),
        },
      ];
    case 'scopes':
      return [
        {
          key: 'scopes:scopes',
          query: () => getScopesByOwner(ownerNpub),
          onNext: (scopes) => store.applyScopes(scopes),
        },
      ];
    default:
      return [];
  }
}

function buildDetailSpecs(store) {
  const ownerNpub = String(store?.workspaceOwnerNpub || '').trim();
  if (!ownerNpub) return [];

  switch (store?.navSection) {
    case 'chat': {
      const channelId = String(store?.selectedChannelId || '').trim();
      if (!channelId) return [];
      return [
        {
          key: `chat:messages:${channelId}`,
          query: () => getMessagesByChannel(channelId, {
            limit: store?.mainFeedVisibleCount || store?.MAIN_FEED_PAGE_SIZE,
          }),
          onNext: (messages) => {
            if (store.workspaceOwnerNpub !== ownerNpub || store.selectedChannelId !== channelId) return;
            return store.applyMessages(messages);
          },
        },
      ];
    }
    case 'tasks': {
      const taskId = String(store?.activeTaskId || '').trim();
      if (!taskId) return [];
      return [
        {
          key: `tasks:selected-task:${taskId}`,
          query: () => getTaskById(taskId),
          onNext: (task) => {
            if (store.workspaceOwnerNpub !== ownerNpub || store.activeTaskId !== taskId) return;
            return store.applySelectedTask(task);
          },
        },
        {
          key: `tasks:comments:${taskId}`,
          query: () => getCommentsByTarget(taskId),
          onNext: (comments) => {
            if (store.workspaceOwnerNpub !== ownerNpub || store.activeTaskId !== taskId) return;
            return store.applyTaskComments(comments);
          },
        },
      ];
    }
    case 'docs': {
      if (store?.selectedDocType !== 'document') return [];
      const docId = String(store?.selectedDocId || '').trim();
      if (!docId) return [];
      const documentFamilyHash = recordFamilyHash('document');
      return [
        {
          key: `docs:selected-doc:${docId}`,
          query: () => getDocumentById(docId),
          onNext: (document) => {
            if (
              store.workspaceOwnerNpub !== ownerNpub
              || store.selectedDocType !== 'document'
              || store.selectedDocId !== docId
            ) return;
            return store.applySelectedDocument(document);
          },
        },
        {
          key: `docs:comments:${docId}`,
          query: () => getCommentsByTarget(docId),
          onNext: (comments) => {
            if (
              store.workspaceOwnerNpub !== ownerNpub
              || store.selectedDocType !== 'document'
              || store.selectedDocId !== docId
            ) return;
            return store.applyDocComments(
              comments.filter((comment) => comment.target_record_family_hash === documentFamilyHash),
              { docId, allowBackfill: true },
            );
          },
        },
      ];
    }
    case 'reports': {
      const reportId = String(store?.selectedReportId || '').trim();
      if (!reportId) return [];
      return [
        {
          key: `reports:selected-report:${reportId}`,
          query: () => getReportById(reportId),
          onNext: (report) => {
            if (store.workspaceOwnerNpub !== ownerNpub || store.selectedReportId !== reportId) return;
            return store.applySelectedReport(report);
          },
        },
      ];
    }
    default:
      return [];
  }
}

function syncLiveQuerySet(store, bucket, specs) {
  const desiredSpecs = Array.isArray(specs) ? specs : [];
  syncBucket(store, bucket, desiredSpecs);
}

export function getSectionLiveQueryPlan(store) {
  return {
    shared: buildSharedSpecs.call(store).map((spec) => spec.key),
    workspace: buildWorkspaceSpecs(store).map((spec) => spec.key),
    detail: buildDetailSpecs(store).map((spec) => spec.key),
  };
}

export const sectionLiveQueryMixin = {
  startSharedLiveQueries() {
    const state = getSectionState(this);
    syncLiveQuerySet(this, state.shared, buildSharedSpecs.call(this));
  },

  stopSharedLiveQueries() {
    const state = getSectionState(this);
    stopBucket(this, state.shared);
  },

  startWorkspaceLiveQueries() {
    const state = getSectionState(this);
    if (typeof this.startSharedLiveQueries === 'function') {
      this.startSharedLiveQueries();
    }

    const ownerNpub = String(this.workspaceOwnerNpub || '').trim();
    const workspaceKey = String(this.currentWorkspaceKey || '').trim();
    if (state.workspaceKey !== workspaceKey || state.workspaceOwnerNpub !== ownerNpub) {
      state.workspaceKey = workspaceKey;
      state.workspaceOwnerNpub = ownerNpub;
      this.hasBootstrappedUnreadTracking = false;
    }

    if (!ownerNpub) {
      stopBucket(this, state.workspace);
      stopBucket(this, state.detail);
      return;
    }

    syncLiveQuerySet(this, state.workspace, buildWorkspaceSpecs(this));
    syncLiveQuerySet(this, state.detail, buildDetailSpecs(this));

    if (!this.hasBootstrappedUnreadTracking && typeof this.initUnreadTracking === 'function') {
      this.hasBootstrappedUnreadTracking = true;
      this.initUnreadTracking();
    }
  },

  stopWorkspaceLiveQueries() {
    const state = getSectionState(this);
    stopBucket(this, state.workspace);
    stopBucket(this, state.detail);
  },

  stopAllLiveQueries() {
    const state = getSectionState(this);
    stopBucket(this, state.shared);
    stopBucket(this, state.workspace);
    stopBucket(this, state.detail);
    state.workspaceKey = '';
    state.workspaceOwnerNpub = '';
  },

  startSelectedChannelLiveQuery() {
    this.startWorkspaceLiveQueries();
  },

  stopSelectedChannelLiveQuery() {
    const state = getSectionState(this);
    for (const [key, subscription] of state.detail.entries()) {
      if (!key.startsWith('chat:messages:')) continue;
      stopSubscription(this, subscription);
      state.detail.delete(key);
    }
  },

  startTaskCommentsLiveQuery() {
    this.startWorkspaceLiveQueries();
  },

  stopTaskCommentsLiveQuery() {
    const state = getSectionState(this);
    for (const [key, subscription] of state.detail.entries()) {
      if (!key.startsWith('tasks:comments:') && !key.startsWith('tasks:selected-task:')) continue;
      stopSubscription(this, subscription);
      state.detail.delete(key);
    }
  },

  startDocCommentsLiveQuery() {
    this.startWorkspaceLiveQueries();
  },

  stopDocCommentsLiveQuery() {
    const state = getSectionState(this);
    for (const [key, subscription] of state.detail.entries()) {
      if (!key.startsWith('docs:comments:') && !key.startsWith('docs:selected-doc:')) continue;
      stopSubscription(this, subscription);
      state.detail.delete(key);
    }
  },
};
