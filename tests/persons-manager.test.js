import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/db.js', () => ({
  addPendingWrite: vi.fn(async () => {}),
  upsertPerson: vi.fn(async () => {}),
  getPersonById: vi.fn(async () => null),
  upsertOrganisation: vi.fn(async () => {}),
  getOrganisationById: vi.fn(async () => null),
}));

vi.mock('../src/preferred-write-group.js', () => ({
  getPreferredRecordWriteGroupForStore: vi.fn((_store, record) => record?.group_ids?.[0] || 'fallback-group'),
  getRecordWriteFieldsForStore: vi.fn(async (_store, record) => ({
    group_ids: record.group_ids || [],
    write_group_ref: record.group_ids?.[0] || null,
  })),
}));

vi.mock('../src/translators/persons.js', () => ({
  outboundPerson: vi.fn(async (person) => ({
    record_id: person.record_id,
    record_family_hash: 'family:person',
    previous_version: person.previous_version,
    group_payloads: (person.group_ids || []).map((group_id) => ({ group_id })),
  })),
}));

vi.mock('../src/translators/organisations.js', () => ({
  outboundOrganisation: vi.fn(async (organisation) => ({
    record_id: organisation.record_id,
    record_family_hash: 'family:organisation',
    previous_version: organisation.previous_version,
    group_payloads: (organisation.group_ids || []).map((group_id) => ({ group_id })),
  })),
}));

import {
  addPendingWrite,
  upsertOrganisation,
  upsertPerson,
} from '../src/db.js';
import { personsManagerMixin } from '../src/persons-manager.js';

function createStore(overrides = {}) {
  const store = {
    session: { npub: 'npub-user' },
    workspaceOwnerNpub: 'npub-owner',
    signingNpub: 'npub-signing',
    persons: [],
    organisations: [],
    scopesMap: new Map([
      ['scope-1', { record_id: 'scope-1', level: 'l2', group_ids: ['shared-group'] }],
      ['scope-2', { record_id: 'scope-2', level: 'l3', group_ids: ['external-group'] }],
    ]),
    groups: [],
    flushAndBackgroundSync: vi.fn(async () => {}),
    getWorkspaceSettingsGroupRef: vi.fn(() => 'private-group'),
    buildScopeAssignment: vi.fn((scopeId) => ({
      scope_id: scopeId ?? null,
      scope_l1_id: scopeId ?? null,
      scope_l2_id: null,
      scope_l3_id: null,
      scope_l4_id: null,
      scope_l5_id: null,
    })),
    getScopeShareGroupIds: vi.fn((scope) => scope?.group_ids || []),
    buildScopeDefaultShares: vi.fn((groupIds = []) => groupIds.map((groupId) => ({
      type: 'group',
      group_npub: groupId,
      access: 'write',
    }))),
    getScopeBreadcrumb: vi.fn((scopeId) => `Scope ${scopeId}`),
    ...overrides,
  };

  const descriptors = Object.getOwnPropertyDescriptors(personsManagerMixin);
  for (const [key, desc] of Object.entries(descriptors)) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) continue;
    Object.defineProperty(store, key, desc);
  }
  return store;
}

describe('personsManagerMixin scoped CRM access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates people with scope-derived delivery groups', async () => {
    const uuidSpy = vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('person-1');
    const store = createStore();

    const recordId = await store.createPerson({
      title: 'Alice',
      scope_id: 'scope-1',
    });

    expect(recordId).toBe('person-1');
    expect(upsertPerson).toHaveBeenCalledWith(expect.objectContaining({
      record_id: 'person-1',
      scope_id: 'scope-1',
      group_ids: ['shared-group'],
      shares: [expect.objectContaining({ group_npub: 'shared-group', access: 'write' })],
    }));
    expect(addPendingWrite).toHaveBeenCalledWith(expect.objectContaining({
      record_id: 'person-1',
      record_family_hash: 'family:person',
      envelope: expect.objectContaining({
        group_payloads: [{ group_id: 'shared-group' }],
      }),
    }));

    uuidSpy.mockRestore();
  });

  it('updates people to a new scope and rewrites access groups', async () => {
    const store = createStore({
      persons: [{
        record_id: 'person-1',
        owner_npub: 'npub-owner',
        title: 'Alice',
        version: 2,
        scope_id: 'scope-1',
        group_ids: ['shared-group'],
        shares: [{ group_npub: 'shared-group', access: 'write' }],
      }],
    });

    const updated = await store.updatePerson('person-1', { scope_id: 'scope-2' });

    expect(updated).toMatchObject({
      record_id: 'person-1',
      version: 3,
      scope_id: 'scope-2',
      group_ids: ['external-group'],
    });
    expect(addPendingWrite).toHaveBeenCalledWith(expect.objectContaining({
      record_id: 'person-1',
      envelope: expect.objectContaining({
        previous_version: 2,
        group_payloads: [{ group_id: 'external-group' }],
      }),
    }));
  });

  it('creates organisations with scope-derived delivery groups', async () => {
    const uuidSpy = vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('org-1');
    const store = createStore();

    const recordId = await store.createOrganisation({
      title: 'Acme',
      scope_id: 'scope-1',
    });

    expect(recordId).toBe('org-1');
    expect(upsertOrganisation).toHaveBeenCalledWith(expect.objectContaining({
      record_id: 'org-1',
      scope_id: 'scope-1',
      group_ids: ['shared-group'],
    }));
    expect(addPendingWrite).toHaveBeenCalledWith(expect.objectContaining({
      record_id: 'org-1',
      record_family_hash: 'family:organisation',
      envelope: expect.objectContaining({
        group_payloads: [{ group_id: 'shared-group' }],
      }),
    }));

    uuidSpy.mockRestore();
  });
});
