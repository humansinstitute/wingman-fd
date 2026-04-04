# Flow-Run Task UX

**Date:** 2026-04-04
**Scope:** wingman-fd task detail panel, flow start confirmation

## Problem

Tasks linked to flows had no visible indication of their flow association in the task detail screen. Users could not:
1. See which flow a task is linked to
2. Provide run-specific context before starting a flow run
3. Attach or detach a flow from an existing task through the UI

## Decisions

### 1. Flow reference vs active run — two visual states

A task's flow linkage is displayed as a badge with two distinct states:
- **Reference** (flow_id set, no flow_run_id): shown with a link icon and "Reference" label in a neutral gray badge. Indicates the task is related to a flow but is not part of an active run.
- **Active run** (both flow_id and flow_run_id set): shown with a play icon and "Active run" label in a blue badge, with the step number. Indicates the task is being executed as part of a flow run.

This distinction was made explicit because the two states have different semantics — a reference is informational, while an active run implies execution context and step sequencing.

### 2. Launch context textarea in flow start confirmation

The flow start confirmation dialog now includes an optional "Run context" textarea. Text entered here is appended to the first task's description, separated by a horizontal rule and labeled as "Run context:". This allows the user to supply run-specific parameters (e.g. client name, target audience) without modifying the flow definition.

When no context is provided, the first task's description is the step description unchanged.

### 3. Attach/detach flow on existing tasks

The task detail panel includes a "Flow" field that:
- When no flow is attached: shows an "Attach flow..." button that opens a dropdown picker listing all active flows in the workspace.
- When a flow is attached: shows the flow badge and a clear ("x") button to detach.

Attaching a flow sets `flow_id` and adds a `{ type: 'flow', id }` reference. It does NOT generate a `flow_run_id` — the user is creating a reference, not starting a run. Detaching clears all flow fields and removes flow-type references.

### 4. Pure helpers in task-flow-helpers.js

All new logic was extracted into `src/task-flow-helpers.js` as pure functions:
- `getTaskFlowInfo(task, flows)` — derives display state
- `buildAttachFlowPatch(flowId, refs)` — builds a task patch for attaching
- `buildDetachFlowPatch(refs)` — builds a task patch for detaching
- `buildFirstStepDescription(stepDesc, runContext)` — merges launch context

This keeps the Alpine store methods thin and makes everything unit-testable.

## Files changed

- `src/task-flow-helpers.js` — new pure helper module
- `src/flows-manager.js` — `startFlowRun` now accepts `runContext` parameter
- `src/app.js` — imported helpers, added state and methods for flow picker/attach/detach
- `index.html` — flow linkage section in task detail, context textarea in flow start dialog
- `src/styles.css` — styles for flow badge, picker, and context field
- `tests/flow-run-task-ux.test.js` — 18 tests covering all helpers
