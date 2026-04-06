# Design: Filter Docs by Active Scope

**Task:** ebd8852d
**Status:** Revision 2
**Date:** 2025-03-25

---

## Problem Statement

Documents in Flight Deck currently show all docs for the workspace in a flat folder hierarchy. The only filtering available is a text search (`docFilter`). Unlike tasks — which can be filtered by scope via the board picker (`selectedBoardId` / `selectedBoardScope`) — docs have no scope-based filtering.

Users who organize docs under scopes (product / project / deliverable) cannot narrow the docs view to a single scope without manually navigating folder trees or relying on naming conventions. This is especially painful in workspaces with many products or projects where the doc list becomes long.

## Proposed Solution

Add a scope filter to the docs section that mirrors the task board scope picker pattern. When a scope is active, the docs browser only shows documents (and their containing directories) whose scope fields match the selected scope.

### Key Decisions

1. **Reuse the existing task board scope selection (`selectedBoardId`)** as the active scope context, rather than introducing a separate `docScopeId`. Rationale: the scope picker already exists, the user's mental model of "I'm working in this scope" should carry across sections, and it avoids duplicating picker UI/state.

2. **Scope filtering applies on top of folder navigation and text search.** The three filters compose: scope narrows the universe, folder navigation picks a subtree, text search matches within that.

3. **Include descendant matching by default.** When a product is selected, show docs scoped to that product and all its child projects and deliverables. This matches the `showBoardDescendantTasks` behavior but defaults to `true` for docs since folder-based browsing already provides narrowing. A toggle can be added later if needed.

4. **Show "Unscoped" and "All" pseudo-scopes** just like the task board, so users can view only unscoped docs or reset to the full view.

5. **Directory visibility is based on recursive child matching, not the directory's own scope fields.** A directory is shown if it contains at least one document (at any depth) that matches the active scope. A directory with no scope-matching descendants is hidden — even if the directory itself is scoped. This keeps the rule simple: scope filtering decides which *documents* are visible, and directories exist only to provide navigation structure to those documents.

## Data Model

No schema changes required. Documents already carry the four scope fields:

```
documents: 'record_id, owner_npub, parent_directory_id, sync_status, updated_at,
            scope_id, scope_product_id, scope_project_id, scope_deliverable_id'
```

Directories also carry these same fields in their local row shape.

## State Changes (app.js)

No new state properties. The docs scope filter reads directly from the existing `selectedBoardId`.

### New computed: `activeDocScope`

```js
get activeDocScope() {
  const id = this.selectedBoardId;
  if (!id || id === ALL_TASK_BOARD_ID || id === RECENT_TASK_BOARD_ID) return null;
  if (id === UNSCOPED_TASK_BOARD_ID) return { _unscoped: true };
  return this.scopesMap.get(id) || null;
}
```

### Modified computed: `currentFolderContents`

Currently returns all non-deleted docs/dirs matching `currentFolderId`. Add scope filtering — documents are matched by their own scope fields, directories are shown only if they contain a scope-matching descendant:

```js
get currentFolderContents() {
  const folderId = this.currentFolderId ?? null;
  const scopeFilter = this.activeDocScope;

  // Documents: filter by own scope fields
  const documents = this.documents
    .filter((item) => item.record_state !== 'deleted'
      && (item.parent_directory_id ?? null) === folderId
      && matchesDocScope(item, scopeFilter, this.scopesMap))
    ...

  // Directories: show only if a descendant doc matches the scope
  const directories = this.directories
    .filter((item) => item.record_state !== 'deleted'
      && (item.parent_directory_id ?? null) === folderId
      && directoryHasScopeMatch(item.record_id, this.documents, this.directories, scopeFilter, this.scopesMap))
    ...
}
```

### New helper: `directoryHasScopeMatch`

Recursive check — does this directory (or any nested subdirectory) contain at least one doc matching the scope? This is extracted into `doc-scope-filter.js` alongside `matchesDocScope`:

```js
export function directoryHasScopeMatch(directoryId, documents, directories, scopeFilter, scopesMap) {
  if (!scopeFilter) return true;  // "All" — no filtering, show everything
  const childDocs = documents.filter(d => d.record_state !== 'deleted' && d.parent_directory_id === directoryId);
  if (childDocs.some(d => matchesDocScope(d, scopeFilter, scopesMap))) return true;
  const childDirs = directories.filter(d => d.record_state !== 'deleted' && d.parent_directory_id === directoryId);
  return childDirs.some(d => directoryHasScopeMatch(d.record_id, documents, directories, scopeFilter, scopesMap));
}
```

### Modified computed: `filteredDocBrowserItems`

The recursive text-search walker also needs scope awareness. Documents are scope-filtered before text matching. Directories use the same `directoryHasScopeMatch` check — the existing `directoryHasMatch` function is extended to also require scope match:

## New Module: `src/doc-scope-filter.js`

Extract scope matching for docs into a small, testable module (following the `task-board-scopes.js` pattern):

```js
import { isTaskUnscoped } from './task-board-scopes.js';

/**
 * Check if a doc/directory matches the active scope filter.
 * Reuses the same scope field convention as tasks.
 */
export function matchesDocScope(record, scopeFilter, scopesMap) {
  if (!scopeFilter) return true;                         // "All" — no filtering
  if (scopeFilter._unscoped) return isDocUnscoped(record, scopesMap);

  const level = scopeFilter.level;
  const scopeId = scopeFilter.record_id;

  if (level === 'deliverable') {
    return record.scope_deliverable_id === scopeId;
  }
  if (level === 'project') {
    return record.scope_project_id === scopeId;
  }
  if (level === 'product') {
    return record.scope_product_id === scopeId;
  }
  return true;
}

export function isDocUnscoped(record, scopesMap) {
  return !record.scope_id
    && !record.scope_product_id
    && !record.scope_project_id
    && !record.scope_deliverable_id;
}
```

