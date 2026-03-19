export const CALENDAR_VIEWS = ['day', 'week', 'month', 'year'];

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function createUtcDate(year, monthIndex, dayOfMonth) {
  return new Date(Date.UTC(year, monthIndex, dayOfMonth));
}

function parseDateKey(dateKey) {
  const match = String(dateKey || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const dayOfMonth = Number(match[3]);
  const date = createUtcDate(year, monthIndex, dayOfMonth);
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== monthIndex
    || date.getUTCDate() !== dayOfMonth
  ) {
    return null;
  }
  return date;
}

function formatDateKey(date) {
  return [
    String(date.getUTCFullYear()).padStart(4, '0'),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function addUtcDays(date, amount) {
  return new Date(date.getTime() + (Number(amount) || 0) * DAY_MS);
}

function addUtcMonths(date, amount) {
  return createUtcDate(
    date.getUTCFullYear(),
    date.getUTCMonth() + (Number(amount) || 0),
    Math.min(date.getUTCDate(), 28),
  );
}

function addUtcYears(date, amount) {
  return createUtcDate(
    date.getUTCFullYear() + (Number(amount) || 0),
    date.getUTCMonth(),
    Math.min(date.getUTCDate(), 28),
  );
}

function startOfWeek(date) {
  const weekday = date.getUTCDay();
  const offset = weekday === 0 ? -6 : 1 - weekday;
  return addUtcDays(date, offset);
}

function compareScheduledTasks(left, right) {
  const leftDate = String(left?.scheduled_for || '');
  const rightDate = String(right?.scheduled_for || '');
  if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
  const leftState = String(left?.state || '');
  const rightState = String(right?.state || '');
  if (leftState !== rightState) return leftState.localeCompare(rightState);
  return String(left?.title || '').localeCompare(String(right?.title || ''));
}

export function getTodayDateKey() {
  const now = new Date();
  return formatDateKey(createUtcDate(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  ));
}

export function normalizeDateKey(dateKey, fallback = getTodayDateKey()) {
  const parsed = parseDateKey(dateKey);
  return parsed ? formatDateKey(parsed) : normalizeDateKey(fallback, getTodayDateKey());
}

export function shiftCalendarDate(dateKey, view = 'month', step = 1) {
  const normalizedView = CALENDAR_VIEWS.includes(view) ? view : 'month';
  const parsed = parseDateKey(normalizeDateKey(dateKey));
  if (!parsed) return getTodayDateKey();

  if (normalizedView === 'day') return formatDateKey(addUtcDays(parsed, step));
  if (normalizedView === 'week') return formatDateKey(addUtcDays(parsed, step * 7));
  if (normalizedView === 'year') return formatDateKey(addUtcYears(parsed, step));
  return formatDateKey(addUtcMonths(parsed, step));
}

function formatLabelForDay(date) {
  return `${MONTH_LONG[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

function formatLabelForWeek(anchorDate) {
  const weekStart = startOfWeek(anchorDate);
  const weekEnd = addUtcDays(weekStart, 6);
  const startMonth = MONTH_SHORT[weekStart.getUTCMonth()];
  const endMonth = MONTH_SHORT[weekEnd.getUTCMonth()];
  const startYear = weekStart.getUTCFullYear();
  const endYear = weekEnd.getUTCFullYear();
  if (startYear === endYear && weekStart.getUTCMonth() === weekEnd.getUTCMonth()) {
    return `${startMonth} ${weekStart.getUTCDate()}-${weekEnd.getUTCDate()}, ${startYear}`;
  }
  if (startYear === endYear) {
    return `${startMonth} ${weekStart.getUTCDate()} - ${endMonth} ${weekEnd.getUTCDate()}, ${startYear}`;
  }
  return `${startMonth} ${weekStart.getUTCDate()}, ${startYear} - ${endMonth} ${weekEnd.getUTCDate()}, ${endYear}`;
}

export function formatCalendarRangeLabel(view = 'month', anchorDateKey = getTodayDateKey()) {
  const normalizedView = CALENDAR_VIEWS.includes(view) ? view : 'month';
  const parsed = parseDateKey(normalizeDateKey(anchorDateKey));
  if (!parsed) return '';
  if (normalizedView === 'day') return formatLabelForDay(parsed);
  if (normalizedView === 'week') return formatLabelForWeek(parsed);
  if (normalizedView === 'year') return String(parsed.getUTCFullYear());
  return `${MONTH_LONG[parsed.getUTCMonth()]} ${parsed.getUTCFullYear()}`;
}

function buildDaySlot(date, anchorDate, view) {
  return {
    dateKey: formatDateKey(date),
    fullLabel: `${WEEKDAY_LONG[date.getUTCDay()]}, ${MONTH_LONG[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`,
    weekdayLabel: WEEKDAY_SHORT[date.getUTCDay()],
    dayLabel: `${MONTH_SHORT[date.getUTCMonth()]} ${date.getUTCDate()}`,
    inCurrentPeriod: view !== 'month' || date.getUTCMonth() === anchorDate.getUTCMonth(),
    isToday: formatDateKey(date) === getTodayDateKey(),
    tasks: [],
  };
}

function buildCalendarDays(view, anchorDate) {
  if (view === 'day') {
    return [buildDaySlot(anchorDate, anchorDate, view)];
  }

  if (view === 'week') {
    const start = startOfWeek(anchorDate);
    return Array.from({ length: 7 }, (_, index) => buildDaySlot(addUtcDays(start, index), anchorDate, view));
  }

  const monthStart = createUtcDate(anchorDate.getUTCFullYear(), anchorDate.getUTCMonth(), 1);
  const gridStart = startOfWeek(monthStart);
  return Array.from({ length: 42 }, (_, index) => buildDaySlot(addUtcDays(gridStart, index), anchorDate, view));
}

function buildYearMonths(tasks, anchorDate) {
  const year = anchorDate.getUTCFullYear();
  return Array.from({ length: 12 }, (_, monthIndex) => {
    const monthKey = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
    const monthTasks = tasks
      .filter((task) => String(task?.scheduled_for || '').startsWith(monthKey))
      .sort(compareScheduledTasks);
    return {
      monthKey,
      label: MONTH_LONG[monthIndex],
      taskCount: monthTasks.length,
      tasks: monthTasks.slice(0, 5),
      overflowCount: Math.max(0, monthTasks.length - 5),
    };
  });
}

export function buildTaskCalendar(tasks = [], { view = 'month', anchorDateKey = getTodayDateKey() } = {}) {
  const normalizedView = CALENDAR_VIEWS.includes(view) ? view : 'month';
  const normalizedAnchorDate = normalizeDateKey(anchorDateKey);
  const anchorDate = parseDateKey(normalizedAnchorDate);
  const scheduledTasks = (Array.isArray(tasks) ? tasks : [])
    .filter((task) => parseDateKey(task?.scheduled_for))
    .sort(compareScheduledTasks);

  if (normalizedView === 'year') {
    return {
      view: normalizedView,
      anchorDateKey: normalizedAnchorDate,
      label: formatCalendarRangeLabel(normalizedView, normalizedAnchorDate),
      days: [],
      months: buildYearMonths(scheduledTasks, anchorDate),
    };
  }

  const days = buildCalendarDays(normalizedView, anchorDate);
  const tasksByDate = new Map();
  for (const task of scheduledTasks) {
    const dateKey = normalizeDateKey(task.scheduled_for);
    const list = tasksByDate.get(dateKey) || [];
    list.push(task);
    tasksByDate.set(dateKey, list);
  }

  return {
    view: normalizedView,
    anchorDateKey: normalizedAnchorDate,
    label: formatCalendarRangeLabel(normalizedView, normalizedAnchorDate),
    days: days.map((day) => ({
      ...day,
      tasks: tasksByDate.get(day.dateKey) || [],
    })),
    months: [],
  };
}
