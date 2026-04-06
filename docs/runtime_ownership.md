# Flight Deck Runtime Ownership Contract

Status: working note
Last updated: 2026-03-31

This document is the narrow runtime boundary contract for the Alpine + Dexie rollout.
It exists so the performance workpackages can be dispatched independently without
overlapping ownership or reintroducing broad reactive churn.

## 1. Ownership Layers

### Root shell store

Owns only app-shell concerns:

- auth/session
- workspace selection
- route and nav state
- sync status and notices
- build/update state

The root shell store must not hold large workspace collections.

### Section stores

Each major section owns its own reactive slice:

- chat store
- tasks store
- docs store
- reports store

Section stores may hold:

- the active list projection for that section
- the active selection
- open detail state for that section
- local UI state needed by that section

Section stores must not become a second global root store.

### Local component state

Use component-local state for:

- modal flags
- editor buffers
- mention menus
- drag state
- ephemeral selection UI

### Worker

The worker owns background data movement and maintenance:

- outbox flush
- remote sync orchestration
- record fetch and normalization
- projection table updates
- unread summary maintenance
- sync status events back to the main thread

The worker does not render UI.

## 2. Subscription Ownership

Subscriptions should be mounted only for the currently visible section or detail target.

Default ownership:

- shared subscriptions: small cross-cutting data such as address book / profile cache
- chat subscriptions: channel list, selected channel messages, active thread replies
- tasks subscriptions: task projection, active task comments
- docs subscriptions: document browser projection, selected document comments
- reports subscriptions: report projection, selected report detail

Teardown rules:

- stop section subscriptions when the route changes away from that section
- stop detail subscriptions when the selected item changes
- do not keep inactive sections live just because the workspace is open

## 3. No LiveQuery Write-Back

`liveQuery` handlers are read-side subscribers only.

Allowed in handlers:

- assign the active store
- update local UI state
- schedule rendering side effects that stay in memory

Disallowed in handlers:

- writing back into Dexie
- mutating unrelated collections
- creating outbox entries
- kicking off sync loops
- normalizing and re-materializing data in the reader path

If a record needs normalization or projection work, do it in the worker or in an explicit maintenance job, not in a live reader.

## 4. Write Path

The write contract is:

`UI action -> section store action -> Dexie local row update + outbox row -> worker flush -> remote ack -> Dexie reconcile -> active section refresh`

This keeps UI updates optimistic while still making the worker the only runtime that talks to the remote sync transport.

## 5. Section Data Lifecycle

Domain arrays are cleared when the user navigates away from a section.
`clearInactiveSectionData(activeSection)` in `app.js` enforces this.

Data ownership by section:

- **chat**: `channels`, `messages`, `audioNotes`
- **tasks** (shared with calendar): `tasks`, `taskComments`
- **docs**: `documents`, `directories`, `docComments`
- **reports** (shared with status): `reports`
- **schedules** (shared with calendar): `schedules`
- **status**: `statusRecentChanges`
- **cross-cutting** (always live): `groups`, `scopes`, `addressBookPeople`

Data is re-populated via liveQuery subscriptions when the user navigates back.

## 6. Store Split Status

The root store currently holds all section state (1407 template references to `$store.chat`).
Full store split into `Alpine.store('tasks')`, `Alpine.store('docs')`, etc. requires
a dedicated template migration pass through `index.html` (4774 lines).

Current mitigation: `clearInactiveSectionData()` provides the memory boundary
without requiring template changes. The store split should happen as a separate
work package once the section-scoped subscription model is stable.

## 7. Worker Key Bridge

Group encryption keys are bootstrapped on the main thread and sent to the worker
via `sync-worker:bootstrap-keys` postMessage. Both sides hold keys in memory:
- Main thread: for outbound encryption during user writes
- Worker: for inbound decryption during sync pulls

The worker auth bridge supports `getPublicKey` and `signEvent`.
NIP-44 encrypt/decrypt bridge is not yet implemented — the main thread
decrypts wrapped keys and sends the raw nsec values to the worker.

