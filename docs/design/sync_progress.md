# Sync Progress Design

## Goal

Flight Deck needs visible sync feedback when the workspace is catching up with a large amount of remote data.

The UI should answer three questions clearly:

1. Is this workspace up to date?
2. Is a sync running right now?
3. If a sync is running, what stage is it in and how much work is left?

## Current gap

Today the avatar ring only reflects a coarse local state:

- `synced`
- `unsynced` for local pending writes
- `syncing`
- `quarantined`

That means the user cannot tell the difference between:

- local changes waiting to upload
- remote changes waiting to download
- a large sync currently in progress
- a sync that is checking for changes

The avatar menu also has no progress content. It only offers actions such as `Sync Now`.

## UX target

Use the avatar chip as the top-level sync indicator and expand the avatar menu into a small sync status panel.

Desired states:

- green ring: fully synced
- amber ring: stale or local changes pending
- blue ring: sync actively running
- red ring: quarantine or sync failure needs attention

Desired panel content:

- current status label
- last successful sync time
- current phase: `checking`, `pushing`, `pulling`, `applying`
- progress bar
- family progress, for example `4 / 10 collections`
- record progress when known, for example `82 / 240 records`
- current collection label, for example `Fetching tasks`

## Flight Deck changes

### 1. Add a first-class sync session state

Introduce a `syncSession` object in the Alpine store instead of relying on `syncing` plus `syncStatus` alone.

Suggested shape:

```js
{
  state: 'synced' | 'stale' | 'unsynced' | 'syncing' | 'quarantined' | 'error',
  phase: 'idle' | 'checking' | 'pushing' | 'pulling' | 'applying' | 'done' | 'error',
  startedAt: null,
  finishedAt: null,
  lastSuccessAt: null,
  currentFamily: null,
  completedFamilies: 0,
  totalFamilies: 0,
  pushed: 0,
  pushTotal: 0,
  pulled: 0,
  pullTotalKnown: null,
  error: null,
}
```

### 2. Instrument the sync worker

`src/worker/sync-worker.js` already has the right phases:

- flush pending writes in batches
- pull families sequentially
- materialize each fetched record locally

Add progress callbacks or emitted progress objects so `performSync()` can update `syncSession` live while keeping the current sync order intact.

### 3. Separate stale from unsynced

`unsynced` should keep its current meaning: local pending writes exist.

Add `stale` for: remote summary says one or more families are ahead of local cursors.

This is the state that should drive the amber avatar ring before a full sync starts.

### 4. Expand the avatar menu

Replace the current action-only popover with:

- compact sync summary block at the top
- progress bar and counts
- current family label
- last success or last error text
- existing action buttons below

## Relevant files

- `src/app.js`
- `src/worker/sync-worker.js`
- `src/api.js`
- `src/sync-families.js`
- `index.html`
- `src/styles.css`

## Dependency on Tower

Flight Deck can ship basic in-flight progress first using the existing sync loop.

To show a true pre-sync stale state without fetching full payloads, Flight Deck depends on a lightweight Tower summary endpoint described in:

- `wingman-tower/docs/design/sync_progress.md`
