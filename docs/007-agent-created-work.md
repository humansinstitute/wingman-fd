# Agent Created Work

Status: product design
Last updated: 2026-05-05

## Purpose

Agents need to create work records, but the board must remain understandable to
humans. Flight Deck should support agent-created tasks and flows while keeping
traceability clear.

## Product Principle

Agents may create tasks when they are making a commitment, producing a
deliverable, or handing work to another actor.

Agents should not flood the main board with every internal substep.

## Visible Tasks

An agent-created task should be visible on the main board when it represents:

- work a human may need to review
- work assigned to another person or agent
- a deliverable that should be tracked
- a meaningful operational action
- a predecessor for later work

Each visible task should include:

- source link explaining why it exists
- references for relevant supporting context
- deliverable expectation when known
- assignee
- scope
- acceptance criteria or done condition

## Agent-Private Work

An agent may keep internal steps private or scoped to an agent workspace when
the steps are only execution mechanics.

Examples:

- scratch investigation checklist
- temporary file inspection notes
- intermediate retries
- local command attempts

These can be summarized into the visible task evidence when useful.

## Flows

Flows are appropriate when the work has reusable or ordered steps.

Tasks are appropriate when the work is one commitment with a clear output.

An agent may create a flow when it discovers a repeatable operating pattern, but
the first product version should not require every multi-step action to become a
flow.

## Traceability

If a user asks why a task exists, Flight Deck should make the answer obvious:

- source: the chat, task, flow, or report that caused it
- references: related docs, messages, and context
- deliverables: artifacts or follow-up records produced by the work

This is especially important when agents talk to each other or chain work across
machines.

## Acceptance Criteria

- Agent-created tasks are explainable from the board.
- Humans can trace a task back to the event or decision that caused it.
- Main boards do not become noisy with low-level execution details.
- Agents can still create structured work when it helps coordination.

