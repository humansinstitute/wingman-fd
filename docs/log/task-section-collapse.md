# Task Section Collapse

## Decision

Add collapsible sections to both kanban and list task views so users can hide sections they aren't focused on.

## Behavior

- **List view**: Clicking a group header (e.g. "New", "In Progress") toggles the task rows below. When collapsed, only the header with the count badge remains visible.
- **Kanban view**: Clicking a column header collapses the column to a narrow vertical strip (~2.2rem wide) with the label rendered as rotated text (writing-mode: vertical-rl) and the count badge. The column's state accent color moves from a bottom border to a left border on the strip.
- Collapse state is persisted per workspace in localStorage under the key `coworker:<slug>:collapsed-sections`.
- `computeBoardColumns` is unchanged — collapse is purely a UI concern handled by Alpine `x-show` directives and CSS.

## Files changed

- `src/task-board-state.js` — added `isSectionCollapsed`, `toggleSectionCollapse`, `persistCollapsedSections`, `readStoredCollapsedSections` to the mixin
- `src/app.js` — added `collapsedSections: {}` initial state, restore on login
- `index.html` — kanban column header click handler + `x-show` on body; list group header click handler + `x-show` on rows
- `src/styles.css` — `.kanban-column-collapsed` styles for narrow strip with rotated text and accent-colored left border
- `tests/task-section-collapse.test.js` — 12 tests covering toggle, persistence, JSON error handling, and column computation independence
