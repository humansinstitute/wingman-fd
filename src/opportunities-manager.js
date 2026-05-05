import {
  addPendingWrite,
  getCommentsByTarget,
  getTaskById,
  getOpportunityById,
  getOpportunitiesByOwner,
  getPendingWrites,
  removePendingWrite,
  upsertComment,
  upsertOpportunity,
  upsertTask,
} from './db.js';
import { outboundComment } from './translators/comments.js';
import {
  OPPORTUNITY_STAGE_OPTIONS,
  outboundOpportunity,
  recordFamilyHash as opportunityFamilyHash,
} from './translators/opportunities.js';
import {
  outboundTask,
  resolveFlowDispatchAssignee,
  resolveFlowLinkage,
} from './translators/tasks.js';
import { toRaw } from './utils/state-helpers.js';
import {
  getRecordWriteFieldsForStore,
  getPreferredRecordWriteGroupForStore,
} from './preferred-write-group.js';

const FORECAST_TERMINAL_STAGES = new Set(['won', 'lost', 'abandoned']);
const INTEGER_FORMATTER = new Intl.NumberFormat();
const COMPACT_NUMBER_FORMATTER = new Intl.NumberFormat(undefined, {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function normalizeLinkedRows(value, key) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const rows = [];
  for (const item of value) {
    const normalized = item && typeof item === 'object'
      ? item
      : { [key]: String(item || '').trim() };
    const id = String(normalized?.[key] || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    rows.push({
      ...normalized,
      [key]: id,
      primary: normalized?.primary === true,
    });
  }
  return rows;
}

function sortLinksPrimaryFirst(links = [], key) {
  return [...links].sort((left, right) => {
    if (left?.primary === right?.primary) {
      return String(left?.[key] || '').localeCompare(String(right?.[key] || ''));
    }
    return left?.primary ? -1 : 1;
  });
}

function buildLinkedOpportunitySummary(opportunity) {
  return {
    opportunity_id: opportunity.record_id,
    title: opportunity.title || 'Untitled opportunity',
    stage: opportunity.stage || 'speculation',
  };
}

function parseDateValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T00:00:00`)
    : new Date(raw);
  const timestamp = parsed.getTime();
  return Number.isFinite(timestamp) ? parsed : null;
}

function isForecastStage(stage) {
  return !FORECAST_TERMINAL_STAGES.has(String(stage || '').trim().toLowerCase());
}

function normalizeCurrencyCode(value) {
  const code = String(value || '').trim().toUpperCase();
  return code || 'UNSPECIFIED';
}

function formatForecastNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0';
  const absolute = Math.abs(numeric);
  return absolute >= 1000
    ? COMPACT_NUMBER_FORMATTER.format(numeric)
    : INTEGER_FORMATTER.format(Math.round(numeric));
}

function formatCurrencySummaryEntry(entry) {
  const label = entry.currency === 'UNSPECIFIED' ? 'No currency' : entry.currency;
  return `${label} ${formatForecastNumber(entry.amount)}`;
}

function summarizeForecastTotals(opportunities = []) {
  const totals = new Map();
  let scopedCount = 0;
  for (const opportunity of opportunities) {
    const amount = Number(opportunity?.expected_value);
    if (!Number.isFinite(amount)) continue;
    const currency = normalizeCurrencyCode(opportunity?.currency);
    totals.set(currency, (totals.get(currency) || 0) + amount);
    scopedCount += 1;
  }

  const entries = [...totals.entries()]
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((left, right) => right.amount - left.amount);

  if (entries.length === 0) {
    return {
      value: '—',
      meta: 'No forecast values',
      count: 0,
    };
  }

  if (entries.length === 1) {
    return {
      value: formatCurrencySummaryEntry(entries[0]),
      meta: `${INTEGER_FORMATTER.format(scopedCount)} forecast item${scopedCount === 1 ? '' : 's'}`,
      count: scopedCount,
    };
  }

  return {
    value: `${formatCurrencySummaryEntry(entries[0])} +${entries.length - 1}`,
    meta: entries.map(formatCurrencySummaryEntry).join(' · '),
    count: scopedCount,
  };
}

export const opportunitiesManagerMixin = {
  get opportunityStageOptions() {
    return OPPORTUNITY_STAGE_OPTIONS;
  },

  hydrateOpportunities(opportunities = [], context = {}) {
    const persons = Array.isArray(context.persons) ? context.persons : this.persons;
    const organisations = Array.isArray(context.organisations) ? context.organisations : this.organisations;
    const tasks = Array.isArray(context.tasks) ? context.tasks : this.tasks;
    const all = Array.isArray(opportunities) ? opportunities : [];
    const byId = new Map(all.map((row) => [row.record_id, row]));
    return all
      .filter((row) => row?.record_state !== 'deleted')
      .map((row) => ({
        ...row,
        person_links: sortLinksPrimaryFirst(normalizeLinkedRows(row.person_links, 'person_id'), 'person_id'),
        organisation_links: sortLinksPrimaryFirst(normalizeLinkedRows(row.organisation_links, 'organisation_id'), 'organisation_id'),
        task_links: sortLinksPrimaryFirst(normalizeLinkedRows(row.task_links, 'task_id'), 'task_id'),
        linked_people: normalizeLinkedRows(row.person_links, 'person_id')
          .map((link) => ({
            ...link,
            person: persons.find((person) => person.record_id === link.person_id) || null,
          })),
        linked_organisations: normalizeLinkedRows(row.organisation_links, 'organisation_id')
          .map((link) => ({
            ...link,
            organisation: organisations.find((organisation) => organisation.record_id === link.organisation_id) || null,
          })),
        linked_tasks: normalizeLinkedRows(row.task_links, 'task_id')
          .map((link) => ({
            ...link,
            task: tasks.find((task) => task.record_id === link.task_id) || null,
          })),
        origin_opportunity: row.origin_opportunity_id
          ? (byId.get(row.origin_opportunity_id)
            || this.opportunities.find((entry) => entry.record_id === row.origin_opportunity_id)
            || null)
          : null,
      }));
  },

  hydratePersonsWithOpportunityLinks(persons = [], opportunities = this.opportunities) {
    const allOpportunities = Array.isArray(opportunities) ? opportunities : [];
    return (Array.isArray(persons) ? persons : [])
      .filter((row) => row?.record_state !== 'deleted')
      .map((person) => ({
        ...person,
        opportunity_links: allOpportunities
          .filter((opportunity) => (opportunity.person_links || []).some((link) => link.person_id === person.record_id))
          .map(buildLinkedOpportunitySummary),
      }));
  },

  hydrateOrganisationsWithOpportunityLinks(organisations = [], opportunities = this.opportunities) {
    const allOpportunities = Array.isArray(opportunities) ? opportunities : [];
    return (Array.isArray(organisations) ? organisations : [])
      .filter((row) => row?.record_state !== 'deleted')
      .map((organisation) => ({
        ...organisation,
        opportunity_links: allOpportunities
          .filter((opportunity) => (opportunity.organisation_links || []).some((link) => link.organisation_id === organisation.record_id))
          .map(buildLinkedOpportunitySummary),
      }));
  },

  hydrateTasksWithOpportunityLinks(tasks = [], opportunities = this.opportunities) {
    const allOpportunities = Array.isArray(opportunities) ? opportunities : [];
    return (Array.isArray(tasks) ? tasks : [])
      .filter((row) => row?.record_state !== 'deleted')
      .map((task) => ({
        ...task,
        opportunity_links: allOpportunities
          .filter((opportunity) => (opportunity.task_links || []).some((link) => link.task_id === task.record_id))
          .map(buildLinkedOpportunitySummary),
      }));
  },

  applyOpportunities(opportunities = []) {
    const hydrated = this.hydrateOpportunities(opportunities);
    this.opportunities = hydrated;
    this.persons = this.hydratePersonsWithOpportunityLinks(this.persons, hydrated);
    this.organisations = this.hydrateOrganisationsWithOpportunityLinks(this.organisations, hydrated);
    this.tasks = this.hydrateTasksWithOpportunityLinks(this.tasks, hydrated);

    if (this.activeOpportunityId) {
      const active = hydrated.find((row) => row.record_id === this.activeOpportunityId) || null;
      if (!this.isOpportunityDetailEditing?.()) {
        this.editingOpportunity = active ? toRaw(active) : null;
      }
      this.showOpportunityEditor = Boolean(active);
    }
  },

  async refreshOpportunities() {
    const ownerNpub = this.workspaceOwnerNpub;
    if (!ownerNpub) return;
    await this.applyOpportunities(await getOpportunitiesByOwner(ownerNpub));
  },

  async applySelectedOpportunity(opportunity = null) {
    const recordId = String(this.activeOpportunityId || '').trim();
    if (!recordId) return;
    const nextRows = this.opportunities.filter((item) => item?.record_id !== recordId);
    if (opportunity && opportunity.record_state !== 'deleted') {
      nextRows.push(opportunity);
    }
    this.applyOpportunities(nextRows);
    if (this.activeOpportunityId !== recordId) return;
    const selected = this.opportunities.find((item) => item.record_id === recordId) || null;
    this.editingOpportunity = selected ? toRaw(selected) : null;
    this.showOpportunityEditor = Boolean(selected);
    this.opportunityDetailMode = 'view';
    this.opportunityEditOriginal = null;
    this.opportunityPersonQuery = '';
    this.opportunityOrganisationQuery = '';
    this.opportunityTaskQuery = '';
    this.opportunityResponsibleQuery = '';
    if (selected?.responsible_npub) this.resolveChatProfile(selected.responsible_npub);
  },

  applyOpportunityComments(comments = []) {
    const targetFamilyHash = opportunityFamilyHash('opportunity');
    this.opportunityComments = (Array.isArray(comments) ? comments : [])
      .filter((comment) => comment?.target_record_family_hash === targetFamilyHash && comment?.record_state !== 'deleted');
  },

  async loadOpportunityComments(opportunityId) {
    this.startOpportunityCommentsLiveQuery?.();
    const comments = await getCommentsByTarget(opportunityId);
    this.applyOpportunityComments(comments);
  },

  createOpportunityDraft(seed = {}) {
    return {
      record_id: seed.record_id || null,
      owner_npub: seed.owner_npub || this.workspaceOwnerNpub,
      title: seed.title || '',
      description: seed.description || '',
      stage: seed.stage || 'speculation',
      opportunity_type: seed.opportunity_type || '',
      responsible_npub: seed.responsible_npub || null,
      person_links: sortLinksPrimaryFirst(normalizeLinkedRows(seed.person_links, 'person_id'), 'person_id'),
      organisation_links: sortLinksPrimaryFirst(normalizeLinkedRows(seed.organisation_links, 'organisation_id'), 'organisation_id'),
      task_links: sortLinksPrimaryFirst(normalizeLinkedRows(seed.task_links, 'task_id'), 'task_id'),
      expected_value: Number.isFinite(Number(seed.expected_value)) ? Number(seed.expected_value) : null,
      currency: seed.currency || '',
      expected_close_at: seed.expected_close_at || null,
      source: seed.source || '',
      origin_opportunity_id: seed.origin_opportunity_id || null,
      scope_id: seed.scope_id ?? null,
      scope_l1_id: seed.scope_l1_id ?? null,
      scope_l2_id: seed.scope_l2_id ?? null,
      scope_l3_id: seed.scope_l3_id ?? null,
      scope_l4_id: seed.scope_l4_id ?? null,
      scope_l5_id: seed.scope_l5_id ?? null,
      shares: Array.isArray(seed.shares) ? [...seed.shares] : [],
      group_ids: Array.isArray(seed.group_ids) ? [...seed.group_ids] : [],
      sync_status: seed.sync_status || 'pending',
      record_state: seed.record_state || 'active',
      version: seed.version ?? 1,
      created_at: seed.created_at || null,
      updated_at: seed.updated_at || null,
    };
  },

  openNewOpportunity(seed = {}) {
    this.activeOpportunityId = null;
    this.editingOpportunity = this.createOpportunityDraft(seed);
    this.showOpportunityEditor = true;
    this.opportunityDetailMode = 'edit';
    this.opportunityEditOriginal = null;
    this.newOpportunityCommentBody = '';
    this.opportunityComments = [];
    this.opportunityPersonQuery = '';
    this.opportunityOrganisationQuery = '';
    this.opportunityTaskQuery = '';
    this.opportunityResponsibleQuery = '';
    this.syncRoute();
  },

  openOpportunityDetail(opportunityId) {
    const opportunity = this.opportunities.find((item) => item.record_id === opportunityId) || null;
    this.activeOpportunityId = opportunityId;
    this.editingOpportunity = opportunity ? this.createOpportunityDraft(opportunity) : null;
    this.showOpportunityEditor = Boolean(opportunity);
    this.opportunityDetailMode = 'view';
    this.opportunityEditOriginal = null;
    this.newOpportunityCommentBody = '';
    this.opportunityPersonQuery = '';
    this.opportunityOrganisationQuery = '';
    this.opportunityTaskQuery = '';
    this.opportunityResponsibleQuery = '';
    if (opportunity?.responsible_npub) this.resolveChatProfile(opportunity.responsible_npub);
    this.loadOpportunityComments(opportunityId);
    this.syncRoute();
  },

  closeOpportunityDetail(options = {}) {
    this.stopOpportunityCommentsLiveQuery?.();
    if (this.isOpportunityDetailEditing?.() && this.opportunityEditOriginal?.record_id) {
      void this.releaseLockManagedCheckout?.(this.opportunityEditOriginal, opportunityFamilyHash('opportunity'), {
        reportError: false,
        force: true,
        checkoutPolicyConfig: this.getOpportunityCheckoutPolicyConfig?.(),
      });
    }
    this.activeOpportunityId = null;
    this.editingOpportunity = null;
    this.showOpportunityEditor = false;
    this.opportunityDetailMode = 'view';
    this.opportunityEditOriginal = null;
    this.newOpportunityCommentBody = '';
    this.opportunityComments = [];
    this.opportunityPersonQuery = '';
    this.opportunityOrganisationQuery = '';
    this.opportunityTaskQuery = '';
    this.opportunityResponsibleQuery = '';
    if (options.syncRoute !== false) this.syncRoute();
  },

  get filteredOpportunities() {
    const needle = String(this.opportunityFilter || '').trim().toLowerCase();
    const rows = Array.isArray(this.opportunities) ? this.opportunities : [];
    if (!needle) return rows;
    return rows.filter((opportunity) =>
      String(opportunity.title || '').toLowerCase().includes(needle)
      || String(opportunity.description || '').toLowerCase().includes(needle)
      || String(opportunity.opportunity_type || '').toLowerCase().includes(needle)
      || String(opportunity.stage || '').toLowerCase().includes(needle)
      || String(opportunity.source || '').toLowerCase().includes(needle)
    );
  },

  get opportunityMetrics() {
    const opportunities = Array.isArray(this.filteredOpportunities) ? this.filteredOpportunities : [];
    const openOpportunities = opportunities.filter((opportunity) => isForecastStage(opportunity?.stage));
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfWindow = new Date(startOfToday);
    endOfWindow.setDate(endOfWindow.getDate() + 30);

    const forecast30 = openOpportunities.filter((opportunity) => {
      const closeDate = parseDateValue(opportunity?.expected_close_at);
      if (!closeDate) return false;
      return closeDate >= startOfToday && closeDate <= endOfWindow;
    });

    const linkedTaskIds = new Set();
    for (const opportunity of opportunities) {
      for (const link of opportunity?.task_links || []) {
        const taskId = String(link?.task_id || '').trim();
        if (taskId) linkedTaskIds.add(taskId);
      }
    }
    const recentActivityThreshold = new Date(startOfToday);
    recentActivityThreshold.setDate(recentActivityThreshold.getDate() - 30);
    const recentActivities = (this.tasks || []).filter((task) => {
      if (task?.record_state === 'deleted') return false;
      if (!linkedTaskIds.has(task?.record_id)) return false;
      const updatedAt = parseDateValue(task?.updated_at || task?.created_at);
      return updatedAt && updatedAt >= recentActivityThreshold;
    });

    return {
      opportunityCount: opportunities.length,
      openCount: openOpportunities.length,
      totalForecast: summarizeForecastTotals(openOpportunities),
      next30Forecast: summarizeForecastTotals(forecast30),
      recentActivityCount: recentActivities.length,
    };
  },

  get opportunityTypeSuggestions() {
    const needle = String(this.editingOpportunity?.opportunity_type || '').trim().toLowerCase();
    if (!needle) return [];
    const values = [...new Set(
      (this.opportunities || [])
        .map((opportunity) => String(opportunity.opportunity_type || '').trim())
        .filter(Boolean),
    )];
    return values
      .filter((value) => value.toLowerCase().includes(needle) && value.toLowerCase() !== needle)
      .slice(0, 8);
  },

  get opportunityResponsibleSuggestions() {
    return this.findPeopleSuggestions(this.opportunityResponsibleQuery, [this.editingOpportunity?.responsible_npub]);
  },

  get opportunityPersonSuggestions() {
    const excludedIds = new Set((this.editingOpportunity?.person_links || []).map((link) => link.person_id));
    const needle = String(this.opportunityPersonQuery || '').trim().toLowerCase();
    if (!needle) return [];
    return (this.persons || [])
      .filter((person) => !excludedIds.has(person.record_id))
      .filter((person) =>
        String(person.title || '').toLowerCase().includes(needle)
        || String(person.tags || '').toLowerCase().includes(needle))
      .slice(0, 8);
  },

  get opportunityOrganisationSuggestions() {
    const excludedIds = new Set((this.editingOpportunity?.organisation_links || []).map((link) => link.organisation_id));
    const needle = String(this.opportunityOrganisationQuery || '').trim().toLowerCase();
    if (!needle) return [];
    return (this.organisations || [])
      .filter((organisation) => !excludedIds.has(organisation.record_id))
      .filter((organisation) =>
        String(organisation.title || '').toLowerCase().includes(needle)
        || String(organisation.tags || '').toLowerCase().includes(needle))
      .slice(0, 8);
  },

  get opportunityTaskSuggestions() {
    const excludedIds = new Set((this.editingOpportunity?.task_links || []).map((link) => link.task_id));
    const needle = String(this.opportunityTaskQuery || '').trim().toLowerCase();
    if (!needle) return [];
    return (this.tasks || [])
      .filter((task) => task.record_state !== 'deleted' && !excludedIds.has(task.record_id))
      .filter((task) => String(task.title || '').toLowerCase().includes(needle))
      .slice(0, 8);
  },

  get editingOpportunityScopeLabel() {
    const scopeId = this.editingOpportunity?.scope_id;
    if (!scopeId) return '';
    return this.getScopeBreadcrumb?.(scopeId) || '';
  },

  get editingOpportunityScopeLevel() {
    const scopeId = this.editingOpportunity?.scope_id;
    if (!scopeId) return '';
    return this.scopesMap?.get(scopeId)?.level || '';
  },

  get opportunityTaskDraftTitle() {
    return String(this.opportunityTaskQuery || '').trim();
  },

  get opportunityTaskHasExactMatch() {
    const needle = this.opportunityTaskDraftTitle.toLowerCase();
    if (!needle) return false;
    return (this.tasks || []).some((task) =>
      task?.record_state !== 'deleted'
      && String(task.title || '').trim().toLowerCase() === needle);
  },

  isOpportunityDetailEditing() {
    return this.opportunityDetailMode === 'edit';
  },

  getOpportunityCheckoutPolicyConfig() {
    if (typeof this.getCheckoutEditPolicyConfig === 'function') {
      return this.getCheckoutEditPolicyConfig('opportunity');
    }
    const baseConfig = this.recordCheckoutPolicyConfig || {};
    return {
      recordFamilyHashes: {
        ...(baseConfig.recordFamilyHashes || {}),
      },
      familySuffixes: {
        ...(baseConfig.familySuffixes || {}),
        opportunity: 'checkout_required',
      },
    };
  },

  async enterOpportunityEditMode() {
    if (!this.editingOpportunity || !this.session?.npub || this.opportunityCheckoutPending) return false;
    if (!this.editingOpportunity.record_id) {
      this.opportunityDetailMode = 'edit';
      return true;
    }
    const opportunity = this.opportunities.find((item) => item.record_id === this.editingOpportunity.record_id)
      || await getOpportunityById(this.editingOpportunity.record_id);
    if (!opportunity) return false;
    const checkoutPolicyConfig = this.getOpportunityCheckoutPolicyConfig();
    this.opportunityCheckoutPending = true;
    try {
      await this.ensureLockManagedCheckout?.(opportunity, opportunityFamilyHash('opportunity'), {
        intent: 'edit',
        checkoutPolicyConfig,
      });
      this.opportunityEditOriginal = toRaw(opportunity);
      this.editingOpportunity = this.createOpportunityDraft(opportunity);
      this.opportunityDetailMode = 'edit';
      this.error = '';
      return true;
    } catch (error) {
      this.opportunityDetailMode = 'view';
      if (error?.userMessage) this.error = error.userMessage;
      return false;
    } finally {
      this.opportunityCheckoutPending = false;
    }
  },

  async cancelOpportunityEdit(options = {}) {
    if (!this.editingOpportunity) return;
    const recordId = this.editingOpportunity.record_id;
    const original = recordId
      ? (this.opportunities.find((item) => item.record_id === recordId) || this.opportunityEditOriginal)
      : null;
    if (original?.record_id) {
      await this.releaseLockManagedCheckout?.(original, opportunityFamilyHash('opportunity'), {
        reportError: options.reportError === true,
        force: true,
        checkoutPolicyConfig: this.getOpportunityCheckoutPolicyConfig(),
      });
    }
    this.editingOpportunity = original ? this.createOpportunityDraft(original) : null;
    this.opportunityDetailMode = 'view';
    this.opportunityEditOriginal = null;
    this.opportunityPersonQuery = '';
    this.opportunityOrganisationQuery = '';
    this.opportunityTaskQuery = '';
    this.opportunityResponsibleQuery = '';
  },

  get canCreateOpportunityTask() {
    return Boolean(this.opportunityTaskDraftTitle) && Boolean(this.editingOpportunity?.scope_id);
  },

  assignOpportunityResponsible(npub) {
    if (!this.editingOpportunity) return;
    this.editingOpportunity.responsible_npub = npub || null;
    this.opportunityResponsibleQuery = '';
    if (npub) this.resolveChatProfile(npub);
  },

  clearOpportunityResponsible() {
    if (!this.editingOpportunity) return;
    this.editingOpportunity.responsible_npub = null;
    this.opportunityResponsibleQuery = '';
  },

  assignScopeToEditingOpportunity(scopeId) {
    if (!this.editingOpportunity) return;
    Object.assign(this.editingOpportunity, this.buildScopeAssignment(scopeId));
  },

  clearEditingOpportunityScope() {
    if (!this.editingOpportunity) return;
    Object.assign(this.editingOpportunity, this.buildScopeAssignment(null));
  },

  linkPersonToEditingOpportunity(personId, options = {}) {
    if (!this.editingOpportunity || !personId) return;
    const nextLinks = normalizeLinkedRows([
      ...(this.editingOpportunity.person_links || []),
      { person_id: personId, primary: options.primary === true || (this.editingOpportunity.person_links || []).length === 0 },
    ], 'person_id');
    this.editingOpportunity.person_links = sortLinksPrimaryFirst(nextLinks, 'person_id');
    this.opportunityPersonQuery = '';
  },

  unlinkPersonFromEditingOpportunity(personId) {
    if (!this.editingOpportunity) return;
    const nextLinks = (this.editingOpportunity.person_links || []).filter((link) => link.person_id !== personId);
    if (nextLinks.length > 0 && !nextLinks.some((link) => link.primary)) nextLinks[0].primary = true;
    this.editingOpportunity.person_links = sortLinksPrimaryFirst(nextLinks, 'person_id');
  },

  linkOrganisationToEditingOpportunity(organisationId, options = {}) {
    if (!this.editingOpportunity || !organisationId) return;
    const nextLinks = normalizeLinkedRows([
      ...(this.editingOpportunity.organisation_links || []),
      { organisation_id: organisationId, primary: options.primary === true || (this.editingOpportunity.organisation_links || []).length === 0 },
    ], 'organisation_id');
    this.editingOpportunity.organisation_links = sortLinksPrimaryFirst(nextLinks, 'organisation_id');
    this.opportunityOrganisationQuery = '';
  },

  unlinkOrganisationFromEditingOpportunity(organisationId) {
    if (!this.editingOpportunity) return;
    const nextLinks = (this.editingOpportunity.organisation_links || []).filter((link) => link.organisation_id !== organisationId);
    if (nextLinks.length > 0 && !nextLinks.some((link) => link.primary)) nextLinks[0].primary = true;
    this.editingOpportunity.organisation_links = sortLinksPrimaryFirst(nextLinks, 'organisation_id');
  },

  linkTaskToEditingOpportunity(taskId, options = {}) {
    if (!this.editingOpportunity || !taskId) return;
    const nextLinks = normalizeLinkedRows([
      ...(this.editingOpportunity.task_links || []),
      { task_id: taskId, primary: options.primary !== false },
    ], 'task_id');
    if (nextLinks.length > 0 && !nextLinks.some((link) => link.primary)) nextLinks[0].primary = true;
    this.editingOpportunity.task_links = sortLinksPrimaryFirst(nextLinks, 'task_id');
    this.opportunityTaskQuery = '';
  },

  unlinkTaskFromEditingOpportunity(taskId) {
    if (!this.editingOpportunity) return;
    const nextLinks = (this.editingOpportunity.task_links || []).filter((link) => link.task_id !== taskId);
    if (nextLinks.length > 0 && !nextLinks.some((link) => link.primary)) nextLinks[0].primary = true;
    this.editingOpportunity.task_links = sortLinksPrimaryFirst(nextLinks, 'task_id');
  },

  async createTaskForEditingOpportunity() {
    if (!this.session?.npub) return null;
    const title = this.opportunityTaskDraftTitle;
    if (!title) return null;
    if (!this.editingOpportunity?.scope_id) {
      this.error = 'Set an opportunity scope before creating a task.';
      return null;
    }

    const assignment = this.buildTaskBoardAssignment(this.editingOpportunity.scope_id);
    if (!assignment.scope_id) {
      this.error = 'Select a valid opportunity scope before creating a task.';
      return null;
    }

    const now = new Date().toISOString();
    const recordId = crypto.randomUUID();
    const ownerNpub = this.workspaceOwnerNpub;
    const references = this.editingOpportunity?.record_id
      ? [{ type: 'opportunity', id: this.editingOpportunity.record_id }]
      : [];
    const flowLinkage = resolveFlowLinkage({
      title,
      description: '',
      references,
      flows: (this.flows || []).filter((flow) => flow.record_state !== 'deleted'),
    });
    const dispatchAssigneeNpub = resolveFlowDispatchAssignee({
      flowId: flowLinkage.flow_id,
      flowRunId: flowLinkage.flow_run_id,
      defaultAgentNpub: this.defaultAgentNpub,
      botNpub: this.botNpub,
    });

    const localRow = {
      record_id: recordId,
      owner_npub: ownerNpub,
      title,
      description: '',
      state: 'new',
      priority: 'sand',
      parent_task_id: null,
      ...assignment,
      assigned_to_npub: dispatchAssigneeNpub,
      scheduled_for: null,
      tags: '',
      predecessor_task_ids: null,
      flow_id: flowLinkage.flow_id,
      flow_run_id: flowLinkage.flow_run_id,
      flow_step: flowLinkage.flow_step,
      source_links: this.editingOpportunity?.record_id
        ? [{ type: 'opportunity', id: this.editingOpportunity.record_id }]
        : [],
      references: flowLinkage.references,
      deliverable_links: [],
      sync_status: 'pending',
      record_state: 'active',
      version: 1,
      created_at: now,
      updated_at: now,
    };

    await upsertTask(localRow);
    this.tasks = this.hydrateTasksWithOpportunityLinks([
      ...this.tasks.filter((task) => task.record_id !== recordId),
      localRow,
    ]);
    this.linkTaskToEditingOpportunity(recordId);
    await this.queueTaskBacklinkWrite(localRow, null);
    await this.flushAndBackgroundSync();
    return localRow;
  },

  forkOpportunity(opportunityId = null) {
    const targetId = String(opportunityId || this.editingOpportunity?.record_id || '').trim();
    if (!targetId) return;
    const current = this.opportunities.find((item) => item.record_id === targetId)
      || (this.editingOpportunity?.record_id === targetId ? this.editingOpportunity : null);
    if (!current) return;
    this.openNewOpportunity({
      title: current.title,
      description: current.description,
      stage: 'qualified',
      opportunity_type: current.opportunity_type,
      responsible_npub: current.responsible_npub,
      person_links: current.person_links,
      organisation_links: current.organisation_links,
      task_links: [],
      expected_value: current.expected_value,
      currency: current.currency,
      expected_close_at: current.expected_close_at,
      source: current.source,
      origin_opportunity_id: current.record_id,
      scope_id: current.scope_id,
      scope_l1_id: current.scope_l1_id,
      scope_l2_id: current.scope_l2_id,
      scope_l3_id: current.scope_l3_id,
      scope_l4_id: current.scope_l4_id,
      scope_l5_id: current.scope_l5_id,
      shares: current.shares,
      group_ids: current.group_ids,
    });
  },

  forkOpportunityFromCurrent() {
    this.forkOpportunity(this.editingOpportunity?.record_id);
  },

  async queueOpportunityWrite(updatedOpportunity, previousOpportunity = null, options = {}) {
    const familyHash = opportunityFamilyHash('opportunity');
    const fallbackWriteGroupRef = getPreferredRecordWriteGroupForStore(this, updatedOpportunity)
      || this.getWorkspaceSettingsGroupRef?.()
      || null;
    const writeFields = await getRecordWriteFieldsForStore(this, updatedOpportunity, {
      label: 'Opportunity write',
      writeGroupRef: fallbackWriteGroupRef,
    });
    const envelope = await outboundOpportunity({
      ...updatedOpportunity,
      group_ids: writeFields.group_ids,
      previous_version: previousOpportunity?.version ?? 0,
      signature_npub: this.signingNpub,
      write_group_ref: writeFields.write_group_ref,
    });
    const checkoutPolicyConfig = options.checkoutPolicyConfig || null;
    const managedEnvelope = checkoutPolicyConfig && previousOpportunity?.record_id && typeof this.attachCheckoutRequiredCheckoutToEnvelope === 'function'
      ? await this.attachCheckoutRequiredCheckoutToEnvelope(updatedOpportunity, envelope, {
        intent: options.intent || 'edit',
        checkoutPolicyConfig,
      })
      : envelope;
    const pendingWrite = {
      record_id: updatedOpportunity.record_id,
      record_family_hash: familyHash,
      envelope: managedEnvelope,
    };
    if (checkoutPolicyConfig) pendingWrite.checkout_policy_config = checkoutPolicyConfig;
    await addPendingWrite(pendingWrite);
  },

  async hasPendingOpportunityCreate(recordId) {
    const familyHash = opportunityFamilyHash('opportunity');
    const pending = await getPendingWrites();
    return pending.some((row) =>
      String(row?.record_id || row?.envelope?.record_id || '') === recordId
      && String(row?.record_family_hash || row?.envelope?.record_family_hash || '') === familyHash
      && Number(row?.envelope?.previous_version ?? -1) === 0
    );
  },

  async replacePendingOpportunityWrites(recordId) {
    const familyHash = opportunityFamilyHash('opportunity');
    const pending = await getPendingWrites();
    await Promise.all(pending
      .filter((row) =>
        String(row?.record_id || row?.envelope?.record_id || '') === recordId
        && String(row?.record_family_hash || row?.envelope?.record_family_hash || '') === familyHash
      )
      .map((row) => removePendingWrite(row.row_id)));
  },

  async queueTaskBacklinkWrite(updatedTask, previousTask) {
    const writeFields = await getRecordWriteFieldsForStore(this, updatedTask, {
      label: 'Opportunity task backlink write',
    });
    const envelope = await outboundTask({
      ...updatedTask,
      group_ids: writeFields.group_ids,
      previous_version: previousTask?.version ?? 0,
      signature_npub: this.signingNpub,
      write_group_ref: writeFields.write_group_ref,
    });
    await addPendingWrite({
      record_id: updatedTask.record_id,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });
  },

  async syncOpportunityTaskBacklinks(nextOpportunity, previousOpportunity = null) {
    const previousTaskIds = new Set((previousOpportunity?.task_links || []).map((link) => link.task_id));
    const nextTaskIds = new Set((nextOpportunity?.task_links || []).map((link) => link.task_id));
    const touchedTaskIds = [...new Set([...previousTaskIds, ...nextTaskIds])];

    for (const taskId of touchedTaskIds) {
      const task = await getTaskById(taskId);
      if (!task || task.record_state === 'deleted') continue;

      const references = Array.isArray(task.references) ? [...task.references] : [];
      const filtered = references.filter((ref) => !(ref?.type === 'opportunity' && ref?.id === nextOpportunity.record_id));
      const shouldLink = nextTaskIds.has(taskId);
      if (shouldLink) filtered.push({ type: 'opportunity', id: nextOpportunity.record_id });

      const changed = JSON.stringify(filtered) !== JSON.stringify(references);
      if (!changed) continue;

      const updatedTask = {
        ...task,
        references: filtered,
        version: (task.version ?? 1) + 1,
        sync_status: 'pending',
        updated_at: new Date().toISOString(),
      };
      await upsertTask(updatedTask);
      this.tasks = this.hydrateTasksWithOpportunityLinks(
        this.tasks.map((entry) => entry.record_id === updatedTask.record_id ? updatedTask : entry),
      );
      if (this.editingTask?.record_id === updatedTask.record_id) {
        this.editingTask = { ...updatedTask };
      }
      await this.queueTaskBacklinkWrite(updatedTask, task);
    }
  },

  async saveEditingOpportunity() {
    if (!this.editingOpportunity || !this.session?.npub) return null;
    if (this.opportunitySaving) return null;
    this.opportunitySaving = true;
    try {
      const title = String(this.editingOpportunity.title || '').trim();
      if (!title) {
        this.error = 'Opportunity title is required.';
        return null;
      }

      const existing = this.editingOpportunity.record_id
        ? await getOpportunityById(this.editingOpportunity.record_id)
        : null;
      const pendingCreate = existing?.record_id
        ? await this.hasPendingOpportunityCreate(existing.record_id)
        : false;
      if (existing?.record_id && !pendingCreate && !this.isOpportunityDetailEditing()) {
        this.error = 'Click Edit before changing this opportunity.';
        return null;
      }
      const now = new Date().toISOString();
      const effectiveScopeId = this.editingOpportunity.scope_id ?? null;
      let groupIds = [];
      let shares = [];
      if (effectiveScopeId && typeof this.getScopeShareGroupIds === 'function') {
        const scope = this.scopesMap?.get(effectiveScopeId) || null;
        const scopeGroupIds = scope ? this.getScopeShareGroupIds(scope).filter(Boolean) : [];
        if (scopeGroupIds.length > 0) {
          groupIds = scopeGroupIds;
          shares = typeof this.buildScopeDefaultShares === 'function'
            ? this.buildScopeDefaultShares(scopeGroupIds)
            : [];
        }
      }
      if (groupIds.length === 0) {
        const writeGroupRef = this.getWorkspaceSettingsGroupRef?.()
          || (existing ? getPreferredRecordWriteGroupForStore(this, existing) : null)
          || null;
        groupIds = writeGroupRef ? [writeGroupRef] : (existing?.group_ids || []);
        shares = groupIds.length > 0 && typeof this.buildScopeDefaultShares === 'function'
          ? this.buildScopeDefaultShares(groupIds)
          : (existing?.shares || []);
      }
      const base = existing || {};

      const updated = {
        ...base,
        ...toRaw(this.editingOpportunity),
        record_id: this.editingOpportunity.record_id || crypto.randomUUID(),
        owner_npub: base.owner_npub || this.workspaceOwnerNpub,
        title,
        description: String(this.editingOpportunity.description || ''),
        stage: OPPORTUNITY_STAGE_OPTIONS.includes(this.editingOpportunity.stage) ? this.editingOpportunity.stage : 'speculation',
        opportunity_type: String(this.editingOpportunity.opportunity_type || '').trim(),
        responsible_npub: this.editingOpportunity.responsible_npub || null,
        person_links: sortLinksPrimaryFirst(normalizeLinkedRows(this.editingOpportunity.person_links, 'person_id'), 'person_id'),
        organisation_links: sortLinksPrimaryFirst(normalizeLinkedRows(this.editingOpportunity.organisation_links, 'organisation_id'), 'organisation_id'),
        task_links: sortLinksPrimaryFirst(normalizeLinkedRows(this.editingOpportunity.task_links, 'task_id'), 'task_id'),
        expected_value: Number.isFinite(Number(this.editingOpportunity.expected_value)) ? Number(this.editingOpportunity.expected_value) : null,
        currency: String(this.editingOpportunity.currency || '').trim(),
        expected_close_at: this.editingOpportunity.expected_close_at || null,
        source: String(this.editingOpportunity.source || '').trim(),
        origin_opportunity_id: this.editingOpportunity.origin_opportunity_id || null,
        scope_id: this.editingOpportunity.scope_id ?? null,
        scope_l1_id: this.editingOpportunity.scope_l1_id ?? null,
        scope_l2_id: this.editingOpportunity.scope_l2_id ?? null,
        scope_l3_id: this.editingOpportunity.scope_l3_id ?? null,
        scope_l4_id: this.editingOpportunity.scope_l4_id ?? null,
        scope_l5_id: this.editingOpportunity.scope_l5_id ?? null,
        shares,
        group_ids: groupIds,
        sync_status: 'pending',
        record_state: this.editingOpportunity.record_state || 'active',
        version: pendingCreate || !existing ? 1 : (existing.version ?? 1) + 1,
        created_at: existing?.created_at || now,
        updated_at: now,
      };

      if (pendingCreate) {
        await this.replacePendingOpportunityWrites(existing.record_id);
      }
      await upsertOpportunity(updated);
      const checkoutPolicyConfig = existing && !pendingCreate
        ? this.getOpportunityCheckoutPolicyConfig()
        : null;
      await this.queueOpportunityWrite(updated, pendingCreate ? null : existing, {
        checkoutPolicyConfig,
        intent: 'edit',
      });
      await this.syncOpportunityTaskBacklinks(updated, pendingCreate ? null : existing);
      this.applyOpportunities([
        ...this.opportunities.filter((row) => row.record_id !== updated.record_id),
        updated,
      ]);
      this.activeOpportunityId = updated.record_id;
      this.editingOpportunity = this.createOpportunityDraft(updated);
      this.showOpportunityEditor = true;
      const flushResult = await this.flushAndBackgroundSync();
      if (!existing || pendingCreate) {
        this.opportunityDetailMode = 'view';
        this.opportunityEditOriginal = null;
      } else if ((flushResult?.pushed ?? 0) > 0) {
        this.clearLockManagedCheckoutSession?.(updated.record_id, opportunityFamilyHash('opportunity'));
        this.opportunityDetailMode = 'view';
        this.opportunityEditOriginal = null;
      }
      return updated;
    } finally {
      this.opportunitySaving = false;
    }
  },

  async saveEditingOpportunityAndClose() {
    const saved = await this.saveEditingOpportunity();
    if (saved && !this.isOpportunityDetailEditing()) this.closeOpportunityDetail({ syncRoute: true });
    return saved;
  },

  async deleteOpportunity(opportunityId) {
    const existing = await getOpportunityById(opportunityId);
    if (!existing || !this.session?.npub) return;
    const updated = {
      ...existing,
      record_state: 'deleted',
      sync_status: 'pending',
      version: (existing.version ?? 1) + 1,
      updated_at: new Date().toISOString(),
    };
    await upsertOpportunity(updated);
    await this.queueOpportunityWrite(updated, existing);
    await this.syncOpportunityTaskBacklinks({ ...updated, task_links: [] }, existing);
    this.applyOpportunities(this.opportunities.filter((row) => row.record_id !== opportunityId));
    if (this.activeOpportunityId === opportunityId) this.closeOpportunityDetail({ syncRoute: true });
    await this.flushAndBackgroundSync();
  },

  async addOpportunityComment(opportunityId) {
    const body = String(this.newOpportunityCommentBody || '').trim();
    if (!body || !opportunityId || !this.session?.npub) return;
    const opportunity = this.opportunities.find((item) => item.record_id === opportunityId) || await getOpportunityById(opportunityId);
    const now = new Date().toISOString();
    const comment = {
      record_id: crypto.randomUUID(),
      owner_npub: this.workspaceOwnerNpub,
      target_record_id: opportunityId,
      target_record_family_hash: opportunityFamilyHash('opportunity'),
      parent_comment_id: null,
      anchor_line_number: null,
      comment_status: 'open',
      body,
      attachments: [],
      sender_npub: this.signingNpub || this.session?.npub || this.workspaceOwnerNpub,
      sync_status: 'pending',
      record_state: 'active',
      version: 1,
      created_at: now,
      updated_at: now,
    };
    await upsertComment(comment);
    const writeFields = await getRecordWriteFieldsForStore(this, opportunity, {
      label: 'Opportunity comment write',
    });
    const envelope = await outboundComment({
      ...comment,
      target_group_ids: writeFields.group_ids,
      signature_npub: this.signingNpub,
      write_group_ref: writeFields.write_group_ref,
    });
    await addPendingWrite({
      record_id: comment.record_id,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });
    this.newOpportunityCommentBody = '';
    await this.loadOpportunityComments(opportunityId);
    await this.flushAndBackgroundSync();
  },
};
