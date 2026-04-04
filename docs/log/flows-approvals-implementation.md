# Flows & Approvals — Flight Deck Implementation

**Date:** 2026-04-04
**Scope:** WP-FA2, WP-FA3, WP-FA4, WP-FA5, WP-FA6, WP-FA10

## Decisions

### 1. Separate mixin for flows/approvals (flows-manager.js)

Rather than adding ~300 lines of CRUD and approval action logic directly to app.js (already ~4460 lines), flow and approval management was extracted into `flows-manager.js` as a mixin. This follows the established pattern of `scopesManagerMixin`, `docsManagerMixin`, etc.

### 2. Dexie schema v5 for new tables

Added `flows` and `approvals` tables as a v5 migration. Extended `tasks` table indexes to include `*predecessor_task_ids, flow_id, flow_run_id, flow_step`. The v4 schema was preserved unchanged — v5 only adds the new tables and task index extensions.

### 3. Approval actions create local state immediately

`approveApproval`, `rejectApproval`, and `improveApproval` all follow the optimistic update pattern: update local Dexie + Alpine state first, then queue the pending write for sync. This is consistent with how tasks, comments, and other records work.

### 4. improveApproval creates a revision task

When a user clicks "Improve", the system creates a new task in `ready` state with flow context inherited from the approval. The task title is prefixed with "Revision:" and the decision note becomes the task description. The approval's `revision_task_id` is set to track the link.

### 5. Flow editor uses x-data for local form state

The flow editor modal uses Alpine's `x-data` for local form state (title, description, steps array). This avoids polluting the global store with transient form state. On save, it calls through to the store's `createFlow` or `updateFlow`.

### 6. Approvals surface on both landing page and flows section

Pending approvals appear in two places: (a) a compact card in the landing page's side panel, and (b) a full-width banner in the flows section. Both share the same `pendingApprovalsByScope` computed getter. The approval detail modal is shared between both views.

### 7. Task schema extended in sb-publisher

The task-v1.json schema was updated to include `predecessor_task_ids`, `flow_id`, `flow_run_id`, and `flow_step` as optional fields. This was necessary for the existing schema-sync validation test to pass with the new task fields. New flow-v1.json and approval-v1.json schema manifests are deferred to WP-FA1.

### 8. Sync family registration order

Flow and approval families were appended to the end of SYNC_FAMILY_OPTIONS to avoid changing the order of existing families. This is safe because the sync system identifies families by hash, not by array position.

## Files Changed

### New
- `src/translators/flows.js` — flow inbound/outbound translator
- `src/translators/approvals.js` — approval inbound/outbound translator
- `src/flows-manager.js` — Alpine store mixin for flow/approval CRUD
- `tests/flows-translator.test.js` — flow translator tests
- `tests/approvals-translator.test.js` — approval translator tests
- `tests/task-flow-extensions.test.js` — task extension tests
- `tests/flows-approvals-db.test.js` — DB and sync integration tests
- `tests/flows-manager.test.js` — mixin and utility tests

### Modified
- `src/translators/tasks.js` — added predecessor_task_ids, flow_id, flow_run_id, flow_step
- `src/db.js` — v5 schema, flows/approvals tables, helpers, clearRuntimeData
- `src/sync-families.js` — registered flow and approval families
- `src/worker/sync-worker.js` — materialization for flow and approval
- `src/app.js` — flows/approvals state properties, mixin registration
- `src/section-live-queries.js` — live queries for flows section and status approvals
- `src/styles.css` — CSS for approval cards, flow editor, detail modal
- `index.html` — flows nav item, flow list, flow editor, approval cards/detail
- `tests/sync-repair.test.js` — updated family list assertion
- `tests/sync-manager.test.js` — fixed chat.js mock for recordFamilyHash
- `tests/section-live-queries.test.js` — updated status section assertion
