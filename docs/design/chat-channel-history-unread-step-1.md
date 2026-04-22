# Chat Channel History, Bottom Anchoring, and Unread Highlight Plan

## Scope

This document is the step-1 design artifact for flow `3efa0719-b4df-48d1-92b4-4e92be40cdad`, task `d2ee8674-6bd8-4cff-a1c8-eb2fd9355679`.

Requested outcomes for the Flight Deck chat channel screen:

1. Opening a channel lands on the newest message at the bottom.
2. Sending a new channel message keeps the newest message visible.
3. Adjacent chat rows have a faint divider.
4. Initial render shows only the newest 21 messages, and older history is exposed through a load-more control when the user scrolls upward.
5. Unread messages render with a faint blue background without breaking the existing read-cursor behavior.

This step does not implement production code or real tests. It defines the exact changes for later steps.

## Current Codebase Findings

### What already exists

- `src/chat-message-manager.js`
  - `scheduleChatFeedScrollToBottom()` already scrolls the main feed to the end.
  - `applyMessages()` already decides between restoring scroll position and forcing the latest message into view.
  - `showMoreMainFeedMessages()` already expands the main-feed window while preserving anchor position.
- `src/channels-manager.js`
  - `applyChannels()` and `selectChannel()` already reset `mainFeedVisibleCount` and set `pendingChatScrollToLatest`.
  - `selectChannel()` already calls `markChannelRead(recordId)`.
- `index.html`
  - The chat feed already renders a top-of-feed button for older messages.
- `src/unread-store.js`
  - Unread state already exists at nav and per-channel level via read cursors.
- `src/section-live-queries.js`
  - The selected channel’s live query already reads only a window of messages based on `mainFeedVisibleCount`.

### Where current behavior diverges from the request

1. `src/app.js` sets `MAIN_FEED_PAGE_SIZE` and `mainFeedVisibleCount` to `80`, not `21`.
2. The current “show older messages” button is always at the top of the feed when hidden messages exist. It is not tied to the user scrolling upward.
3. Channel opening through route replay explicitly suppresses bottom anchoring:
   - `src/app.js` calls `selectChannel(item.channelId, { scrollToLatest: false })`.
4. Message rows do not currently render a divider or per-message unread highlight.
5. Unread state is only tracked at channel level. There is no message-level unread helper.
6. `selectChannel()` marks the channel read immediately. If message unread styling is computed only from the current cursor, the act of opening the channel would erase the unread highlight before it is shown.

## Diagnosis

The requested behavior is mostly an extension of existing mechanisms, not a new subsystem:

- Bottom anchoring is already implemented in the chat store but is bypassed on at least one channel-open path.
- Incremental history load already exists as a count-based window and can stay count-based.
- The unread requirement is the only part that needs a new local view-model concept, because the existing cursor model is channel-scoped and eagerly advanced on channel selection.

The safest implementation is:

1. Reuse the existing windowed query and `showMoreMainFeedMessages()` behavior.
2. Reduce the default window to `21`.
3. Add a feed-top detection state so the load-more control only appears once the user scrolls upward near the top.
4. Snapshot the selected channel’s effective unread cutoff before advancing the read cursor, and use that snapshot to style the currently rendered messages for that channel.

## Tests First

The tests below should be added in step 2 before production changes.

### 1. Channel selection preserves bottom-anchor intent

Target file:

- `tests/channels-manager-mixin.test.js` (new)

Cases:

- Selecting a channel resets `mainFeedVisibleCount` to `21`.
- Selecting a channel sets `pendingChatScrollToLatest` to `true` by default.
- Route-driven channel open no longer suppresses bottom anchoring for normal channel navigation.
- Selecting a channel captures a stable unread snapshot before `markChannelRead()` clears the live unread flag.

Why this test exists:

- The scroll bug is partly caused by channel-open orchestration, not just DOM scrolling.

### 2. Main-feed windowing defaults to 21 and expands safely

Target file:

- `tests/chat-message-manager.test.js`

Cases:

- `visibleMainFeedMessages` returns only the newest `21` top-level messages when more exist.
- `hiddenMainFeedCount` reflects the older remainder correctly.
- `showMoreMainFeedMessages()` increments by `21` and preserves the scroll anchor.
- `applyMessages()` still schedules scroll-to-bottom when `pendingChatScrollToLatest` is set.
- `sendMessage()` still schedules chat-feed scroll-to-bottom after inserting the local pending row.

Why this test exists:

- The request changes the default pagination contract, so the store-level slicing behavior must be pinned down.

### 3. Load-more control only appears when the user scrolls upward

Target files:

- `tests/chat-message-manager.test.js`
- `tests/chat-channel-rendering.test.js` (new, only if template-level assertions become too awkward in the mixin test)

Cases:

- When hidden messages exist but the feed is near the bottom, the load-more control is hidden.
- When the feed is near the top, the control becomes visible.
- Clicking the control requests the next page and does not jump the viewport away from the anchored message.

Why this test exists:

- The current button is always rendered when hidden messages exist, which does not match the requested interaction.

### 4. Unread message highlighting is derived from a captured cutoff, not the post-open cursor

Target files:

- `tests/unread-store.test.js`
- `tests/chat-message-manager.test.js`

Cases:

- A pure helper returns `true` only for messages whose `updated_at` is newer than the effective unread cutoff.
- Messages older than or equal to the cutoff are not highlighted.
- A selected channel can keep highlighting the messages that were unread before opening even after `markChannelRead()` runs.
- Messages authored by the current viewer are not highlighted as unread when they are newly inserted locally.

Why this test exists:

- Without a snapshot, the highlight would disappear immediately on open because `markChannelRead()` updates the cursor to `now`.

### 5. Template-level styling hooks exist for dividers and unread rows

Target file:

- `tests/chat-channel-rendering.test.js` (new) or an equivalent DOM-oriented test

Cases:

- Each rendered chat row includes a stable class hook for unread styling.
- Rows after the first render with a divider affordance.
- Focus styling and unread styling can coexist without one removing the other.

Why this test exists:

- The request is specifically visual, so the template must expose explicit class hooks instead of burying the behavior in brittle CSS selectors.

## Planned Production Changes

### A. Reduce the initial main-feed window from 80 to 21

Files:

- `src/app.js`
- possibly `tests/chat-message-manager.test.js`
- possibly `tests/chat-delete-channel.test.js` and any other fixtures that currently hard-code `80`

Changes:

- Change `MAIN_FEED_PAGE_SIZE` from `80` to `21`.
- Change the initial `mainFeedVisibleCount` from `80` to `21`.
- Keep `THREAD_REPLY_PAGE_SIZE` unchanged.

Reasoning:

- The live query already respects `mainFeedVisibleCount`, so reducing the constant is enough to make the first render window smaller.

### B. Keep bottom anchoring on first open and on send

Files:

- `src/app.js`
- `src/channels-manager.js`
- `src/chat-message-manager.js`

Changes:

- Remove the explicit `scrollToLatest: false` suppression from the normal route-driven channel open path in `src/app.js`.
- Preserve the existing `pendingChatScrollToLatest` behavior in `selectChannel()` and `applyChannels()`.
- Do not redesign `sendMessage()`; it already calls `scheduleChatFeedScrollToBottom()` after inserting the local row.

Reasoning:

- The send path already satisfies the requirement.
- The open-path bug is most likely orchestration, not missing scroll code.

### C. Surface the load-more control only when the user scrolls upward

Files:

- `src/app.js`
- `src/chat-message-manager.js`
- `index.html`

Changes:

- Add local UI state such as `chatFeedNearTop` or `showMainFeedLoadMoreControl`.
- Add a passive feed-scroll handler, or an equivalent top-sentinel observer, to detect when the user has scrolled near the top.
- Show the load-more control only when:
  - the channel has more hidden messages, and
  - the feed is near the top.
- Keep the actual expansion action wired to `showMoreMainFeedMessages()`.

Reasoning:

- The data model already supports incremental reveal.
- The missing piece is the UI rule for when the control appears.

Preferred implementation:

- Start with a scroll-threshold boolean because it is simpler than an observer and easier to unit test in the existing store-driven architecture.

