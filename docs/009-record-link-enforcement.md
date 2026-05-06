# Record Link Enforcement

Status: product design
Last updated: 2026-05-06

## Purpose

The record link model defines `source`, `reference`, and `deliverable`. This
document describes how Flight Deck should enforce and expose that model in the
product so links are useful to both humans and agents.

The goal is not to add more relationship types. The goal is to make the three
existing types consistently visible, clickable, and meaningful.

## Canonical Link Fields

Records should use these fields where the family supports them:

- `source_links`: records that explicitly caused this record to exist
- `references`: records that are related or useful as context
- `deliverable_links`: records produced by this record or work item

Existing `references` fields should be reused rather than introducing a second
reference mechanism.

## Source Rules

Source answers: "Why does this exist?"

Rules:

- Prefer one primary source.
- Allow multiple source links only when the origin genuinely has multiple
  causes.
- Show source more prominently than references.
- Preserve source links when a task brief is repaired or rewritten.
- When a record is created from chat, the source should point to the thread or
  message that caused it.
- When a record is created from a task, the source should point to that task.

## Reference Rules

Reference answers: "What else is related?"

Rules:

- References can be plural and loose.
- References should not require labels in the first version.
- References should be pulled into agent context opportunistically.
- The UI should make references easy to inspect without making them visually
  louder than source or deliverables.
- References should dedupe against source and deliverable links.

## Deliverable Rules

Deliverable answers: "What did this make?"

Rules:

- Deliverables should be ordered.
- The primary deliverable should appear first.
- If a task expects a doc output, the doc should be created or linked as a
  deliverable.
- If a task expects a chat response, the originating thread should be marked as
  the output destination.
- If a task expects a follow-up task, the follow-up task should link back to the
  original task as source.

## UI Rules

Every visible link should be clickable.

Supported targets:

- chat thread or message
- task
- doc
- scope
- flow
- approval
- report
- schedule
- storage object

If a target cannot be opened directly, Flight Deck should show a clear fallback
state instead of a dead click.

## Record Detail Surfaces

Task and doc detail surfaces should show link sections in this order:

1. Source
2. Deliverables
3. References

The user should be able to answer:

- where did this come from?
- what did it produce?
- what else is relevant?

## Creation Flows

Creation flows should set links automatically when the origin is known.

Examples:

- Chat "Get it done" creates a task with source link to the chat thread.
- `doc` output creates or links a doc deliverable on the task.
- Follow-up task output creates a child/follow-up task with source link to the
  original task.
- Agent-created work records include source and deliverable expectations before
  they appear on the main board.

## Agent Context Rules

Agents should treat link types differently:

- source: high-signal origin context, read early
- deliverable: output or prior result, read when checking state
- reference: supporting context, read selectively

The agent should mention which links it used when leaving execution evidence on
a task.

## Migration And Compatibility

Older records may have only free-text links or loose references.

The first version should:

- continue rendering existing references
- infer clickable links from known record mentions where practical
- avoid destructive rewrites of old records
- add structured links when records are next edited or created

## Acceptance Criteria

- Source, references, and deliverables are visible on task and doc detail
  screens.
- Link chips route to the correct Flight Deck surface.
- "Get it done" creates source and deliverable links for known outputs.
- Agents can use link fields to assemble context predictably.
- Users can explain why a record exists without reading raw logs.
