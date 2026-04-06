# Design: SSE Push Updates for Real-Time Sync

**Status:** Draft
**Date:** 2026-04-01
**Depends on:** [target_alpine_dexie_archi.md](./target_alpine_dexie_archi.md), WP2 (Web Worker sync runtime)

---

## Problem Statement

Flight Deck currently polls Tower every 15 seconds (active section) or 30 seconds (idle) via `backgroundSyncTick()`. Each tick runs a full `performSync` cycle:

1. Refresh groups (conditional)
2. Flush pending writes
3. POST `/api/v4/records/heartbeat` with all family cursors
4. If stale families found → GET `/api/v4/records` per stale family
5. Decrypt + materialize each record into Dexie
6. Update unread summaries

Even when nothing has changed, this cycle costs:

- A signed NIP-98 request for the heartbeat
- Worker wake + message round-trip
- Dexie cursor reads for every family
- Alpine sync-status reactivity

At 15-second cadence that is ~5,760 sync cycles per day per tab. The vast majority return "nothing changed."

### What polling cannot fix

- **Latency floor.** Other clients see changes up to 15 seconds late. Chat feels sluggish.
- **Idle CPU.** The heartbeat cycle runs even when no data has changed, keeping the worker and main thread periodically hot.
- **Scaling cost.** Every connected client hits Tower on a fixed cadence regardless of activity. Tower bears O(clients × cadence) request volume even at rest.

## Proposal

Replace the poll-based inbound sync trigger with a **Server-Sent Events (SSE)** stream from Tower.

The SSE stream delivers lightweight change notifications. The client's Web Worker receives these notifications and pulls only the affected family, only when data actually changed.

The outbound write path (pending writes → worker flush → POST) is unchanged, except the flush interval can become more aggressive since inbound and outbound are now decoupled.

## Why SSE, Not WebSocket

| Concern | SSE | WebSocket |
|---|---|---|
| Data direction | Server → client (our primary need) | Bidirectional |
| Reconnect | Built into EventSource spec | Manual reconnect logic |
| Auth | Standard HTTP headers on connect | Requires auth in upgrade or first frame |
| Proxy/CDN | Works through standard HTTP infrastructure | Often needs special proxy config |
| Complexity | Simple text stream, native browser API | Frame protocol, ping/pong, close codes |
| Outbound writes | Use existing POST `/api/v4/records/sync` | Would duplicate the existing write API |

SSE is sufficient because the data flow is asymmetric: Tower pushes notifications, client pushes writes via existing REST endpoints. WebSocket adds bidirectional complexity with no current benefit.

## Architecture

### Stream Topology

One SSE connection per active workspace, owned by the Web Worker:

```
Tower
  │
  └─ GET /api/v4/workspaces/:owner_npub/stream
       │
       └─ SSE connection (long-lived, per workspace)
            │
            └─ Web Worker (EventSource)
                 │
                 ├─ echo suppression
                 ├─ family routing
                 ├─ targeted pull for active families
                 ├─ dirty-flag for inactive families
                 └─ postMessage status to main thread
```

### Event Shape

Tower emits lightweight notification events. These include enough metadata for the worker to decide whether a pull is needed, but do not include the full encrypted payload:

```
id: 1711929600123
event: record-changed
data: {"family_hash":"namespace:chat_message","record_id":"abc-123","version":3,"signature_npub":"npub1xyz...","updated_at":"2026-04-01T12:00:00.123Z","record_state":"active"}
```

Fields:

| Field | Purpose |
|---|---|
| `id` | Monotonic cursor for `Last-Event-ID` replay |
| `family_hash` | Which sync family changed |
| `record_id` | Which record (for targeted pull or echo match) |
| `version` | Record version — worker can compare against local Dexie row and skip pull if already current |
| `signature_npub` | Who signed the change (for echo suppression) |
| `updated_at` | Timestamp of the change |
| `record_state` | `active` or `deleted` — lets worker handle deletes without a pull |

The worker can skip the pull entirely if its local Dexie row for `record_id` already has `version >= event.version`. This avoids unnecessary round-trips for records the client already has (e.g., from a recent sync or optimistic local write).

The event does **not** include encrypted payloads. When a pull is needed, the client fetches the actual record through the existing `GET /api/v4/records` endpoint, which already enforces visibility and group-payload access.

### Additional Event Types

