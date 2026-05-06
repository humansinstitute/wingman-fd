# Agent Execution Pipeline

Status: product design
Last updated: 2026-05-06

## Purpose

The agent execution pipeline is the bridge between a ready task and real work
being completed. It should let an agent start from the task record alone,
recover the relevant context, execute or dispatch the work, attach evidence,
and move the task toward review.

This pipeline is especially important for tasks created through "Get it done",
because those tasks carry the transition from exploratory chat into committed
work.

## Starting Point

The pipeline starts when a task becomes actionable.

Actionable states:

- `ready`: work is available to begin.
- `in_progress`: work is already underway and needs continuation.
- `review`: only actionable when the agent is asked to revise, explain, or
  continue from review feedback.

The task record is the primary source of truth. The pipeline must not rely on
ephemeral chat context that is not recorded on the task.

## Required Task Read

Before acting, the agent should read:

1. The full task title and description.
2. State, assignee, scope, tags, scheduled date, and predecessor fields.
3. Source links.
4. Deliverable links and deliverable expectations.
5. References.
6. Latest task comments.
7. Current checkout/edit state when the record family requires checkout.

If the task was created from chat, the source chat thread should be read before
the execution plan is finalized.

## Context Assembly

The agent should assemble context in this order:

1. Task body and latest comments.
2. Source record.
3. Existing deliverables.
4. Explicit references.
5. Scope context.
6. Related reports or recent attention items when directly relevant.

The agent should avoid pulling every loosely related record. References are
useful context, not an instruction to exhaustively read the whole workspace.

## Execution Contract

When the agent first takes the task, it should leave a short task comment that
states:

- scope of work
- expected deliverable
- validation method
- known blockers or assumptions

This comment makes the handoff visible to the user and gives later agents a
stable starting point.

## Task Brief Repair

If the task was created from a short chat prompt and the description is not yet
execution-ready, the pipeline should improve the task description before doing
substantive work.

The improved brief should include:

- concise goal
- source context summary
- relevant links
- acceptance criteria
- constraints
- expected output

The pipeline should preserve the original user prompt and source links.

## Execution Modes

The pipeline can complete work in three ways.

### Direct Execution

Use when the assigned agent can complete the work itself.

Examples:

- edit a doc
- update a task
- summarize a thread
- inspect records and produce a report

### Worker Dispatch

Use when the work belongs in a software repo, local machine, or specialized
worker session.

The dispatched worker must receive a self-contained brief. The task description
should carry the essential context, not only the worker prompt.

### Follow-Up Work Creation

Use when the expected deliverable is another task, flow, or handoff.

The follow-up record should have:

- source link to the current task
- references to supporting context
- clear assignee
- scope
- expected output

## Deliverables

When the task produces an output, the output should be attached as a
deliverable.

Supported deliverable shapes:

- doc
- task
- chat response
- report
- storage object
- flow run result
- code change or commit reference when represented in Flight Deck

If the output already exists, the pipeline should link it rather than duplicate
it.

## Evidence And Handoff

Before moving a task to review, the agent should add a completion comment with:

- what changed
- where the deliverable is
- validation performed
- remaining risks or open questions

For software work, include the commands run and whether they passed.

For writing or planning work, include the doc/report/task reference that the
user should inspect.

## Failure Behavior

If the agent cannot complete the task, it should not silently stall.

It should:

- add a blocker comment
- keep or move the task to the appropriate blocked/review state
- explain what is needed next
- preserve partial findings and links

## Acceptance Criteria

- An agent can start from a task record and recover the needed context.
- Tasks created from chat become executable without losing the original thread.
- Deliverables are linked back to the task.
- Completion comments include evidence and validation.
- Humans can understand what happened without reading raw agent logs.
