# Store and Template Decomposition Plan

**Status:** Implementation-ready
**Date:** 2026-04-06
**Scope:** First extraction seam for the monolithic runtime in `wingman-fd`

---

## Problem

`src/app.js` is 4,584 lines. `index.html` is 5,953 lines. Both are growing. The entire runtime registers as a single Alpine store (`Alpine.store('chat', storeObj)`) and every template expression reads from `$store.chat.*`. The as-built report (Issue #5) and the target architecture doc (`docs/design/target_alpine_dexie_archi.md`) both flag this as the scaling bottleneck.

The mixin pattern (`applyMixins`) already separates domain logic into files, but at runtime everything merges into one reactive object. Cross-section state changes trigger reactive churn across the whole store. Template sections are gated by `x-if="$store.chat.navSection === '...'"`  but they all share one namespace.

This note defines the first safe extraction seam and the patch order to execute it.

---

## Current Shell Responsibilities in src/app.js

Traced from the live code, `src/app.js` currently owns six distinct responsibility categories inside one store object:

### 1. Shell lifecycle and bootstrap

Lines ~1083–1165: `init()` method. Responsibilities:
- Extension signer watch startup
- Route sync initialization
- Legacy DB migration
- Shared live queries startup
- Settings load from Dexie
- Invite token extraction
- Connection token parsing
- Backend URL resolution
- Known workspace hydration
- Auto-login attempt
- Workspace selection
- Workspace bootstrap (groups, flows, key mappings, access prune)

**State involved:** `backendUrl`, `ownerNpub`, `botNpub`, `session`, `selectedWorkspaceKey`, `currentWorkspaceOwnerNpub`, `knownWorkspaces`, `knownHosts`, `pendingInviteToken`, `superbasedTokenInput`, `useCvmSync`, `extensionSignerAvailable`

### 2. Route activation and section switching

Lines ~1223–1457: `initRouteSync()`, `buildRouteUrl()`, `syncRoute()`, `applyRouteFromLocation()`, `navigateTo()`.

**State involved:** `navSection`, `routeSyncPaused`, `popstateHandler`, `mobileNavOpen`, `showWorkspaceSwitcherMenu`

### 3. Section domain state (the bulk)

Lines ~295–549: All domain arrays and selection state declared inline in storeObj.

| Section | State keys (sample) | Lines |
|---------|---------------------|-------|
| Chat | `channels`, `messages`, `audioNotes`, `selectedChannelId`, `activeThreadId`, `threadInput`, `messageInput`, `focusMessageId`, `expandedChatMessageIds` | ~30 keys |
| Tasks | `tasks`, `taskComments`, `activeTaskId`, `editingTask`, `taskFilter`, `taskFilterTags`, `selectedTaskIds`, `selectedBoardId`, `taskViewMode`, `collapsedSections`, `newTaskTitle`, `newSubtaskTitle` | ~25 keys |
| Docs | `documents`, `directories`, `docComments`, `selectedDocId`, `selectedDocType`, `currentFolderId`, `docEditorBlocks`, `docEditorContent`, `docEditingBlockIndex`, `docBlockBuffer`, `docAutosaveTimer` | ~40 keys |
| Reports | `reports`, `selectedReportId`, `reportModalReport` | ~3 keys |
| Schedules | `schedules`, `showNewScheduleModal`, `editingScheduleId`, `editingScheduleDraft`, `newSchedule*` fields | ~12 keys |
| Flows/Approvals | `flows`, `approvals`, `editingFlowId`, `showFlowEditor`, `activeApprovalId`, `approvalDecisionNote`, `approvalLinkedNames`, `approvalPreview*` fields, `showApprovalHistory` | ~20 keys |
| Scopes | `scopes`, `scopesLoaded`, `scopePickerQuery`, `showScopePicker`, `newScope*` fields, `editingScope*` fields | ~15 keys |
| People | `persons`, `organisations`, `editingPersonId`, `editingOrgId`, `personForm*`, `orgForm*`, `linkPicker*` | ~15 keys |
| Jobs | `jobDefinitions`, `jobRuns`, `jobsLoading`, `showNewJobModal`, `editJob*`, `dispatch*` | ~20 keys |

### 4. Transient UI state

Scattered across the store object. Key examples:
- Modal flags: `showConnectModal`, `showAgentConnectModal`, `showAudioRecorderModal`, `showChannelSettingsModal`, `showNewGroupModal`, `showEditGroupModal`, `showDocShareModal`, `showDocScopeModal`, `showDocMoveModal`, `showNewChannelModal`, `recordVersionModalOpen`, `recordStatusModalOpen`
- Editor buffer state: `docBlockBuffer`, `docEditorContent`, `messageInput`, `threadInput`, `newTaskCommentBody`, `newDocCommentBody`
- Menu state: `showAvatarMenu`, `messageActionsMenuId`, `showBoardPicker`
- Drag state: `_dragTaskId`, `_taskWasDragged`, `_dragDocBrowserItem`

### 5. Data subscriptions

Managed through `section-live-queries.js` (`sectionLiveQueryMixin`). The `startWorkspaceLiveQueries()` method is called from:
- `applyRouteFromLocation()` (line 1455)
- `navigateTo()` (line 1758)
- `selectWorkspace()` / workspace switching (multiple sites)
- Various detail-open flows

Current subscription model:
- **Always-on:** flows, approvals (needed by task/status surfaces)
- **Section-gated:** channels, messages, docs, tasks, schedules, reports, scopes, persons/orgs
- **Detail-gated:** selected channel messages, selected task comments, selected doc/report

The subscription lifecycle is already section-aware via `buildWorkspaceSpecs()` in `section-live-queries.js`, using `store.navSection` to decide which queries are active.

### 6. Side-effect orchestration

- **Sync lifecycle:** `syncManagerMixin` (1,367 lines) — background sync timer, flush, pull, SSE, repair tools
- **Crypto bootstrap:** `bootstrapWrappedGroupKeys`, `setActiveSessionNpub`, `clearCryptoContext`
- **Storage orchestration:** `prepareStorageObject`, `uploadStorageObject`, `completeStorageObject`
- **Profile resolution:** `peopleProfilesManagerMixin` (388 lines) — sender/avatar lookup, cached suggestions
- **Unread tracking:** `unreadStoreMixin` (390 lines) — nav dots, read cursor writes

---

## First Extraction Seam: Shell Store Separation

### What moves

Extract a new `Alpine.store('shell', shellObj)` that owns all app-level state that is not section-domain-specific. This is the lowest-risk first seam because:

1. Shell state has no section-specific data dependencies
2. Shell state is read by every section but mutated only by lifecycle code
3. The template already reads shell state through `$store.chat.navSection`, `$store.chat.session`, etc. — these become `$store.shell.navSection`, `$store.shell.session`
4. No domain logic changes. Only namespace moves.

### Shell store contents (move from `src/app.js` storeObj to new shell store)

```
# Identity and session
session
signingNpub (getter)
isLoggedIn (getter)
displayName (getter)
greetingName (getter)
avatarUrl (getter)
avatarFallback (getter)
extensionSignerAvailable
extensionSignerPollTimer

# Workspace context
backendUrl
ownerNpub
botNpub
selectedWorkspaceKey
currentWorkspaceOwnerNpub
knownWorkspaces
workspaceProfileRowsByKey
knownHosts
currentWorkspaceKey (from workspaceManagerMixin)
currentWorkspaceSlug (from workspaceManagerMixin)
workspaceOwnerNpub (from workspaceManagerMixin)
workspaceSettingsRecordId
workspaceSettingsVersion
workspaceSettingsGroupIds
workspaceHarnessUrl
hasHarnessLink (getter)

# Route and navigation
navSection
navCollapsed
mobileNavOpen
routeSyncPaused
popstateHandler
settingsTab

# Sync status (read-only UI indicators)
syncStatus
syncSession
sseConnected
catchUpSyncActive

# Global UI chrome
showAvatarMenu
showWorkspaceSwitcherMenu
error
loginError
isLoggingIn
appBuildId
```

### What remains in the domain store

Everything else. The existing `Alpine.store('chat', ...)` keeps all section arrays, domain methods, selection state, modals, editor buffers, and mixin-applied behavior. It can reference shell state via `Alpine.store('shell')` where needed (e.g. checking `navSection` for subscription gating).

### What stays shell-owned but executed through shell store methods

- `init()` — bootstrap sequence
- `initRouteSync()`, `syncRoute()`, `applyRouteFromLocation()` — route lifecycle
- `navigateTo()` — section switching (calls into domain store for `clearInactiveSectionData` and `startWorkspaceLiveQueries`)
- `startExtensionSignerWatch()` / `stopExtensionSignerWatch()`
- `maybeAutoLogin()` / login flows
- `selectWorkspace()` / workspace switching top-level coordination

---

## Template Touch Points

### index.html: $store.chat → $store.shell replacements

Every `$store.chat.*` reference that reads shell state must change to `$store.shell.*`. The affected patterns are:

| Pattern | Estimated occurrences | Replacement |
|---------|----------------------|-------------|
| `$store.chat.navSection` | ~40 | `$store.shell.navSection` |
| `$store.chat.isLoggedIn` | ~5 | `$store.shell.isLoggedIn` |
| `$store.chat.session` | ~15 | `$store.shell.session` |
| `$store.chat.backendUrl` | ~3 | `$store.shell.backendUrl` |
| `$store.chat.error` | ~5 | `$store.shell.error` |
| `$store.chat.loginError` | ~3 | `$store.shell.loginError` |
| `$store.chat.syncStatus` | ~3 | `$store.shell.syncStatus` |
| `$store.chat.navCollapsed` | ~5 | `$store.shell.navCollapsed` |
| `$store.chat.mobileNavOpen` | ~5 | `$store.shell.mobileNavOpen` |
| `$store.chat.hasHarnessLink` | ~3 | `$store.shell.hasHarnessLink` |
| `$store.chat.displayName` | ~3 | `$store.shell.displayName` |
| `$store.chat.greetingName` | ~2 | `$store.shell.greetingName` |
| `$store.chat.avatarUrl` | ~3 | `$store.shell.avatarUrl` |
| `$store.chat.avatarFallback` | ~2 | `$store.shell.avatarFallback` |
| `$store.chat.knownWorkspaces` | ~5 | `$store.shell.knownWorkspaces` |
| `$store.chat.selectedWorkspaceKey` | ~3 | `$store.shell.selectedWorkspaceKey` |
| `$store.chat.showAvatarMenu` | ~3 | `$store.shell.showAvatarMenu` |
| `$store.chat.showWorkspaceSwitcherMenu` | ~3 | `$store.shell.showWorkspaceSwitcherMenu` |
| `$store.chat.settingsTab` | ~5 | `$store.shell.settingsTab` |

**Approach:** Mechanical find-and-replace per property. Each replacement is independently verifiable.

### index.html: x-init change

Current: `x-init="$store.chat.init()"`
New: `x-init="$store.shell.init()"`

### Navigation click handlers

Current: `@click="$store.chat.navigateTo('tasks')"`
New: `@click="$store.shell.navigateTo('tasks')"` (navigateTo moves to shell)

---

## File Move Targets

### New files

| File | Purpose |
|------|---------|
| `src/shell-store.js` | Shell store definition, init, route lifecycle, workspace coordination |

### Modified files

| File | Change |
|------|--------|
| `src/app.js` | Remove shell state keys, remove init/route/nav methods, add cross-store bridge where domain store needs shell context |
| `src/main.js` | Register shell store before domain store, call `Alpine.store('shell').init()` |
| `index.html` | Replace `$store.chat.<shell-key>` with `$store.shell.<shell-key>` |
| `src/section-live-queries.js` | Read `navSection` and workspace context from `Alpine.store('shell')` instead of the domain store |
| `src/sync-manager.js` | Read `backendUrl`, `session`, workspace context from shell store |
| `src/workspace-manager.js` | Partial move — workspace identity getters move to shell, workspace CRUD actions stay or bridge |
| `src/unread-store.js` | Read `navSection` from shell store for section-read marking |

### Unchanged files

All translator files, `src/db.js`, `src/api.js`, `src/crypto/`, `src/auth/`, `src/worker/` — these have no direct store dependency.

---

## Ownership Boundaries After First Seam

### Shell store (`$store.shell`)

Owns: identity, workspace context, route, navigation, sync status indicators, global error, login flow, workspace switcher, build version.

Does not own: any domain array, any section detail state, any editor buffer, any modal except workspace connect/bootstrap.

### Domain store (`$store.chat`)

Owns: all section arrays (channels, messages, tasks, docs, etc.), all selection state, all domain methods (CRUD, optimistic writes, detail flows), all section-specific modals and editor state.

Reads from shell: `navSection` (for subscription gating and section-aware behavior), `session.npub`, `backendUrl`, workspace identity fields.

### Interaction pattern

```
Shell store                     Domain store
─────────────                   ─────────────
navigateTo(section)  ──────►   clearInactiveSectionData(section)
                     ──────►   startWorkspaceLiveQueries()
selectWorkspace()    ──────►   clearRuntimeData() + rehydrate

Domain store reads:
  Alpine.store('shell').navSection
  Alpine.store('shell').session
  Alpine.store('shell').backendUrl
  Alpine.store('shell').workspaceOwnerNpub
```

---

## Regression Risks

### Risk 1: Reactive dependency breaks

**What could break:** Alpine getters in the domain store that reference shell state (e.g. `this.session?.npub`) will no longer find it on `this`. They need to read from `Alpine.store('shell')`.

**Mitigation:** Grep for all `this.session`, `this.backendUrl`, `this.navSection`, `this.ownerNpub`, `this.selectedWorkspaceKey` references inside domain methods and getters. Replace with `Alpine.store('shell').<key>` or pass via method arguments.

**Test:** Existing test suite covers most domain methods. Add a cross-store bridge test that verifies domain store can read shell state.

### Risk 2: Template expression scope

**What could break:** `$store.chat.navigateTo(...)` becomes `$store.shell.navigateTo(...)`. If any template expression chains shell and domain calls in the same expression (e.g. `$store.chat.navigateTo('tasks'); $store.chat.loadJobDefinitions()`), the second call stays on chat but the first must move to shell.

**Mitigation:** Audit all `@click` handlers in `index.html` that call `navigateTo` alongside domain methods. Split into two calls: `$store.shell.navigateTo('tasks'); $store.chat.loadJobDefinitions()`.

**Test:** Grep-based test that verifies no `$store.chat.navigateTo` remains in `index.html`.

### Risk 3: Mixin application order

**What could break:** `workspaceManagerMixin` currently adds getters like `currentWorkspaceSlug` that reference `this.selectedWorkspaceKey`. If the mixin is split between shell and domain stores, the getter must land on the right store.

**Mitigation:** `workspaceManagerMixin` splits into two parts: identity getters (shell) and CRUD actions (domain). Or: identity getters become standalone functions called by both stores.

**Test:** Unit test for `currentWorkspaceSlug` verifying it works from the shell store.

### Risk 4: section-live-queries.js store reference

**What could break:** `buildWorkspaceSpecs(store)` reads `store.navSection` and `store.workspaceOwnerNpub`. After the split, `navSection` is on shell and `workspaceOwnerNpub` may be on shell.

**Mitigation:** `buildWorkspaceSpecs` takes explicit parameters or reads from `Alpine.store('shell')` directly.

**Test:** Existing `section-live-queries.test.js` should continue to pass.

### Risk 5: syncManagerMixin references

**What could break:** `syncManagerMixin` reads `this.backendUrl`, `this.session`, `this.navSection` for sync cadence decisions. These move to shell.

**Mitigation:** The sync mixin stays on the domain store but reads shell state via `Alpine.store('shell')`. Or sync cadence methods move to shell.

**Test:** Existing sync-manager tests.

---

## Test Plan

### Phase 1: Pre-extraction validation

1. Run `bun run test` — all currently passing tests must still pass after extraction.
2. Run `bun run build` — build must succeed.
3. Grep-based tests verify no stale `$store.chat.<shell-key>` references remain in `index.html`.

### Phase 2: Shell store unit tests

New test file: `tests/shell-store.test.js`

Coverage targets:
- Shell store exports expected state keys
- `init()` can be called without throwing
- `navigateTo()` updates `navSection` and calls domain store hooks
- Shell getters (`isLoggedIn`, `displayName`, `hasHarnessLink`) return expected shapes
- Route lifecycle methods exist and are callable

### Phase 3: Cross-store integration tests

New test file: `tests/store-bridge.test.js`

Coverage targets:
- Domain store can read `Alpine.store('shell').navSection`
- `section-live-queries` correctly gates subscriptions using shell `navSection`
- `syncManagerMixin` sync cadence reads shell state correctly
- Workspace switch correctly coordinates shell + domain state

### Phase 4: Template regression tests

Grep-based tests in existing test files:
- No `$store.chat.navSection` in `index.html`
- No `$store.chat.isLoggedIn` in `index.html`
- No `$store.chat.navigateTo` in `index.html`
- `$store.shell.init()` appears in `x-init`

### Test strategy for approach

Tests run against source files (not built output) so they execute in the normal `bun test` pipeline without requiring a dev server.

---

## Patch Order

### Step 1: Create `src/shell-store.js` with shell state and methods

- Extract shell state keys from `src/app.js` storeObj
- Move `init()`, route methods, navigation, login, extension signer watch
- Move shell-relevant workspace identity getters
- Register as `Alpine.store('shell', shellObj)` in `src/main.js`
- **Do not modify `index.html` yet.** Domain store temporarily proxies shell keys for backward compatibility.

**Validation:** `bun run test` passes. Both stores are registered. Domain store still works because proxies forward reads.

### Step 2: Add shell store tests

- `tests/shell-store.test.js` — unit tests for shell state and methods
- `tests/store-bridge.test.js` — cross-store coordination tests

**Validation:** New tests pass.

### Step 3: Update `index.html` template references

- Mechanical find-and-replace: `$store.chat.<shell-key>` → `$store.shell.<shell-key>`
- Split compound `@click` handlers that mix shell and domain calls
- Update `x-init` to call `$store.shell.init()`

**Validation:** `bun run build` succeeds. Grep tests confirm no stale references.

### Step 4: Remove proxy layer from domain store

- Remove forwarded shell keys from `src/app.js` storeObj
- Update domain mixins to read shell state via `Alpine.store('shell')`
- Update `section-live-queries.js` to read `navSection` from shell store
- Update `syncManagerMixin` to read `backendUrl`/`session` from shell store

**Validation:** `bun run test` passes. `bun run build` succeeds.

### Step 5: Clean up workspace-manager split

- `workspaceManagerMixin` identity getters (`currentWorkspaceKey`, `currentWorkspaceSlug`, `workspaceOwnerNpub`) move to shell store
- CRUD actions (`createWorkspace`, `removeWorkspace`, workspace profile saves) stay on domain store
- Bridge methods for workspace switching coordinate both stores

**Validation:** Full test suite passes. Manual smoke test of workspace switching.

### Step 6: Run build and manual verification

- `bun run build`
- Verify `dist/` output
- Manual browser test: login, navigate all sections, switch workspaces, verify sync status

---

## What This Does NOT Cover

This plan covers only the first seam: shell store extraction. It does not:

- Split the domain store into per-section stores (chat store, tasks store, docs store)
- Move template sections into separate files/components
- Change the subscription model
- Introduce projection tables
- Change the sync worker boundary
- Rename `$store.chat` to a better name for the domain store

Those are subsequent seams. The shell extraction is deliberately minimal so it can land safely and be validated before larger decomposition continues.

---

## Decision Record

**Decision:** Extract shell state first, not a section store.

**Rationale:** Shell state has the clearest ownership boundary and the fewest cross-dependencies. A section store extraction (e.g. chat store) would require splitting the subscription model, detail state lifecycle, and domain methods simultaneously — more risk for a first move.

**Alternative considered:** Extract the task board state first (it has its own mixin already). Rejected because task board state still heavily references `this.scopes`, `this.tasks`, and shell state. The dependency surface is larger than shell extraction.

**Alternative considered:** Start with template splitting (separate HTML files per section). Rejected because Alpine doesn't natively support template composition and the store namespace problem would still exist. Store split should precede template split.

---

## Current Metrics for Baseline

| File | Lines | Role |
|------|-------|------|
| `src/app.js` | 4,584 | Store definition + domain methods + shell lifecycle |
| `index.html` | 5,953 | Full template, all sections, all modals |
| `src/section-live-queries.js` | 448 | Subscription gating |
| `src/sync-manager.js` | 1,367 | Sync lifecycle mixin |
| `src/workspace-manager.js` | 1,074 | Workspace identity + CRUD mixin |
| `src/task-board-state.js` | 1,177 | Task board mixin |
| `src/docs-manager.js` | 1,538 | Docs domain mixin |
| `src/channels-manager.js` | 850 | Channels mixin |
| `src/flows-manager.js` | 891 | Flows/approvals mixin |
| `src/chat-message-manager.js` | 764 | Chat messages mixin |
| `src/scopes-manager.js` | 772 | Scopes mixin |

After shell extraction, `src/app.js` should drop by approximately 300–400 lines (shell state declarations, init, route methods, navigation, login flow). The new `src/shell-store.js` would be approximately 400–500 lines.

---

## How to Use This Note

A worker implementing the first seam should:

1. Read this note (you're doing that now)
2. Start at **Step 1** in the patch order
3. Use the **Shell store contents** list as the definitive move list
4. Use the **Template Touch Points** table for the `index.html` pass
5. Use the **Regression Risks** section to know what to watch for
6. Run `bun run test` and `bun run build` after each step
7. Do not proceed to section store decomposition in the same patch
