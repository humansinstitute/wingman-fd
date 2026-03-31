const DEFAULT_WINDOW_LIMITS = Object.freeze({
  chatMessages: 80,
  threadReplies: 6,
  tasks: 50,
  documents: 50,
  directories: 50,
  reports: 50,
  schedules: 50,
});

export function coercePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return fallback;
}

export function resolveWindowLimit(kind, options = {}) {
  const fallback = DEFAULT_WINDOW_LIMITS[kind] ?? DEFAULT_WINDOW_LIMITS.tasks;
  return coercePositiveInteger(options.limit, fallback);
}

export function sortRowsByTimestamp(rows, key = 'updated_at', direction = 'desc') {
  const list = Array.isArray(rows) ? rows.slice() : [];
  list.sort((a, b) => {
    const aValue = String(a?.[key] ?? '');
    const bValue = String(b?.[key] ?? '');
    return direction === 'asc'
      ? aValue.localeCompare(bValue)
      : bValue.localeCompare(aValue);
  });
  return list;
}

export function takeWindow(rows, limit, { fromStart = false } = {}) {
  const list = Array.isArray(rows) ? rows.slice() : [];
  const safeLimit = coercePositiveInteger(limit, list.length);
  if (safeLimit >= list.length) return list;
  return fromStart ? list.slice(0, safeLimit) : list.slice(list.length - safeLimit);
}

export function takeNewestWindow(rows, limit, options = {}) {
  const sorted = sortRowsByTimestamp(rows, options.key ?? 'updated_at', 'desc');
  return takeWindow(sorted, limit, { fromStart: true });
}

export function takeOldestWindow(rows, limit, options = {}) {
  const sorted = sortRowsByTimestamp(rows, options.key ?? 'updated_at', 'asc');
  return takeWindow(sorted, limit, { fromStart: true });
}

export function latestTimestamp(rows, key = 'updated_at') {
  const sorted = sortRowsByTimestamp(rows, key, 'desc');
  return sorted[0]?.[key] ?? null;
}

export function hasRowsNewerThan(rows, timestamp, key = 'updated_at') {
  const cursor = String(timestamp || '');
  if (!cursor) return false;
  return sortRowsByTimestamp(rows, key, 'desc').some((row) => String(row?.[key] ?? '') > cursor);
}
