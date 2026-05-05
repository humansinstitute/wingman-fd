import { describe, expect, it } from 'vitest';
import {
  buildRecordLinkPayload,
  buildVisibleRecordLinkSections,
  normalizeRecordLinkFields,
  parseRecordReferencesFromText,
} from '../src/record-links.js';

describe('record link helpers', () => {
  it('classifies source, reference, and deliverable links with normalized ids', () => {
    const links = normalizeRecordLinkFields({
      source: { type: 'document', id: 'doc-1' },
      references: [{ type: 'task', id: 'task-1' }, { type: 'person', id: 'npub1person' }],
      deliverables: [{ type: 'doc', id: 'doc-2', order: 2 }, { type: 'task', id: 'task-2', order: 1 }],
    });

    expect(links.source_links).toEqual([{ type: 'doc', id: 'doc-1' }]);
    expect(links.references).toEqual([{ type: 'task', id: 'task-1' }]);
    expect(links.deliverable_links).toEqual([
      { type: 'task', id: 'task-2', order: 1 },
      { type: 'doc', id: 'doc-2', order: 2 },
    ]);
  });

  it('extracts generic references from mention tokens', () => {
    expect(parseRecordReferencesFromText(
      '@[Task](mention:task:t-1) @[Doc](mention:doc:d-1) @[Alice](mention:person:npub1alice) @[Task](mention:task:t-1)',
    )).toEqual([
      { type: 'task', id: 't-1' },
      { type: 'doc', id: 'd-1' },
    ]);
  });

  it('builds UI sections with source and deliverables before references', () => {
    const sections = buildVisibleRecordLinkSections(buildRecordLinkPayload({
      source_links: [{ type: 'task', id: 'source-1' }, { type: 'doc', id: 'secondary-source' }],
      references: [{ type: 'task', id: 'source-1' }, { type: 'scope', id: 'scope-1' }],
      deliverable_links: [{ type: 'doc', id: 'deliverable-1' }],
    }));

    expect(sections.map((section) => section.kind)).toEqual(['source', 'deliverable', 'reference']);
    expect(sections[0].links).toEqual([{ type: 'task', id: 'source-1' }]);
    expect(sections[2].links).toEqual([
      { type: 'scope', id: 'scope-1' },
      { type: 'doc', id: 'secondary-source' },
    ]);
  });
});
