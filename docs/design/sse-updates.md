# Design: Flight Deck Sync Catch-Up, Cold-Start, and Recovery Policy

**Status:** Draft  
**Date:** 2026-04-22  
**Scope:** Flight Deck, Tower, and Yoke sync/runtime behavior  
**Related:** `wingman-fd/src/sync-manager.js`, `wingman-fd/src/worker/sync-worker-runner.js`, `wingman-tower/src/routes/stream.ts`, `wingman-tower/src/sse-hub.ts`, `wingman-yoke/src/sync.js`, `docs/log/wp4-sse-sync-messaging-contract.md`

---

## Problem

SSE is already the agreed primary live-update path. The current design problem is
not transport choice. It is continuity handling:

- when should Flight Deck resume from a previously seen stream position
- when should it do a bounded delta catch-up using existing family cursors
- when should it escalate to a real cold-start or full reconciliation
- how do we explain, log, and debug those transitions

Pete's observed failure mode is that normal wake, reconnect, and routine use on
mobile and laptop often feel like recovery mode or a cold re-read of record
families rather than a bounded catch-up from the last known good position.

The policy in this document makes **cold-start and full reconciliation the
exception**, not the default.

## Goals

1. Keep SSE as the default steady-state freshness path.
2. Persist enough local state that worker restarts, browser wake, and reconnects
   can resume cleanly.
3. Use bounded delta catch-up whenever continuity is still plausible.
4. Escalate to full reconciliation only on explicit continuity-break signals.
5. Detect linked-record integrity gaps without silently broadening every issue
   into a workspace-wide recovery.
6. Make recovery-mode entry observable and explainable.

## Non-goals

- Replacing Yoke with SSE. Yoke remains an explicit sync client.
- Pushing encrypted payloads over SSE. SSE remains advisory.
- Using wall-clock age alone as proof that continuity is broken.

---

## Current Runtime Gaps

The current runtime explains why recovery behavior appears too often:

1. `ensureBackgroundSync(true)` reconnects SSE too aggressively. Many UI and
   workspace paths call it, and `connectSSEStream()` is not idempotent, so
   normal navigation can tear down and reopen the stream.
2. `sseLastEventId` lives only in worker memory. A worker restart, tab reload,
   or mobile suspend loses the replay cursor even when local family cursors are
   still valid.
3. Flight Deck ignores the `connected` event payload from Tower. Tower already
   emits the current stream cursor, but the worker only updates its cursor from
   `record-changed` events. A quiet workspace can reconnect without any stored
   replay cursor.
4. `catch-up-required` currently schedules an ordinary background sync rather
   than an explicit continuity-break recovery path.
5. `lastSuccessAt` is overloaded. It is updated by write flush success, which is
   not the same thing as inbound continuity or read freshness.
6. The current catch-up overlay can be raised by a time threshold (`10 hours`)
   rather than by a real continuity-break signal.

Those gaps create false transitions from "healthy but briefly disconnected" into
"looks stale, reconnect, maybe full sync."

---

## Design Principles

1. **Continuity beats age.** A 12-hour sleep with a valid replay cursor is still
   resumable. A 30-second disconnect after a worker restart with no cursor may
   require delta catch-up.
2. **Persist both stream and family state.** SSE continuity and record-family
   progress are related but different.
3. **Make recovery layered.** Replay first, then bounded delta, then targeted
   integrity repair, then full reconciliation.
4. **Do not let UI timers define sync semantics.** Visibility, focus, and route
   changes may trigger checks, but they should not by themselves force
   reconnect/recovery.
5. **Target integrity gaps narrowly.** Missing children or linked records should
   trigger family-specific repair before workspace-wide recovery.

---

## Runtime State Machine

### State Summary

