import { beforeEach, describe, expect, it } from 'vitest';
import db, {
  upsertDirectory,
  upsertDocument,
  getDirectoriesByOwner,
  getDocumentsByOwner,
  upsertAddressBookPerson,
  getAddressBookPeople,
} from '../src/db.js';

beforeEach(async () => {
  await db.open();
  await Promise.all(db.tables.map((table) => table.clear()));
});

describe('docs db operations', () => {
  it('stores directories and documents by owner', async () => {
    await upsertDirectory({
      record_id: 'dir-1',
      owner_npub: 'npub_owner',
      title: 'Projects',
      parent_directory_id: null,
      shares: [],
      group_ids: [],
      sync_status: 'synced',
      record_state: 'active',
      version: 1,
      updated_at: '2026-03-12T00:00:00.000Z',
    });

    await upsertDocument({
      record_id: 'doc-1',
      owner_npub: 'npub_owner',
      title: 'Spec',
      content: 'hello',
      parent_directory_id: 'dir-1',
      shares: [],
      group_ids: [],
      sync_status: 'synced',
      record_state: 'active',
      version: 1,
      updated_at: '2026-03-12T00:01:00.000Z',
    });

    const directories = await getDirectoriesByOwner('npub_owner');
    const documents = await getDocumentsByOwner('npub_owner');

    expect(directories).toHaveLength(1);
    expect(documents).toHaveLength(1);
    expect(documents[0].parent_directory_id).toBe('dir-1');
  });

  it('stores address book entries for share suggestions', async () => {
    await upsertAddressBookPerson({
      npub: 'npub_friend',
      label: 'Wingman 21',
      avatar_url: 'https://example.com/avatar.png',
      source: 'chat',
      last_used_at: '2026-03-12T00:00:00.000Z',
    });

    const people = await getAddressBookPeople('wing');
    expect(people).toHaveLength(1);
    expect(people[0].npub).toBe('npub_friend');
    expect(people[0].label).toBe('Wingman 21');
  });
});
