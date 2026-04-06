/**
 * Coworker Identifier Inventory Tests
 *
 * Validates the classification of legacy "Coworker" identifiers across the
 * Flight Deck codebase. Each identifier is categorised by rename safety:
 *
 *   migration-sensitive  – changing would break persisted user data
 *   external-contract    – changing would break cross-app or cross-repo consumers
 *   deploy-config        – changing would break deploy tooling (PM2, Caprover)
 *   env-var              – changing would break .env / CI configuration
 *   user-facing          – safe to rename (only affects display text)
 *   internal-low-risk    – safe to rename with a coordinated code change
 */

import { describe, it, expect } from 'bun:test';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dir, '..');

// ---------------------------------------------------------------------------
// Helper: read a source file and return all lines matching a pattern
// ---------------------------------------------------------------------------
function grepFile(relPath, pattern) {
  const abs = resolve(ROOT, relPath);
  if (!existsSync(abs)) return [];
  const lines = readFileSync(abs, 'utf-8').split('\n');
  return lines
    .map((text, i) => ({ line: i + 1, text }))
    .filter(({ text }) => pattern.test(text));
}

// ---------------------------------------------------------------------------
// 1. Migration-sensitive identifiers (IndexedDB names used by real browsers)
// ---------------------------------------------------------------------------
describe('migration-sensitive identifiers', () => {
  it('secure-store.js opens IndexedDB as CoworkerV4SecureAuth', () => {
    const hits = grepFile('src/auth/secure-store.js', /CoworkerV4SecureAuth/);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    // This name is persisted in every user's browser. Renaming it would
    // orphan stored credentials and device keys.
  });

  it('db.js references legacy CoworkerV4 DB for migration', () => {
    const hits = grepFile('src/db.js', /CoworkerV4/);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    // migrateFromLegacyDb() reads from the old CoworkerV4 database.
    // The name must match what earlier versions of the app actually created.
  });

  it('hard-reset.js lists both legacy DB names for cleanup', () => {
    const hits = grepFile('src/hard-reset.js', /CoworkerV4/);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    // Both 'CoworkerV4SecureAuth' and 'CoworkerV4' must appear so the
    // hard-reset path can delete databases created by older app versions.
  });

  it('auth/nostr.js uses APP_TAG coworker-v4 in signed events', () => {
    const hits = grepFile('src/auth/nostr.js', /coworker-v4/);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    // APP_TAG is embedded in Nostr login events already stored by Tower.
    // Changing it would create a new tag namespace and break session
    // verification against existing records.
  });
});

// ---------------------------------------------------------------------------
// 2. External-contract identifiers (consumed by Tower, Yoke, or agents)
// ---------------------------------------------------------------------------
describe('external-contract identifiers', () => {
  it('agent-connect.js emits kind coworker_agent_connect', () => {
    const hits = grepFile('src/agent-connect.js', /coworker_agent_connect/);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    // The Agent Connect package kind is consumed by Yoke and external agents.
    // Renaming requires coordinated changes across repos.
  });

  it('agent-connect.js notes reference mentions Coworker/agent session', () => {
    const hits = grepFile('src/agent-connect.js', /Coworker\/agent session/);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    // User-facing note inside a structured payload. Low risk but technically
    // part of a published JSON shape that agents may parse.
  });

  it('public/llms.txt references coworker_agent_connect kind', () => {
    const hits = grepFile('public/llms.txt', /coworker_agent_connect/);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    // Published agent instruction surface. Rename requires updating
    // llms.txt and any agents that reference the kind.
  });

  it('public/agentconnect.md references Coworker naming', () => {
    const hits = grepFile('public/agentconnect.md', /[Cc]oworker/);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    // Published documentation consumed by agents.
  });
});

// ---------------------------------------------------------------------------
// 3. Environment variable / build config
// ---------------------------------------------------------------------------
describe('env-var identifiers', () => {
  it('app-identity.js reads VITE_COWORKER_APP_NPUB', () => {
    const hits = grepFile('src/app-identity.js', /VITE_COWORKER_APP_NPUB/);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    // Env var used in .env files, CI, and deploy scripts.
    // Renaming requires updating every deployment environment.
  });

  it('README.md documents VITE_COWORKER_APP_NPUB', () => {
    const hits = grepFile('README.md', /VITE_COWORKER_APP_NPUB/);
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// 4. Deploy configuration (PM2 / ecosystem)
// ---------------------------------------------------------------------------
describe('deploy-config identifiers', () => {
  it('ecosystem.config.cjs contains legacy Coworker app entries', () => {
    const hits = grepFile('ecosystem.config.cjs', /[Cc]oworker/);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    // PM2 app names and paths reference old coworker-fe location.
    // These are deploy artifacts; renaming is safe but needs coordination
    // with the PM2 process list on the target host.
  });
});

// ---------------------------------------------------------------------------
// 5. Package identity
// ---------------------------------------------------------------------------
describe('package identity', () => {
  it('package.json uses name coworker-fe', () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8'));
    expect(pkg.name).toBe('coworker-fe');
    // Package name is internal (private: true). Low risk to rename but
    // may appear in lockfiles, PM2 labels, and Caprover app names.
  });
});

// ---------------------------------------------------------------------------
// 6. Internal low-risk identifiers (localStorage keys, display strings)
// ---------------------------------------------------------------------------
describe('internal low-risk identifiers', () => {
  it('task-board-state.js uses coworker: prefixed localStorage keys', () => {
    const hits = grepFile('src/task-board-state.js', /['"]coworker:/);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    // localStorage keys prefixed with "coworker:". Renaming would lose
    // the user's last-selected board, but that is a minor UX reset,
    // not data loss. Needs a one-time migration or can be left.
  });
});

// ---------------------------------------------------------------------------
// 7. User-facing display strings (safe to rename)
// ---------------------------------------------------------------------------
describe('user-facing display strings', () => {
  it('auth/nostr.js has Authenticate with Coworker content string', () => {
    const hits = grepFile('src/auth/nostr.js', /Authenticate with Coworker/);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    // This is the `content` field of the login event. It is display-only;
    // Tower does not validate the content string. Safe to rename.
  });
});

// ---------------------------------------------------------------------------
// 8. Compatibility note exists
// ---------------------------------------------------------------------------
describe('compatibility documentation', () => {
  it('docs/coworker-identifier-compatibility.md exists', () => {
    const notePath = resolve(ROOT, 'docs/coworker-identifier-compatibility.md');
    expect(existsSync(notePath)).toBe(true);
  });

  it('compatibility note covers all classification categories', () => {
    const notePath = resolve(ROOT, 'docs/coworker-identifier-compatibility.md');
    const content = readFileSync(notePath, 'utf-8');
    expect(content).toContain('migration-sensitive');
    expect(content).toContain('external-contract');
    expect(content).toContain('deploy-config');
    expect(content).toContain('env-var');
    expect(content).toContain('user-facing');
    expect(content).toContain('internal-low-risk');
  });

  it('compatibility note lists specific identifiers', () => {
    const notePath = resolve(ROOT, 'docs/coworker-identifier-compatibility.md');
    const content = readFileSync(notePath, 'utf-8');
    expect(content).toContain('CoworkerV4SecureAuth');
    expect(content).toContain('CoworkerV4');
    expect(content).toContain('coworker-v4');
    expect(content).toContain('coworker_agent_connect');
    expect(content).toContain('VITE_COWORKER_APP_NPUB');
    expect(content).toContain('coworker-fe');
  });
});
