# Chat Thread Dispatch To Flow Implementation Review

Date: 2026-04-22
Feature slug: `chat-thread-dispatch-to-flow`
Primary repo: `/Users/mini/code/wingmanbefree/wingman-fd`
Canonical design: `/Users/mini/code/wingmen/docs/feature-chat-thread-dispatch-to-flow.md`
Flight Deck review design: `/Users/mini/code/wingmanbefree/wingman-fd/docs/design/chat-thread-dispatch-to-flow.md`
Runtime contract: `/Users/mini/code/wingmen/docs/design/flight-deck-flow-dispatch-contract.md`

## Outcome

Implemented the approved Flight Deck flow-dispatch design for chat threads.

The message ellipsis popover now exposes `Dispatch to flow` from:

- main feed messages
- thread parent messages
- thread reply messages

The action opens a dedicated chat-origin modal that:

- resolves the canonical thread from the full in-memory channel message set
- selects a target flow
- resolves scope with the approved precedence: manual override, flow scope, channel scope, none
- materializes a full kickoff scope payload instead of mixing stale flow metadata
- renders an editable deterministic kickoff preview with provenance and transcript sections
- prevents silent overwrite after manual preview edits and exposes `Regenerate preview`

Kickoff creation still uses the normal flow-start task contract:

- `flow_id` set
- `flow_run_id = null`
- `state = new`
- assigned to the configured flow dispatch bot
- tagged with `flow_kickoff`
- normal flow reference retained

## Change Surface

Primary implementation files:

- `/Users/mini/code/wingmanbefree/wingman-fd/src/chat-thread-flow-dispatch.js`
- `/Users/mini/code/wingmanbefree/wingman-fd/src/chat-message-manager.js`
- `/Users/mini/code/wingmanbefree/wingman-fd/src/flows-manager.js`
- `/Users/mini/code/wingmanbefree/wingman-fd/src/task-flow-helpers.js`
- `/Users/mini/code/wingmanbefree/wingman-fd/src/app.js`
- `/Users/mini/code/wingmanbefree/wingman-fd/index.html`
- `/Users/mini/code/wingmanbefree/wingman-fd/src/styles.css`

Validation coverage:

- `/Users/mini/code/wingmanbefree/wingman-fd/tests/chat-thread-flow-dispatch.test.js`
- `/Users/mini/code/wingmanbefree/wingman-fd/tests/chat-channel-rendering.test.js`
- `/Users/mini/code/wingmanbefree/wingman-fd/tests/flows-step-types.test.js`

## Validation

Executed successfully:

```bash
bun test tests/chat-thread-flow-dispatch.test.js tests/chat-channel-rendering.test.js tests/flows-step-types.test.js
bun run build
```

Concrete evidence aligned to the design:

- UI entry points: `index.html` now wires `Dispatch to flow` into all three existing message-action popovers.
- Canonical thread resolution: `src/chat-thread-flow-dispatch.js` resolves the root and transcript from the full channel message collection, not visible slices.
- Dedicated modal: `index.html` renders a chat-origin dispatch dialog with flow selection, scope override, provenance summary, launch notes, and editable preview.
- Deterministic preview contract: `src/chat-thread-flow-dispatch.js` generates the exact `Dispatch Request`, `Source Provenance`, `Launch Notes`, `Dispatch Brief`, and `Thread Transcript` sections.
- Scope materialization: `src/chat-message-manager.js` uses stored-flow kickoff semantics for flow scope and `buildTaskBoardAssignment(...)` for override/channel/none cases.
- Runtime dispatch contract: `src/flows-manager.js` creates a normal kickoff task through `startChatThreadFlowDispatch(...)`; no new record family or Wingmen runtime path was added.

## Deviations

No contract deviations were required.

Notes:

- The stored flow-scope path intentionally matches the current `startFlowRun(...)` kickoff semantics.
- Manual override and channel fallback rebuild the scoped payload as a full assignment so stale flow policy/sharing data is not reused.

## Risks

- The modal depends on the currently synced channel message set. If a user dispatches before a recent remote message arrives locally, the transcript will reflect local state at dispatch time.
- The transcript truncation contract preserves the root and clicked message, but a pathological pair of very large required messages can still dominate description size.

## Recommendation

Recommend approval.

The UI contract, task contract, and Wingmen flow-dispatch compatibility all align with the approved design, and the implementation validates cleanly with focused tests and a production build.
