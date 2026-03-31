const RESET_PARAM = 'reset';
const KNOWN_DB_NAMES = [
  'wingman-fd-shared',
  'CoworkerV4SecureAuth',
  'CoworkerV4',
];
const WORKSPACE_DB_PREFIX = 'wingman-fd-ws-';

function shouldResetFromUrl(href = '') {
  try {
    const url = new URL(href, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    const value = String(url.searchParams.get(RESET_PARAM) || '').trim().toLowerCase();
    return value === '1' || value === 'true' || value === 'yes';
  } catch {
    return false;
  }
}

function buildPostResetUrl(href = '') {
  try {
    const url = new URL(href, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    url.searchParams.delete(RESET_PARAM);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
}

async function listIndexedDbNames() {
  if (typeof indexedDB === 'undefined') return [...KNOWN_DB_NAMES];
  if (typeof indexedDB.databases === 'function') {
    try {
      const databases = await indexedDB.databases();
      return databases
        .map((entry) => String(entry?.name || '').trim())
        .filter(Boolean);
    } catch {
      // Fall back to known names below.
    }
  }
  return [...KNOWN_DB_NAMES];
}

function deleteDatabase(name) {
  return new Promise((resolve) => {
    if (!name || typeof indexedDB === 'undefined') {
      resolve();
      return;
    }
    try {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function clearServiceWorkers() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister().catch(() => false)));
  } catch {
    // Ignore hard-reset cleanup failures.
  }
}

async function clearCaches() {
  if (typeof caches === 'undefined') return;
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key).catch(() => false)));
  } catch {
    // Ignore hard-reset cleanup failures.
  }
}

async function clearIndexedDb() {
  const discovered = await listIndexedDbNames();
  const dbNames = [...new Set([
    ...KNOWN_DB_NAMES,
    ...discovered.filter((name) => name.startsWith(WORKSPACE_DB_PREFIX)),
  ])];
  await Promise.all(dbNames.map((name) => deleteDatabase(name)));
}

async function performHardReset() {
  try { localStorage.clear(); } catch {}
  try { sessionStorage.clear(); } catch {}
  await Promise.all([
    clearServiceWorkers(),
    clearCaches(),
    clearIndexedDb(),
  ]);
}

export async function maybePerformHardReset() {
  if (typeof window === 'undefined' || !shouldResetFromUrl(window.location.href)) return false;
  await performHardReset();
  window.location.replace(buildPostResetUrl(window.location.href));
  return true;
}
