# SSE-First Sync Default

**Date**: 2026-04-06
**Scope**: sync-manager.js, app.js

## Decision

Wire SSE as the default live refresh path, with heartbeat polling demoted to a
catch-up and recovery fallback.

## Rationale

The worker-side SSE client (`sync-worker-runner.js`) was already fully
implemented (event handling, echo suppression, debounced family pulls,
exponential backoff reconnect). The main-thread lifecycle never connected it,
leaving heartbeat-first polling as the only freshness path. This is wasteful
and adds unnecessary latency for live updates.

## Steady-State Sync Contract

1. **SSE (primary)**: On `ensureBackgroundSync()`, the sync manager connects
   SSE via `connectSSEStream()`. The worker receives `record-changed` and
   `group-changed` events and pulls stale families automatically.

2. **Heartbeat polling (catch-up)**: When SSE is connected, the background
   polling cadence widens to `SSE_HEARTBEAT_CADENCE_MS` (120 s). This serves
   as a safety-net reconciliation pass, not the primary freshness driver.

3. **Aggressive polling (fallback)**: If SSE disconnects or gives up after 5
   reconnect attempts (`fallback-polling`), cadence returns to `FAST_SYNC_MS`
   (15 s) / `IDLE_SYNC_MS` (30 s) section-aware polling.

4. **Full pull (recovery)**: On `catch-up-required` (cursor eviction from
   Tower's ring buffer), the manager sets `catchUpSyncActive = true` and
   triggers an immediate background sync tick that runs a full heartbeat +
   pull cycle.

5. **Token refresh**: When the worker needs a fresh token for reconnect
   (`token-needed`), the manager re-calls `connectSSEStream()` which reads
   the current `superbasedTokenInput`.

## Changes

- `sync-manager.js`: Added `connectSSEStream()`, `disconnectSSEStream()`,
  `handleSSEStatus()`, `isSSEConnected` getter. Modified `getSyncCadenceMs()`
  to return widened interval when SSE is connected. Modified
  `ensureBackgroundSync()` to connect SSE. Modified `stopBackgroundSync()` to
  disconnect SSE.
- `app.js`: Added `SSE_HEARTBEAT_CADENCE_MS: 120000` constant. Replaced
  vestigial `sseConnected`/`_sseConnecting`/`_sseCallbackRegistered` fields
  with single `sseStatus: 'disconnected'` state.

## What Was Not Changed

- `sync-worker-runner.js`: No changes needed. The worker-side SSE client was
  already complete.
- `sync-worker-client.js`: No changes needed. The `connectSSE()`,
  `disconnectSSE()`, and `setSSEStatusCallback()` exports were already wired.
- Recovery paths (heartbeat fallback, full-pull, worker crash recovery) are
  preserved and explicitly documented as fallbacks.
