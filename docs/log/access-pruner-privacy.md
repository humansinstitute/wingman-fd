# Access Pruner — Privacy-Aware Local Cache Pruning

**Date**: 2026-03-29
**Scope**: d5713ab5-3274-4507-b675-a3ca21d02717
**Task**: 5559f847-e8da-49b4-96d9-a2c8acfb0890

## Problem

After a user is removed from a group or loses scope access, the local IndexedDB cache still retains records they can no longer see on the server. These stale records remain visible in the UI until a full cache wipe.

## Decision

Implemented a post-sync access pruner (`src/access-pruner.js`) that runs after every sync cycle. The pruner:

1. **Collects accessible group IDs** by checking which groups the viewer is a member of
2. **Prunes group-bearing tables** (channels, scopes, tasks, documents, directories, reports, schedules, audio_notes) — any record whose `group_ids` don't intersect the viewer's accessible groups is deleted
3. **Cascades to child records** — messages for pruned channels, comments for any pruned target record
4. **Skips for the workspace owner** — the owner sees all records regardless of group membership
5. **Preserves unscoped records** — records with empty `group_ids` are kept (they represent unscoped/owner-level data)

## Alternatives Considered

- **Server-side reconciliation**: Ask the server for the canonical set of record IDs per family and diff against local. Rejected — too expensive and would require a new API endpoint.
- **Full cache wipe on group change**: Simple but destroys all local state, triggers a full re-sync.
- **Event-driven pruning** (prune only when groups change): Would miss edge cases where the server revokes access without a local group change event.

## Integration

The pruner runs inside `runSync()` in `src/worker/sync-worker.js`, after every pull phase. Errors are caught and logged so sync still succeeds even if pruning fails.

## Files Changed

- `src/access-pruner.js` — new module
- `src/worker/sync-worker.js` — calls pruner after sync pull
- `tests/access-pruner.test.js` — 16 unit tests
- `docs/log/access-pruner-privacy.md` — this file
