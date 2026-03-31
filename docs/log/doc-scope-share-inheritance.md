# Doc scope share inheritance fix

## Decision

When assigning a scope to a document, directory, or creating a document inside a scoped directory, merge the scope's `group_ids` into the record's `shares` and `group_ids`. This ensures scope group members can access scope-tagged documents.

## Context

Documents were not inheriting scope default groups and shares. When a scope was assigned to a doc (via scope picker or inherited from parent directory), only the `scope_id`/`scope_lN_id` fields were set. The `shares` and `group_ids` arrays were left unchanged, meaning the document's encryption group payloads would not include the scope's groups.

This contrasted with task board assignment (`buildTaskBoardAssignment` in `task-board-state.js`), which correctly derived `shares` and `group_ids` from the scope's groups.

## Bug locations

1. **`updateDocScope()`** in `scopes-manager.js` — Only set scope assignment fields, did not update shares/group_ids.
2. **`createDocument()`** in `docs-manager.js` — Inherited shares from directory tree but did not merge scope's groups when scope was assigned via `defaultScopeAssignment`.
3. **`updateDirectoryScope()`** in `scopes-manager.js` — Same issue as `updateDocScope`.
4. **`moveDocItemToFolder()`** in `app.js` — When applying default scope from target folder, did not merge scope's groups.

## Fix

In all four locations, after determining the scope assignment, look up the scope's `group_ids`, build scope default shares via `buildScopeDefaultShares(getScopeShareGroupIds(scope))`, and merge them into the record's shares using `mergeDocShareLists`. Existing shares are preserved; scope group shares are added (not replaced).

## Files changed

- `src/scopes-manager.js` — `updateDocScope`, `updateDirectoryScope`
- `src/docs-manager.js` — `createDocument`
- `src/app.js` — `moveDocItemToFolder`
- `tests/doc-scope-shares.test.js` — New test file (16 tests)
