import { describe, it, expect } from 'vitest';
import {
  toRaw,
  normalizeBackendUrl,
  workspaceSettingsRecordId,
  storageObjectIdFromRef,
  storageImageCacheKey,
  defaultRecordSignature,
  sameListBySignature,
  parseMarkdownBlocks,
  assembleMarkdownBlocks,
} from '../src/utils/state-helpers.js';

describe('toRaw', () => {
  it('returns null/undefined as-is', () => {
    expect(toRaw(null)).toBe(null);
    expect(toRaw(undefined)).toBe(undefined);
  });

  it('returns primitives as-is', () => {
    expect(toRaw(42)).toBe(42);
    expect(toRaw('hello')).toBe('hello');
    expect(toRaw(true)).toBe(true);
  });

  it('deep-clones objects via JSON round-trip', () => {
    const obj = { a: 1, b: { c: 2 } };
    const result = toRaw(obj);
    expect(result).toEqual(obj);
    expect(result).not.toBe(obj);
    expect(result.b).not.toBe(obj.b);
  });

  it('deep-clones arrays', () => {
    const arr = [1, [2, 3]];
    const result = toRaw(arr);
    expect(result).toEqual(arr);
    expect(result).not.toBe(arr);
  });
});

describe('normalizeBackendUrl', () => {
  it('returns empty string for falsy input', () => {
    expect(normalizeBackendUrl('')).toBe('');
    expect(normalizeBackendUrl(null)).toBe('');
    expect(normalizeBackendUrl(undefined)).toBe('');
  });

  it('strips trailing slashes', () => {
    expect(normalizeBackendUrl('https://example.com/')).toBe('https://example.com');
    expect(normalizeBackendUrl('https://example.com///')).toBe('https://example.com');
  });

  it('preserves valid URLs', () => {
    expect(normalizeBackendUrl('https://api.example.com')).toBe('https://api.example.com');
  });

  it('handles non-URL strings gracefully', () => {
    const result = normalizeBackendUrl('not-a-url');
    expect(typeof result).toBe('string');
    expect(result).toBe('not-a-url');
  });
});

describe('workspaceSettingsRecordId', () => {
  it('builds prefixed record id', () => {
    expect(workspaceSettingsRecordId('npub1abc')).toBe('workspace-settings:npub1abc');
  });
});

describe('storageObjectIdFromRef', () => {
  it('extracts object id from storage:// ref', () => {
    expect(storageObjectIdFromRef('storage://abc-123')).toBe('abc-123');
  });

  it('returns empty string for non-matching input', () => {
    expect(storageObjectIdFromRef('not-a-ref')).toBe('');
    expect(storageObjectIdFromRef(null)).toBe('');
    expect(storageObjectIdFromRef('')).toBe('');
  });

  it('rejects refs with invalid characters', () => {
    expect(storageObjectIdFromRef('storage://abc def')).toBe('');
    expect(storageObjectIdFromRef('storage://abc/def')).toBe('');
  });
});

describe('storageImageCacheKey', () => {
  it('returns objectId alone when no backendUrl', () => {
    expect(storageImageCacheKey('obj-1')).toBe('obj-1');
    expect(storageImageCacheKey('obj-1', '')).toBe('obj-1');
  });

  it('returns backendUrl::objectId when both provided', () => {
    expect(storageImageCacheKey('obj-1', 'https://api.example.com')).toBe(
      'https://api.example.com::obj-1',
    );
  });

  it('strips trailing slashes from backendUrl', () => {
    expect(storageImageCacheKey('obj-1', 'https://api.example.com/')).toBe(
      'https://api.example.com::obj-1',
    );
  });

  it('returns empty string for empty objectId', () => {
    expect(storageImageCacheKey('', 'https://api.example.com')).toBe('');
    expect(storageImageCacheKey(null)).toBe('');
  });
});

