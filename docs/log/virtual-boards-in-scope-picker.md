# Virtual boards (Recent, All) in scope picker

## Decision

Include the `__all__` and `__recent__` virtual task boards in
`flightDeckScopeOptions` so they appear in both the hero page scope selector
and the left-hand nav scope control.

## Context

`taskBoards` already produced All, Recent, and Unscoped entries with
`level: 'system'`. The `flightDeckScopeOptions` getter filtered out every
board where `level === 'system'`, so neither All nor Recent appeared in the
hero/sidebar pickers.

## Change

Updated the filter predicate in `flightDeckScopeOptions` from:

```js
board.level !== 'system'
```

to:

```js
board.level !== 'system' || board.id === ALL_TASK_BOARD_ID || board.id === RECENT_TASK_BOARD_ID
```

This keeps Unscoped out of the picker (it is a contextual system board) while
surfacing the two user-facing virtual boards.

## Impact

- `filteredFlightDeckScopeOptions` and `filterFlightDeckScopeOptions` inherit
  the change automatically since they derive from `flightDeckScopeOptions`.
- Search text for All (`all tasks everything`) and Recent
  (`recent updated today`) was already defined in `getTaskBoardSearchText`, so
  query filtering works without further changes.
- No UI template changes needed; the pickers already render whatever
  `flightDeckScopeOptions` / `filteredFlightDeckScopeOptions` return.
