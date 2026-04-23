import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(rootDir, 'dist');
const indexPath = path.join(distDir, 'index.html');

function fail(message) {
  console.error(`[verify-dist-assets] ${message}`);
  process.exitCode = 1;
}

if (!existsSync(indexPath)) {
  fail('dist/index.html is missing. Run bun run build before deploying.');
} else {
  const html = readFileSync(indexPath, 'utf8');
  const assetRefs = new Set();
  const assetPattern = /\b(?:src|href)=["']\/assets\/([^"']+)["']/g;
  for (const match of html.matchAll(assetPattern)) {
    assetRefs.add(match[1]);
  }

  if (assetRefs.size === 0) {
    fail('dist/index.html does not reference any /assets/ files.');
  }

  for (const assetRef of assetRefs) {
    const assetPath = path.join(distDir, 'assets', assetRef);
    if (!existsSync(assetPath)) {
      fail(`dist/index.html references missing asset /assets/${assetRef}.`);
      continue;
    }
    if (statSync(assetPath).size <= 0) {
      fail(`dist/index.html references empty asset /assets/${assetRef}.`);
    }
  }

  for (const required of ['version.json', 'service-worker.js']) {
    const requiredPath = path.join(distDir, required);
    if (!existsSync(requiredPath)) {
      fail(`dist/${required} is missing.`);
    }
  }

  if (!process.exitCode) {
    console.log(`[verify-dist-assets] verified ${assetRefs.size} asset reference(s).`);
  }
}
