import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

function readBuildMeta(metaPath) {
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch {
    return { absoluteVersion: 0, lastBuildDate: '', dailyVersion: 0 };
  }
}

function buildVersionPlugin() {
  let buildId = null;
  let builtAt = null;

  return {
    name: 'build-version',
    config(_config, env) {
      const metaPath = path.resolve(__dirname, '.build-meta.json');
      const meta = readBuildMeta(metaPath);

      const now = new Date();
      const date = now.toISOString().slice(0, 10).replace(/-/g, '');
      const time = now.toISOString().slice(11, 16).replace(':', '');
      const todayKey = now.toISOString().slice(0, 10);
      builtAt = now.toISOString();

      if (env.command === 'build') {
        const daily = todayKey === meta.lastBuildDate ? (meta.dailyVersion || 0) + 1 : 1;
        const absolute = (meta.absoluteVersion || 0) + 1;
        buildId = `${date}-${time}-${daily}-${absolute}`;

        fs.writeFileSync(metaPath, JSON.stringify({
          absoluteVersion: absolute,
          lastBuildDate: todayKey,
          dailyVersion: daily,
        }, null, 2) + '\n');
      } else {
        const absolute = Number(meta.absoluteVersion || 0);
        buildId = `${date}-dev-${String(Math.max(absolute, 0)).padStart(4, '0')}`;
      }

      const define = {
        __APP_BUILD_ID__: JSON.stringify(buildId),
      };

      return { define };
    },
    generateBundle() {
      if (!buildId || !builtAt) return;
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({
          buildId,
          builtAt,
        }),
      });
      this.emitFile({
        type: 'asset',
        fileName: 'service-worker.js',
        source: `
const BUILD_ID = ${JSON.stringify(buildId)};
const CACHE_PREFIX = 'wingman-fd';
const CACHE_NAME = \`\${CACHE_PREFIX}-\${BUILD_ID}\`;
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/apple-touch-icon.png',
  '/wingman-logo-192x192.png',
  '/wingman-logo-512x512.png',
  '/wingman-logo.png',
  '/version.json',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch(() => undefined)
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames
        .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
        .map((name) => caches.delete(name))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone()).catch(() => undefined);
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    const appShell = await cache.match('/index.html');
    if (appShell) return appShell;
    throw error;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone()).catch(() => undefined);
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    networkPromise.catch(() => undefined);
    return cached;
  }

  const networkResponse = await networkPromise;
  if (networkResponse) return networkResponse;
  return Response.error();
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname === '/version.json') {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  if (url.pathname.startsWith('/assets/') || PRECACHE_URLS.includes(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});
`,
      });
    },
  };
}

export default defineConfig({
  root: '.',
  plugins: [buildVersionPlugin()],
  server: {
    host: true,
    strictPort: true,
    allowedHosts: true,
    hmr: false,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3100',
        changeOrigin: true,
        secure: false,
        xfwd: true,
      },
    },
  },
  preview: {
    host: '0.0.0.0',
  },
  appType: 'spa',
  build: {
    outDir: 'dist',
  },
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.js'],
  },
});
