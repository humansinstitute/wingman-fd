import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
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
