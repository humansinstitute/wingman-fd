# Shell State Extraction — First Runtime Boundary Seam

**Date:** 2026-04-06
**Task:** FD As-Built Remediation 07
**Scope:** Execute the first runtime boundary extraction seam

## Decision

Extract the app shell state (identity, session, navigation, route, sync status, connect modal, constants, and lifecycle methods) from the monolithic `src/app.js` store into a dedicated `src/shell-state.js` module.

The shell state module is applied to the assembled store via `applyMixins`, so `$store.chat.*` template bindings in `index.html` continue to work unchanged.

## What was extracted

The `createShellState()` function in `src/shell-state.js` defines:

**State keys (120+):**
- Constants: `FAST_SYNC_MS`, `IDLE_SYNC_MS`, `SSE_HEARTBEAT_CADENCE_MS`, `BACKGROUND_GROUP_REFRESH_MS`
- Identity/session: `backendUrl`, `ownerNpub`, `botNpub`, `session`, `settingsTab`, `appBuildId`, `extensionSignerAvailable`, `isLoggingIn`, `loginError`, `error`
- Navigation: `navSection`, `navCollapsed`, `mobileNavOpen`, `routeSyncPaused`, `popstateHandler`
- Sync status: `syncStatus`, `syncSession`, `sseStatus`, `catchUpSyncActive`, plus sync internals
- Shell UI: `showAvatarMenu`, `showWorkspaceSwitcherMenu`, `presetConnecting`
- Connect modal: `showConnectModal`, `connectStep`, all `connect*` fields, `knownHosts`, `showAgentConnectModal`
- Workspace identity: `knownWorkspaces`, `selectedWorkspaceKey`, `workspaceProfileRowsByKey`, all workspace profile fields, harness fields
- Getters: `signingNpub`, `isLoggedIn`

**Lifecycle methods (19):**
- `init`, `bootstrapSelectedWorkspace`
- `initRouteSync`, `getRoutePath`, `buildRouteUrl`, `syncRoute`, `applyRouteFromLocation`, `updatePageTitle`
- `navigateTo`, `togglePrimaryNav`, `clearInactiveSectionData`
- `startExtensionSignerWatch`, `stopExtensionSignerWatch`, `refreshExtensionSignerAvailability`
- `maybeAutoLogin`, `login`, `logout`
- `hasExtensionSigner`, `openHarnessLink`

## What stays in app.js

- All section data arrays (channels, messages, documents, tasks, etc.)
- All section selection state (selectedChannelId, activeTaskId, etc.)
- All domain mixin methods (chat, docs, tasks, flows, scopes, etc.)
- All domain getters (displayName, greetingName, scopedReports, etc.)
- Template coupling: `$store.chat.*` references unchanged

## Implementation approach

Phase 1 (this commit): The shell state module is applied as the first mixin in `applyMixins`. The inline storeObj in app.js still contains the same keys as fallback defaults. The shell module is the canonical source of truth, and the inline keys are now redundant — they will be cleaned up in a subsequent pass.

This two-phase approach was chosen because:
1. It's behavior-preserving by construction (same keys, same values, same runtime behavior)
2. It avoids the risk of breaking the 4500-line app.js with large surgical deletions
3. It establishes the boundary module and test coverage first
4. The cleanup (removing redundant inline keys) can be done safely in a follow-up

## Boundary enforcement

`SHELL_STATE_KEYS` and `SHELL_METHOD_NAMES` are exported as frozen arrays and tested against the actual object shape. The test suite verifies:
- All expected shell keys are present
- No domain keys leak into the shell boundary
- Getters survive the mixin application pattern
- The shell state is spreadable into a store via Object.defineProperties

## Remaining highest-risk coupling in app.js

The highest-risk coupling still in `src/app.js` is that all domain section data (channels, messages, documents, tasks, reports, schedules, scopes, flows, approvals, persons, organisations) lives in the same reactive store object. A change to any section's data arrays can trigger Alpine reactivity across unrelated sections. This is the next seam identified in `docs/design/store-template-decomposition.md`.

## Files changed

- `src/shell-state.js` (new) — Shell state module
- `src/app.js` — Added import and applyMixins integration
- `tests/shell-state.test.js` (new) — 40 tests for shell state boundary
- `docs/log/shell-state-extraction.md` (new) — This decision log

## Validation

- `bun test` — All 40 new tests pass. No new test failures (117 pre-existing failures unchanged).
- `bun run build` — Succeeds.
