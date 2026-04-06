# Wingman Flight Deck As-Built Important Notes

Status: as-built working note  
Reviewed against live code on 2026-04-06  
Companion docs:

- `docs/asbuilt/architecture.md`
- `docs/asbuilt/data model.md`
- `docs/asbuilt/middleware.md`
- `docs/asbuilt/frontend.md`
- `docs/asbuilt/design.md`

## Scope

This note captures the non-obvious practices, sharp edges, implicit rules, and maintenance caveats that exist in the current implementation. It is intentionally narrower than the architecture/design notes and is meant to help maintainers avoid breaking the current runtime model.

Primary files reviewed for this note:

- `README.md`
- `package.json`
- `vite.config.js`
- `src/main.js`
- `src/app.js`
- `src/api.js`
- `src/db.js`
- `src/hard-reset.js`
- `src/service-worker-registration.js`
- `src/version-check.js`
- `src/workspaces.js`
- `src/workspace-manager.js`
- `src/storage-image-manager.js`
- `src/sync-worker-client.js`
- `src/sync-manager.js`
- `src/worker/sync-worker.js`
- `src/worker/sync-worker-runner.js`
- `src/access-pruner.js`
- `src/auth/nostr.js`
- `src/auth/secure-store.js`
- `src/crypto/workspace-keys.js`
- `src/agent-connect.js`
- `src/jobs-manager.js`
- `src/logging.js`
- `src/route-helpers.js`
- `src/utils/state-helpers.js`

## Legacy Naming Still Matters

- The repo still carries older `Coworker` names in live contract surfaces, not just comments. Current examples include:
  - package name `coworker-fe` in `package.json`
  - auth IndexedDB name `CoworkerV4SecureAuth` in `src/auth/secure-store.js`
  - legacy IndexedDB migration source `CoworkerV4` in `src/db.js`
  - hard-reset cleanup targets `CoworkerV4SecureAuth` and `CoworkerV4` in `src/hard-reset.js`
  - auth app tag `coworker-v4` in `src/auth/nostr.js`
  - Agent Connect package kind `coworker_agent_connect` in `src/agent-connect.js`
- Do not treat those names as cosmetic debt that can be renamed in isolation. Reset flows, migrations, persisted auth state, and downstream consumers still depend on them.

## Build And Deploy Caveats

- The shipped app is the built static site in `dist/`. `index.html` at repo root is the source template; `dist/index.html` is generated output.
- `bun run build` does more than bundle assets:
  - it mutates `.build-meta.json`
  - it emits `dist/version.json`
  - it emits a build-specific `dist/service-worker.js`
- The custom Vite plugin increments build metadata on every real build. That means build output is intentionally stateful across runs, not purely derived from git state.
- Dev and preview are materially different:
  - `bun run dev` uses Vite dev server with `/api` proxied to `http://127.0.0.1:3100`
  - `bun run start` is just `vite preview` on `0.0.0.0:${PORT:-8093}` and serves the built static app
- The service worker and version polling are disabled in dev mode. Update behavior only exists in built/non-dev runs.

## Stale-App Recovery Is Built In

- `src/main.js` checks `maybePerformHardReset()` before booting the app.
- Visiting the app with `?reset=1`, `?reset=true`, or `?reset=yes` triggers a full local reset in `src/hard-reset.js`.
- That reset clears:
  - `localStorage`
  - `sessionStorage`
  - all service-worker registrations
  - all Cache Storage entries
  - `wingman-fd-shared`
  - `CoworkerV4SecureAuth`
  - `CoworkerV4`
  - every IndexedDB whose name starts with `wingman-fd-ws-`
- After cleanup the app reloads without the `reset` query param. This is the intended recovery path for cache/schema/service-worker drift.

## Worker Isolation Is Partial

- Sync logic is architecturally separated into `src/worker/sync-worker.js`, but runtime isolation is conditional.
- `src/sync-worker-client.js` falls back to importing `src/worker/sync-worker.js` on the main thread when `Worker` startup fails or is unavailable.
- That fallback is incomplete:
  - `runSync`
  - `pullRecordsForFamilies`
  - `pruneOnLogin`
  - `checkStaleness`
  are implemented locally
  - `flushOnly` is not implemented in the local fallback path
  - SSE connect/disconnect is worker-only
  - the independent worker flush timer is worker-only
- Practical result: the app can still sync without a worker, but write-only fast flush flows and SSE-driven live refresh depend on successful worker startup.
- There is also a small source-of-truth mismatch: the comment in `src/sync-worker-client.js` says the worker flushes every 5 seconds, but `FLUSH_INTERVAL_MS` in `src/worker/sync-worker-runner.js` is 2000 ms.

## Sync Has Protective Rules That Can Look Like Bugs

- Sync is heartbeat-first. `runSync()` asks Tower which families are stale and only pulls those families when heartbeat succeeds. If heartbeat fails, Flight Deck falls back to a full-family pull.
- Per-family sync cursors only advance when every pulled record in that family materializes cleanly. If even one record cannot be decrypted or translated, the cursor for that family is held back.
- Because of that rule, undecryptable records can cause repeated re-pulls of the same family until the record becomes readable, is repaired, or the family is restored.
- Access pruning is a cache cleanup step, not a security boundary. It runs:
  - immediately on login/workspace selection through `pruneOnLogin()`
  - at most once per hour after sync pulls through `maybePruneAfterSync()`
