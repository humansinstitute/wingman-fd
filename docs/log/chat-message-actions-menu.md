# Chat Message Actions Menu

## Decision

Add an ellipsis (three-dot) actions menu to every chat message in Flight Deck — main feed messages, thread parent messages, and thread replies.

## Context

Chat messages had sync status dots but no actionable menu. Tasks, documents, and folders already had ellipsis action menus using the `doc-actions-menu` pattern. The record status inspector modal (`openRecordStatusModal`) already supports the `chat_message` family, so the UI just needed a trigger point on each message.

## Approach

- **Reused patterns**: Followed the existing `doc-actions-menu` pattern (local toggle state, `@click.outside` close, `x-cloak x-transition`, same popover structure).
- **State management**: Added `messageActionsMenuId` to the Alpine store (single open menu at a time, avoids multiple open menus) with `toggle/open/close/isOpen` methods in `chatMessageManagerMixin`.
- **CSS**: New `.chat-msg-actions-menu` classes, positioned absolute top-right of each message. Opacity transitions on hover/focus-within so the menu toggle appears only when interacting with a message.
- **Sync inspection**: `inspectMessageSyncStatus(recordId)` finds the message, builds a truncated label from the body, closes the menu, then calls the existing `openRecordStatusModal` with `familyId: 'chat_message'`.
- **Coverage**: 11 new unit tests covering open/close/toggle/isOpen and sync status inspection (including label truncation and fallback).

## Files Changed

- `src/chat-message-manager.js` — new mixin methods
- `src/app.js` — `messageActionsMenuId` state field
- `src/styles.css` — `.chat-msg-actions-*` styles
- `index.html` — menu markup on main feed messages, thread parent, thread replies
- `tests/chat-message-manager.test.js` — 11 new tests
- `docs/log/chat-message-actions-menu.md` — this file
