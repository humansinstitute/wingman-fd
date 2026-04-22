# Chat Thread Dispatch To Flow

Status: step-1 implementation design
Last updated: 2026-04-22
Canonical source reviewed: `/Users/mini/code/wingmen/docs/feature-chat-thread-dispatch-to-flow.md`
Cross-repo contract reviewed: `/Users/mini/code/wingmen/docs/design/flight-deck-flow-dispatch-contract.md`
Primary artifact for this task: `/Users/mini/code/wingmanbefree/wingman-fd/docs/design/chat-thread-dispatch-to-flow.md`

Execution contract for this step: design only. Do not land the production
implementation or the final test suite in this pass. Minimal runtime and test
exploration was allowed to verify the current code, baseline behavior, and
board/task state before writing this document.

Board evidence gathered before planning:

- verified live task `4be222c9-b80f-4484-b95e-48029dc5e9a8` via
  `cd /Users/mini/code/wingmen && bun clis/wingman.ts board task show 4be222c9-b80f-4484-b95e-48029dc5e9a8`
- verified there were no prior board comments for this task in the local
  `.wingmen/board-state/yoke.db` cache before posting the execution-contract
  comment
- posted the execution-contract comment back to the board through the Wingmen
  CLI so downstream workers have an explicit repo, artifact, and validation
  contract attached to the task itself

This design intentionally reflects the live codebase as inspected on
2026-04-22. It supersedes the earlier lighter review copy by adding actual
baseline test results, the exact local helper seam already present in the repo,
and a precise implementation sequence.

## Proving Tests First

The implementation should be treated as correct only when the new pure-helper,
store-integration, and kickoff-write tests pass without regressing the existing
flow-dispatch contract.

### Baseline Tests Already Run

The following baseline commands were run during this design step:

- `cd /Users/mini/code/wingmanbefree/wingman-fd && bun test tests/chat-message-manager.test.js tests/flow-run-task-ux.test.js tests/flows-step-types.test.js tests/flow-reference-linkage.test.js`
- `cd /Users/mini/code/wingmen && bun test src/agent-chat/subscription-runtime.agent-work.test.ts src/agent-work/prompts.test.ts src/board/flow-orchestration.test.ts`

Observed result:

- Wingmen cross-repo validation passed cleanly.
- Flight Deck targeted validation passed except for one unrelated existing test
  failure:
  `tests/chat-message-manager.test.js` ->
  `sendMessage > schedules a chat-feed scroll after inserting the local pending row`
  failed with `Dexie DatabaseClosedError: MissingAPIError IndexedDB API missing`.

This matters for the next worker:

- do not treat that IndexedDB failure as caused by the chat-thread-dispatch
  feature
- keep the new proving tests isolated so feature failures stay readable
- rerun the existing baseline command after the implementation, but expect that
  one unrelated failure to persist unless it is fixed independently

### New Tests To Add First

Add these tests before landing the production change.

1. `tests/chat-thread-flow-dispatch.test.js`
   This should be the primary test file for the already-present
   `src/chat-thread-flow-dispatch.js` helper module.

   Add test coverage for:

   - `resolveChatThreadFlowDispatchThread(...)`
     - returns `null` when the clicked message does not exist
     - resolves a root message to a single-message thread
     - resolves a reply to the canonical root message
     - excludes deleted rows
     - returns messages sorted oldest to newest using `updated_at`
     - returns the same transcript set regardless of whether the clicked
       message is the root or a reply in the same thread
   - `resolveChatThreadFlowDispatchScope(...)`
     - manual override wins over flow scope and channel scope
     - flow scope wins over channel scope
     - channel scope wins when flow has no scope
     - `none` is returned when no scope exists
   - `normalizeChatThreadFlowDispatchScopeAssignment(...)`
     - normalizes null input into a fully empty scope payload
     - preserves group ids, shares, and `scope_policy_group_ids`
     - derives `write_group_ref` from `write_group_ref`, `board_group_id`, or
       the first `group_id`
   - `buildChatThreadFlowDispatchPreview(...)`
     - renders all required top-level sections in order:
       `Dispatch Request`, `Source Provenance`, `Launch Notes`,
       `Dispatch Brief`, `Thread Transcript`
     - includes literal body text, sender label, timestamp, and message id
     - adds attachment note suffixes like `[attachments: 2]`
     - truncation always preserves the canonical root message and the clicked
       message
     - emitted transcript is wrapped in `~~~text`

