import { describe, expect, it } from 'vitest';
import { escapeHtml, renderBriefHtml, resolveArtifactRef } from '../src/approval-helpers.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TASK_UUID_1 = 'aaaaaaaa-1111-2222-3333-444444444444';
const TASK_UUID_2 = 'bbbbbbbb-1111-2222-3333-444444444444';
const DOC_UUID = 'cccccccc-1111-2222-3333-444444444444';
const UNKNOWN_UUID = 'dddddddd-1111-2222-3333-444444444444';

const tasks = [
  { record_id: TASK_UUID_1, title: 'Implement login' },
  { record_id: TASK_UUID_2, title: 'Write tests' },
];

const documents = [
  { record_id: DOC_UUID, title: 'API spec' },
];

// ---------------------------------------------------------------------------
// escapeHtml
// ---------------------------------------------------------------------------

describe('escapeHtml', () => {
  it('escapes angle brackets, ampersands, and quotes', () => {
    expect(escapeHtml('<script>"xss"&</script>')).toBe(
      '&lt;script&gt;&quot;xss&quot;&amp;&lt;/script&gt;',
    );
  });

  it('passes through safe strings unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });
});

// ---------------------------------------------------------------------------
// renderBriefHtml
// ---------------------------------------------------------------------------

describe('renderBriefHtml', () => {
  it('returns fallback for empty/null brief', () => {
    expect(renderBriefHtml('', [], [])).toBe('No brief provided.');
    expect(renderBriefHtml(null, [], [])).toBe('No brief provided.');
    expect(renderBriefHtml(undefined, [], [])).toBe('No brief provided.');
  });

  it('returns escaped plain text when no UUIDs present', () => {
    expect(renderBriefHtml('All good.', tasks, documents)).toBe('All good.');
  });

  it('replaces a known task UUID with a clickable link', () => {
    const brief = `Please review task ${TASK_UUID_1} before merging.`;
    const html = renderBriefHtml(brief, tasks, documents);
    expect(html).toContain('approval-ref-link');
    expect(html).toContain('approval-ref-task');
    expect(html).toContain(`data-ref-type="task"`);
    expect(html).toContain(`data-ref-id="${TASK_UUID_1}"`);
    expect(html).toContain('Implement login');
    // UUID should only appear inside data-ref-id attribute, not as visible text
    const withoutAttrs = html.replace(/data-ref-id="[^"]*"/g, '');
    expect(withoutAttrs).not.toContain(TASK_UUID_1);
  });

  it('replaces a known document UUID with a clickable link', () => {
    const brief = `See document ${DOC_UUID} for details.`;
    const html = renderBriefHtml(brief, tasks, documents);
    expect(html).toContain('approval-ref-doc');
    expect(html).toContain(`data-ref-type="doc"`);
    expect(html).toContain(`data-ref-id="${DOC_UUID}"`);
    expect(html).toContain('API spec');
  });

  it('leaves unknown UUIDs as plain text', () => {
    const brief = `Reference ${UNKNOWN_UUID} not in store.`;
    const html = renderBriefHtml(brief, tasks, documents);
    expect(html).toContain(UNKNOWN_UUID);
    expect(html).not.toContain('approval-ref-link');
  });

  it('handles multiple UUIDs in one brief', () => {
    const brief = `Tasks ${TASK_UUID_1} and ${TASK_UUID_2}, plus doc ${DOC_UUID}.`;
    const html = renderBriefHtml(brief, tasks, documents);
    expect(html).toContain('Implement login');
    expect(html).toContain('Write tests');
    expect(html).toContain('API spec');
    // Should have three links
    const linkCount = (html.match(/approval-ref-link/g) || []).length;
    expect(linkCount).toBe(3);
  });

  it('escapes HTML in brief text around UUIDs', () => {
    const brief = `<b>Bold</b> task ${TASK_UUID_1}`;
    const html = renderBriefHtml(brief, tasks, documents);
    expect(html).toContain('&lt;b&gt;');
    expect(html).not.toContain('<b>');
    // Link should still be present
    expect(html).toContain('Implement login');
  });

  it('escapes HTML in resolved titles', () => {
    const xssTasks = [{ record_id: TASK_UUID_1, title: '<img onerror=alert(1)>' }];
    const html = renderBriefHtml(`Task ${TASK_UUID_1}`, xssTasks, []);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});

// ---------------------------------------------------------------------------
// resolveArtifactRef
// ---------------------------------------------------------------------------

describe('resolveArtifactRef', () => {
  it('resolves a task artifact ref with title', () => {
    const ref = { record_id: TASK_UUID_1, record_family_hash: 'npub1abc:task' };
    const result = resolveArtifactRef(ref, tasks, documents);
    expect(result.type).toBe('task');
    expect(result.title).toBe('Implement login');
    expect(result.resolved).toBe(true);
  });

  it('resolves a document artifact ref with title', () => {
    const ref = { record_id: DOC_UUID, record_family_hash: 'npub1abc:document' };
    const result = resolveArtifactRef(ref, tasks, documents);
    expect(result.type).toBe('document');
    expect(result.title).toBe('API spec');
    expect(result.resolved).toBe(true);
  });

  it('returns resolved=false for unknown task ref', () => {
    const ref = { record_id: UNKNOWN_UUID, record_family_hash: 'npub1abc:task' };
    const result = resolveArtifactRef(ref, tasks, documents);
    expect(result.type).toBe('task');
    expect(result.title).toBeNull();
    expect(result.resolved).toBe(false);
  });

  it('returns type from family hash for unrecognized families', () => {
    const ref = { record_id: UNKNOWN_UUID, record_family_hash: 'npub1abc:report' };
    const result = resolveArtifactRef(ref, tasks, documents);
    expect(result.type).toBe('report');
    expect(result.resolved).toBe(false);
  });

  it('handles missing record_family_hash gracefully', () => {
    const ref = { record_id: UNKNOWN_UUID, record_family_hash: '' };
    const result = resolveArtifactRef(ref, tasks, documents);
    expect(result.type).toBe('unknown');
    expect(result.resolved).toBe(false);
  });

  it('preserves original ref fields', () => {
    const ref = { record_id: TASK_UUID_1, record_family_hash: 'npub1abc:task' };
    const result = resolveArtifactRef(ref, tasks, documents);
    expect(result.record_id).toBe(TASK_UUID_1);
    expect(result.record_family_hash).toBe('npub1abc:task');
  });
});
