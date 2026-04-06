# Design: Doc Comments — Multiple Root Threads on Same Anchor Line

**Task:** ae9d8afa
**Status:** Design
**Date:** 2025-03-25

---

## Problem Statement

When multiple doc comments share the same anchor line (i.e., multiple independent root comments on the same block), only the first comment's thread is accessible through the UI. The badge count shows the correct total (all root comments + replies), but the user can only view the **first** root thread — the remaining root comments and their replies are invisible.

The task title says "only the first 2 comments" render, which likely means one root comment + one reply (the thread view), giving the appearance of 2 entries. All other root comments on that block are unreachable.

## Root Cause Analysis

The bug is a **UI navigation problem**, not a data/storage problem. All comments are loaded correctly into `this.docComments`. The issue is in how the gutter trigger button and thread panel interact:

### 1. Gutter trigger always selects the first root comment

`index.html:1768`:
```js
@click.stop="$store.chat.getDocCommentsForBlock(block).length > 0
  ? $store.chat.selectDocCommentThread($store.chat.getDocCommentsForBlock(block)[0].record_id)
  : $store.chat.openDocCommentModal(block)"
```

`getDocCommentsForBlock(block)[0]` — this always selects the **first** root comment. There is no way to navigate to the 2nd, 3rd, etc. root comment on the same block.

### 2. Thread panel shows exactly one root + its replies

The thread panel (`index.html:1802-1862`) renders:
- One root comment (`selectedDocComment`) — hardcoded single entry, not a loop
- Its replies (`selectedDocCommentReplies`) — filtered by `parent_comment_id === rootId`

There is no navigation between sibling root comments on the same anchor.

### 3. No structural limit on data

- `getDocCommentsForBlock()` returns all root comments for a block (no slice/limit)
- `getDocBlockCommentCount()` correctly counts all roots + all replies
- `getCommentsByTarget()` in db.js loads all non-deleted comments for the doc
- `commentBelongsToDocBlock()` correctly filters root comments by anchor range
- The `addDocComment()` function creates new root comments with `parent_comment_id: null` — so each "Post comment" action on the same block creates a new independent root, not a reply

**Summary:** Data is complete. The gap is purely in the UI — there's no way to cycle through or list multiple root comments on the same block.

## Proposed Solution

### Option A: Show all root comments in the thread panel (Recommended)

Change the thread panel from showing a single root comment to showing **all root comments for the selected block**, each with its own replies nested beneath.

**How it works:**
1. When clicking the gutter trigger, instead of selecting a single comment, select the **block** (store `selectedDocCommentBlockId` or equivalent)
2. The thread panel renders all root comments for that block in a loop, each followed by its replies
3. Each root comment retains its own resolve/reopen action
4. The reply textarea attaches to the **last-interacted** or **most recent** root thread

**Pros:** Most complete solution. Users see everything at once. Matches how Google Docs shows multiple comment threads on the same line.
**Cons:** More complex UI. Thread panel could get long with many root threads. Need to decide which root gets the reply input.

### Option B: Add prev/next navigation between root comments (Simpler)

Keep the single-root thread panel but add navigation arrows to cycle between root comments on the same block.

**How it works:**
1. Add a computed property `docCommentsForSelectedBlock` that returns all root comments for the block containing the selected comment
2. Add prev/next buttons in the thread header when `docCommentsForSelectedBlock.length > 1`
3. Show an indicator like "2 of 3" in the thread header
4. Clicking prev/next calls `selectDocCommentThread()` with the adjacent root's ID

**Pros:** Minimal UI change. Keeps existing single-thread rendering. Easy to implement.
**Cons:** User can't see all threads at once. Must click through to find the one they want.

### Option C: Collapse new comments into the first root's thread

Treat the block as having a single thread — all new comments on the same anchor become replies to the first root comment, not new roots.

**Pros:** Eliminates the multi-root problem entirely. Simplest mental model.
**Cons:** Behavioral change — existing data with multiple roots would still need handling. Loses the ability to have independent resolved/open threads on the same line. Could be surprising if a user intends a new topic.

---

## Recommendation: Option B (prev/next navigation)

Option B is the best balance of effort vs. completeness:
- Minimal UI surgery (add 1 nav bar, 1 computed property)
- No structural changes to the data model or thread semantics
- Handles existing multi-root data correctly
- Can be upgraded to Option A later if needed

## Detailed Design (Option B)

### Data Model Changes

None. The existing `docComments` array and `commentBelongsToDocBlock` filter are sufficient.

### New Computed Properties

Add to `docs-manager.js`:

```js
// Returns all root comments for the block that contains the currently selected comment
get selectedBlockRootComments() {
  const selected = this.selectedDocComment;
  if (!selected) return [];
  const anchor = selected.anchor_line_number || 1;
  // Find the block that contains this anchor
  const blocks = this.parsedDocBlocks || [];
  const block = blocks.find(b => {
    const start = Number(b.start_line);
    const end = Number(b.end_line);
    return Number.isFinite(start) && Number.isFinite(end)
      && anchor >= start && anchor <= end;
  });
  if (!block) return [selected]; // fallback: just the selected one
  return this.getDocCommentsForBlock(block);
},

get selectedBlockRootIndex() {
  const roots = this.selectedBlockRootComments;
  return roots.findIndex(c => c.record_id === this.selectedDocCommentId);
},

get selectedBlockHasMultipleRoots() {
  return this.selectedBlockRootComments.length > 1;
},
```

### New Navigation Methods

Add to `docs-manager.js`:

