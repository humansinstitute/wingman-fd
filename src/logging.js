const LOG_BUFFER_KEY = '__wingmanFlightDeckLogs';
const LOG_BUFFER_LIMIT = 200;

function appendBrowserLog(entry) {
  if (typeof window === 'undefined') return;
  const existing = Array.isArray(window[LOG_BUFFER_KEY]) ? window[LOG_BUFFER_KEY] : [];
  const next = existing.concat(entry);
  window[LOG_BUFFER_KEY] = next.length > LOG_BUFFER_LIMIT
    ? next.slice(next.length - LOG_BUFFER_LIMIT)
    : next;
}

export function flightDeckLog(level, topic, message, details = null) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    topic,
    message,
    details: details ?? null,
  };

  appendBrowserLog(entry);

  const prefix = `[WingmanFD:${topic}] ${message}`;
  if (level === 'error') {
    console.error(prefix, details ?? '');
  } else if (level === 'warn') {
    console.warn(prefix, details ?? '');
  } else if (level === 'info') {
    console.info(prefix, details ?? '');
  } else {
    console.debug(prefix, details ?? '');
  }

  return entry;
}

export function getFlightDeckLogBufferKey() {
  return LOG_BUFFER_KEY;
}
