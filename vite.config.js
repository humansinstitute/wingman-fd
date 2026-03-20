import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

function buildVersionPlugin() {
  let buildId = null;

  return {
    name: 'build-version',
    buildStart() {
      const metaPath = path.resolve(__dirname, '.build-meta.json');
      let meta = { absoluteVersion: 0, lastBuildDate: '', dailyVersion: 0 };
      try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch {}

      const now = new Date();
      const date = now.toISOString().slice(0, 10).replace(/-/g, '');
      const time = now.toISOString().slice(11, 16).replace(':', '');
      const todayKey = now.toISOString().slice(0, 10);

      const daily = todayKey === meta.lastBuildDate ? (meta.dailyVersion || 0) + 1 : 1;
      const absolute = (meta.absoluteVersion || 0) + 1;

      buildId = `${date}-${time}-${daily}-${absolute}`;

      fs.writeFileSync(metaPath, JSON.stringify({
        absoluteVersion: absolute,
        lastBuildDate: todayKey,
        dailyVersion: daily,
      }, null, 2) + '\n');
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({
          buildId,
          builtAt: new Date().toISOString(),
        }),
      });
    },
    config() {
      return {
        define: {
          __APP_BUILD_ID__: JSON.stringify(buildId || 'dev'),
        },
      };
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
  build: {
    outDir: 'dist',
  },
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.js'],
  },
});
