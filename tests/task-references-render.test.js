import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/translators/record-crypto.js', () => ({
  decryptRecordPayload: vi.fn(async (record) => JSON.parse(record.owner_payload.ciphertext)),
  encryptOwnerPayload: vi.fn(async (_ownerNpub, payload) => ({ ciphertext: JSON.stringify(payload) })),
  buildGroupPayloads: vi.fn(async (groupNpubs, payload) =>
    groupNpubs.map((group_npub) => ({ group_npub, ciphertext: JSON.stringify(payload), write: true }))),
}));

import {
  inboundTask,
  parseReferencesFromDescription,
} from '../src/translators/tasks.js';

/**
 * These tests validate the rendering path for task references:
 *
 * 1. References derived from description mentions must be available
 *    when a task is opened for viewing, even if the stored `references`
 *    array is empty (legacy tasks pre-dating the feature).
 *
 * 2. The `hydrateTaskReferences` helper should fill in missing references
 *    from the description so the UI template can render them.
 *
 * 3. New tasks must include `references: []` so the field exists in Dexie.
 */

// Simulate openTaskDetail hydration logic
// This is the function we'll add to the rendering path
function hydrateTaskReferences(task) {
  if (!task) return task;
  const hasStoredRefs = Array.isArray(task.references) && task.references.length > 0;
  if (!hasStoredRefs && task.description) {
    task.references = parseReferencesFromDescription(task.description);
  }
  return task;
}

describe('task references rendering path', () => {
  describe('hydrateTaskReferences', () => {
    it('populates references from description when references array is missing', () => {
      const task = {
        record_id: 'task-1',
        description: 'See @[Build board](mention:task:task-99) for context',
      };
      const hydrated = hydrateTaskReferences(task);
      expect(hydrated.references).toEqual([
        { type: 'task', id: 'task-99' },
      ]);
    });

    it('populates references from description when references array is empty', () => {
      const task = {
        record_id: 'task-2',
        description: 'Refer to @[Spec doc](mention:doc:doc-42)',
        references: [],
      };
      const hydrated = hydrateTaskReferences(task);
      expect(hydrated.references).toEqual([
        { type: 'doc', id: 'doc-42' },
      ]);
    });

    it('preserves existing references when already populated', () => {
      const existingRefs = [{ type: 'task', id: 'task-99' }];
      const task = {
        record_id: 'task-3',
        description: 'See @[Build board](mention:task:task-99)',
        references: existingRefs,
      };
      const hydrated = hydrateTaskReferences(task);
      expect(hydrated.references).toBe(existingRefs);
    });

    it('returns null for null task', () => {
      expect(hydrateTaskReferences(null)).toBeNull();
    });

    it('handles task with no description and no references', () => {
      const task = {
        record_id: 'task-4',
        description: '',
        references: [],
      };
      const hydrated = hydrateTaskReferences(task);
      expect(hydrated.references).toEqual([]);
    });

    it('handles task with undefined description', () => {
      const task = {
        record_id: 'task-5',
      };
      const hydrated = hydrateTaskReferences(task);
      expect(hydrated.references).toBeUndefined();
    });

    it('extracts multiple reference types from description', () => {
      const desc = '@[Task A](mention:task:t1) and @[Doc B](mention:doc:d1) and @[Scope C](mention:scope:s1)';
      const task = {
        record_id: 'task-6',
        description: desc,
      };
      const hydrated = hydrateTaskReferences(task);
      expect(hydrated.references).toEqual([
        { type: 'task', id: 't1' },
        { type: 'doc', id: 'd1' },
        { type: 'scope', id: 's1' },
      ]);
    });

    it('skips person mentions when hydrating', () => {
      const task = {
        record_id: 'task-7',
        description: '@[Alice](mention:person:npub1abc) assigned @[Fix it](mention:task:t2)',
      };
      const hydrated = hydrateTaskReferences(task);
      expect(hydrated.references).toEqual([
        { type: 'task', id: 't2' },
      ]);
    });
  });

  describe('inbound task references', () => {
    it('inbound task with description mentions but no references field gets empty array', async () => {
      const record = {
        record_id: 'task-legacy',
        owner_npub: 'npub_owner',
        version: 1,
        updated_at: '2026-03-28T00:00:00Z',
        owner_payload: {
          ciphertext: JSON.stringify({
            data: {
              title: 'Legacy task',
              description: 'See @[Fix it](mention:task:t-old)',
              // no references field — legacy payload
            },
          }),
        },
        group_payloads: [],
      };
      const row = await inboundTask(record);
      // inbound defaults references to [] — the rendering path must hydrate from description
      expect(row.references).toEqual([]);
      // After hydration, references should be derived
      const hydrated = hydrateTaskReferences(row);
      expect(hydrated.references).toEqual([
        { type: 'task', id: 't-old' },
      ]);
    });
  });
});