```
event: group-changed
data: {"group_id":"...","group_npub":"npub1...","action":"member_added|member_removed|epoch_rotated"}

event: heartbeat
data: {"ts":"2026-04-01T12:00:30Z"}
```

- `group-changed`: Triggers group refresh so the client picks up new keys/membership before pulling records.
- `heartbeat`: Tower sends every ~30 seconds to keep the connection alive and let the client detect stale connections.

## Authentication

### Connection Auth

NIP-98 is per-request and has a 300-second freshness window. SSE connections are long-lived. The solution uses the existing **workspace session key** infrastructure:

1. Client generates a short-lived **connection token**: a NIP-98-style signed event with:
   - `url` = the SSE endpoint URL
   - `method` = `GET`
   - `created_at` = now
   - Signed by the workspace session key (already registered with Tower)
2. Token is passed as a query parameter: `?token=<base64>`
3. Tower validates the token on connection open using `requireNip98AuthResolved()`, which already resolves workspace session keys to real user npubs.
4. Tower holds the resolved `userNpub` and `workspaceOwnerNpub` in connection state for the lifetime of the stream.

### Token Refresh

The initial NIP-98 token is validated once at connection time. The SSE connection stays open without re-authentication. If the connection drops, the client reconnects with a fresh token.

For long-lived connections (hours), Tower can optionally close the stream after a configurable max lifetime (e.g., 4 hours), forcing a clean reconnect with fresh auth.

### Workspace Session Key Dependency

This design assumes the workspace session key (`ws_key_npub`) is registered with Tower before SSE connects. The registration flow already exists:

```
bootstrapWorkspaceSessionKey()
  → registerWorkspaceKey({ workspace_owner_npub, ws_key_npub })
  → markWorkspaceKeyRegistered()
  → workspace key available for NIP-98 signing
```

SSE connection should only be attempted after `isWorkspaceKeyRegistered()` returns true. If registration fails (old Tower), fall back to poll-based sync.

## Echo Suppression

### Problem

When a client writes a record, the SSE stream will echo that change back. Without suppression, the client would re-pull and re-materialize its own write.

### Solution: Write-ID Set

1. When the worker flushes a pending write and gets a success response, it stores the `record_id + version` pair in a short-lived `Map` with a 30-second TTL.
2. When an SSE event arrives, the worker checks `echoSet.has(recordId + ':' + version)`.
3. If found → skip. The client already has this data from the optimistic local write.
4. If not found → process normally (pull the record).

```javascript
// In the worker
const echoSuppressionSet = new Map(); // key: "recordId:version", value: expiry timestamp

function markOwnWrite(recordId, version) {
  echoSuppressionSet.set(`${recordId}:${version}`, Date.now() + 30_000);
}

function isOwnEcho(recordId, version) {
  const key = `${recordId}:${version}`;
  const expiry = echoSuppressionSet.get(key);
  if (!expiry) return false;
  if (Date.now() > expiry) {
    echoSuppressionSet.delete(key);
    return false;
  }
  echoSuppressionSet.delete(key);
  return true;
}
```

### Multi-Tab Behavior

Tab A writes a record. Tab B (same user, same workspace) has a separate worker with a separate echo set. Tab B does **not** have the write in its echo set, so it pulls and materializes the record normally. This is correct — Tab B needs the update.

## Client-Side Design

### Worker SSE Lifecycle

The Web Worker manages the `EventSource` connection:

```javascript
// In sync-worker-runner.js or a new sse-client.js module in the worker

let eventSource = null;
let reconnectTimer = null;
let lastEventId = null;

function connectSSE(workspaceOwnerNpub, token, backendUrl) {
  disconnectSSE();

  const url = new URL(`/api/v4/workspaces/${workspaceOwnerNpub}/stream`, backendUrl);
  url.searchParams.set('token', token);
  if (lastEventId) url.searchParams.set('last_event_id', lastEventId);

  eventSource = new EventSource(url.toString());

  eventSource.addEventListener('record-changed', handleRecordChanged);
  eventSource.addEventListener('group-changed', handleGroupChanged);
  eventSource.addEventListener('heartbeat', handleHeartbeat);

  eventSource.onerror = () => {
    disconnectSSE();
    scheduleReconnect();
  };
}

function disconnectSSE() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}
```

### Event Handling and Debounce

SSE events arrive individually, but the worker should not pull per-event. Instead, it collects events into a short debounce window and pulls once per affected family.

