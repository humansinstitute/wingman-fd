# Decision: Enforce worker-only sync and automatic worker recovery

**Date:** 2026-04-06
**Task:** FD As-Built Remediation 01

## Context

The intended Flight Deck architecture is optimistic local writes plus worker-managed background flush and sync. The sync-worker-client.js module contained a local fallback path (`invokeLocally()`) that would silently run sync work on the main thread when the Web Worker was unavailable or crashed. This violated the desired product architecture and masked worker failures.

## Decision

1. **Remove the local fallback path entirely.** Deleted `invokeLocally()`, `getLocalWorkerModule()`, `localModulePromise`, and `primeRequestBaseUrl()`. The `setBaseUrl` import from `api.js` was also removed since it was only used by the local fallback.

2. **Add worker recovery with retry.** When `postMessage` fails (indicating the worker crashed between creation and the send), the client now resets the worker, creates a new one, and retries — up to 2 attempts (`MAX_RECOVERY_ATTEMPTS`). This handles transient worker crashes without falling back to main-thread execution.

3. **Surface explicit errors on worker unavailability.** If the Worker API is not available or recovery is exhausted, the client rejects with a clear error message noting that pending writes are preserved locally (in Dexie) and will sync when the worker recovers. This replaces the old silent degradation.

4. **Add `getWorkerStatus()` export.** Returns `'healthy'` or `'unavailable'` so callers can observe worker state.

## What was removed

- `invokeLocally()` — main-thread sync execution fallback
- `getLocalWorkerModule()` — lazy import of `sync-worker.js` for local use
- `localModulePromise` — cached dynamic import promise
- `primeRequestBaseUrl()` — only needed for local path
- `import { setBaseUrl } from './api.js'` — only consumer was removed code

## What was preserved

- The existing `handleWorkerError` → `resetWorkerInstance` → `rejectPendingRequests` flow still works for runtime crashes (error events from the worker). Callers get a rejection and can retry.
- Queued writes persist in Dexie regardless of worker state. The next successful worker startup will flush them.
- All existing tests continue to pass.

## Trade-offs

- Environments without Web Worker support (extremely rare in modern browsers) will now get an explicit error instead of silently degrading. This is the intended behavior — the app should not pretend sync works when it doesn't.
- The recovery retry adds a small delay on the rare path where postMessage fails, but this is far better than silently running heavy sync work on the main thread.