2. `tests/chat-message-manager.test.js`
   Extend the chat store integration tests instead of pushing more flow logic
   into `app.js`.

   Add test coverage for:

   - `openChatThreadFlowDispatch(recordId, sourceSurface)`
     - closes the message-actions menu
     - resolves `chatThreadFlowDispatchSource` with:
       `channelId`, `clickedMessageId`, `threadRootMessageId`, and
       `sourceSurface`
     - loads the canonical thread from `this.messages`, not from
       `visibleMainFeedMessages` or `visibleThreadMessages`
     - seeds `chatThreadFlowDispatchMessages` in oldest-to-newest order
     - initializes default selected flow and scope resolution state without
       mutating the existing `showFlowStartConfirm` path
   - `closeChatThreadFlowDispatch()`
     - resets all chat-thread-dispatch state fields
   - preview regeneration behavior
     - flow selection change updates preview while `dirty === false`
     - manual scope override updates preview while `dirty === false`
     - launch note edits update preview while `dirty === false`
     - manual preview edit sets `dirty === true`
     - later dependency changes set `previewStale === true` without
       overwriting user edits
     - explicit regenerate clears stale state and rebuilds preview
   - entry-point parity
     - dispatch from `main_feed`, `thread_parent`, and `thread_reply` all
       produce the same `threadRootMessageId` and ordered transcript for the
       same underlying thread

3. `tests/flows-chat-thread-dispatch.test.js`
   Add a new file rather than growing `tests/flows-step-types.test.js` even
   further. This keeps the kickoff-write contract focused and readable.

   Add test coverage for a new `flowsManagerMixin` wrapper such as
   `dispatchChatThreadToFlow(...)` or
   `createChatThreadFlowDispatchKickoffTask(...)`.

   Cover:

   - creates exactly one kickoff task
   - task title equals the selected flow title
   - task description equals the modal preview text verbatim
   - task `state === 'new'`
   - task `flow_id === selected flow id`
   - task `flow_run_id === null`
   - task `flow_step === null`
   - `flow_kickoff` tag is present
   - `references` include exactly one flow reference and preserve any
     additional intended references if added by the wrapper
   - assignee uses the existing default-dispatch-bot resolution
   - flow-scope path reuses the selected flow's existing scope semantics
   - manual-scope and channel-scope paths write a fully rebuilt, consistent
     scope payload:
     `scope_id`, lineage fields, `scope_policy_group_ids`, `group_ids`,
     `shares`, and `write_group_ref`
   - unscoped path writes the existing unscoped defaults rather than mixing in
     stale flow groups

4. Keep these existing proving tests green:

   - `tests/flow-run-task-ux.test.js`
   - `tests/flows-step-types.test.js`
   - `tests/flow-reference-linkage.test.js`
   - `src/agent-chat/subscription-runtime.agent-work.test.ts`
   - `src/agent-work/prompts.test.ts`
   - `src/board/flow-orchestration.test.ts`

### Test Order

The next implementation worker should use this order:

1. add `tests/chat-thread-flow-dispatch.test.js`
2. extend `tests/chat-message-manager.test.js`
3. add `tests/flows-chat-thread-dispatch.test.js`
4. make the Flight Deck production changes needed to satisfy those tests
5. rerun the targeted Flight Deck tests
6. rerun the Wingmen cross-repo contract checks
7. run `bun run build` in `wingman-fd`