| State | Meaning | Entry signals | Exit path |
| --- | --- | --- | --- |
| `cold_start` | No trusted local sync baseline exists | empty local DB, no family cursors, manual full reset | `full_reconcile` |
| `stream_connecting` | Opening or reopening SSE | app start, reconnect, token refresh | `live`, `delta_catchup`, `polling_fallback`, `recovery_required` |
| `live` | SSE connected and continuity intact | successful `connected`, replay or no gap | stay live or move to `delta_catchup` on stream drop |
| `delta_catchup` | Resume via replay or heartbeat-bounded stale-family pull | replay requested, stream drop, worker restart with local cursors, short offline gap | `live`, `integrity_repair`, `polling_fallback`, `recovery_required` |
| `integrity_repair` | Targeted repair for missing linked records after bounded catch-up | parent/child/reference gap detected | `live` or `recovery_required` |
| `recovery_required` | Continuity is explicitly broken | Tower `catch-up-required`, corrupted local cursor state, repeated targeted repair failure | `full_reconcile` |
| `full_reconcile` | Broad workspace reconciliation | manual full sync, cold start, explicit recovery | `live` |
| `polling_fallback` | SSE unavailable but local state still usable | repeated reconnect failures, transient stream outage | `stream_connecting`, `delta_catchup`, or `recovery_required` |

### User-facing mapping

| UI state | Backing runtime states |
| --- | --- |
| normal live | `live` |
| reconnecting | `stream_connecting`, `delta_catchup`, `polling_fallback` |
| targeted repair | `integrity_repair` |
| recovery mode | `recovery_required`, `full_reconcile` |

The blocking catch-up overlay should be shown only for:

- `cold_start`
- `full_reconcile`
- user-invoked manual full sync
- explicit continuity break after `recovery_required`

It should **not** appear for normal replay-based resume or bounded stale-family
catch-up.

---

## Persisted State

Flight Deck already persists per-family `sync_since:<familyHash>` cursors. That
must remain the authoritative record-family watermark. The missing piece is a
persisted stream continuity record.

### Flight Deck persisted sync state

Store these keys in `sync_state`:

| Key | Purpose |
| --- | --- |
| `sync_since:<familyHash>` | latest fully applied timestamp per family |
| `sse:last_event_id` | highest acknowledged SSE event id |
| `sse:last_event_seen_at` | wall clock when that event was processed |
| `sse:last_connected_event_id` | `connected.event_id` from Tower |
| `sse:last_connected_at` | wall clock for the last successful stream connect |
| `sync:last_inbound_apply_at` | last time a remote pull materially applied data |
| `sync:last_outbound_flush_at` | last successful write flush |
| `sync:last_heartbeat_ok_at` | last successful heartbeat summary check |
| `sync:last_transition` | last runtime transition reason payload |
| `sync:last_recovery_reason` | latest reason that entered `recovery_required` or `full_reconcile` |

### What counts as acknowledging an SSE cursor

The worker should advance `sse:last_event_id` on every event that carries an
event id, not only `record-changed`:

- `connected`
- `record-changed`
- `group-changed`
- `heartbeat`
- `catch-up-required`

On initial connect, `connected.event_id` seeds the stream baseline even if the
workspace is quiet. That prevents a reconnect from starting with a null cursor.

### Yoke persisted state

Yoke remains a pull-based reconciler, but it should stay aligned with the same
family-watermark semantics:

- keep `sync:<family>:at` as the per-family watermark
- keep `sync:last_at`
- expose repaired/pruned counts and family watermarks in diagnostics so it can
  serve as a comparison baseline when Flight Deck claims it needed recovery

Yoke does not need an SSE cursor today.

---

## Transition Policy

### 1. Cold start

Enter `cold_start` only when at least one of these is true:

- the local workspace DB is empty for runtime families
- no `sync_since:<familyHash>` cursors exist
- the user explicitly requested a reset/full sync

Action:

- perform `full_reconcile`
- after apply, connect SSE
- persist `connected.event_id`

### 2. Routine focus resume, short sleep, reconnect, or network blip

These cases should **not** imply recovery on their own.

Action order:

1. If the existing stream is still healthy, do nothing.
2. If the stream must reconnect, reconnect with persisted `sse:last_event_id`.
3. If replay succeeds, process replay-triggered family pulls and return to
   `live`.
4. If replay cannot be attempted but family cursors exist, run heartbeat-based
   stale-family delta catch-up.

