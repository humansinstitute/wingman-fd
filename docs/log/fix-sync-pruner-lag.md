# Fix: Sync pruner causing typing and button lag

## Problem

After commit `58f9bd0` (Prune inaccessible local records after sync), the access
pruner ran after every sync cycle — including cycles where the heartbeat reported
zero stale families and no records were pulled. Because the sync timer fires
every 1 second (`FAST_SYNC_MS = 1000`) on most pages, this meant the pruner
performed full `toArray()` scans across 8 IndexedDB tables plus cascading
message/comment checks every second on the main thread. These blocking reads
caused visible typing and button lag in Flight Deck.

## Root cause

`pruneAfterSync()` was called unconditionally in all three `runSync()` branches:
1. Heartbeat with 0 stale families (nothing changed)
2. Heartbeat with stale families but 0 records pulled
3. Full-pull fallback

This produced at minimum 9 full-table IndexedDB reads per sync cycle (1 for
groups + 8 for group-bearing tables), blocking the event loop ~1x/second.

## Fix

Three changes:

1. **Prune on login only.** A new `pruneOnLogin()` export in `sync-worker.js`
   runs immediately (bypassing cooldown) when a workspace is selected. This is
   called fire-and-forget from the app init flow after groups are loaded.
   (`src/sync-manager.js` → `runAccessPruneOnLogin()`, wired in `src/app.js`.)

2. **1-hour cooldown for sync-triggered pruning.** During normal sync cycles,
   pruning only fires if records were actually pulled (`pulled > 0`) AND the
   last prune was more than 1 hour ago. The timestamp is persisted in IndexedDB
   via `sync_state` (`access_prune_last` key) so it survives page reloads.

3. **Skip pruning entirely when nothing changed.** If the heartbeat reports 0
   stale families or the pull returns 0 records, pruning is skipped outright.

## Impact

- Eliminates the per-second IndexedDB scan overhead that caused UI jank.
- Stale access data is cleaned up at login and re-checked at most once per hour.
- Existing access-pruner unit tests remain green; new throttle + login tests
  added in `tests/sync-pruner-throttle.test.js` (9 tests).