This works because Tower's `GET /api/v4/records` already supports `since` cursor filtering per family. A single call returns all records updated after the cursor — whether 1 record changed or 30. The SSE events are just the **trigger** telling the worker which families to pull. The actual data comes through the existing REST endpoint.

**Example:** 50 SSE events arrive in 1 second across 3 families (30 chat, 15 tasks, 5 docs). Result: 3 HTTP requests, not 50.

```javascript
const DEBOUNCE_MS = 300;
let debounceTimer = null;
const staleFamilies = new Set();

function handleRecordChanged(event) {
  const data = JSON.parse(event.data);
  lastEventId = event.lastEventId;

  // Echo suppression
  if (isOwnEcho(data.record_id, data.version)) return;

  // Collect the stale family, don't pull yet
  staleFamilies.add(data.family_hash);

  // Reset debounce timer
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(flushStaleFamilies, DEBOUNCE_MS);
}

async function flushStaleFamilies() {
  debounceTimer = null;
  const families = [...staleFamilies];
  staleFamilies.clear();

  if (!families.length) return;

  // One pull per family — each call uses the existing since cursor
  // and returns ALL changed records in that family since the cursor.
  // No need to fetch individual record IDs.
  await pullRecordsForFamilies(ownerNpub, viewerNpub, families, {
    workspaceDbKey,
  });
}
```

The debounce window (300ms) is short enough to feel instant to the user but long enough to batch bursts. A rapid-fire sequence of 50 events settles into a single batch pull after the last event.

### Family Routing (Section-Aware Pull)

When section-scoped subscriptions are implemented (WP4), the debounce handler can route differently based on whether the family is currently active:

```javascript
async function flushStaleFamilies() {
  debounceTimer = null;
  const families = [...staleFamilies];
  staleFamilies.clear();

  const activeFamilies = [];
  for (const family of families) {
    if (isActiveSectionFamily(family)) {
      activeFamilies.push(family);
    } else {
      // Inactive section — mark dirty, pull on section switch
      markFamilyDirty(family);
    }
  }

  if (activeFamilies.length) {
    await pullRecordsForFamilies(ownerNpub, viewerNpub, activeFamilies, {
      workspaceDbKey,
    });
  }
}
```

This means navigating to Tasks after being in Chat only pulls task data if it was marked dirty while the user was away. No pull needed if no SSE events arrived for that family.

### Why No New Fetch Endpoint is Needed

Tower's existing `GET /api/v4/records` already supports everything the SSE client needs:

- `record_family_hash` — scopes to one family per request
- `since` — returns only records updated after the cursor (ISO timestamp)
- `limit` / `offset` — pagination for large result sets (default 200, max 1000)
- Visibility enforcement — owner sees all, non-owner sees group-accessible only

The worker already tracks `sync_since:${familyHash}` per family in Dexie. After a pull, it advances the cursor. The next SSE-triggered pull starts from the new cursor. No record-by-record fetching needed.

### Connection Start Semantics

The SSE stream is **live-only**. It does not replay history on connect.

The client must be caught up before opening the stream. The invariant is:

```
1. performSync()      → catch up via REST (pulls all stale families)
2. connectSSE()       → live updates from this moment forward
```

A fresh client (first load, new device, cleared cache) does a full `performSync()` first, then opens the stream. The stream starts delivering events from the moment of connection. The client never has to "work through" a backlog of stream history.

The `last_event_id` parameter exists for **reconnection after disconnect** — whether a network blip or 8 hours of sleep. Tower's in-memory ring buffer holds the most recent ~10k events (see Ring Buffer Eviction below). If the client's `Last-Event-ID` is still in the buffer, Tower replays the missed events and the client processes them normally — no full sync needed.

If the client's cursor has been evicted from the buffer (buffer full, or Tower restarted), Tower sends `event: catch-up-required` and the client falls back to `performSync()` before resuming the stream.

### Ring Buffer Eviction

The ring buffer is **size-based, not time-based**. It holds the most recent ~10k events regardless of when they occurred.

Why this matters: a quiet workspace overnight might produce only 5 events over 8 hours. Those 5 events sit comfortably in a 10k-slot buffer. When the user opens their laptop in the morning, the client reconnects with `Last-Event-ID`, Tower replays 5 events, the worker does 2-3 family pulls, and the user is caught up in under a second. A time-based policy (e.g., "discard events older than 5 minutes") would force a full sync for no reason in this scenario.