## Investigation Findings

The planning step verified the following live code conditions.

### Flight Deck Current State

- `index.html` currently renders the message-actions popover in exactly three
  places:
  - main feed messages
  - thread parent message
  - thread replies
- each popover currently exposes only `Check sync status`
- `src/app.js` currently owns only the plain flow-start state:
  - `showFlowStartConfirm`
  - `flowStartTarget`
  - `flowStartContext`
- `src/chat-message-manager.js` currently owns:
  - thread open/close
  - message-actions-menu state
  - `inspectMessageSyncStatus(...)`
  - no chat-thread-dispatch modal lifecycle yet
- `src/flows-manager.js` currently exposes `startFlowRun(flowId, runContext)`
  which creates a kickoff task, but it currently copies the flow scope fields
  directly and hardcodes `shares: []`
- `src/task-board-state.js` already contains
  `buildTaskBoardAssignment(scopeId, fallbackTask)` which rebuilds a consistent
  scoped payload, including `shares`, `group_ids`, `scope_policy_group_ids`,
  and `board_group_id`
- `src/scope-policy-helpers.js` already contains the lower-level
  `buildScopedPolicyRepairPatch(...)` logic for scope-policy repair

### Newly Discovered Local Helper Seam

The target repo already contains an untracked file:

- `src/chat-thread-flow-dispatch.js`

This file already implements pure helpers for:

- dispatch state creation
- scope-source labels
- scope precedence resolution
- scope-assignment normalization
- canonical thread resolution from raw message rows
- deterministic preview generation
- transcript truncation while preserving required messages

Downstream implication:

- do not invent a second pure-helper location for preview or transcript logic
- treat `src/chat-thread-flow-dispatch.js` as the primary pure-logic seam for
  this feature
- prefer importing this helper into the Alpine store and chat mixin rather than
  copying its logic into `src/app.js`, `src/chat-message-manager.js`, or
  `src/task-flow-helpers.js`

### Wingmen Current State

Reviewed runtime files confirm that Flight Deck can still ship this as a normal
kickoff task:

- `wingmen/src/board/flow-orchestration.ts`
  - kickoff matcher remains `flow_id != null` and `flow_run_id == null`
  - the kickoff task becomes the parent task for the run
  - runtime enrichment appends additional run details to the kickoff
    description instead of replacing it
- `wingmen/src/agent-chat/prompt-templates.ts`
  - worker dispatch still treats the task description as durable source
    material
- `wingmen/src/agent-chat/subscription-runtime.agent-work.test.ts`
  - kickoff tasks route into flow dispatch instead of ordinary task dispatch
- `wingmen/src/agent-work/prompts.test.ts`
  - prompt rendering assumes the kickoff task description is already the
    correct operator-authored contract

Downstream implication:

- no Wingmen production code change is currently required for v1
- the Flight Deck implementation must preserve the existing kickoff-task shape
  exactly so Wingmen continues to consume it without changes

## Implementation Changes

The feature remains a Flight Deck-authored UI that packages a canonical chat
thread into a normal kickoff task. The main refinement from this investigation
is that the repo already contains the pure-helper module that should own the
description contract and transcript rules.

### User Flow

1. The user opens the ellipsis menu on a main-feed message, thread parent, or
   thread reply.
2. They choose `Dispatch to flow`.
3. Flight Deck resolves:
   - the clicked message
   - the canonical thread root
   - the full ordered thread transcript from the underlying channel message set
   - the source channel scope
4. A dedicated chat-origin flow-dispatch modal opens.
5. The user selects a flow and optionally overrides the scope.
6. Flight Deck resolves scope using the precedence rules below.
7. Flight Deck shows an editable kickoff-description preview generated from the
   deterministic helper.
8. The user can edit launch notes and, if needed, edit the preview directly.
9. On confirm, Flight Deck creates exactly one kickoff task.
10. Wingmen consumes that task through the existing flow-dispatch contract.

