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

export const personsManagerMixin = {
  applyPersons(persons) {
    const next = (Array.isArray(persons) ? persons : []).filter(
      (p) => p.record_state !== 'deleted',
    );
    this.persons = next;
  },

  applyOrganisations(orgs) {
    const next = (Array.isArray(orgs) ? orgs : []).filter(
      (o) => o.record_state !== 'deleted',
    );
    this.organisations = next;
  },

  // --- Person CRUD ---

  async createPerson({ title, description = '', contacts = [], tags = '', organisation_links = [] }) {
    if (!title || !this.session?.npub) return null;

    const now = new Date().toISOString();
    const recordId = crypto.randomUUID();
    const ownerNpub = this.workspaceOwnerNpub;
    const writeGroupRef = typeof this.getWorkspaceSettingsGroupRef === 'function'
      ? this.getWorkspaceSettingsGroupRef() : null;
    const groupIds = writeGroupRef ? [writeGroupRef] : [];
    const shares = groupIds.length > 0 && typeof this.buildScopeDefaultShares === 'function'
      ? this.buildScopeDefaultShares(groupIds) : [];

    const localRow = {
      record_id: recordId,
      owner_npub: ownerNpub,
      title,
      description,
      contacts,
      organisation_links,
      tags,
      scope_id: null,
      scope_l1_id: null,
      scope_l2_id: null,
      scope_l3_id: null,
      scope_l4_id: null,
      scope_l5_id: null,
      shares,
      group_ids: groupIds,
      sync_status: 'pending',
      record_state: 'active',
      version: 1,
      created_at: now,
      updated_at: now,
    };

    await upsertPerson(localRow);
    this.persons = [...this.persons, localRow];

    const envelope = await outboundPerson({
      ...localRow,
      signature_npub: this.signingNpub,
      write_group_ref: writeGroupRef,
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
    const updated = toRaw({
      ...person,
      ...patch,
      version: nextVersion,
      sync_status: 'pending',
      updated_at: new Date().toISOString(),
    });

    await upsertPerson(updated);
    this.persons = this.persons.map((p) => p.record_id === personId ? updated : p);

    const envelope = await outboundPerson({
      ...updated,
      previous_version: person.version ?? 1,
      signature_npub: this.signingNpub,
      write_group_ref: updated.group_ids?.[0] || null,
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

    const envelope = await outboundPerson({
      ...updated,
      previous_version: person.version ?? 1,
      signature_npub: this.signingNpub,
      write_group_ref: person.group_ids?.[0] || null,
    });

    await addPendingWrite({
      record_id: personId,
      record_family_hash: envelope.record_family_hash,
      envelope,
    });

    await this.flushAndBackgroundSync();
  },

  // --- Organisation CRUD ---

  async createOrganisation({ title, description = '', positioning = '', contacts = [], tags = '', person_links = [] }) {
    if (!title || !this.session?.npub) return null;

    const now = new Date().toISOString();
    const recordId = crypto.randomUUID();
    const ownerNpub = this.workspaceOwnerNpub;
    const writeGroupRef = typeof this.getWorkspaceSettingsGroupRef === 'function'
      ? this.getWorkspaceSettingsGroupRef() : null;
    const groupIds = writeGroupRef ? [writeGroupRef] : [];
    const shares = groupIds.length > 0 && typeof this.buildScopeDefaultShares === 'function'
      ? this.buildScopeDefaultShares(groupIds) : [];

    const localRow = {
      record_id: recordId,
      owner_npub: ownerNpub,
      title,
      description,
      positioning,
      contacts,
      person_links,
      tags,
      scope_id: null,
      scope_l1_id: null,
      scope_l2_id: null,
      scope_l3_id: null,
      scope_l4_id: null,
      scope_l5_id: null,
      shares,
      group_ids: groupIds,
      sync_status: 'pending',
      record_state: 'active',
      version: 1,
      created_at: now,
      updated_at: now,
    };

    await upsertOrganisation(localRow);
    this.organisations = [...this.organisations, localRow];

    const envelope = await outboundOrganisation({
      ...localRow,
      signature_npub: this.signingNpub,
      write_group_ref: writeGroupRef,
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
    const updated = toRaw({
      ...org,
      ...patch,
      version: nextVersion,
      sync_status: 'pending',
      updated_at: new Date().toISOString(),
    });

    await upsertOrganisation(updated);
    this.organisations = this.organisations.map((o) => o.record_id === orgId ? updated : o);

    const envelope = await outboundOrganisation({
      ...updated,
      previous_version: org.version ?? 1,
      signature_npub: this.signingNpub,
      write_group_ref: updated.group_ids?.[0] || null,
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

    const envelope = await outboundOrganisation({
      ...updated,
      previous_version: org.version ?? 1,
      signature_npub: this.signingNpub,
      write_group_ref: org.group_ids?.[0] || null,
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
