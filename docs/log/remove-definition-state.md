# Remove Definition State from Task Board

**Date:** 2026-03-31
**Scope:** Task board columns, task status selector, CSS styles

## Decision

Remove the "definition" state/column from the Flight Deck task board. This state was not actively used in the workflow and added unnecessary complexity to the kanban and list views.

## Changes

- **`src/task-board-state.js`**: Removed `'definition'` from the `computeBoardColumns` states array and its label entry.
- **`index.html`**: Removed the `<option value="definition">Definition</option>` from the task status `<select>` dropdown.
- **`src/styles.css`**: Removed three CSS rules: `.kanban-col-definition`, `.task-list-group-header.task-list-group-definition`, and `.state-definition`.
- **`tests/task-board-state.test.js`**: Updated `computeBoardColumns` test to expect five columns without definition, and added explicit assertion that definition is absent.

## Notes

- Tasks that already have `state: 'definition'` in the database are unaffected at the data level. They will not appear in any board column since no column matches that state. If migration is needed, it should be handled at the Tower level.
- The `stateColor` and `formatStateLabel` functions in `src/translators/tasks.js` never had explicit definition entries, so no changes were needed there.