No blocking overlay. No full reconcile by age threshold alone.

### 3. Worker restart or browser process restart

If the worker restarts but the workspace DB still exists:

- reconnect using persisted `sse:last_event_id`
- if that cursor is missing but family cursors are present, use heartbeat delta
  catch-up rather than full reconcile

This is the critical distinction between:

- **stream continuity missing**
- **workspace baseline missing**

The former does not automatically imply the latter.

### 4. Explicit continuity break

Enter `recovery_required` only on concrete signals:

| Signal | Reason |
| --- | --- |
| Tower emits `catch-up-required` | replay cursor is no longer usable |
| Tower restart / stream epoch mismatch | replay continuity cannot be trusted |
| local cursor state is corrupted or regresses | client cannot prove incremental safety |
| repeated targeted integrity repair still fails for the same gap | bounded repair is insufficient |
| user clicks manual full sync | explicit operator override |

Action:

- record `sync:last_recovery_reason`
- show recovery UI
- run `performSync({ forceFull: true })`
- reconnect SSE and seed the new cursor from `connected.event_id`

### 5. Polling fallback

If SSE cannot reconnect after the configured retry budget:

- enter `polling_fallback`
- continue heartbeat summary checks and stale-family pulls on cadence
- do not force full reconcile merely because SSE is unavailable

Escalate from `polling_fallback` to `recovery_required` only if:

- heartbeat indicates cursor state is unusable
- stale-family pulls repeatedly fail
- an integrity gap persists after targeted repair

---

## Bounded Delta Catch-Up Rules

### Replay-first

If `sse:last_event_id` exists, Flight Deck reconnects with it first.

Expected Tower behavior:

- replay available: replay missed events, then emit `connected`
- replay unavailable: emit `catch-up-required`, then `connected`

Expected Flight Deck behavior:

- replay success: debounce stale families and pull only affected families
- replay unavailable: enter `recovery_required`

### Heartbeat-bounded delta

If no replay cursor is available but family cursors exist:

- run `POST /api/v4/records/heartbeat`
- pull only `stale_families`
- keep existing `sync_since:<familyHash>` semantics

This is still bounded catch-up. It is not cold start.

### No time-based auto-escalation

Remove "older than 10 hours" as a recovery trigger. Long offline duration may
change the *likelihood* of replay failure, but it is not itself proof that
continuity is broken.

Time should feed observability:

- `stale_for_ms`
- `offline_for_ms`
- `last_event_seen_at`

It should not directly force `full_reconcile`.

---

## Linked-Record Integrity Checks

Recovery mode must not hide missing linked records. It must make them visible
and repairable.

### Integrity invariants

After any bounded catch-up or full reconcile, the runtime should verify the
links touched by that sync batch:

| Source family | Required linked family | Example |
| --- | --- | --- |
| `chat_message` | `channel` | message without channel should not render as healthy |
| `chat_message` attachment refs | `audio_note` / storage metadata | visible voice-note message with missing note record |
| `comment` | target family row | comment exists but parent task/doc missing |
| `task` | parent task / flow / approval refs | task references step context not materialized |
| `document` / `directory` | parent directory | child appears before parent |

### Repair policy

Integrity repair should be narrow and ordered:

1. detect the missing edge
2. queue targeted family repair for only the relevant linked family or families
3. retry once with existing family cursors
4. if still missing, retry with a family-local force pull
5. escalate to `recovery_required` only if the same gap survives targeted repair

Examples:

- missing `audio_note` for a freshly visible message should queue
  `audio_note` repair, not full workspace sync
- missing comment target after a comment pull should queue the target family
  repair before broad recovery

### Integrity incidents must be observable

Every detected integrity gap should log:

- source record id
- source family
- missing linked family
- missing linked record id if known
- repair attempts
- final outcome

---

## Observable State and Instrumentation

The runtime should emit structured transition logs rather than only coarse
status strings.

### Flight Deck transition log

Emit a structured entry on every state transition:

