# Wingman Flight Deck Agent Guide

Use this file for work inside `wingman-fd/`. Keep `agents.md` and `claude.md` identical.

## What this repo owns

`wingman-fd` is the browser client for Wingman Be Free.

It owns:

- browser UX and interaction flow
- Dexie schema and local materialized tables
- transport helpers for talking to Tower
- record translators and sync-family definitions
- background sync worker behavior
- workspace switching and workspace profile UX
- Agent Connect export and browser-side onboarding

It does not own:

- authority API semantics
- Tower database schema
- Yoke CLI behavior
- Flight Logs operational control

## Read this first

- repo purpose: `README.md`
- shared workspace framing: `../README.md`
- current architecture: `../ARCHITECTURE.md`
- implementation seams: `../design.md`
- main app state: `src/app.js`
- local DB: `src/db.js`
- Tower transport: `src/api.js`
- workspace normalization: `src/workspaces.js`

## Code map

- `src/app.js`: main Alpine state and user-facing orchestration
- `src/main.js`: app bootstrap
- `src/db.js`: Dexie schema and local persistence helpers
- `src/api.js`: signed requests and backend communication
- `src/workspaces.js`: workspace normalization and token-derived metadata
- `src/worker/sync-worker.js`: background sync worker
- `src/translators/`: family-specific materialization and outbound payload logic
- `src/auth/`: signer and secure-store helpers
- `src/crypto/`: group key handling
- `src/agent-connect.js`: Agent Connect export helpers
- `tests/`: unit and integration coverage
- `tests/e2e/`: browser-level checks
- `docs/tower-backend-prod.md`: backend deployment notes from the FD side

## Ownership by area

- workspace switching and profile hydration: `src/app.js`, `src/workspaces.js`, `src/db.js`
- asset and storage handling: `src/api.js`, `src/app.js`, `src/storage-payloads.js`
- chat/tasks/docs/comments/scopes translation: `src/translators/`
- sync family wiring: `src/sync-families.js`
- UI-only helpers: files like `src/channel-labels.js`, `src/page-title.js`, `src/task-calendar.js`

## Cross-app boundaries

Flight Deck consumes Tower’s contract. It must stay aligned with:

- `connection_token`
- workspace owner and backend origin fields
- group ID and epoch semantics
- storage object metadata and `content_url`
- record family hashes and payload schemas

When a shared field changes:

- update Tower first
- update Flight Deck translator and DB code second
- update Yoke in the same pass if the family is shared
- update published schemas in `../sb-publisher/schemas/flightdeck` if payload shape changed

## Design rules

- Render from Dexie-backed local state, not raw Tower responses.
- Prefer Dexie `liveQuery` subscriptions for persisted UI collections so Dexie is the reactive source and Alpine only holds view/UI state.
- Keep transport shape, local row shape, and rendered UI shape separate.
- Heavy sync, crypto, migration, and reconciliation work belongs off the main thread.
- Any workspace-aware asset lookup must be backend-aware.
- Preserve partial workspace metadata; do not erase good local state just because a remote payload is sparse.
- If the same record family exists in Yoke, keep payload compatibility explicit and tested.
- Preserve scroll position when live data changes; chat and thread panes should use scroll anchoring unless the user explicitly asked to jump to latest.

## Where to look for common tasks

- add or change a shared family:
  - translator in `src/translators/`
  - sync registration in `src/sync-families.js`
  - Dexie table shape in `src/db.js`
  - app usage in `src/app.js`
  - tests in `tests/`
- change workspace onboarding or token import:
  - `src/workspaces.js`
  - `src/superbased-token.js`
  - `src/app.js`
- change storage-backed media behavior:
  - `src/api.js`
  - `src/app.js`
  - `src/db.js`

## Things to avoid

- Do not add Tower contract fields only in Flight Deck without updating Tower.
- Do not use the currently selected backend for data that belongs to a different known workspace.
- Do not bypass translators by rendering transport payloads directly.
- Do not make Flight Logs mandatory in browser flows.
- Do not leave `dist/` stale after source edits that affect the shipped app.

## Validation

- `bun run test`
- `bun run build`

If the change affects real browser flow, add a note about whether a manual or Playwright pass is still needed.
