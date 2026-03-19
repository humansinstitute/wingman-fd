import { describe, expect, it } from 'vitest';
import {
  buildTaskCalendar,
  formatCalendarRangeLabel,
  shiftCalendarDate,
} from '../src/task-calendar.js';

describe('task calendar', () => {
  const tasks = [
    { record_id: 'a', title: 'Today', scheduled_for: '2026-03-18', state: 'ready' },
    { record_id: 'b', title: 'Tomorrow', scheduled_for: '2026-03-19', state: 'new' },
    { record_id: 'c', title: 'Next month', scheduled_for: '2026-04-03', state: 'review' },
    { record_id: 'd', title: 'Year end', scheduled_for: '2026-12-31', state: 'in_progress' },
  ];

  it('builds a day view for one anchor date', () => {
    const calendar = buildTaskCalendar(tasks, { view: 'day', anchorDateKey: '2026-03-18' });
    expect(calendar.days).toHaveLength(1);
    expect(calendar.days[0].dateKey).toBe('2026-03-18');
    expect(calendar.days[0].tasks.map((task) => task.record_id)).toEqual(['a']);
  });

  it('builds a monday-starting week view', () => {
    const calendar = buildTaskCalendar(tasks, { view: 'week', anchorDateKey: '2026-03-18' });
    expect(calendar.days).toHaveLength(7);
    expect(calendar.days[0].dateKey).toBe('2026-03-16');
    expect(calendar.days[2].tasks.map((task) => task.record_id)).toEqual(['a']);
    expect(calendar.days[3].tasks.map((task) => task.record_id)).toEqual(['b']);
  });

  it('builds a full month grid and year summary', () => {
    const monthCalendar = buildTaskCalendar(tasks, { view: 'month', anchorDateKey: '2026-03-18' });
    expect(monthCalendar.days).toHaveLength(42);
    expect(monthCalendar.days.some((day) => day.dateKey === '2026-04-03' && day.tasks.some((task) => task.record_id === 'c'))).toBe(true);

    const yearCalendar = buildTaskCalendar(tasks, { view: 'year', anchorDateKey: '2026-03-18' });
    expect(yearCalendar.months).toHaveLength(12);
    expect(yearCalendar.months[2].taskCount).toBe(2);
    expect(yearCalendar.months[11].tasks.map((task) => task.record_id)).toEqual(['d']);
  });

  it('formats labels and shifts anchors by view', () => {
    expect(formatCalendarRangeLabel('month', '2026-03-18')).toBe('March 2026');
    expect(formatCalendarRangeLabel('year', '2026-03-18')).toBe('2026');
    expect(shiftCalendarDate('2026-03-18', 'week', 1)).toBe('2026-03-25');
    expect(shiftCalendarDate('2026-03-18', 'month', -1)).toBe('2026-02-18');
    expect(shiftCalendarDate('2026-03-18', 'year', 1)).toBe('2027-03-18');
  });
});