Eviction rules:

- Buffer is a fixed-size ring (oldest events dropped when full)
- No time-based expiry
- Buffer is cleared on Tower restart (unavoidable for in-memory storage)
- If the requested `Last-Event-ID` has been evicted → send `catch-up-required`

For a workspace with moderate activity (~100 events/hour), a 10k buffer covers roughly 4 days. For a very active workspace (~1000 events/hour), it covers ~10 hours. This means most overnight disconnects reconnect cleanly via replay.

### Catch-Up Sync UI Gate

When the client needs to do a full `performSync()` — initial load, long offline gap with expired cursor, or Tower restart — the app should show a **blocking overlay** so the user does not interact with stale or incomplete state.

The app already tracks sync progress (`syncSession` with phase, `syncProgressPercent()`, `syncProgressLabel()`) and renders a progress bar in the avatar menu. The change is to surface this prominently during catch-up scenarios:

```
┌──────────────────────────────────┐
│                                  │
│       Catching up...             │
│                                  │
│   ████████████░░░░░░░  65%       │
│   Fetching Tasks (4 / 11)        │
│                                  │
└──────────────────────────────────┘
```

**When to show the gate:**

- **Initial load:** First sync after login or workspace switch with no local data. Always show.
- **Catch-up after `catch-up-required`:** SSE reconnect failed cursor check, falling back to full sync. Show gate.
- **Short SSE replay:** Reconnect with `Last-Event-ID` that succeeds. No gate — the replay is fast (a few family pulls via debounce) and the user already has recent local data.

**When to dismiss:**

- `performSync()` completes successfully and SSE stream is connected.

**Implementation:** A simple Alpine reactive flag (`catchUpSyncActive`) set by the sync manager when a full catch-up sync begins, cleared when it completes. The overlay reads this flag and renders the existing `syncProgressPercent()` / `syncProgressLabel()` in a centered modal instead of the avatar dropdown.

### Reconnect and Catch-Up

SSE connections will drop (network changes, server restarts, laptop sleep). The reconnect strategy:

1. **Cursor still in buffer:** Reconnect with `Last-Event-ID`. Tower replays missed events, then continues live. Client debounces and pulls affected families. No UI gate needed — local data is recent, replay is fast.
2. **Cursor evicted or Tower restarted:** Tower sends `catch-up-required`. Client shows the catch-up sync gate, runs a single full `performSync()`, dismisses the gate, then reconnects SSE with no `Last-Event-ID` (starts fresh from now).
3. **Repeated failures:** Exponential backoff (1s, 2s, 4s, 8s, max 60s). After 5 consecutive failures, fall back to poll-based sync until the next successful connection.

```javascript
let reconnectAttempts = 0;

function scheduleReconnect() {
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 60_000);
  reconnectAttempts++;

  if (reconnectAttempts > 5) {
    // Fall back to polling
    postMessage({ type: 'sse-status', status: 'fallback-polling' });
    startPollFallback();
    return;
  }

  reconnectTimer = setTimeout(() => {
    requestFreshToken().then((token) => {
      connectSSE(ownerNpub, token, backendUrl);
    });
  }, delay);
}
```

### Visibility Handling

When the tab is hidden:

- Keep the SSE connection open (it is cheap — just a TCP connection receiving small text events).
- The worker continues receiving events and can batch dirty flags.
- On `visibilitychange` → visible: process any queued dirty families.

Closing SSE on tab hide would save a server connection but require a catch-up sync on every tab switch, which defeats the purpose.

### Aggressive Write Flush

With inbound sync decoupled from polling, the outbound flush timer can become more aggressive:

| Current | Target |
|---|---|
| Flush every 5 seconds | Flush every 2 seconds |
| Sync couples inbound + outbound | Outbound flush independent of inbound SSE |

The `FLUSH_INTERVAL_MS` in `sync-worker-runner.js` drops from 5000 to 2000. Writes land on Tower faster, SSE notifies other clients faster, end-to-end latency drops from ~20s (15s poll + 5s flush) to ~3s (2s flush + ~1s SSE delivery).

For even lower latency on explicit user actions, the UI can trigger an immediate flush via `postMessage` to the worker rather than waiting for the next timer tick.

#### Instant Flush Triggers

The following user actions should trigger an immediate flush rather than waiting for the 2-second timer:

