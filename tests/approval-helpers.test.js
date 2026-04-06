import { describe, expect, it } from 'vitest';
import { resolveArtifactRef } from '../src/approval-helpers.js';

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
