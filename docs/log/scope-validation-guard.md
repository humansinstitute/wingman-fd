# Scope validation guard during loading

## Decision

Added a `scopesLoaded` flag to prevent `validateSelectedBoardId()` from resetting a persisted scope-based board ID before scopes have finished loading from the database.

## Problem

During app init and workspace switching, `validateSelectedBoardId()` was called before `refreshScopes()` completed. With `this.scopes` still empty, the method could not find the persisted scope board in `taskBoards` and would reset the selection to a fallback (typically "All"). The same issue occurred after task creation or sync if scope data hadn't been refreshed in the same cycle.

## Approach

- Added `scopesLoaded: false` to app state, reset on workspace switch
- Set `scopesLoaded = true` in `applyScopes()` after scopes are loaded from DB
- Modified `validateSelectedBoardId()` to skip invalidation of non-system board IDs when `scopesLoaded` is false
- System boards (All, Recent, Unscoped) are always validated immediately since they don't depend on scope data

## Files changed

- `src/task-board-state.js`: guard in `validateSelectedBoardId()`
- `src/app.js`: added `scopesLoaded` state field
- `src/scopes-manager.js`: set `scopesLoaded = true` after applying scopes
- `src/workspace-manager.js`: reset `scopesLoaded = false` on workspace switch
- `tests/scope-validation.test.js`: new test coverage