### Scope Resolution Rules

Scope precedence remains:

1. manual override
2. selected flow scope
3. source channel scope
4. no scope

The modal must show both:

- the resolved scope label
- the reason it was chosen:
  `Manual override`, `Flow scope`, `Channel scope`, or `No scope`

Before task creation, the resolved scope decision must be expanded into a fully
consistent task payload:

- `scope_id`
- `scope_l1_id`
- `scope_l2_id`
- `scope_l3_id`
- `scope_l4_id`
- `scope_l5_id`
- `scope_policy_group_ids`
- `group_ids`
- `shares`
- `write_group_ref`

Implementation rule:

- if the resolved scope comes from the selected flow and exactly matches the
  flow scope, the wrapper may reuse the flow's existing scope payload
- if the resolved scope comes from manual override or channel fallback, the
  wrapper must rebuild the scope payload from the chosen scope instead of
  mixing the new `scope_id` with the flow's stale groups or shares

### Description Contract

The kickoff description must be generated locally and stored directly on the
task record. The top-level sections must remain exactly:

- `Dispatch Request`
- `Source Provenance`
- `Launch Notes`
- `Dispatch Brief`
- `Thread Transcript`

Transcript rules:

- use literal message text, not a summary
- include timestamp, sender label when available, message id, and body
- append short attachment notes only, such as `[attachments: 2]`
- wrap the transcript body in `~~~text`
- if truncation is needed, always preserve:
  - the canonical thread root message
  - the clicked message

Preview regeneration rules:

- auto-regenerate while `chatThreadFlowDispatchDirty === false`
- once the user edits the preview manually, stop silent auto-overwrite
- when dependencies change after manual editing, set
  `chatThreadFlowDispatchPreviewStale === true`
- expose an explicit `Regenerate preview` action that rebuilds the preview and
  clears the stale marker

## Exact Files And Subsystems Expected To Change

### Flight Deck Files

- `index.html`
  - add `Dispatch to flow` to the main-feed message popover
  - add `Dispatch to flow` to the thread-parent popover
  - add `Dispatch to flow` to the thread-reply popover
  - add a dedicated chat-thread-to-flow modal
  - keep the existing flow-start confirmation dialog unchanged
  - add accessibility hooks:
    `aria-label`, visible labels, and `data-testid` on the new action and
    modal confirm/cancel controls

- `src/chat-thread-flow-dispatch.js`
  - keep this as the pure helper module
  - extend only if the existing exports are insufficient
  - preferred home for:
    - preview composition
    - transcript formatting
    - scope-source helpers
    - state factory
    - canonical thread resolution

- `src/app.js`
  - import `createChatThreadFlowDispatchState()` and spread or assign its state
    fields into the root Alpine store
  - keep the new state isolated from the existing flow-start confirm state
  - do not add large new inline helper bodies here; delegate to the helper file
    and mixins

- `src/chat-message-manager.js`
  - add the modal open/close lifecycle
  - add `Dispatch to flow` entry-point handlers
  - resolve the canonical thread from `this.messages`
  - resolve sender labels for the preview using existing people/profile helpers
  - own preview regeneration orchestration and stale/dirty toggling
  - own modal error/loading/submitting state

- `src/flows-manager.js`
  - add a dedicated kickoff-task creation wrapper for chat dispatch
  - preserve the existing `startFlowRun(...)` path for the plain flow-start UI
  - reuse:
    - `buildAttachFlowPatch(...)`
    - default dispatch assignee resolution
    - existing task upsert and pending-write flow
  - reuse scope materialization helpers instead of copying the current
    `startFlowRun(...)` direct-flow-field behavior

- `src/task-board-state.js`
  - likely no behavioral change outside reuse, but this is the primary existing
    helper seam for rebuilding scoped task payloads
  - if the wrapper cannot call it directly because of mixin boundaries, extract
    the minimum reusable helper rather than duplicating its logic