- **Send chat message** — other participants should see it within ~1s
- **Create task / create channel / create doc** — collaborators see new items immediately
- **Task detail back/close with changes** — the back link becomes a "save & back" action. If the detail view has unsaved changes, closing it should save + immediate flush in one step. The user should not need a separate save button — navigating away is the save.
- **Doc editor back/close with changes** — same contract. Closing or navigating away from a dirty editor triggers save + immediate flush. This replaces reliance on the autosave timer for the critical "I'm done editing" moment.
- **Any detail view with inline edits** — the general rule is: if a detail pane has pending changes and the user navigates away, treat that navigation as the save intent and flush immediately.

The immediate flush is a `postMessage` to the worker:

```javascript
// Main thread, on save-triggering navigation
worker.postMessage({ type: 'sync-worker:flush-now' });
```

The worker responds by running `flushPendingWrites()` immediately instead of waiting for the next timer tick. If the flush is already in progress, the request is queued and runs after the current flush completes.

## Tower-Side Design

### New Endpoint

```
GET /api/v4/workspaces/:owner_npub/stream?token=<base64>&last_event_id=<cursor>
```

Response: `text/event-stream` with `Cache-Control: no-cache`, `Connection: keep-alive`.

### Auth Middleware

```typescript
// In routes/workspaces.ts or a new routes/stream.ts

app.get('/api/v4/workspaces/:owner_npub/stream', async (c) => {
  const token = c.req.query('token');
  if (!token) return c.text('Missing token', 401);

  // Validate NIP-98 token (same as existing auth, but from query param)
  const userNpub = await resolveNip98Token(token, c.req.url, 'GET');
  if (!userNpub) return c.text('Invalid token', 401);

  const ownerNpub = c.req.param('owner_npub');

  // Verify user has access to this workspace
  const hasAccess = await checkWorkspaceAccess(userNpub, ownerNpub);
  if (!hasAccess) return c.text('Forbidden', 403);

  // Open SSE stream
  return streamSSE(c, userNpub, ownerNpub);
});
```

### Change Detection

Tower needs to emit events when records change. Two options:

#### Option A: PostgreSQL LISTEN/NOTIFY

```sql
-- Trigger on v4_records insert
CREATE OR REPLACE FUNCTION notify_record_change() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('record_changes', json_build_object(
    'owner_npub', NEW.owner_npub,
    'family_hash', NEW.record_family_hash,
    'record_id', NEW.record_id,
    'version', NEW.version,
    'signature_npub', NEW.signature_npub,
    'updated_at', NEW.updated_at
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_record_change
  AFTER INSERT ON v4_records
  FOR EACH ROW EXECUTE FUNCTION notify_record_change();
```

Tower subscribes to `LISTEN record_changes` on a single persistent connection and fans out to connected SSE clients.

**Advantages:**

- Change detection is authoritative (database level)
- Works across multiple Tower instances (all listen on same channel)
- No application-level bookkeeping

**Disadvantages:**

- NOTIFY payload size limit (8000 bytes, but our payloads are small)
- Requires PostgreSQL (already the case)

#### Option B: Application-Level Event Emitter

```typescript
// In services/records.ts, after successful sync
import { sseHub } from '../sse-hub';

// After inserting records:
for (const record of insertedRecords) {
  sseHub.emit(record.owner_npub, {
    event: 'record-changed',
    data: {
      family_hash: record.record_family_hash,
      record_id: record.record_id,
      version: record.version,
      signature_npub: record.signature_npub,
      updated_at: record.updated_at,
    },
  });
}
```

**Advantages:**

- Simpler, no DB trigger setup
- Easy to add non-record events (group changes, etc.)

**Disadvantages:**

- Only works within a single Tower process
- If Tower scales to multiple instances, needs Redis pub/sub or similar

#### Recommendation

Start with **Option B** (application-level emitter). Tower currently runs as a single Bun process. If/when it scales to multiple instances, add Redis pub/sub or switch to LISTEN/NOTIFY. The SSE fan-out interface stays the same either way.

AGREED OPTION B is fine for this.

### SSE Hub

