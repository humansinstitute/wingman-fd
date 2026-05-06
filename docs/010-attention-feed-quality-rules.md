# Attention Feed Quality Rules

Status: product design
Last updated: 2026-05-06

## Purpose

The Flight Deck attention feed should answer "what needs my attention now?"
without becoming a noisy activity log. The first implementation groups work into
attention lanes and adds a timing panel. This document defines the next quality
rules for making those cards more accurate and useful.

## Current Lanes

The attention feed should keep these high-level lanes:

- Needs You
- Changed Work
- Agent Updates
- Due / Next

The timing panel should keep:

- Coming Up
- Just Gone

## Needs You

This lane should be reserved for items that plausibly require user attention.

Include:

- approvals waiting on the user
- direct mentions in chat
- mentions in doc comments
- mentions in task comments
- tasks assigned to the user
- tasks created by the user that moved to review
- tasks where the user is explicitly requested as reviewer

Avoid:

- every task update
- every doc edit
- agent noise that does not require a decision

## Changed Work

This lane shows meaningful movement in work the user cares about.

Include:

- tasks the user created that changed after creation
- tasks the user follows or has referenced recently
- docs in the current scope that changed
- comments on tasks or docs in the current scope
- chat threads with new replies in the active scope

Changed Work should be scoped and deduped. A task with five new comments should
usually produce one card, not five.

## Agent Updates

This lane is for agent output that a human may reasonably want to inspect.

Include:

- agent reports
- agent-owned tasks entering review
- blocked agent work
- important handoff comments
- failed runs or deployment signals

Avoid:

- low-level logs
- routine progress pings
- internal retries unless they block work

## Due / Next

This lane is the active work runway for the selected board.

Include:

- ready tasks in the current board
- in-progress tasks in the current board
- blocked tasks in the current board
- review tasks in the current board
- scheduled tasks due soon

Ordering should prefer:

1. blocked or review work
2. tasks assigned to the user
3. tasks assigned to the default agent
4. soonest scheduled work
5. recently updated work

## Timing Panel

The timing panel should be a compact time-aware surface, not another task list.

Coming Up should include:

- schedule runs in the next few days
- scheduled tasks due soon
- handoffs due soon when represented as tasks

Just Gone should include:

- schedule runs that recently passed
- tasks that became overdue recently
- recently completed scheduled work when useful

The timing panel should not show long-range calendar clutter.

## Mention Detection

Mention parsing should use structured mentions where available.

Fallback text matching can remain, but the preferred order is:

1. structured mention tokens
2. linked record comment metadata
3. exact npub references
4. display-name fallback only when low risk

Display-name fallback should avoid false positives from common names.

## Read And Acknowledge State

The feed should eventually distinguish:

- unseen
- seen
- acknowledged
- dismissed

Dismissal should hide a card for the current user without deleting the source
record.

Acknowledgement should be lightweight and reversible where possible.

## Deduping

Cards should dedupe by the highest-level useful record.

Examples:

- Multiple comments on one task become one task-comment card.
- Multiple doc edits in one short window become one doc-update card.
- A task entering review and receiving a comment should prefer the review card
  if it needs user action.

## Scope Rules

In all-scope mode:

- show the highest-priority items across the workspace
- include scope labels on cards
- avoid flooding one active scope over everything else

In focused scope mode:

- prioritize the selected scope and descendants
- keep parent context secondary
- hide unrelated workspace noise unless it is directly assigned to or mentions
  the user

## Card Requirements

Each card should provide:

- clear title
- reason it is shown
- source or target record type
- relative time
- actor or assignee when relevant
- action label
- click-through route

Cards should not require the user to guess why they appeared.

## Acceptance Criteria

- The feed is useful as a first screen for starting work.
- User mentions and approvals reliably appear in Needs You.
- Changed Work does not duplicate every low-level event.
- Agent Updates are high-signal.
- Timing shows near-term events without becoming a calendar.
- Every card has a working route to inspect or act on the underlying record.
