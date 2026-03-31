const RUNNING_BUILD_ID = typeof __APP_BUILD_ID__ !== 'undefined' ? __APP_BUILD_ID__ : 'dev';
const IS_DEV = import.meta.env.DEV;

let registrationPromise = null;
let reloadOnControllerChange = false;
let controllerListenerRegistered = false;

function ensureControllerReloadListener() {
  if (controllerListenerRegistered || typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  controllerListenerRegistered = true;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!reloadOnControllerChange) return;
    reloadOnControllerChange = false;
    window.location.reload();
  });
}

async function requestWaitingWorkerActivation(registration) {
  if (!registration?.waiting) return false;
  reloadOnControllerChange = true;
  registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  return true;
}

async function waitForInstallingWorker(registration, timeoutMs = 3000) {
  const worker = registration?.installing;
  if (!worker) return false;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      worker.removeEventListener('statechange', handleStateChange);
      resolve(value);
    };
    const handleStateChange = async () => {
      if (worker.state === 'installed' && registration.waiting) {
        finish(await requestWaitingWorkerActivation(registration));
        return;
      }
      if (worker.state === 'activated' || worker.state === 'redundant') {
        finish(false);
      }
    };

    worker.addEventListener('statechange', handleStateChange);
    handleStateChange();
    window.setTimeout(() => finish(false), timeoutMs);
  });
}

export async function registerBuildServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || IS_DEV) {
    return null;
  }
  if (registrationPromise) return registrationPromise;

  ensureControllerReloadListener();
  registrationPromise = navigator.serviceWorker.register(
    `/service-worker.js?build=${encodeURIComponent(RUNNING_BUILD_ID)}`,
    { updateViaCache: 'none' },
  ).catch(() => null);

  return registrationPromise;
}

export async function forceRefreshToLatestBuild() {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator) || IS_DEV) {
    window.location.reload();
    return;
  }

  ensureControllerReloadListener();
  const registration = await (registrationPromise || registerBuildServiceWorker());
  if (!registration) {
    window.location.reload();
    return;
  }

  await registration.update().catch(() => undefined);
  if (await requestWaitingWorkerActivation(registration)) return;
  if (await waitForInstallingWorker(registration)) return;
  window.location.reload();
}
