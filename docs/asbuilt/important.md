# Wingman Flight Deck As-Built Important Notes

Status: as-built working note  
Reviewed against live code on 2026-04-08  
Companion docs:

- `docs/asbuilt/architecture.md`
- `docs/asbuilt/data model.md`
- `docs/asbuilt/middleware.md`
- `docs/asbuilt/frontend.md`
- `docs/asbuilt/design.md`

## Scope

This note captures the non-obvious practices, sharp edges, implicit rules, and maintenance caveats in the current repository. It is intentionally narrower than the architecture and design notes and is aimed at maintainers who need to avoid breaking the shipped runtime model.

Primary files reviewed for this refresh:

- `README.md`
- `package.json`
- `vite.config.js`
- `src/main.js`
- `src/app.js`
- `src/api.js`
- `src/app-identity.js`
- `src/db.js`
- `src/hard-reset.js`
- `src/page-title.js`
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
  - app namespace env var `VITE_COWORKER_APP_NPUB` in `src/app-identity.js`
  - auth IndexedDB name `CoworkerV4SecureAuth` in `src/auth/secure-store.js`
  - legacy IndexedDB migration source `CoworkerV4` in `src/db.js`
  - hard-reset cleanup targets `CoworkerV4SecureAuth` and `CoworkerV4` in `src/hard-reset.js`
  - auth app tag `coworker-v4` in `src/auth/nostr.js`
  - Agent Connect package kind `coworker_agent_connect` in `src/agent-connect.js`
- Do not rename those strings casually. Reset flows, migration paths, persisted auth state, package export payloads, and app identity all still depend on them.

## Build And Deploy Caveats

- The shipped app is the built static site in `dist/`. `index.html` at repo root is the source template; `dist/index.html` is generated output.
- `bun run build` does more than bundle assets:
  - it mutates `.build-meta.json`
  - it emits `dist/version.json`
  - it emits a build-specific `dist/service-worker.js`
- The custom Vite plugin increments build metadata on every real build. Build output is intentionally stateful across runs, not purely derived from git state.
- Dev and preview are materially different:
  - `bun run dev` uses Vite dev server with `/api` proxied to `http://127.0.0.1:3100`
  - `bun run start` is `vite preview` on `0.0.0.0:${PORT:-8093}` and serves the built app
- Service-worker registration and version polling are disabled in dev mode. The update banner and service-worker reload path only exist in built, non-dev runs.

## Stale-App Recovery Is Built In

- `src/main.js` checks `maybePerformHardReset()` before booting the app.
- Visiting the app with `?reset=1`, `?reset=true`, or `?reset=yes` triggers a full local reset in `src/hard-reset.js`.
- That reset clears:
  - `localStorage`
  - `sessionStorage`
  - all service-worker registrations
  - all Cache Storage entries
  - the known IndexedDB names `wingman-fd-shared`, `CoworkerV4SecureAuth`, and `CoworkerV4`
- Workspace DB cleanup is best-effort:
  - if the browser supports `indexedDB.databases()`, the reset also deletes every IndexedDB whose name starts with `wingman-fd-ws-`
  - if that API is unavailable, the code falls back to the fixed known-name list and may miss workspace DBs
- After cleanup the app reloads without the `reset` query param. This is the intended recovery path for cache, schema, or service-worker drift.

## Sync Requires A Real Worker Now

- The old documentation that described a main-thread sync fallback is no longer accurate for the current client.
- `src/sync-worker-client.js` now requires a real `Worker` instance. If worker startup fails or the browser does not support workers, sync calls reject with a degraded-sync error and queued writes are left in Dexie for later retry.
- Practical result:
  - sync does not continue on the main thread when worker startup fails
  - SSE live refresh does not exist without a worker
  - the independent outbox flush timer does not exist without a worker
- `src/worker/sync-worker.js` still contains a top comment describing a reusable main-thread fallback path. That comment is stale relative to the live client behavior.
- There is also a smaller source-of-truth mismatch: the comment in `src/sync-worker-client.js` says the worker flushes every 5 seconds, but `FLUSH_INTERVAL_MS` in `src/worker/sync-worker-runner.js` is 2000 ms.

