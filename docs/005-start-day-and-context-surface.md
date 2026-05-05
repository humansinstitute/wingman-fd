# Start Day And Context Surface

Status: product design
Last updated: 2026-05-05

## Purpose

Flight Deck should help a user begin work by surfacing what matters now. This
is not a generic activity feed. It is a scoped, time-aware briefing assembled
from tasks, chats, docs, reports, and agent updates.

## Start Day Mode

The user should be able to start their day from Flight Deck.

The briefing should use the user's local time and workspace context.

It should show:

- tasks needing attention
- recent agent reports
- important unread chat threads
- docs or decisions updated since the last session
- upcoming deadlines or scheduled work
- active scopes with meaningful movement

## End Day Or Later Mode

Later in the day, Flight Deck should shift from "what should I start with?" to
"what changed and what needs closure?"

It should show:

- work completed today
- tasks still blocked
- review items waiting on the user
- agent summaries that were posted during the day
- suggested follow-up for tomorrow

## Context Surface

Flight Deck should have a flexible context area that can be populated by the
current work pattern.

Examples:

- If the user spends the day in "Marketing", show marketing tasks, docs, and
  chats.
- If agents are working heavily on "Wingman Suite", surface the active suite
  tasks and reports.
- If an agent posts an important update, show it as an attention item.

This context surface should be explainable. The user should be able to tell why
something is visible.

## Scope Rules

When the user is in all-scope mode:

- show the most important items across the workspace
- group by scope when useful
- preserve shortcuts to all major surfaces

When the user chooses a scope:

- prioritize that scope and its descendants
- keep major child-scope activity visible
- reduce unrelated workspace noise

When the user chooses a child scope:

- show that child scope deeply
- keep parent context available but secondary

## Agent Reports

Agents should be able to post report-like updates that Flight Deck can surface.

The report should include:

- title
- summary
- source task, chat, or session
- scope
- severity or importance
- suggested next action when applicable

Reports should not become a noisy notification stream. They should be reserved
for information a human may reasonably need to see.

## Acceptance Criteria

- The first screen answers "what matters now?"
- The briefing changes based on time of day and active scope.
- Agent reports can surface without requiring the user to inspect every task.
- Every surfaced item has a visible source, reference, or deliverable path.