- Workspace owners are exempt from local pruning; non-owners are not.
- `ensureTaskFamilyBackfill()` in `src/sync-manager.js` is a one-shot repair heuristic. If the local task cache is empty but groups/scopes imply tasks should exist, the app forcibly clears task sync state and pulls the task family again.
- Restore/rebuild tooling is intentionally destructive to local cache state. `restoreFamiliesFromSuperBased()` clears runtime tables, sync state, and quarantine for the chosen families before forcing a fresh pull.
- Restore is blocked when the selected families still have pending writes. Maintainers should not bypass that guard casually; it exists to avoid discarding unsynced local edits.

## Workspace Identity And Routing Are More Specific Than They Look

- A workspace is not identified only by `workspace_owner_npub`.
- `buildWorkspaceKey()` in `src/workspaces.js` prefers:
  - `service:<serviceNpub>::workspace:<owner>`
  - then `url:<directHttpsUrl>::workspace:<owner>`
  - then plain `workspace:<owner>`
- That means the same workspace owner can intentionally map to different local workspace DBs when the backend identity differs.
- Route handling also reflects that distinction:
  - URL paths use a human slug such as `/<slug>/chat`
  - the query string can also carry `workspacekey`
  - `applyRouteFromLocation()` in `src/app.js` prefers `workspacekey` before slug when choosing which workspace to switch to
- Workspace switching intentionally does a full page navigation in `handleWorkspaceSwitcherSelect()` after persisting settings. It is not a pure in-memory section swap.
- Maintain that behavior unless the app gains a fully safe cross-workspace teardown path. The current code relies on a reload to avoid leaking runtime state between workspace DBs.

## Workspace Profile Hydration Trades Freshness For Safety

- Workspace switcher cards are hydrated from cached `workspace_settings` snapshots in other workspace DBs via `getWorkspaceSettingsSnapshot()`.
- `ensureWorkspaceProfileHydrated()` only attempts that snapshot hydration once per workspace key per session, using `_workspaceProfileHydratedKeys`.
- That guard exists to stop a hot loop where repeated avatar/profile lookups opened throwaway Dexie instances during Alpine re-renders.
- Side effect: a failed or sparse first hydration attempt can leave switcher cards stale until a reload or another code path explicitly merges fresher workspace data.

## Backend URL Handling Is Opinionated

- `normalizeBackendUrl()` in `src/utils/state-helpers.js` rewrites a same-host `:3100` root URL to `window.location.origin`.
- This is convenient when the frontend is reverse-proxied through the same host as Tower, but it can surprise maintainers expecting the literal `:3100` URL to persist in settings.
- When debugging cross-origin issues, check the normalized stored value rather than the raw value the user entered.

## Storage And Media Behavior Has Hidden Rules

- Image cache keys are backend-aware. `storageImageCacheKey()` uses `backendUrl::objectId`, not just `objectId`.
- `resolveStorageImageUrl()` still checks old object-id-only cache entries and will re-save them under the backend-aware key when possible. That is a compatibility bridge for older cached data.
- Image fetch failures are memoized for 60 seconds in `storageImageFailureCache` to suppress retry loops during repeated Alpine renders.
- Dexie-backed image cache eviction is capped at 100 entries and uses `cached_at` as an LRU-like timestamp.
- Upload flow is two-stage in `src/api.js`:
  - first try `PUT /api/v4/storage/:objectId` with base64 payload through the backend
  - if that returns 404 or 405, fall back to direct `upload_url` PUT
- A 404 from `POST /api/v4/storage/prepare` is treated as a real capability gap. `workspace-manager.js` surfaces that as “this backend does not support SuperBased storage”.

## Auth And Key Handling Have Non-Default Rules

- Stored auth credentials expire after 7 days in `src/auth/secure-store.js`.
- When Web Crypto AES-GCM is available, secrets are encrypted before being stored in IndexedDB. When it is not available, secrets are stored in plain form in the secure-auth DB.
- Workspace session keys are separate from the real user signer:
  - generated client-side
  - encrypted to the real user with NIP-44
  - cached in shared IndexedDB
  - loaded into memory for local crypto
- The workspace key may be used for local owner-payload crypto before Tower registration completes, but it must not be used for API auth until the `registered` flag is true.
- Cached unregistered workspace-key blobs are retried on later bootstrap. This is intentional; do not “simplify” it away unless Tower registration semantics also change.

## Some UI Surfaces Are Intentionally Stubbed

- `src/jobs-manager.js` is still a shell. It exposes modal toggles and formatting helpers, but every load/create/edit/dispatch action currently resolves to “Jobs are unavailable in this build.”
- The route layer still knows about `jobs`, so its existence in navigation or URLs does not imply a live backend implementation.

## Useful Debugging Hooks

- Browser logs are mirrored into `window.__wingmanFlightDeckLogs` with a ring buffer of 200 entries in `src/logging.js`.
- That buffer is often the quickest way to inspect sync, storage, and workspace-key issues in a live browser session without reproducing everything through devtools console history.
