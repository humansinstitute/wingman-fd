# Remove inline task board scope selector

## Decision

Remove the redundant inline scope selector from the tasks board filter bar.
The sidebar scope picker (`flightDeckScopeOptions`) becomes the single source
of scope selection for the tasks view.

## Context

The tasks board had two ways to select a scope:

1. **Sidebar scope picker** — uses `filterFlightDeckScopeOptions()` with its own
   local `query` state. Excludes `Unscoped` (by design, since `flightDeckScopeOptions`
   filters out system boards except All and Recent).
2. **Inline board-selector** — embedded in the `task-filters-bar`, uses
   `filteredTaskBoards` (which includes Unscoped). Both call `selectBoard()`.

The inline selector duplicated scope selection that was already available in
the sidebar. Removing it simplifies the task board UI without losing core
functionality — the sidebar scope picker already covers All, Recent, and all
active scopes.

## Notes

- The Unscoped board option was only reachable via the inline selector. With
  this change, it is no longer directly selectable from the tasks board. The
  Unscoped option remains available in the schedules section's inline selector
  and through programmatic selection.
- The descendant toggle button remains in the filter bar — it controls task
  filtering depth, not scope selection.
- The `filteredTaskBoards` getter and `showBoardPicker`/`closeBoardPicker`
  methods are preserved because the schedules section still uses them.
- CSS for `.board-selector-inline` is retained for the schedules section.
