# Scope Reset Investigation

## Problem Statement

The selected scope (task board) resets unexpectedly in two scenarios:
1. **Navigation**: moving between site sections (e.g. tasks -> chat -> tasks) can cause the scope to change
2. **Task creation/submission**: after creating a task via `addTask()`, the scope may reset to a different board

## Root Cause Analysis

### How scope selection works

- `selectedBoardId` (app state, line 286) holds the current scope board
- `persistSelectedBoardId()` saves to localStorage keyed by workspace slug
- `readStoredTaskBoardId()` reads from localStorage
- `validateSelectedBoardId()` checks if the current board still exists in `taskBoards`; if not, falls back to `preferredTaskBoardId`
- `preferredTaskBoardId` is a computed getter that picks the board with the most active tasks — this is **non-deterministic** from the user's perspective

### Root Cause 1: `validateSelectedBoardId` resets to `preferredTaskBoardId` when scopes haven't loaded yet

**Code path**: `navigateTo()` (line 1710) → calls `validateSelectedBoardId()` (line 1722) immediately.

`validateSelectedBoardId()` (task-board-state.js:630) checks if `selectedBoardId` exists in `this.taskBoards`. The `taskBoards` getter (line 327) filters from `this.scopes`. If scopes data is stale, partially loaded, or the live query hasn't fired yet, the current board ID won't be found, and the method falls back to `preferredTaskBoardId` — which picks whichever board has the most tasks.

This is especially problematic because:
- `taskBoards` is a computed getter derived from `this.scopes` (a reactive array)
- During live query updates via `applyScopes()`, there's a brief window where scopes may be empty or incomplete
- `validateSelectedBoardId` is called eagerly in multiple hot paths

### Root Cause 2: `performSync` triggers validation after task creation

**Code path**: `addTask()` (line 2630) → `performSync()` (line 2680) → `ensureTaskBoardScopeSetup()` (sync-manager.js:747) → `validateSelectedBoardId()` (task-board-state.js:768)

After creating a task and syncing:
1. Sync pulls fresh data and applies it to Dexie
2. Live queries fire, updating `this.scopes` (and thus `taskBoards`)
3. `ensureTaskBoardScopeSetup()` calls `validateSelectedBoardId()`
4. If the scopes list momentarily doesn't include the current board (race with live query), the board resets to `preferredTaskBoardId`
5. `preferredTaskBoardId` may now pick a **different** board because the task counts changed (the new task was just added to the current board, potentially shifting the "most tasks" calculation)

### Root Cause 3: `applyRouteFromLocation` falls back aggressively on popstate

**Code path**: browser back/forward → `popstate` → `applyRouteFromLocation()` (line 1384)

For tasks/calendar sections (line 1445-1455):
```js
this.selectedBoardId = route.params.scopeid
  || route.params.groupid
  || this.readStoredTaskBoardId()
  || this.preferredTaskBoardId;
```

If the URL doesn't contain a `scopeid` parameter (e.g., navigated to tasks from a non-tasks page where `buildRouteUrl` didn't write `scopeid`), and localStorage was updated by an intervening validation, the board jumps to whatever `preferredTaskBoardId` computes.

### Root Cause 4: Non-tasks sections don't preserve `scopeid` in URL

`buildRouteUrl()` (line 1343) only writes `scopeid` to the URL for `tasks`, `calendar`, and `reports` sections. When the user navigates to chat/docs/status, the URL has no `scopeid`. On returning via back-button (`popstate`), `applyRouteFromLocation` falls through to `readStoredTaskBoardId()` or `preferredTaskBoardId`.

## Summary of Reset Triggers

| Trigger | Code Path | Mechanism |
|---------|-----------|-----------|
| Nav to tasks/reports | `navigateTo()` → `validateSelectedBoardId()` | Board not found in stale `taskBoards` → falls back to `preferredTaskBoardId` |
| After task creation | `addTask()` → `performSync()` → `ensureTaskBoardScopeSetup()` → `validateSelectedBoardId()` | Race between live query update and validation; task count shift changes preferred board |
| Browser back/forward | `popstate` → `applyRouteFromLocation()` | URL lacks `scopeid`, falls through to non-deterministic preferred board |
| Scope live query fires | `applyScopes()` updates `this.scopes` | `taskBoards` getter recomputes; if validation runs during transition, board resets |

## Proposed Fix

### Option A: Guard `validateSelectedBoardId` against localStorage (recommended)

Make `validateSelectedBoardId` trust localStorage over the computed `preferredTaskBoardId`:

```js
validateSelectedBoardId() {
  if (!this.selectedBoardId) {
    // Try localStorage first before falling back to preferred
    const stored = this.readStoredTaskBoardId();
    this.selectedBoardId = stored || this.preferredTaskBoardId;
    this.persistSelectedBoardId(this.selectedBoardId);
    return;
  }
  // Allow special IDs without checking taskBoards
  if (this.selectedBoardId === ALL_TASK_BOARD_ID
    || this.selectedBoardId === RECENT_TASK_BOARD_ID) return;
  // Check if the board exists; if not, keep it anyway if it's in localStorage
  // (scopes may not have loaded yet)
  const exists = this.taskBoards.some((board) => board.id === this.selectedBoardId);
  if (!exists) {
    const stored = this.readStoredTaskBoardId();
    if (stored === this.selectedBoardId) return; // trust localStorage — scopes likely loading
    this.selectedBoardId = stored || this.preferredTaskBoardId;
    this.persistSelectedBoardId(this.selectedBoardId);
  }
}
```

**Why this works**: localStorage is a stable source of truth that doesn't depend on reactive state. If the user explicitly selected a board and it's persisted, we should trust it even if the scopes list is momentarily incomplete.

### Option B: Debounce validation after scope changes

Add a guard in `ensureTaskBoardScopeSetup` to skip validation if scopes haven't settled:

```js
async ensureTaskBoardScopeSetup() {
  if (this.taskBoardScopeSetupInFlight) return;
  if (this.scopes.length === 0) return; // don't validate against empty list
  // ... rest
}
```

### Option C: Preserve `scopeid` across all sections

In `buildRouteUrl()`, always include `scopeid` regardless of navSection, so back-navigation always has it.

## Recommended Approach

**Combine A + B + C**:
1. **A** fixes the core validation logic to not discard a known-good selection
2. **B** prevents empty-scopes races from triggering resets
3. **C** ensures URL-based navigation always carries the scope context

The fixes are small, surgical, and backward-compatible. Option A is the most impactful single change.

## Edge Cases

- **First visit with no localStorage**: `preferredTaskBoardId` is still the correct fallback — no change in behavior
- **Deleted scope**: If a scope is genuinely deleted, the stored ID will eventually be cleaned up when scopes finish loading and the board truly doesn't exist
- **Workspace switch**: `selectWorkspace` already calls `readStoredTaskBoardId()` per-workspace slug, so this is unaffected

## Open Questions

1. Should `preferredTaskBoardId` be cached to prevent re-computation on every access?
2. Should we add a `scopesLoaded` flag to distinguish "no scopes exist" from "scopes haven't loaded yet"?
3. Is the `ALL_TASK_BOARD_ID` option surfaced to users? If so, it might be a better default than the heuristic.
