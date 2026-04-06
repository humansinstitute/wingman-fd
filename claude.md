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
- `src/worker/sync-worker.js`: background sync logic (materialization, flush, pull)
- `src/worker/sync-worker-runner.js`: Web Worker entrypoint — message handler, flush timer, SSE client
- `src/sync-worker-client.js`: main-thread client for communicating with the Web Worker
- `src/sync-manager.js`: sync lifecycle mixin (performSync, background sync, SSE orchestration)
- `src/translators/`: family-specific materialization and outbound payload logic
- `src/auth/`: signer and secure-store helpers
- `src/crypto/`: group key handling and workspace session keys
- `src/agent-connect.js`: Agent Connect export helpers
- `tests/`: unit and integration coverage
- `tests/e2e/`: browser-level checks
- `docs/tower-backend-prod.md`: backend deployment notes from the FD side
- `docs/design/`: architecture and design docs (SSE, Alpine+Dexie target, etc.)

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

## Build process

This is a Vite project. The source HTML is `index.html` at the project root. Vite builds into `dist/`.

- **`index.html`** (root) is the source template. Edit this for HTML changes.
- **`dist/index.html`** is the build output. Do not edit directly — it gets overwritten by `bun run build`.
- **`src/styles.css`** is the source CSS. It builds into `dist/assets/index-*.css`.
- **`src/worker/sync-worker-runner.js`** builds into `dist/assets/sync-worker-runner-*.js` as a separate chunk.

After any source change, always run `bun run build` to regenerate `dist/`. The app is served from `dist/`.

## Working rules

These rules exist because this repo has been damaged by agents taking
unauthorized destructive git actions, hiding work in `git stash`, and leaving
half-wired features that silently discarded user data. Follow them strictly.
If a rule blocks you, stop and ask — do not invent your own exception.

### Operating assumption: main is a shared multi-agent working surface

Pete works on `main` directly with multiple concurrent agent sessions. You
will never see the full picture of what other sessions are doing, have done,
or intend to do. Because of this, the foundational stance for every agent in
this repo is:

**Every file you find — tracked, untracked, modified, committed, in any
state — is presumed intentional and load-bearing. If it is here, it is
meant to be here.**

This assumption is stronger than "investigate before tidying". It means:

- **Do not delete, revert, refactor, consolidate, reorganize, rename, or
  "clean up" anything unless Pete has explicitly asked you to make that
  specific change in the current conversation.**
- **Do not remove "dead code", "unused imports", "orphaned helpers",
  "duplicate logic", or anything that looks like scaffolding.** You cannot
  tell the difference between dead code and another session's in-progress
  wiring. Assume it is in-progress wiring.
- **Do not "fix" files that are not directly part of the task you were
  given.** Drive-by fixes, style cleanups, lint corrections, and
  "while I was here" edits are all forbidden on this repo. If you notice a
  real problem, surface it to Pete and let him decide.
- **Do not touch files that look abandoned, broken, or inconsistent with
  surrounding code.** They may be mid-flight work from another session. Ask.
- **Do not assume your mental model of "how the code should look" matches
  reality.** Other agents are actively reshaping this repo in parallel. Your
  snapshot is stale the moment you took it.

The operating rule is simple: **if Pete would have to tell you "put that
back", you should not have touched it in the first place**. When Pete stops
complaining about lost code, the rule is working.

### Git safety — never without explicit, in-conversation user approval

Assume the user has *not* approved any of the following unless they told you to
do it, in this conversation, with full context. Prior approval for one risky
op is **not** blanket approval for others.

- **No `git revert`.** Not a single commit, not a chain. Reverting touches shared
  history and cascades silently. If you think a revert is needed, describe which
  commits, read each one with `git show`, summarize what will be undone, list
  any files that touch shared state (schema, sync families, translators, UI
  surfaces, worker dispatch), and wait for explicit approval. Prefer a surgical
  forward-fix over a revert whenever possible.
- **No `git reset --hard`, `git reset --soft` across commits, `git restore .`,
  `git checkout .`, `git clean -f`, `git clean -fd`.** These destroy working
  tree or history. Ask first, every time.
- **No `git stash`.** Ever. Stashes are invisible, transient, and have been
  dropped by mistake and by other agent sessions in this repo. If you need to
  set work aside, commit it to a WIP branch with a descriptive message, or
  leave it in the working tree and commit in topical steps. Never use stash
  as a hiding place. Never run `git stash drop`, `git stash clear`, or
  `git stash pop` under any circumstances.