### D. Add per-message unread highlighting without changing the persisted unread model

Files:

- `src/channels-manager.js`
- `src/chat-message-manager.js`
- `src/unread-store.js`
- `index.html`
- `src/styles.css`

Changes:

- Add a local snapshot state for the selected channel, for example:
  - `selectedChannelUnreadCutoff`
  - `selectedChannelUnreadChannelId`
- When selecting a channel:
  - read the effective unread cutoff for that channel before calling `markChannelRead()`
  - store that cutoff locally for the selected channel
  - then keep the existing mark-as-read call
- Add a helper such as `isMessageUnread(message)` that returns `true` only when:
  - the message belongs to the selected channel
  - the message is active
  - the message is newer than the captured cutoff
  - the sender is not the current viewer
- Bind a CSS class like `chat-post-unread` in `index.html`.

Reasoning:

- This preserves current channel-read semantics while still letting the UI show what had been unread immediately before the user opened the channel.
- It avoids introducing new persisted message-level read state.

### E. Add faint row separators and unread background

Files:

- `index.html`
- `src/styles.css`

Changes:

- Add a row-level class for unread state.
- Add a subtle separator between consecutive rows, most likely via `border-top` on rows after the first or an equivalent pseudo-element.
- Add a faint blue unread background that still allows:
  - hover styling
  - focused-message styling
  - sync-status dot visibility

Styling constraints:

- Divider should be noticeably present but low-contrast.
- Unread blue should be pale enough to avoid fighting the existing focus treatment.
- Focused state should remain visually stronger than unread state.

## Exact Files Expected To Change In Later Steps

Primary implementation files:

- `src/app.js`
- `src/channels-manager.js`
- `src/chat-message-manager.js`
- `src/unread-store.js`
- `index.html`
- `src/styles.css`
- `src/section-live-queries.js` only if query invalidation/window refresh needs adjustment

Primary tests:

- `tests/chat-message-manager.test.js`
- `tests/unread-store.test.js`
- `tests/channels-manager-mixin.test.js` (new)
- `tests/chat-channel-rendering.test.js` (new, only if needed for DOM/class assertions)

## Validation Commands

Step 2 should use these commands to prove the new tests exist and fail for the expected reasons before implementation:

```bash
bun test tests/chat-message-manager.test.js tests/unread-store.test.js tests/channels-manager-mixin.test.js
```

If a DOM-oriented rendering test is added:

```bash
bun test tests/chat-message-manager.test.js tests/unread-store.test.js tests/channels-manager-mixin.test.js tests/chat-channel-rendering.test.js
```

Step 3 should then use the same commands and expect them to pass.

Recommended broader confidence pass after implementation:

```bash
bun test
```

## Risks

1. Message unread styling can disappear instantly if the implementation reads the cursor after `markChannelRead()` instead of before it.
2. Scroll restoration can jitter if the load-more expansion and image hydration both try to restore anchors at the same time.
3. The route-open change can unintentionally affect focused-message deep links if those flows depend on `scrollToLatest: false`.
4. Existing tests and fixture stores hard-code `80` as the main-feed page size and will need coordinated updates.

## Fallback Plans

1. If route-based deep links need to preserve non-bottom behavior for focused-message jumps, split channel-open options into:
   - standard channel open: scroll to latest
   - focused-message jump: preserve target message position
2. If the scroll-threshold approach proves flaky, replace it with a top sentinel plus `IntersectionObserver`.
3. If unread snapshot logic becomes too implicit inside `selectChannel()`, extract a pure helper from `unread-store.js` so the cutoff calculation is independently testable.

## Explicit Non-Goals

- No backend contract changes.
- No new persisted message-level read model.
- No redesign of thread reply pagination.
- No virtualization or infinite-scroll rewrite.
- No changes to channel sidebar unread dots beyond keeping them compatible with the new message-row highlighting.

## Completion Criteria For This Flow Step

This step is complete when:

1. The design document exists at this path.
2. It names the exact tests to add first.
3. It names the exact files expected to change.
4. It explains the unread-cursor edge case and the route-open scroll issue.
5. It provides concrete validation commands for steps 2 and 3.