```json
{
  "from": "live",
  "to": "delta_catchup",
  "reason": "visibility_resume_reconnect",
  "workspace_owner_npub": "...",
  "sse_last_event_id": 12844,
  "last_connected_event_id": 12850,
  "reconnect_attempt": 1,
  "document_hidden": false,
  "online": true
}
```

Minimum fields:

- `from`
- `to`
- `reason`
- workspace owner
- stream cursor values
- reconnect attempt count
- visibility / online state
- whether recovery UI is shown

### Tower stream diagnostics

Tower should log and count:

- `stream_connected`
- `stream_replayed`
- `stream_replay_unavailable`
- `stream_catch_up_required`
- earliest buffer id
- requested `last_event_id`
- current `event_id`
- resolved actor npub and workspace owner

### Key counters

Flight Deck:

- `sse_reconnect_attempts_total`
- `sse_replay_success_total`
- `sse_replay_miss_total`
- `delta_catchup_runs_total`
- `full_reconcile_runs_total`
- `integrity_repair_runs_total`
- `integrity_repair_escalations_total`
- `sse_reconnect_caused_by_duplicate_connect_total`

Tower:

- `sse_connections_active`
- `sse_replay_requests_total`
- `sse_replay_misses_total`
- `sse_catch_up_required_total`

Yoke:

- `sync_pruned_total`
- `sync_repaired_total`
- per-family watermark age in diagnostics

---

## Recommended Implementation Changes

### Flight Deck

1. Make `connectSSEStream()` idempotent. If workspace owner, viewer, backend,
   and token source are unchanged and the stream is already healthy, do not
   disconnect/reconnect.
2. Split "ensure timers/background sync" from "connect stream." Normal route or
   focus changes should not reopen SSE by default.
3. Persist `sse:last_event_id` and `sse:last_connected_event_id` in `sync_state`.
4. Parse `connected.event_id` and use it to seed the cursor.
5. Advance the cursor for every SSE event type that arrives with an event id.
6. Replace `lastSuccessAt` with separate inbound/outbound/heartbeat timestamps.
7. Make `catch-up-required` enter explicit `recovery_required` and run
   `performSync({ forceFull: true })`.
8. Remove the 10-hour wall-clock rule as an automatic recovery trigger.
9. Add targeted linked-record integrity repair before any workspace-wide
   escalation.

### Tower

1. Keep the ring buffer size-based, not time-based.
2. Keep `catch-up-required` as the authoritative continuity-break signal.
3. Extend diagnostics around replay success/failure and earliest available
   buffer id.
4. Consider adding a `stream_epoch` or equivalent restart marker so clients can
   distinguish buffer eviction from process restart in logs.

### Yoke

1. Keep per-family watermarks aligned with Flight Deck family semantics.
2. Surface repaired/pruned counts and family watermark age in `status`.
3. Use Yoke as the manual reconciliation baseline when debugging claims that
   Flight Deck entered recovery too aggressively.

---

## Expected Behavior By Scenario

### Mobile or laptop wakes after short sleep

- Flight Deck reconnects with persisted `sse:last_event_id`
- Tower replays if available
- worker pulls only affected families
- no blocking recovery UI

### Browser tab resumes after worker restart

- worker loads persisted stream cursor
- if absent, heartbeat checks stale families using family cursors
- no full reconcile unless Tower explicitly says continuity is broken

### Tower restarted while client slept

- reconnect receives `catch-up-required`
- Flight Deck records the reason, shows recovery UI, runs `forceFull`
- new `connected.event_id` becomes the fresh baseline

### Manual sync from the menu

- always run full reconcile
- preserve as explicit operator action

---

## Acceptance

This policy is correct when all of the following are true:

1. Routine focus, wake, and reconnect behavior on mobile and laptop stays in
   replay or bounded delta catch-up by default.
2. Full reconcile happens only on cold start, manual full sync, or explicit
   continuity-break signals.
3. Missing linked child records trigger targeted repair first, not silent broad
   recovery.
4. Logs and counters make it possible to explain exactly why recovery mode was
   entered for a given session.
5. Yoke remains a reliable manual reconciliation baseline with comparable
   per-family watermark semantics.