Note: `matchesDocScope` always includes descendants (a product filter matches project-level and deliverable-level docs under that product). This differs from the task board's `includeDescendants` toggle — intentionally simpler for v1.

## UI Changes (index.html)

### Scope indicator in docs toolbar

Add a scope pill/badge next to the search input showing the active scope, with a click to open the existing board picker or clear:

```html
<div class="docs-toolbar" x-show="!$store.chat.docsEditorOpen">
  <!-- NEW: scope pill -->
  <button
    class="docs-scope-pill"
    x-show="$store.chat.activeDocScope"
    @click="$store.chat.showBoardPicker = true"
    x-text="$store.chat.activeDocScopeLabel"
  ></button>
  <input class="docs-search-input" ... />
  ...
</div>
```

### Scope label computed

```js
get activeDocScopeLabel() {
  const scope = this.activeDocScope;
  if (!scope) return 'All docs';
  if (scope._unscoped) return 'Unscoped';
  return scope.title || 'Scoped';
}
```

### Reuse task board picker

The existing `showBoardPicker` modal and `boardPickerQuery` state can be reused. When the user picks a scope from the picker while on the docs section, it sets `selectedBoardId` (shared across sections). No new picker needed.

## Component Interaction Flow

```
User selects scope in board picker
  → selectedBoardId updates
  → activeDocScope recomputes
  → currentFolderContents recomputes (scope-filtered)
  → filteredDocBrowserItems recomputes (scope + text filtered)
  → UI re-renders with narrowed doc list

User clears scope (selects "All")
  → selectedBoardId = ALL_TASK_BOARD_ID
  → activeDocScope = null
  → all docs visible again
```

## Edge Cases

1. **Doc has no scope, scope filter is active:** Doc is hidden unless "All" or "Unscoped" is selected. This is correct — unscoped docs should not appear in a scoped view.

2. **Directory is scoped but contains only unscoped docs:** The directory is hidden. Directory visibility is determined solely by whether descendant docs match the scope — the directory's own scope fields are irrelevant for filtering purposes. Unscoped docs inside a scoped directory are not visible unless "All" or "Unscoped" is selected.

3. **Scope is deleted after being assigned to docs:** The doc's `scope_id` points to a missing scope. `scopesMap.get(id)` returns undefined. `matchesDocScope` won't match — the doc effectively becomes unscoped from a filtering perspective. The scope pill on the doc still shows the stale ID but that's a pre-existing issue not introduced by this change.

4. **Empty folder after scope filter:** A directory whose descendants all fail the scope check is hidden. Both `currentFolderContents` and `filteredDocBrowserItems` use `directoryHasScopeMatch` for this — same recursive pattern the text-search walker already uses for `directoryHasMatch`.

5. **Board picker opened from docs vs tasks:** The picker already works section-agnostically since `selectedBoardId` is shared state. No change needed.

6. **New doc creation while scope filter is active:** The new doc should inherit the active scope automatically. This follows the same pattern as tasks, where `selectedBoardId` is used for default scope assignment. Wire `selectedBoardId` into `openNewDocModal`.

7. **URL persistence:** The scope is already persisted via `scopeid` query param in the task route. Since we're sharing `selectedBoardId`, this carries over. If the user navigates directly to docs without a scope param, the last-used scope applies (via `readStoredTaskBoardId`).

## Files to Change

| File | Change |
|------|--------|
| `src/doc-scope-filter.js` | **New** — `matchesDocScope`, `isDocUnscoped`, `directoryHasScopeMatch` |
| `src/app.js` | Add `activeDocScope`, `activeDocScopeLabel`; modify `currentFolderContents` and `filteredDocBrowserItems` |
| `index.html` | Add scope pill to docs toolbar |
| `src/scopes-manager.js` | Wire active scope into new doc/directory creation defaults |
| `tests/doc-scope-filter.test.js` | **New** — unit tests for `matchesDocScope`, `isDocUnscoped` |
| `src/styles.css` | `.docs-scope-pill` styling |

## What This Does NOT Change

- No Dexie schema migration
- No translator changes
- No new sync families
- No Tower API changes
- No changes to how scopes are assigned to docs (that already works)
- No independent docs-only scope picker (v2 if needed)

## Open Questions

1. **Should the scope pill show in the docs toolbar or should we add a full board picker dropdown?** Current proposal: minimal pill that opens the existing board picker. A dedicated dropdown is heavier but might be clearer.

2. **Should "Recent" pseudo-scope apply to docs?** Tasks have a "Recent (24h)" view. Docs could too, but it's not directly related to scope filtering. Defer unless requested.

## Testing Plan

- Unit tests for `matchesDocScope` covering all scope levels and edge cases
- Unit tests for `isDocUnscoped`
- Unit tests for `directoryHasScopeMatch` — nested dirs, empty dirs, mixed scoped/unscoped children
- Manual verification: select a product scope, confirm only docs with that product's scope chain appear
- Manual verification: select "Unscoped", confirm only unscoped docs appear
- Manual verification: text search within a scoped view narrows correctly
- Manual verification: new doc created while scope is active inherits that scope
- Manual verification: empty directories are hidden when scope filter eliminates all their contents