describe('defaultRecordSignature', () => {
  it('builds pipe-delimited signature from record fields', () => {
    const record = {
      record_id: 'r1',
      updated_at: '2024-01-01',
      version: 3,
      record_state: 'active',
      sync_status: 'synced',
    };
    expect(defaultRecordSignature(record)).toBe('r1|2024-01-01|3|active|synced');
  });

  it('handles missing fields gracefully', () => {
    expect(defaultRecordSignature({})).toBe('||||');
    expect(defaultRecordSignature(null)).toBe('||||');
  });
});

describe('sameListBySignature', () => {
  it('returns true for identical references', () => {
    const list = [{ record_id: '1', updated_at: 'a', version: 1, record_state: '', sync_status: '' }];
    expect(sameListBySignature(list, list)).toBe(true);
  });

  it('returns true for lists with same signatures', () => {
    const a = [{ record_id: '1', updated_at: 'a', version: 1, record_state: '', sync_status: '' }];
    const b = [{ record_id: '1', updated_at: 'a', version: 1, record_state: '', sync_status: '' }];
    expect(sameListBySignature(a, b)).toBe(true);
  });

  it('returns false for different lengths', () => {
    expect(sameListBySignature([{ record_id: '1' }], [])).toBe(false);
  });

  it('returns false for different signatures', () => {
    const a = [{ record_id: '1', updated_at: 'a', version: 1, record_state: '', sync_status: '' }];
    const b = [{ record_id: '2', updated_at: 'a', version: 1, record_state: '', sync_status: '' }];
    expect(sameListBySignature(a, b)).toBe(false);
  });

  it('supports custom signatureFor function', () => {
    const a = [{ id: 'x' }];
    const b = [{ id: 'x' }];
    expect(sameListBySignature(a, b, (r) => r.id)).toBe(true);
  });

  it('returns true for two empty arrays', () => {
    expect(sameListBySignature([], [])).toBe(true);
  });
});

describe('parseMarkdownBlocks', () => {
  it('returns empty array for empty content', () => {
    expect(parseMarkdownBlocks('')).toEqual([]);
    expect(parseMarkdownBlocks(null)).toEqual([]);
  });

  it('parses single block', () => {
    const blocks = parseMarkdownBlocks('Hello world');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].raw).toBe('Hello world');
    expect(blocks[0].start_line).toBe(1);
    expect(blocks[0].end_line).toBe(1);
  });

  it('splits on blank lines', () => {
    const blocks = parseMarkdownBlocks('Block one\n\nBlock two');
    expect(blocks).toHaveLength(2);
    expect(blocks[0].raw).toBe('Block one');
    expect(blocks[1].raw).toBe('Block two');
  });

  it('handles multi-line blocks', () => {
    const blocks = parseMarkdownBlocks('Line 1\nLine 2\n\nLine 3');
    expect(blocks).toHaveLength(2);
    expect(blocks[0].raw).toBe('Line 1\nLine 2');
    expect(blocks[1].raw).toBe('Line 3');
  });

  it('assigns sequential block ids', () => {
    const blocks = parseMarkdownBlocks('A\n\nB');
    expect(blocks[0].id).toMatch(/^block-0-/);
    expect(blocks[1].id).toMatch(/^block-1-/);
  });
});

describe('assembleMarkdownBlocks', () => {
  it('joins blocks with double newline', () => {
    const blocks = [{ raw: 'Block one' }, { raw: 'Block two' }];
    expect(assembleMarkdownBlocks(blocks)).toBe('Block one\n\nBlock two');
  });

  it('filters out empty blocks', () => {
    const blocks = [{ raw: 'A' }, { raw: '' }, { raw: 'B' }];
    expect(assembleMarkdownBlocks(blocks)).toBe('A\n\nB');
  });

  it('returns empty string for no blocks', () => {
    expect(assembleMarkdownBlocks([])).toBe('');
    expect(assembleMarkdownBlocks(null)).toBe('');
  });

  it('round-trips with parseMarkdownBlocks', () => {
    const original = 'First paragraph\n\nSecond paragraph\nwith two lines\n\nThird';
    const blocks = parseMarkdownBlocks(original);
    expect(assembleMarkdownBlocks(blocks)).toBe(original);
  });
});