- `src/scope-policy-helpers.js`
  - only if a tiny pure helper extraction is needed for
    `flows-manager.js`
  - avoid broad refactors in this step; keep changes surgical

### Flight Deck Test Files

- `tests/chat-thread-flow-dispatch.test.js` (new)
- `tests/chat-message-manager.test.js` (extend)
- `tests/flows-chat-thread-dispatch.test.js` (new)
- `tests/flow-run-task-ux.test.js` (rerun only unless shared helpers move)
- `tests/flows-step-types.test.js` (rerun only unless shared kickoff helpers
  move)

### Wingmen Files To Review And Revalidate

Expected production code changes in `wingmen` for v1: none.

Still revalidate these files and tests because they define the downstream
contract:

- `/Users/mini/code/wingmen/docs/feature-chat-thread-dispatch-to-flow.md`
- `/Users/mini/code/wingmen/docs/design/flight-deck-flow-dispatch-contract.md`
- `/Users/mini/code/wingmen/src/board/flow-orchestration.ts`
- `/Users/mini/code/wingmen/src/agent-chat/prompt-templates.ts`
- `/Users/mini/code/wingmen/src/agent-chat/subscription-runtime.agent-work.test.ts`
- `/Users/mini/code/wingmen/src/agent-work/prompts.test.ts`

If the Flight Deck implementation reveals a contract mismatch during step 2 or
step 3, open that as a separate follow-up instead of silently changing Wingmen
runtime behavior in the same implementation pass.

## Detailed Implementation Sequence

Follow this sequence to minimise regressions.

1. Add the pure-helper tests in `tests/chat-thread-flow-dispatch.test.js`.
   This locks the deterministic contract first and prevents the modal work from
   hiding preview regressions.

2. Extend `tests/chat-message-manager.test.js`.
   Lock the UI/store orchestration next:
   entry points, thread resolution, dirty/stale preview behavior, and modal
   lifecycle.

3. Add `tests/flows-chat-thread-dispatch.test.js`.
   Lock the kickoff task write contract separately from the existing
   `startFlowRun(...)` tests.

4. Wire the state into `src/app.js`.
   Only import and initialize the new chat-thread-dispatch state. Avoid putting
   business logic here.

5. Wire the menu buttons and modal in `index.html`.
   Keep the markup changes narrow and ensure the existing flow-start modal still
   behaves exactly as before.

6. Implement the chat-side orchestration in `src/chat-message-manager.js`.
   Use `this.messages` as the canonical store, not visible slices.

7. Implement the kickoff-write wrapper in `src/flows-manager.js`.
   Use the selected preview text verbatim as the task description and reuse the
   existing task write pipeline.

8. Reuse scope rebuilding helpers.
   Prefer `buildTaskBoardAssignment(...)` or a minimal extracted pure helper so
   manual/channel scope fallback produces a self-consistent task payload.

9. Rerun the targeted tests and cross-repo checks.

10. Run the Flight Deck build and perform manual UI verification.

## Validation Commands

### Flight Deck

- `cd /Users/mini/code/wingmanbefree/wingman-fd && bun test tests/chat-thread-flow-dispatch.test.js`
- `cd /Users/mini/code/wingmanbefree/wingman-fd && bun test tests/chat-message-manager.test.js`
- `cd /Users/mini/code/wingmanbefree/wingman-fd && bun test tests/flows-chat-thread-dispatch.test.js`
- `cd /Users/mini/code/wingmanbefree/wingman-fd && bun test tests/flow-run-task-ux.test.js tests/flows-step-types.test.js tests/flow-reference-linkage.test.js`
- `cd /Users/mini/code/wingmanbefree/wingman-fd && bun run build`

Optional combined targeted run after the new tests exist:

