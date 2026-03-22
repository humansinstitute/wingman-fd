import { describe, it, expect } from 'vitest';
import { getShortNpub, getInitials } from '../src/utils/naming.js';

describe('getShortNpub', () => {
  it('truncates long npub to first 7 + last 6 with ellipsis', () => {
    const npub = 'npub1abcdefghijklmnopqrstuvwxyz';
    expect(getShortNpub(npub)).toBe('npub1ab...uvwxyz');
  });

  it('returns short values unchanged', () => {
    expect(getShortNpub('npub1short')).toBe('npub1short');
  });

  it('returns exactly 13-char values unchanged', () => {
    expect(getShortNpub('1234567890123')).toBe('1234567890123');
  });

  it('handles empty/null input', () => {
    expect(getShortNpub('')).toBe('');
    expect(getShortNpub(null)).toBe('');
    expect(getShortNpub(undefined)).toBe('');
  });
});

describe('getInitials', () => {
  it('returns first letters of first two words', () => {
    expect(getInitials('John Doe')).toBe('JD');
  });

  it('returns first two chars for single word', () => {
    expect(getInitials('Alice')).toBe('AL');
  });

  it('returns ? for empty input', () => {
    expect(getInitials('')).toBe('?');
    expect(getInitials(null)).toBe('?');
    expect(getInitials(undefined)).toBe('?');
  });

  it('uppercases the result', () => {
    expect(getInitials('jane smith')).toBe('JS');
  });

  it('handles multiple spaces between words', () => {
    expect(getInitials('Jane   Smith')).toBe('JS');
  });

  it('uses only first two words when more exist', () => {
    expect(getInitials('Jane Mary Smith')).toBe('JM');
  });

  it('handles single character input', () => {
    expect(getInitials('A')).toBe('A');
  });
});
