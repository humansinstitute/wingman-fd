/**
 * Person and Organisation management methods for the Alpine store.
 */

import {
  upsertPerson,
  getPersonById,
  upsertOrganisation,
  getOrganisationById,
  addPendingWrite,
} from './db.js';
import { outboundPerson } from './translators/persons.js';
import { outboundOrganisation } from './translators/organisations.js';
import { toRaw } from './utils/state-helpers.js';
import {
  getPreferredRecordWriteGroupForStore,
  getRecordWriteFieldsForStore,
} from './preferred-write-group.js';

function hasScopePatch(patch = {}) {
  return Object.prototype.hasOwnProperty.call(patch, 'scope_id')
    || Object.prototype.hasOwnProperty.call(patch, 'scope_l1_id')
    || Object.prototype.hasOwnProperty.call(patch, 'scope_l2_id')
    || Object.prototype.hasOwnProperty.call(patch, 'scope_l3_id')
    || Object.prototype.hasOwnProperty.call(patch, 'scope_l4_id')
    || Object.prototype.hasOwnProperty.call(patch, 'scope_l5_id');
}

export const personsManagerMixin = {
  applyPersons(persons) {
    const rows = (Array.isArray(persons) ? persons : []).filter(
      (p) => p.record_state !== 'deleted',
    );
    const next = typeof this.hydratePersonsWithOpportunityLinks === 'function'
      ? this.hydratePersonsWithOpportunityLinks(rows)
      : rows;
    this.persons = next;
  },

  applyOrganisations(orgs) {
    const rows = (Array.isArray(orgs) ? orgs : []).filter(
      (o) => o.record_state !== 'deleted',
    );
    const next = typeof this.hydrateOrganisationsWithOpportunityLinks === 'function'
      ? this.hydrateOrganisationsWithOpportunityLinks(rows)
      : rows;
    this.organisations = next;
  },

  buildCrmScopeAccessFields(scopeId = null, existing = null) {
    const cleanScopeId = String(scopeId || '').trim() || null;
    const assignment = typeof this.buildScopeAssignment === 'function'
      ? this.buildScopeAssignment(cleanScopeId)
      : {
        scope_id: cleanScopeId,
        scope_l1_id: null,
        scope_l2_id: null,
        scope_l3_id: null,
        scope_l4_id: null,
        scope_l5_id: null,
      };
    let groupIds = [];
    let shares = [];

    if (cleanScopeId && typeof this.getScopeShareGroupIds === 'function') {
      const scope = this.scopesMap?.get(cleanScopeId) || null;
      groupIds = scope ? this.getScopeShareGroupIds(scope).filter(Boolean) : [];
      shares = groupIds.length > 0 && typeof this.buildScopeDefaultShares === 'function'
        ? this.buildScopeDefaultShares(groupIds)
        : [];
    }

    if (groupIds.length === 0) {
      const fallbackWriteGroupRef = this.getWorkspaceSettingsGroupRef?.()
        || (existing ? getPreferredRecordWriteGroupForStore(this, existing) : null)
        || null;
      groupIds = fallbackWriteGroupRef ? [fallbackWriteGroupRef] : (existing?.group_ids || []);
      shares = groupIds.length > 0 && typeof this.buildScopeDefaultShares === 'function'
        ? this.buildScopeDefaultShares(groupIds)
        : (existing?.shares || []);
    }

    return {
      ...assignment,
      shares,
      group_ids: groupIds,
    };
  },

  get personFormScopeLabel() {
    return this.personFormScopeId ? (this.getScopeBreadcrumb?.(this.personFormScopeId) || '') : '';
  },

  get personFormScopeLevel() {
    return this.personFormScopeId ? (this.scopesMap?.get(this.personFormScopeId)?.level || '') : '';
  },

  get orgFormScopeLabel() {
    return this.orgFormScopeId ? (this.getScopeBreadcrumb?.(this.orgFormScopeId) || '') : '';
  },

  get orgFormScopeLevel() {
    return this.orgFormScopeId ? (this.scopesMap?.get(this.orgFormScopeId)?.level || '') : '';
  },

  assignScopeToPersonForm(scopeId) {
    this.personFormScopeId = String(scopeId || '').trim() || null;
  },

  clearPersonFormScope() {
    this.personFormScopeId = null;
  },

  assignScopeToOrgForm(scopeId) {
    this.orgFormScopeId = String(scopeId || '').trim() || null;
  },

  clearOrgFormScope() {
    this.orgFormScopeId = null;
  },

  // --- Person CRUD ---

  async createPerson({ title, description = '', contacts = [], tags = '', organisation_links = [], scope_id = null }) {
    if (!title || !this.session?.npub) return null;

    const now = new Date().toISOString();
    const recordId = crypto.randomUUID();
    const ownerNpub = this.workspaceOwnerNpub;
    const accessFields = this.buildCrmScopeAccessFields(scope_id, null);

    const localRow = {
      record_id: recordId,
      owner_npub: ownerNpub,
      title,
      description,
      contacts,
      organisation_links,
      tags,
      ...accessFields,
      sync_status: 'pending',
      record_state: 'active',
      version: 1,
      created_at: now,
      updated_at: now,
    };

    await upsertPerson(localRow);
    this.persons = [...this.persons, localRow];

    const writeFields = await getRecordWriteFieldsForStore(this, localRow, {
      label: 'Person write',
    });
    const envelope = await outboundPerson({
      ...localRow,
      group_ids: writeFields.group_ids,
      signature_npub: this.signingNpub,
      write_group_ref: writeFields.write_group_ref,
    });

    await addPendingWrite({
      record_id: recordId,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });

    await this.flushAndBackgroundSync();
    return recordId;
  },

  async updatePerson(personId, patch = {}) {
    const person = this.persons.find((p) => p.record_id === personId);
    if (!person || !this.session?.npub) return null;

    const nextVersion = (person.version ?? 1) + 1;
    const scopePatch = hasScopePatch(patch)
      ? this.buildCrmScopeAccessFields(patch.scope_id ?? null, person)
      : {};
    const updated = toRaw({
      ...person,
      ...patch,
      ...scopePatch,
      version: nextVersion,
      sync_status: 'pending',
      updated_at: new Date().toISOString(),
    });

    await upsertPerson(updated);
    this.persons = this.persons.map((p) => p.record_id === personId ? updated : p);

    const writeFields = await getRecordWriteFieldsForStore(this, updated, {
      label: 'Person write',
    });
    const envelope = await outboundPerson({
      ...updated,
      group_ids: writeFields.group_ids,
      previous_version: person.version ?? 1,
      signature_npub: this.signingNpub,
      write_group_ref: writeFields.write_group_ref,
    });

    await addPendingWrite({
      record_id: personId,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });

    await this.flushAndBackgroundSync();
    return updated;
  },

  async deletePerson(personId) {
    const person = this.persons.find((p) => p.record_id === personId);
    if (!person || !this.session?.npub) return;

    const nextVersion = (person.version ?? 1) + 1;
    const updated = toRaw({
      ...person,
      record_state: 'deleted',
      version: nextVersion,
      sync_status: 'pending',
      updated_at: new Date().toISOString(),
    });

    await upsertPerson(updated);
    this.persons = this.persons.filter((p) => p.record_id !== personId);

    const writeFields = await getRecordWriteFieldsForStore(this, updated, {
      label: 'Person delete',
    });
    const envelope = await outboundPerson({
      ...updated,
      group_ids: writeFields.group_ids,
      previous_version: person.version ?? 1,
      signature_npub: this.signingNpub,
      write_group_ref: writeFields.write_group_ref,
    });

    await addPendingWrite({
      record_id: personId,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });

    await this.flushAndBackgroundSync();
  },

  // --- Organisation CRUD ---

  async createOrganisation({ title, description = '', positioning = '', contacts = [], tags = '', person_links = [], scope_id = null }) {
    if (!title || !this.session?.npub) return null;

    const now = new Date().toISOString();
    const recordId = crypto.randomUUID();
    const ownerNpub = this.workspaceOwnerNpub;
    const accessFields = this.buildCrmScopeAccessFields(scope_id, null);

    const localRow = {
      record_id: recordId,
      owner_npub: ownerNpub,
      title,
      description,
      positioning,
      contacts,
      person_links,
      tags,
      ...accessFields,
      sync_status: 'pending',
      record_state: 'active',
      version: 1,
      created_at: now,
      updated_at: now,
    };

    await upsertOrganisation(localRow);
    this.organisations = [...this.organisations, localRow];

    const writeFields = await getRecordWriteFieldsForStore(this, localRow, {
      label: 'Organisation write',
    });
    const envelope = await outboundOrganisation({
      ...localRow,
      group_ids: writeFields.group_ids,
      signature_npub: this.signingNpub,
      write_group_ref: writeFields.write_group_ref,
    });

    await addPendingWrite({
      record_id: recordId,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });

    await this.flushAndBackgroundSync();
    return recordId;
  },

  async updateOrganisation(orgId, patch = {}) {
    const org = this.organisations.find((o) => o.record_id === orgId);
    if (!org || !this.session?.npub) return null;

    const nextVersion = (org.version ?? 1) + 1;
    const scopePatch = hasScopePatch(patch)
      ? this.buildCrmScopeAccessFields(patch.scope_id ?? null, org)
      : {};
    const updated = toRaw({
      ...org,
      ...patch,
      ...scopePatch,
      version: nextVersion,
      sync_status: 'pending',
      updated_at: new Date().toISOString(),
    });

    await upsertOrganisation(updated);
    this.organisations = this.organisations.map((o) => o.record_id === orgId ? updated : o);

    const writeFields = await getRecordWriteFieldsForStore(this, updated, {
      label: 'Organisation write',
    });
    const envelope = await outboundOrganisation({
      ...updated,
      group_ids: writeFields.group_ids,
      previous_version: org.version ?? 1,
      signature_npub: this.signingNpub,
      write_group_ref: writeFields.write_group_ref,
    });

    await addPendingWrite({
      record_id: orgId,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });

    await this.flushAndBackgroundSync();
    return updated;
  },

  async deleteOrganisation(orgId) {
    const org = this.organisations.find((o) => o.record_id === orgId);
    if (!org || !this.session?.npub) return;

    const nextVersion = (org.version ?? 1) + 1;
    const updated = toRaw({
      ...org,
      record_state: 'deleted',
      version: nextVersion,
      sync_status: 'pending',
      updated_at: new Date().toISOString(),
    });

    await upsertOrganisation(updated);
    this.organisations = this.organisations.filter((o) => o.record_id !== orgId);

    const writeFields = await getRecordWriteFieldsForStore(this, updated, {
      label: 'Organisation delete',
    });
    const envelope = await outboundOrganisation({
      ...updated,
      group_ids: writeFields.group_ids,
      previous_version: org.version ?? 1,
      signature_npub: this.signingNpub,
      write_group_ref: writeFields.write_group_ref,
    });

    await addPendingWrite({
      record_id: orgId,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });

    await this.flushAndBackgroundSync();
  },

  // --- Bi-directional linking ---

  async linkPersonToOrg(personId, orgId, role = '') {
    const person = this.persons.find((p) => p.record_id === personId);
    const org = this.organisations.find((o) => o.record_id === orgId);
    if (!person || !org || !this.session?.npub) return;

    const orgLinks = [...(person.organisation_links || [])];
    if (!orgLinks.some((l) => l.organisation_id === orgId)) {
      orgLinks.push({ organisation_id: orgId, role });
    }

    const personLinks = [...(org.person_links || [])];
    if (!personLinks.some((l) => l.person_id === personId)) {
      personLinks.push({ person_id: personId, role });
    }

    await this.updatePerson(personId, { organisation_links: orgLinks });
    await this.updateOrganisation(orgId, { person_links: personLinks });
  },

  async unlinkPersonFromOrg(personId, orgId) {
    const person = this.persons.find((p) => p.record_id === personId);
    const org = this.organisations.find((o) => o.record_id === orgId);
    if (!person || !org || !this.session?.npub) return;

    const orgLinks = (person.organisation_links || []).filter((l) => l.organisation_id !== orgId);
    const personLinks = (org.person_links || []).filter((l) => l.person_id !== personId);

    await this.updatePerson(personId, { organisation_links: orgLinks });
    await this.updateOrganisation(orgId, { person_links: personLinks });
  },

  // --- Augment toggle ---

  async toggleAugmentPerson(personId) {
    const person = this.persons.find((p) => p.record_id === personId);
    if (!person || !this.session?.npub) return;
    await this.updatePerson(personId, { augment_please: !person.augment_please });
  },

  async toggleAugmentOrganisation(orgId) {
    const org = this.organisations.find((o) => o.record_id === orgId);
    if (!org || !this.session?.npub) return;
    await this.updateOrganisation(orgId, { augment_please: !org.augment_please });
  },

  // --- UI helpers ---

  getPersonName(personId) {
    const p = this.persons.find((p) => p.record_id === personId);
    return p?.title || '';
  },

  getOrgName(orgId) {
    const o = this.organisations.find((o) => o.record_id === orgId);
    return o?.title || '';
  },
};