- `cd /Users/mini/code/wingmanbefree/wingman-fd && bun test tests/chat-thread-flow-dispatch.test.js tests/chat-message-manager.test.js tests/flows-chat-thread-dispatch.test.js tests/flow-run-task-ux.test.js tests/flows-step-types.test.js tests/flow-reference-linkage.test.js`

### Wingmen Cross-Repo Contract

- `cd /Users/mini/code/wingmen && bun test src/agent-chat/subscription-runtime.agent-work.test.ts src/agent-work/prompts.test.ts src/board/flow-orchestration.test.ts`

### Board Evidence

- `cd /Users/mini/code/wingmen && bun clis/wingman.ts board task show 4be222c9-b80f-4484-b95e-48029dc5e9a8`

When the implementation is complete, add a concise board comment describing:

- which files changed
- which targeted tests passed
- whether the unrelated IndexedDB baseline failure remains

## Manual Browser Checks

These still matter even if all automated tests pass.

- open the message ellipsis in the main feed and confirm `Dispatch to flow`
  appears
- open the thread parent ellipsis and confirm `Dispatch to flow` appears
- open a thread reply ellipsis and confirm `Dispatch to flow` appears
- dispatch the same thread from all three surfaces and confirm the preview
  transcript is identical
- confirm the modal shows:
  - selected flow
  - resolved scope label
  - scope source reason
  - clicked message id
  - thread root id
  - message count
- edit launch notes and verify the preview auto-updates before manual preview
  edits
- edit the preview directly and verify later flow/scope changes mark the
  preview stale instead of silently overwriting it
- use `Regenerate preview` and verify the stale marker clears
- confirm the created kickoff task appears on the board as:
  - `state = new`
  - `flow_id` set
  - `flow_run_id = null`
  - assigned to the configured dispatch bot
- verify Wingmen still routes that kickoff task into flow dispatch

## Risks

- Cross-scope dispatch is still the sharpest risk. The feature is correct only
  if scope lineage, policy groups, shares, and write-group selection stay
  internally consistent.
- The target repo is already dirty and contains an untracked
  `src/chat-thread-flow-dispatch.js`. Downstream work must integrate with that
  file instead of overwriting or duplicating it.
- `src/app.js` is already large. Keep its change to state import/wiring only,
  or this feature will worsen the file-size problem called out in `AGENTS.md`.
- Preview dirty/stale behavior is easy to get subtly wrong and can silently
  discard operator edits if not locked by tests first.
- The existing unrelated IndexedDB test failure can hide new failures if the
  command surface is too broad. Use the targeted commands above.

## Fallback Plans

- If direct reuse of `buildTaskBoardAssignment(...)` from `flows-manager.js`
  becomes awkward because of mixin boundaries, extract the minimum pure helper
  needed for scoped task payload materialization. Do not duplicate the logic in
  a third location.
- If the modal wiring starts to bloat `src/chat-message-manager.js`, keep the
  pure preview/scope/thread logic in `src/chat-thread-flow-dispatch.js` and let
  `chat-message-manager.js` stay as orchestration only.
- If scope override or channel-scope fallback proves too risky during
  implementation, stop and split that into a follow-up rather than shipping a
  partially inconsistent scope payload. The lowest-risk fallback is
  flow-scope-only dispatch for v1.
- If the unrelated IndexedDB baseline failure interferes with combined test
  runs, keep using the narrower targeted commands and document that baseline
  failure explicitly in the board evidence.

## Non-Goals

- no production Wingmen runtime change for v1 unless a separate contract bug is
  discovered
- no new record family
- no Tower-side chat retrieval API
- no hidden orchestration in Flight Deck
- no auto-promotion of chat threads into work
- no `Dispatch to task` in the same change
- no AI summarization or LLM preprocessing step before kickoff creation
- no backend schema change
- no replacement of the existing plain flow-start button or its confirm dialog
- no broad refactor of `src/app.js` beyond the minimum state wiring needed for
  this feature