## Sync Has Protective Rules That Can Look Like Bugs

- Sync is heartbeat-first. `runSync()` asks Tower which families are stale and only pulls those families when heartbeat succeeds. If heartbeat fails, Flight Deck falls back to a full-family pull.
- Per-family sync cursors only advance when every pulled record in that family materializes cleanly. If even one record cannot be decrypted or translated, the cursor for that family is held back.
- Because of that rule, undecryptable records can cause repeated re-pulls of the same family until the record becomes readable, is repaired, or the family is restored.
- `ensureTaskFamilyBackfill()` in `src/sync-manager.js` is a one-shot repair heuristic. If the local task cache is empty but groups and scope state suggest tasks should exist, the app clears task sync state and force-pulls the task family again.
- Restore and rebuild tooling is intentionally destructive to local cache state. `restoreFamiliesFromSuperBased()` clears runtime tables, sync state, and quarantine for the chosen families before forcing a fresh pull.
- Restore is blocked when the selected families still have pending writes. That guard is there to avoid discarding unsynced local edits.

## Access Pruning Is Cleanup Only, And Coverage Is Partial

- Local access pruning is a cache cleanup step, not a security boundary. Tower still enforces access authoritatively on pull.
- It runs:
  - immediately on login or workspace selection through `pruneOnLogin()`
  - at most once per hour after sync pulls through `maybePruneAfterSync()`
- Workspace owners are exempt from local pruning; non-owners are not.
- Pruning coverage is incomplete in the current snapshot. `src/access-pruner.js` directly scans only:
  - `channels`
  - `scopes`
  - `tasks`
  - `documents`
  - `directories`
  - `reports`
  - `schedules`
  - `audio_notes`
- `chat_messages` and `comments` are only removed by cascade after their parent channel or target record is pruned.
- `flows`, `approvals`, `persons`, and `organisations` all have local `group_ids`, but they are not in the current prune list.

## Workspace Identity And Routing Are More Specific Than They Look

- A workspace is not identified only by `workspace_owner_npub`.
- The live runtime routing path is entrypoint-backed through `src/main.js` booting `initApp()` from `src/app.js`. Helper modules such as `src/route-helpers.js` assist with parsing, but the effective route selection and workspace-switch behavior still live in `src/app.js`.
- `buildWorkspaceKey()` in `src/workspaces.js` prefers:
  - `service:<serviceNpub>::workspace:<owner>`
  - then `url:<directHttpsUrl>::workspace:<owner>`
  - then plain `workspace:<owner>`
- That means the same workspace owner can intentionally map to different local workspace DBs when backend identity differs.
- Route handling follows that distinction:
  - URL paths use a human slug such as `/<slug>/chat`
  - the query string can also carry `workspacekey`
  - `applyRouteFromLocation()` in `src/app.js` prefers `workspacekey` before slug when deciding which workspace to switch to
- Workspace switching intentionally does a full page navigation in `handleWorkspaceSwitcherSelect()` after persisting settings. It is not a pure in-memory section swap.
- Maintain that behavior unless the app gains a fully safe cross-workspace teardown path. The current implementation relies on a reload to avoid leaking runtime state between workspace DBs.

## Workspace Switcher Metadata Is Simpler Than The Earlier Docs Said

- The earlier as-built pass described workspace-switcher profile hydration from other workspace DB snapshots. That is no longer what the current code does.
- `hydrateKnownWorkspaceProfiles()` in `src/workspace-manager.js` is now effectively a no-op.
- `ensureWorkspaceProfileHydrated()` only records the workspace key in `_workspaceProfileHydratedKeys`; it does not currently read `getWorkspaceSettingsSnapshot()` or merge metadata from another DB.
- Practical result: workspace switcher cards mostly reflect whatever is already present in `knownWorkspaces`, plus avatar resolution through storage or sender-profile fallbacks. They are not actively backfilled from other workspace DBs in this repo snapshot.

