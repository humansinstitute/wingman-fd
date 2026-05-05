# Command Palette And Quick Launch

Status: product design
Last updated: 2026-05-05

## Purpose

Flight Deck needs fast navigation across scopes, tasks, docs, chats, and common
actions. The structured navigation can remain simple if power users have a
reliable command palette and mobile quick launch.

## Desktop Command Palette

Keyboard shortcut:

- `Command+K` / `Super+K`

The palette should open over the current screen and focus the search input.

## Mobile Quick Launch

Use a persistent radar-style button on mobile. 

<EDIT PETE> THIS SHOULD JUST BE THE DEFAULT ACTION WHEN YOUHIT THE FLIGHT DECK LOGO! instrad of adding a radar button!!

When tapped, it opens the same command surface with touch-friendly shortcuts.

The radar button should be available from the primary Flight Deck surfaces, but
it should not block important page actions or overlap content.

## Default Shortcuts

The top of the palette should show common destinations and actions before the
user types:

- All-scope Flight Deck
- All-scope task board
- Current-scope Flight Deck
- Current-scope task board
- New task
- New chat
- Most recent chat channel
- Recent docs

## Search Targets

Typing should search across:

- scopes
- docs
- tasks
- chat channels
- chat threads
- flows
- approvals
- commands

Results should be grouped by type, but the user should not have to choose a
type before searching.

## Scope Selection Behavior

Selecting a scope result should offer two behaviors:

- Set current scope and land on the scope Flight Deck.
- Jump directly to a matching record and set that record's scope.

Keyboard behavior:

- `Enter` on a scope sets it as the active scope.
- `Enter` on a record opens the record and sets the active scope if the record
  has one.

## All-Scope Shortcuts

Flight Deck should provide single-step access to:

- all-scope Flight Deck
- all-scope task board

This matters because a user may intentionally want the whole business view,
even if they usually work inside a focused scope.

## Current-Scope Shortcuts

When a scope is active, the palette should prioritize:

- current-scope Flight Deck
- current-scope task board
- current-scope docs
- current-scope chat

This makes focused work faster without hiding the global view.

## Acceptance Criteria

- A keyboard user can jump to any major Flight Deck object without using the
  sidebar.
- A mobile user can reach the same navigation power through the radar button.
- The palette respects current scope but always exposes all-scope escape hatches.
- Selecting a scoped record makes the scope context obvious.