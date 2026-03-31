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

Two changes in `src/worker/sync-worker.js`:

1. **Skip pruning when nothing was pulled.** If `pulled === 0`, group membership
   cannot have changed, so there is nothing new to prune. The pruner is now only
   called when `pullResult.pulled > 0`.

2. **Throttle pruning to once per 30 seconds.** Even when records are pulled, the
   pruner now checks `Date.now() - lastPruneTime` against a 30-second minimum
   interval. This prevents back-to-back full scans during bursts of sync
   activity.

## Impact

- Eliminates the per-second IndexedDB scan overhead that caused UI jank.
- Pruning still fires within 30 seconds of any real data change, which is
  adequate for the access-revocation use case it was designed for.
- Existing access-pruner unit tests remain green; new throttle tests added in
  `tests/sync-pruner-throttle.test.js`.
