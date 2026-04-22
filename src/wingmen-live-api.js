function cleanHarnessUrl(harnessUrl = '') {
  return String(harnessUrl || '').trim().replace(/\/+$/, '');
}

export function buildWingmenLiveUrl(harnessUrl, path = '') {
  const base = cleanHarnessUrl(harnessUrl);
  const suffix = String(path || '').trim();
  if (!base) return suffix || '';
  if (!suffix) return base;
  return `${base}${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
}

function normalizeErrorState(error) {
  if (error?.status === 401) return 'unauthorized';
  return 'unavailable';
}

async function readResponsePayload(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function requestJson(harnessUrl, path, options = {}) {
  const url = buildWingmenLiveUrl(harnessUrl, path);
  const response = await fetch(url, options);
  const payload = await readResponsePayload(response);
  if (!response.ok) {
    const error = new Error(`Harness request failed: ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export async function listHarnessSessions({ harnessUrl } = {}) {
  if (!cleanHarnessUrl(harnessUrl)) return { ok: false, error: 'unconfigured', sessions: [] };

  try {
    const payload = await requestJson(harnessUrl, '/api/sessions', { method: 'GET' });
    const sessions = Array.isArray(payload?.sessions)
      ? payload.sessions
      : Array.isArray(payload)
        ? payload
        : [];
    return { ok: true, sessions };
  } catch (error) {
    return { ok: false, error: normalizeErrorState(error), sessions: [] };
  }
}

export async function updateHarnessSessionMetadata({ harnessUrl, sessionId, metadata } = {}) {
  if (!cleanHarnessUrl(harnessUrl)) return { ok: false, error: 'unconfigured', session: null };
  if (!sessionId) return { ok: false, error: 'unavailable', session: null };

  try {
    const session = await requestJson(
      harnessUrl,
      `/api/sessions/${encodeURIComponent(sessionId)}/metadata`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(metadata || {}),
      },
    );
    return { ok: true, session };
  } catch (error) {
    return { ok: false, error: normalizeErrorState(error), session: null };
  }
}

export async function getHarnessNightWatchSession({ harnessUrl, sessionId } = {}) {
  if (!cleanHarnessUrl(harnessUrl)) return { ok: false, error: 'unconfigured', nightWatch: null };
  if (!sessionId) return { ok: false, error: 'unavailable', nightWatch: null };

  try {
    const nightWatch = await requestJson(
      harnessUrl,
      `/api/nightwatch/sessions/${encodeURIComponent(sessionId)}`,
      { method: 'GET' },
    );
    return { ok: true, nightWatch };
  } catch (error) {
    return { ok: false, error: normalizeErrorState(error), nightWatch: null };
  }
}

export async function enableHarnessNightWatch({ harnessUrl, sessionId, config } = {}) {
  if (!cleanHarnessUrl(harnessUrl)) return { ok: false, error: 'unconfigured', nightWatch: null };
  if (!sessionId) return { ok: false, error: 'unavailable', nightWatch: null };

  try {
    const nightWatch = await requestJson(
      harnessUrl,
      `/api/nightwatch/sessions/${encodeURIComponent(sessionId)}/enable`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config || {}),
      },
    );
    return { ok: true, nightWatch };
  } catch (error) {
    return { ok: false, error: normalizeErrorState(error), nightWatch: null };
  }
}

export async function disableHarnessNightWatch({ harnessUrl, sessionId } = {}) {
  if (!cleanHarnessUrl(harnessUrl)) return { ok: false, error: 'unconfigured', nightWatch: null };
  if (!sessionId) return { ok: false, error: 'unavailable', nightWatch: null };

  try {
    const nightWatch = await requestJson(
      harnessUrl,
      `/api/nightwatch/sessions/${encodeURIComponent(sessionId)}/disable`,
      { method: 'POST' },
    );
    return { ok: true, nightWatch };
  } catch (error) {
    return { ok: false, error: normalizeErrorState(error), nightWatch: null };
  }
}

function reportSessionId(report = {}) {
  return report.sessionId || report.session_id || report.session?.id || null;
}

export async function listHarnessNightWatchReports({ harnessUrl, sessionId, limit = 25 } = {}) {
  if (!cleanHarnessUrl(harnessUrl)) {
    return { ok: false, error: 'unconfigured', historySource: 'unavailable', reports: [] };
  }

  const searchParams = new URLSearchParams();
  searchParams.set('limit', String(limit));
  try {
    const payload = await requestJson(
      harnessUrl,
      `/api/nightwatch/reports?${searchParams.toString()}`,
      { method: 'GET' },
    );
    const allReports = Array.isArray(payload?.reports)
      ? payload.reports
      : Array.isArray(payload)
        ? payload
        : [];
    const reports = sessionId
      ? allReports.filter((report) => reportSessionId(report) === sessionId)
      : allReports;
    return {
      ok: true,
      historySource: 'client-filtered-global-list',
      reports,
    };
  } catch (error) {
    return {
      ok: false,
      error: normalizeErrorState(error),
      historySource: 'unavailable',
      reports: [],
    };
  }
}