```typescript
// src/sse-hub.ts

type SSEClient = {
  userNpub: string;
  ownerNpub: string;
  controller: ReadableStreamDefaultController;
  connectedAt: number;
};

class SSEHub {
  private clients = new Map<string, Set<SSEClient>>(); // keyed by ownerNpub
  private eventId = 0;

  addClient(client: SSEClient) {
    const key = client.ownerNpub;
    if (!this.clients.has(key)) this.clients.set(key, new Set());
    this.clients.get(key)!.add(client);
  }

  removeClient(client: SSEClient) {
    this.clients.get(client.ownerNpub)?.delete(client);
  }

  emit(ownerNpub: string, event: { event: string; data: object }) {
    const clients = this.clients.get(ownerNpub);
    if (!clients?.size) return;

    this.eventId++;
    const payload = `id: ${this.eventId}\nevent: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;

    for (const client of clients) {
      try {
        client.controller.enqueue(new TextEncoder().encode(payload));
      } catch {
        this.removeClient(client);
      }
    }
  }

  getClientCount(ownerNpub?: string) {
    if (ownerNpub) return this.clients.get(ownerNpub)?.size ?? 0;
    let total = 0;
    for (const set of this.clients.values()) total += set.size;
    return total;
  }
}

export const sseHub = new SSEHub();
```

### Visibility Filtering

The SSE stream should only emit events the connected user can see:

- **Owner of workspace:** Sees all record changes for that workspace.
- **Non-owner (collaborator):** Should only see changes to records where they have group access.

For the initial implementation, **emit all workspace events to all connected clients for that workspace**. The client already enforces visibility when it pulls the actual record via `GET /api/v4/records` (which checks group access). A non-owner receiving a notification for a record they can't access will simply get an empty result on pull — harmless.

Future optimization: filter SSE events server-side by checking group membership, but this adds per-event query cost that may not be worth it initially.

### Last-Event-ID Replay

Tower needs to support cursor-based replay for reconnecting clients. The ring buffer is **size-based, not time-based** — it holds the most recent ~10k events regardless of age. This ensures quiet workspaces (e.g., 5 events overnight) can replay cleanly even after hours of client disconnection.

```typescript
// In-memory ring buffer (size-based eviction, sufficient for single process)
const EVENT_BUFFER_MAX = 10_000;
const eventBuffer: { id: number; ownerNpub: string; payload: string }[] = [];

function pushEvent(ownerNpub: string, payload: string, id: number) {
  eventBuffer.push({ id, ownerNpub, payload });
  // Size-based eviction — drop oldest when full
  while (eventBuffer.length > EVENT_BUFFER_MAX) {
    eventBuffer.shift();
  }
}

function canReplay(lastEventId: number): boolean {
  if (eventBuffer.length === 0) return false;
  return eventBuffer[0].id <= lastEventId;
}

