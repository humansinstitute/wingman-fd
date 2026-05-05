# Record Link Model

Status: product design
Last updated: 2026-05-05

## Purpose

Flight Deck needs a small, understandable link model that helps people and
agents answer three questions:

- Why does this record exist?
- What else is relevant to it?
- What did this work produce?

The model should be easy enough for users to understand from the UI and stable
enough for agents to rely on when building context.

## Link Types

Use three first-class link types.

### Source

Meaning: "I was explicitly created because of this."

Examples:

- A task created from a chat thread has the chat thread as its source.
- A document created from a task has the task as its source.
- A follow-up task created from a completed task has the completed task as its
  source.

Source should usually be singular or very small in number. It explains origin,
not general relevance.

### Reference

Meaning: "This is related to me."

Examples:

- A task references a supporting document.
- A document references a related chat thread.
- A chat thread references a scope, task, or earlier decision.

Reference is intentionally loose. It covers useful context without forcing the
system to over-classify every relationship.

### Deliverable

Meaning: "I made this."

Examples:

- A task has a document deliverable.
- A task has a chat response deliverable.
- A task has a follow-up task deliverable.
- A flow step has a generated report deliverable.

Deliverable links should be used when the output is important enough for a
person or agent to inspect later.

## Product Rules

- Prefer these three link types over a larger taxonomy.
- A record can have many references, but source and deliverable should stay
  intentional.
- The UI should show source and deliverables more prominently than references.
- Every visible link should be clickable and route to the linked record.
- Agents should treat source and deliverable links as high-signal context.
- References should be pulled in opportunistically, filtered by relevance and
  context budget.

## Agent Context Rules

When an agent is asked to work on a record, it should read:

1. The record itself.
2. Its source links.
3. Its deliverable links when checking prior output or follow-up state.
4. Its references when they appear relevant to the current task.

This gives agents traceability without making every relationship type a special
case.

## Open Questions

- Should source be limited to one record in the data model, or should the UI
  merely encourage one primary source?

Answer assume one primary source and everything else is a reference. 

- Should deliverables be ordered so the primary deliverable can be shown first?

Yes. 

- Should references have optional labels, or is that too much complexity for
  the first version?

no labels, also references already exist in the record atructure so reuse where we can. 