- **No `git push --force`, `--force-with-lease`, or force push to `main`/`perf`.**
- **No `git rebase -i`, `git cherry-pick`, `git commit --amend`** on commits
  that already exist, except on an untouched local branch where you created
  every commit in the current session.
- **No `git branch -D`, no deleting tags, no deleting refs** (including
  `refs/recovery/*`, `refs/stash`, dangling refs).
- **No `--no-verify`, `--no-gpg-sign`, or any hook-bypass flag.** If a
  pre-commit hook fails, fix the underlying problem. If you cannot, stop and
  ask — never silence the hook.

### Commit discipline — no orphan scaffolding, no uncommitted piles

- **Commit frequently and topically.** Each commit is one coherent slice. Never
  accumulate more than a handful of modified files across a session. If you
  find yourself about to commit >10 files across >2 topics, stop and split.
- **Never leave orphan scaffolding.** A feature slice is "Dexie table +
  translator + mixin + UI + sync-family registration + test". If you add the
  sync-family entry, the Dexie table MUST exist in the same commit. If you add
  a translator, the worker dispatch MUST call it in the same commit. If you
  create a helper module, at least one consumer MUST import it in the same
  commit. A commit that "scaffolds" one piece while leaving its consumers or
  backing store absent is forbidden — this is the pattern that silently
  discarded CRM data earlier in this repo's history.
- **Never leave a session with a dirty working tree and silence.** Before
  wrapping up, `git status` must be clean, OR you must explicitly tell the user
  "I am leaving the following files uncommitted because X" and get
  acknowledgement. Silent hand-off of a dirty tree is banned.
- **`dist/` must match `src/` at every commit that ships UI changes.** Run
  `bun run build` before committing UI work; include the rebuilt `dist/` in
  the same commit or a clearly-labeled follow-up.

### Preservation — enforce the operating assumption

This section enforces the "every file is presumed intentional" stance above.

- **Modified or untracked files you did not create are another session's
  work in progress.** Do not delete, revert, stash, clean, or "organize"
  them. If they block your task, stop and ask Pete — he will tell you
  whether to wait, work around, or involve the other session.
- **Code that looks dead is not dead.** A helper with no visible consumers,
  a translator with no sync-family entry, a state field with no UI, a Dexie
  table with no table definition, a test for a function that "doesn't exist"
  — every one of these has been, in this repo's history, the visible half
  of an in-progress wiring that another agent or session was mid-completing.
  Treat every such finding as a prompt to ask, not to delete. The prior CRM
  loss happened because an agent deleted what looked like dead scaffolding.
- **Dangling git objects are evidence.** If `git fsck` shows dangling commits
  or trees, treat them as potentially lost work from another session. Pin
  with `git update-ref refs/recovery/<name> <sha>` before any destructive op.
  Never run `git gc` or `git prune` yourself.
- **Root-cause, don't paper over.** If a test fails, a build breaks, or a
  file looks wrong, understand *why* before changing anything. Never delete
  tests, comment out code, add empty `try/catch`, or hardcode values to make
  errors go away. Correct diagnosis beats fast "fixes" every time.
- **Never edit `.gitignore` to hide dirty state.** If files are inconvenient,
  commit them or ask what they should be.
- **Never rename, move, or reorganize files that are not the direct subject
  of the task.** Other sessions may have open work referencing the current
  paths.

### Planning and confirmation

- **State the plan before taking destructive or broad action.** For anything
  that touches >3 files, changes shared contract state, or involves any git
  operation from the "Git safety" list, describe what you will do and wait for
  approval. Users can always say "go ahead" — they cannot always unwind
  surprise changes.
- **When in doubt, stop and ask.** The cost of one extra question is trivial.
  The cost of one unauthorized revert or dropped stash has already been paid
  in this repo.

## Things to avoid

- Do not add Tower contract fields only in Flight Deck without updating Tower.
- Do not use the currently selected backend for data that belongs to a different known workspace.
- Do not bypass translators by rendering transport payloads directly.
- Do not make Flight Logs mandatory in browser flows.
- Do not leave `dist/` stale after source edits that affect the shipped app.
- Do not edit `dist/index.html` directly — edit `index.html` at the project root and rebuild.

## Validation

- `bun run test`
- `bun run build`

If the change affects real browser flow, add a note about whether a manual or Playwright pass is still needed.

## Tower deployment (dev)

Tower runs locally via Docker Compose. To rebuild and redeploy after Tower changes:

```bash
cd /Users/mini/code/wingmanbefree/wingman-tower
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

Health check: `curl http://127.0.0.1:3100/health`
