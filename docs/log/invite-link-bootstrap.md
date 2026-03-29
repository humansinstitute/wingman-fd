# Invite Link Bootstrap Fix

## Decision
Extract invite-link `?token=` handling into a dedicated `src/invite-link.js` module and fix the bootstrap flow so that arriving via an invite URL force-selects the invited workspace.

## Problem
When a user arrived at a Flight Deck URL with `?token=<connection_token>`, the token was parsed but the workspace was not reliably activated:

1. The init code used `this.currentWorkspaceOwnerNpub = this.currentWorkspaceOwnerNpub || config.workspaceOwnerNpub` — the `||` operator meant that if a different workspace was previously saved, the invite token's workspace was silently ignored.
2. After login/auto-login, the app could open the generic connect modal instead of connecting to the invited workspace.
3. Token extraction was inline in `init()` with no unit-test coverage.

## Solution
- Created `src/invite-link.js` with `extractInviteToken(href)` — parses the URL, validates the token, builds a workspace entry, and returns a clean URL without the token param.
- In `init()`, when an invite token is present, the code now **force-sets** `currentWorkspaceOwnerNpub` (no `||` fallback), ensuring the invited workspace is selected regardless of prior state.
- Added a `pendingInviteToken` flag to skip the saved-token fallback path when an invite was just applied.
- Added `token` to `parseRouteLocation()` params for completeness.
- The `pendingInviteToken` flag is cleared at the end of init.

## Files Changed
- `src/invite-link.js` — new module
- `src/app.js` — updated init bootstrap, added import and state field
- `src/route-helpers.js` — added `token` to parsed params
- `tests/invite-link.test.js` — 10 tests covering extraction, validation, clean URL, and override semantics
- `docs/log/invite-link-bootstrap.md` — this file