```js
selectPrevBlockRoot() {
  const roots = this.selectedBlockRootComments;
  const idx = this.selectedBlockRootIndex;
  if (idx > 0) {
    this.selectDocCommentThread(roots[idx - 1].record_id);
  }
},

selectNextBlockRoot() {
  const roots = this.selectedBlockRootComments;
  const idx = this.selectedBlockRootIndex;
  if (idx < roots.length - 1) {
    this.selectDocCommentThread(roots[idx + 1].record_id);
  }
},
```

### UI Changes (index.html)

Add a navigation bar inside the thread header (after `<small>` line indicator, before actions):

```html
<div class="doc-thread-nav"
     x-show="$store.chat.selectedBlockHasMultipleRoots">
  <button type="button" class="doc-thread-icon-btn"
          :disabled="$store.chat.selectedBlockRootIndex === 0"
          @click="$store.chat.selectPrevBlockRoot()">
    <span class="doc-thread-icon-glyph" aria-hidden="true">‹</span>
  </button>
  <small x-text="`${$store.chat.selectedBlockRootIndex + 1} of ${$store.chat.selectedBlockRootComments.length}`"></small>
  <button type="button" class="doc-thread-icon-btn"
          :disabled="$store.chat.selectedBlockRootIndex >= $store.chat.selectedBlockRootComments.length - 1"
          @click="$store.chat.selectNextBlockRoot()">
    <span class="doc-thread-icon-glyph" aria-hidden="true">›</span>
  </button>
</div>
```

### Gutter Trigger Behavior Change

Currently selects `[0]` always. Two options:

**B1 (minimal):** Keep selecting `[0]`. User uses prev/next to navigate. Simple, no change needed.

**B2 (smarter):** Remember the last-viewed root per block and re-select it. Adds state complexity — likely not worth it for v1.

**Recommendation:** B1. Keep `[0]` selection. The nav arrows make all roots reachable.

### CSS Changes

Minimal — `doc-thread-nav` needs flex layout with centered items and small gap. Reuse existing `doc-thread-icon-btn` styles.

```css
.doc-thread-nav {
  display: flex;
  align-items: center;
  gap: 4px;
}
```

### Interaction with Existing Features

| Feature | Impact |
|---|---|
| Badge count (`getDocBlockCommentCount`) | No change — already counts all roots + replies correctly |
| Resolve/reopen | Works per-root as today — no change |
| Reply | Replies to whichever root is currently displayed — correct |
| Connector line (SVG) | No change — connects to selected root's anchor |
| Route sync | No change — routes encode `selectedDocCommentId`, which is still a single root |
| New comment modal | No change — still creates a new root on the block |

## Edge Cases

1. **Single root comment on block:** Nav bar hidden (`selectedBlockHasMultipleRoots` is false). Behavior identical to today.

2. **Root comment deleted while viewing:** `selectedBlockRootComments` filters by `record_state !== 'deleted'` (via `commentBelongsToDocBlock`). If the currently viewed root is deleted, the `selectedDocComment` getter returns null, closing the panel. User can reopen from gutter to see remaining roots.

3. **Comments spanning block boundaries after edit:** If a doc is re-parsed and block boundaries shift, `anchor_line_number` remains fixed. A comment may move to a different block. This is a pre-existing issue unrelated to this fix.

4. **Race between live subscription update and navigation:** `applyDocComments` uses `sameListBySignature` to avoid unnecessary re-renders. If a new root appears via sync while the panel is open, the computed `selectedBlockRootComments` will include it on next reactivity cycle. No special handling needed.

5. **parsedDocBlocks not available:** The fallback in `selectedBlockRootComments` returns just the selected comment, so nav stays hidden. Graceful degradation.

## Testing Plan

1. **Unit test:** `getDocCommentsForBlock` with 1, 2, 3+ root comments — verify all returned
2. **Unit test:** `selectedBlockRootComments` computation with mock state
3. **Unit test:** `selectPrevBlockRoot` / `selectNextBlockRoot` boundary behavior
4. **Manual test:** Create 3+ root comments on same block, verify nav arrows appear and cycle correctly
5. **Manual test:** Badge count matches total across all roots + replies
6. **Manual test:** Resolve one root, navigate to another — status independent
7. **Manual test:** Single-root block — no nav arrows visible

## Open Questions

1. **Should we prevent creating multiple roots on the same block?** Option C suggests collapsing into one thread. This is a product decision — the current design preserves the ability to have independent threads per block, which some users may value (e.g., separate discussion topics on the same code line). Recommend keeping multi-root and just fixing navigation for now.

2. **Should the gutter badge distinguish root count from total count?** Currently shows total (roots + replies). Could show something like "3 threads, 7 comments" — but this adds visual clutter. Recommend keeping total count for v1.

3. **Should the "new comment" modal auto-reply to an existing root instead of creating a new root?** This would prevent the multi-root case from growing. Tradeoff: simpler for users who just want to add to the conversation, but removes the ability to start a fresh topic. Could add a "New thread" vs "Reply to existing" choice — but that's scope creep for this fix.

## Files to Modify

| File | Change |
|---|---|
| `src/docs-manager.js` | Add 3 computed properties + 2 navigation methods |
| `index.html` | Add nav bar in thread header |
| `src/styles.css` | Add `.doc-thread-nav` styles |
| `tests/` | Add unit tests for new computed properties |

## Estimated Complexity

Low. ~50 lines of JS, ~10 lines of HTML, ~5 lines of CSS, plus tests. No data model changes, no backend changes, no migration.