function replayFrom(ownerNpub: string, lastEventId: number, controller: ReadableStreamDefaultController) {
  for (const event of eventBuffer) {
    if (event.id <= lastEventId) continue;
    if (event.ownerNpub !== ownerNpub) continue;
    controller.enqueue(new TextEncoder().encode(event.payload));
  }
}
```

If the requested `lastEventId` has been evicted from the buffer (buffer was full and it was dropped), Tower sends a special event telling the client to do a full catch-up sync:

```
event: catch-up-required
data: {"reason":"cursor_evicted"}
```

Buffer is also cleared on Tower restart, which triggers `catch-up-required` for any reconnecting client.

### Server Heartbeat

Tower sends a heartbeat event every 30 seconds to keep connections alive through proxies and load balancers:

```
event: heartbeat
data: {"ts":"2026-04-01T12:00:30Z"}
```

### Connection Limits

To prevent resource exhaustion:

- Max 10 SSE connections per user across all workspaces
- Max 50 SSE connections per workspace
- Max connection lifetime: 4 hours (force reconnect with fresh auth)
- Idle timeout: 5 minutes without client activity (but heartbeat keeps it alive)

## Integration with Target Architecture

### Relationship to Work Packages

| WP | SSE Impact |
|---|---|
| WP1 (Runtime Boundaries) | SSE stream is owned by the worker, not the main thread |
| WP2 (Web Worker) | SSE client lives in the worker. Worker receives events and decides what to pull |
| WP3 (Store Split) | No direct impact. SSE feeds the worker, not stores |
| WP4 (Section-Scoped Subs) | SSE + dirty flags make section scoping more effective. Inactive families are not pulled until navigated to |
| WP5 (Projections) | Worker can update projection tables on SSE events, not just on poll ticks |
| WP5.1 (Outbox Contract) | Outbound flush becomes more aggressive. Echo suppression ties into the outbox flow |
| WP7 (Unread) | Worker can update unread summaries immediately on SSE events instead of on 15s poll ticks |

### What SSE Replaces

| Current | With SSE |
|---|---|
| `backgroundSyncTick()` every 15/30s | SSE event triggers targeted pull |
| `POST /api/v4/records/heartbeat` every tick | Eliminated for connected clients |
| `getSyncCadenceMs()` fast/idle cadence | Replaced by event-driven wake |
| Full `performSync()` as primary path | `performSync()` becomes catch-up only (initial load, reconnect, manual refresh) |

### What SSE Does Not Replace

- `performSync()` still exists for initial load, reconnection catch-up, and manual sync button
- Pending write flush (outbound) stays as-is, just faster
- Dexie → Alpine liveQuery reactivity is unchanged
- Group refresh still happens on `group-changed` events or on reconnect
- Record decryption and materialization still happen in the worker

## Rollout Plan

### Phase 1: Tower SSE Infrastructure

1. Add `sse-hub.ts` with in-memory fan-out and ring buffer
2. Add `GET /api/v4/workspaces/:owner_npub/stream` endpoint with token auth
3. Emit `record-changed` events from `syncRecords()` in `services/records.ts`
4. Emit `group-changed` events from group mutation endpoints
5. Add server heartbeat (30s)
6. Add connection limits and max lifetime

### Phase 2: Worker SSE Client

1. Add `EventSource` connection management in the worker
2. Add echo suppression set
3. Wire `record-changed` → targeted `pullRecordsForFamilies()`
4. Wire `group-changed` → `refreshGroups()`
5. Wire `catch-up-required` → full `performSync()`
6. Add reconnect with exponential backoff
7. Add SSE status reporting to main thread

### Phase 3: Replace Poll with SSE

1. When SSE is connected, disable `backgroundSyncTick()` timer
2. Keep `performSync()` for initial workspace load and manual sync
3. Reduce flush interval from 5s to 2s
4. Add immediate flush trigger for explicit user actions
5. Add fallback: if SSE fails to connect, revert to poll-based sync

### Phase 4: Dirty Flags and Section Routing (with WP4)

1. Track active section families in the worker
2. On SSE event for inactive family → set dirty flag only
3. On section switch → pull dirty families
4. Eliminates unnecessary pulls for sections the user is not viewing

## Failure Modes

| Failure | Behavior |
|---|---|
| SSE connection drops | Reconnect with backoff + `Last-Event-ID`. Full sync if cursor expired |
| Tower restarts | All SSE connections close. Clients reconnect. Ring buffer lost → clients do full sync |
| Network partition | EventSource fires `onerror`. Backoff reconnect. Fall back to polling after 5 failures |
| Token expired (4h) | Tower closes stream. Client reconnects with fresh token |
| Worker crash | Main thread detects. Falls back to main-thread polling. Worker restart reconnects SSE |
| Malformed SSE event | Skip event, log warning. Do not disconnect |

## Metrics

### Tower-Side

- `sse_connections_active` (gauge, by workspace)
- `sse_events_emitted` (counter, by event type)
- `sse_replay_requests` (counter)
- `sse_replay_cursor_expired` (counter)

### Client-Side

- `sse_connected` (boolean, reported in sync status)
- `sse_events_received` (counter, by event type)
- `sse_events_suppressed` (counter, echo suppression hits)
- `sse_reconnects` (counter)
- `sse_fallback_to_poll` (counter)

## Resolved Questions

1. **Should SSE events include enough data for the worker to skip the pull entirely for simple updates?** Yes. The `version` field already enables this — the worker can compare against its local Dexie row and skip the pull if it already has the latest version. Target event shape should include a content hash or enough metadata for the worker to make this decision without a round-trip. This is a follow-on optimization after the initial SSE implementation is working.

2. **Should Tower filter SSE events by group visibility?** No, not initially. All workspace events go to all connected workspace clients. The pull endpoint already enforces visibility. A non-owner receiving a notification for a record they can't access gets an empty result on pull — harmless. Revisit if SSE volume becomes a concern.

3. **Should the SSE connection move to a separate Tower service?** No. Tower runs as a single Bun process and users are expected to run their own Tower instance. SSE stays in the same Hono process. See `docs/backlog.md` for the scaling note if this assumption changes.