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
  getTasksByOwner,
  getSchedulesByOwner,
  getScopesByOwner,
  getCommentsByTarget,
  getReactionsByTargets,
  getFlowsByOwner,
  getApprovalsByStatus,
  getPersonsByOwner,
  getOrganisationsByOwner,
  getOpportunitiesByOwner,
  getOpportunityById,
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

  // Flows are loaded eagerly (not section-gated) because flow linkage
  // resolution in addTask/saveEditingTask depends on store.flows being
  // populated regardless of which section the user is viewing.
  const alwaysOn = [
    {
      key: 'ws:flows',
      query: () => getFlowsByOwner(ownerNpub),
      onNext: (flows) => store.applyFlows(flows),
    },
    {
      key: 'ws:opportunities',
      query: () => getOpportunitiesByOwner(ownerNpub),
      onNext: (opportunities) => store.applyOpportunities(opportunities),
    },
  ];

  let sectionSpecs;
  switch (store?.navSection) {
    case 'status':
      sectionSpecs = [
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
        {
          key: 'status:approvals',
          query: () => getApprovalsByStatus('pending'),
          onNext: (approvals) => { store.approvals = approvals; },
        },
      ];
      break;
    case 'chat':
      sectionSpecs = [
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
      break;
    case 'docs':
      sectionSpecs = [
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
      break;
    case 'tasks':
      sectionSpecs = [
        {
          key: 'tasks:tasks',
          query: () => getTasksByOwner(ownerNpub),
          onNext: (tasks) => store.applyTasks(tasks),
        },
        {
          key: 'tasks:scopes',
          query: () => getScopesByOwner(ownerNpub),
          onNext: (scopes) => store.applyScopes(scopes),
        },
      ];
      break;
    case 'reports':
      sectionSpecs = [
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
      break;
    case 'settings':
      sectionSpecs = [
        {
          key: 'settings:schedules',
          query: () => getSchedulesByOwner(ownerNpub),
          onNext: (schedules) => store.applySchedules(schedules),
        },
        {
          key: 'settings:scopes',
          query: () => getScopesByOwner(ownerNpub),
          onNext: (scopes) => store.applyScopes(scopes),
        },
        {
          key: 'settings:approvals',
          query: () => getApprovalsByStatus('pending'),
          onNext: (approvals) => { store.approvals = approvals; },
        },
      ];
      break;
    case 'people':
      sectionSpecs = [
        {
          key: 'people:persons',
          query: () => getPersonsByOwner(ownerNpub),
          onNext: (persons) => store.applyPersons(persons),
        },
        {
          key: 'people:organisations',
          query: () => getOrganisationsByOwner(ownerNpub),
          onNext: (orgs) => store.applyOrganisations(orgs),
        },
      ];
      break;
    case 'opportunities':
      sectionSpecs = [
        {
          key: 'opportunities:persons',
          query: () => getPersonsByOwner(ownerNpub),
          onNext: (persons) => store.applyPersons(persons),
        },
        {
          key: 'opportunities:organisations',
          query: () => getOrganisationsByOwner(ownerNpub),
          onNext: (organisations) => store.applyOrganisations(organisations),
        },
        {
          key: 'opportunities:tasks',
          query: () => getTasksByOwner(ownerNpub),
          onNext: (tasks) => store.applyTasks(tasks),
        },
      ];
      break;
    default:
      sectionSpecs = [];
  }

  return [...alwaysOn, ...sectionSpecs];
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
        {
          key: `chat:reactions:${channelId}`,
          query: async () => {
            const messages = await getMessagesByChannel(channelId, {
              limit: store?.mainFeedVisibleCount || store?.MAIN_FEED_PAGE_SIZE,
            });
            return getReactionsByTargets(
              messages.map((message) => message.record_id).filter(Boolean),
              recordFamilyHash('chat_message'),
            );
          },
          onNext: (reactions) => {
            if (store.workspaceOwnerNpub !== ownerNpub || store.selectedChannelId !== channelId) return;
            return store.applyReactions(reactions);
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
        {
          key: `tasks:comment-reactions:${taskId}`,
          query: async () => {
            const comments = await getCommentsByTarget(taskId);
            return getReactionsByTargets(
              comments.map((comment) => comment.record_id).filter(Boolean),
              recordFamilyHash('comment'),
            );
          },
          onNext: (reactions) => {
            if (store.workspaceOwnerNpub !== ownerNpub || store.activeTaskId !== taskId) return;
            return store.applyReactions(reactions);
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
        {
          key: `docs:comment-reactions:${docId}`,
          query: async () => {
            const comments = await getCommentsByTarget(docId);
            return getReactionsByTargets(
              comments
                .filter((comment) => comment.target_record_family_hash === documentFamilyHash)
                .map((comment) => comment.record_id)
                .filter(Boolean),
              recordFamilyHash('comment'),
            );
          },
          onNext: (reactions) => {
            if (
              store.workspaceOwnerNpub !== ownerNpub
              || store.selectedDocType !== 'document'
              || store.selectedDocId !== docId
            ) return;
            return store.applyReactions(reactions);
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
    case 'opportunities': {
      const opportunityId = String(store?.activeOpportunityId || '').trim();
      if (!opportunityId) return [];
      return [
        {
          key: `opportunities:selected-opportunity:${opportunityId}`,
          query: () => getOpportunityById(opportunityId),
          onNext: (opportunity) => {
            if (store.workspaceOwnerNpub !== ownerNpub || store.activeOpportunityId !== opportunityId) return;
            return store.applySelectedOpportunity(opportunity);
          },
        },
        {
          key: `opportunities:comments:${opportunityId}`,
          query: () => getCommentsByTarget(opportunityId),
          onNext: (comments) => {
            if (store.workspaceOwnerNpub !== ownerNpub || store.activeOpportunityId !== opportunityId) return;
            return store.applyOpportunityComments(comments);
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
      if (!key.startsWith('chat:messages:') && !key.startsWith('chat:reactions:')) continue;
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
      if (!key.startsWith('tasks:comments:') && !key.startsWith('tasks:comment-reactions:') && !key.startsWith('tasks:selected-task:')) continue;
      stopSubscription(this, subscription);
      state.detail.delete(key);
    }
  },

  startOpportunityCommentsLiveQuery() {
    this.startWorkspaceLiveQueries();
  },

  stopOpportunityCommentsLiveQuery() {
    const state = getSectionState(this);
    for (const [key, subscription] of state.detail.entries()) {
      if (!key.startsWith('opportunities:comments:') && !key.startsWith('opportunities:selected-opportunity:')) continue;
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
      if (!key.startsWith('docs:comments:') && !key.startsWith('docs:comment-reactions:') && !key.startsWith('docs:selected-doc:')) continue;
      stopSubscription(this, subscription);
      state.detail.delete(key);
    }
  },
};