## Backend URL Handling Is Opinionated

- `normalizeBackendUrl()` in `src/utils/state-helpers.js` rewrites a same-host `:3100` root URL to `window.location.origin`.
- This is convenient when the frontend is reverse-proxied through the same host as Tower, but it can surprise maintainers expecting the literal `:3100` URL to persist in settings.
- When debugging cross-origin issues, check the normalized stored value rather than the raw value the user entered.

## Storage And Media Behavior Has Hidden Rules

- Image cache keys are backend-aware. `storageImageCacheKey()` uses `backendUrl::objectId`, not just `objectId`.
- `resolveStorageImageUrl()` still checks old object-id-only cache entries and rewrites them under the backend-aware key when possible. That is a compatibility bridge for older cached data.
- Image fetch failures are memoized for 60 seconds in `storageImageFailureCache` to suppress retry loops during repeated Alpine renders.
- Dexie-backed image cache eviction is capped at 100 entries and uses `cached_at` as an LRU-like timestamp.
- Upload flow is two-stage in `src/api.js`:
  - first try `PUT /api/v4/storage/:objectId` with base64 payload through the backend
  - if that returns 404 or 405, fall back to direct `upload_url` PUT
- A 404 from `POST /api/v4/storage/prepare` is treated as a real capability gap. `src/workspace-manager.js` surfaces that as “Workspace avatar upload requires SuperBased storage...” with the backend URL and the failing route.

## Auth And Workspace-Key Handling Have Sharp Edges

- Stored auth credentials expire after 7 days in `src/auth/secure-store.js`.
- When Web Crypto AES-GCM is available, secrets are encrypted before being stored in IndexedDB. When it is not available, secrets are stored in plain form in the secure-auth DB.
- `src/api.js` and `src/sync-manager.js` prefer a registered workspace user key for NIP-98 auth, then fall back to the logged-in user signer when no registered workspace user key is active.
- `src/crypto/workspace-keys.js` is now an FD compatibility adapter over `@superbased/browser` workspace user key runtime and encrypted blob helpers.
- The canonical identity names are:
  - `userNpub`: the real user and read viewer
  - `workspaceServiceNpub`: the workspace service identity, still aliased by legacy `workspace_owner_npub` / `owner_npub` at compatibility boundaries
  - `workspaceUserKeyNpub`: the delegated signer, still aliased by legacy `ws_key_npub` where old Dexie rows and Tower payloads require it
- Practical result:
  - owner-payload crypto, worker handoff, and registered API auth can use the workspace user key
  - API auth and SSE auth still fall back to the logged-in user signer when no registered workspace user key is active
- Do not remove the FD compatibility adapter or legacy cache aliases until a Dexie migration and Tower/library strict-mode rollout are planned together.

## Flows And Jobs Are Not Fully First-Class Routes

- `Flows` is visible in the main nav and has a live section in `index.html`, but route handling is still incomplete:
  - `getRoutePath()` in `src/app.js` has no `flows` case and falls back to `/flight-deck`
  - `KNOWN_PAGES` in `src/route-helpers.js` does not include `flows`
  - `buildFlightDeckDocumentTitle()` in `src/page-title.js` has no `flows` case
- Practical result: the Flows section exists in the UI, but deep-linking, browser history, and tab titles are not fully first-class yet.
- `src/jobs-manager.js` is still a shell. It exposes modal toggles and formatting helpers, but every load, create, edit, dispatch, toggle, delete, or stop action currently resolves to “Jobs are unavailable in this build.”
- The template still contains a jobs section, but the nav item is hard-hidden in `index.html` with `x-show="false"`. Its existence in the DOM does not imply a live backend implementation.

## Useful Debugging Hooks

- Browser logs are mirrored into `window.__wingmanFlightDeckLogs` with a ring buffer of 200 entries in `src/logging.js`.
- That buffer is often the quickest way to inspect sync, storage, worker, and workspace-key issues in a live browser session without reproducing everything through console history.
