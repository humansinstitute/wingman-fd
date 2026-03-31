import { describe, expect, it } from 'vitest';

import {
  coercePositiveInteger,
  hasRowsNewerThan,
  latestTimestamp,
  resolveWindowLimit,
  sortRowsByTimestamp,
  takeNewestWindow,
  takeWindow,
} from '../src/windowing.js';

describe('windowing helpers', () => {
  it('uses stable defaults for the target list types', () => {
    expect(resolveWindowLimit('chatMessages')).toBe(80);
    expect(resolveWindowLimit('threadReplies')).toBe(6);
    expect(resolveWindowLimit('tasks')).toBe(50);
    expect(resolveWindowLimit('schedules')).toBe(50);
  });

  it('coerces invalid limits back to the fallback', () => {
    expect(coercePositiveInteger('12', 50)).toBe(12);
    expect(coercePositiveInteger('0', 50)).toBe(50);
    expect(coercePositiveInteger('not-a-number', 50)).toBe(50);
  });

  it('sorts rows by timestamp newest first', () => {
    const rows = [
      { record_id: 'old', updated_at: '2026-03-31T10:00:00.000Z' },
      { record_id: 'new', updated_at: '2026-03-31T11:00:00.000Z' },
    ];

    expect(sortRowsByTimestamp(rows).map((row) => row.record_id)).toEqual(['new', 'old']);
  });

  it('takes newest rows without mutating the input order', () => {
    const rows = [
      { record_id: 'a', updated_at: '2026-03-31T10:00:00.000Z' },
      { record_id: 'b', updated_at: '2026-03-31T11:00:00.000Z' },
      { record_id: 'c', updated_at: '2026-03-31T12:00:00.000Z' },
    ];

    expect(takeNewestWindow(rows, 2).map((row) => row.record_id)).toEqual(['c', 'b']);
    expect(rows.map((row) => row.record_id)).toEqual(['a', 'b', 'c']);
  });

  it('takes windows from either end of a sorted list', () => {
    const rows = ['a', 'b', 'c', 'd'];

    expect(takeWindow(rows, 2, { fromStart: true })).toEqual(['a', 'b']);
    expect(takeWindow(rows, 2, { fromStart: false })).toEqual(['c', 'd']);
  });

  it('reports the latest timestamp and newer-than checks', () => {
    const rows = [
      { record_id: 'a', updated_at: '2026-03-31T10:00:00.000Z' },
      { record_id: 'b', updated_at: '2026-03-31T11:00:00.000Z' },
    ];

    expect(latestTimestamp(rows)).toBe('2026-03-31T11:00:00.000Z');
    expect(hasRowsNewerThan(rows, '2026-03-31T10:30:00.000Z')).toBe(true);
    expect(hasRowsNewerThan(rows, '2026-03-31T11:30:00.000Z')).toBe(false);
  });
});
