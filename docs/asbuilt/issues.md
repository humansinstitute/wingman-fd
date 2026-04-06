# Wingman Flight Deck As-Built Issues

Status: as-built working note  
Reviewed against live code on 2026-04-06  
Companion docs:

- `docs/asbuilt/architecture.md`
- `docs/asbuilt/data model.md`
- `docs/asbuilt/middleware.md`
- `docs/asbuilt/frontend.md`
- `docs/asbuilt/design.md`
- `docs/asbuilt/important.md`

## Scope

This note captures the obvious follow-up issues surfaced while reviewing the current as-built documentation against the live implementation. These are concrete gaps or maintenance problems visible in the repo today, not speculative future cleanup.

## Issues

### 1. No-worker fallback is incomplete for the fast write path

Evidence:

- `src/sync-manager.js` uses `flushOnly()` in `flushAndBackgroundSync()` for the normal fast push path after local writes.
- `src/sync-worker-client.js` exports `flushOnly()` and routes it through the worker queue.
- `src/sync-worker-client.js` local fallback in `invokeLocally()` does not implement the `flushOnly` method at all.

Why this matters:

- Browsers or environments where `Worker` startup fails lose the fast outbox path entirely.
- In those environments the app silently falls back to slower polling-only behavior for writes, even though the UI code assumes the flush-only path exists.
- This is a real behavior gap, not just an architectural nicety.

Practical follow-up:

- Add local fallback support for `flushOnly()` or explicitly disable the fast-write assumption when worker startup fails.
- Test the no-worker path directly so write delivery does not regress unnoticed.

### 2. SSE live-refresh support exists but is dead code, and the as-built docs are not fully aligned about that

Evidence:

- `src/worker/sync-worker-runner.js` contains an SSE client for `/api/v4/workspaces/:owner/stream`.
- `src/sync-worker-client.js` exposes `connectSSE()`, `disconnectSSE()`, and `setSSEStatusCallback()`.
- Repo-wide search shows no main-thread caller uses those functions.
- `docs/asbuilt/middleware.md` correctly says the SSE path is implemented but not currently wired.
- `docs/asbuilt/data model.md` and parts of `docs/asbuilt/architecture.md` still describe SSE refresh as if it is part of the active runtime path.

Why this matters:

- The codebase carries non-trivial sync machinery that is not actually activated.
- Maintainers can easily misread the current freshness model and debug the wrong path.
- The as-built set should be internally consistent, especially around sync behavior.

Practical follow-up:

- Either wire the SSE path into the main-thread sync lifecycle or remove/de-scope the dormant SSE protocol until it is truly used.
- Normalize the as-built docs so they consistently describe heartbeat polling as active and SSE as dormant code.

### 3. Published schema coverage lags the live sync-family registry

Evidence:

- `src/sync-families.js` registers `flow`, `approval`, `person`, and `organisation` alongside the older families.
- `tests/schema-sync.test.js` still expects schema manifests only for the older subset and validates outbound payloads only for that same subset.
- `docs/asbuilt/data model.md` already notes that the local model has moved ahead of repo-local published-schema coverage.

Why this matters:

- Newer synced families can drift from published schemas without the repo noticing.
- Schema compatibility is one of the important cross-app seams in this workspace, so missing validation here is high-value technical debt.

Practical follow-up:

- Publish and validate manifests for `flow`, `approval`, `person`, and `organisation`.
- Keep schema-sync coverage tied to the actual family registry, not to a hand-maintained older list.

### 4. Jobs remains a visible product surface even though the implementation is a stub

Evidence:

- `index.html` renders a full Jobs section, Jobs modals, and navigation entry when `hasHarnessLink` is true.
- `src/jobs-manager.js` hardcodes all load/create/edit/dispatch actions to `setJobsUnavailable('Jobs are unavailable in this build.')`.
- `docs/asbuilt/frontend.md` and `docs/asbuilt/important.md` both describe Jobs as effectively unavailable.

Why this matters:

- The app exposes a substantial UI surface that looks implemented but cannot actually perform its core actions.
- This increases user confusion and leaves extra template/store surface area to maintain for a feature that is not live.

Practical follow-up:

- Either hide the Jobs surface until there is a working backend path, or finish the implementation so the UI contract is real.
- If it remains intentionally unavailable, collapse it to a much smaller explicit placeholder.

### 5. The runtime UI remains tightly coupled to one very large Alpine store and one very large template

Evidence:

- `src/app.js` is 4,582 lines and still finishes by registering a single `Alpine.store('chat', storeObj)`.
- `index.html` is 5,953 lines and is tightly bound to `$store.chat.*`.
- The as-built docs consistently describe the source layout as modular while the runtime state model remains monolithic.

Why this matters:

- Cross-section changes still concentrate risk in a single store object and a single template surface.
- The size and coupling now make it harder to reason about ownership boundaries, test smaller UI slices, and make incremental refactors safely.

Practical follow-up:

- Continue moving domain state and actions behind clearer boundaries instead of extending the root store.
- Treat future section work as an opportunity to reduce direct `$store.chat` coupling rather than adding to it.

### 6. Legacy Coworker naming still leaks through live product, auth, and deploy surfaces

Evidence:

- `package.json` still uses the package name `coworker-fe`.
- `src/auth/nostr.js` uses `APP_TAG = 'coworker-v4'` and signs login copy as “Authenticate with Coworker”.
- `src/agent-connect.js` emits `kind: 'coworker_agent_connect'` and notes that another “Coworker/agent session” should use the token.
- `ecosystem.config.cjs` still contains old Wingman Coworker app names and paths.
- `src/db.js`, `src/auth/secure-store.js`, and `src/hard-reset.js` still depend on legacy `CoworkerV4*` IndexedDB names.

Why this matters:

- Some of these identifiers are compatibility-sensitive, while others are just stale branding or deployment residue.
- Without a deliberate boundary inventory, maintainers have to guess which names are safe to change and which are contract-critical.

Practical follow-up:

- Separate compatibility-critical legacy identifiers from renameable operator/product strings.
- Document that boundary in one place before attempting further naming cleanup.
