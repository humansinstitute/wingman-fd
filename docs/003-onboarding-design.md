# Onboarding Design

Status: product design
Last updated: 2026-05-05

## Purpose

An empty Flight Deck should not feel like an empty database. It should teach the
operating model by helping the user complete a first useful loop:

1. Create or choose a scope.
2. Start a chat.
3. Turn useful discussion into a task.
4. Produce a doc, response, or follow-up task.
5. Review the result.

The goal is not to explain every primitive. The goal is to get the user to a
productive first outcome.

## First Empty State

When a workspace has no meaningful activity, Flight Deck should ask:

"What kind of work are you here to coordinate?"

Suggested options:

- Product or project
- Team operations
- Customer or client work
- Personal agent workspace
- Existing business or company

The answer should guide default scope creation and initial suggestions.

## First Scope

The first setup step should create a scope with a plain-language name.

Examples:

- "Wingman Suite"
- "Marketing"
- "Client Work"
- "Operations"

After scope creation, Flight Deck should land the user inside that scope rather
than returning to a global blank page.

## First Chat

The next step should invite the user to start a chat with an agent or teammate.

The prompt should be practical:

- "What are we trying to move forward?"
- "What do you want help thinking through?"
- "What should be checked, written, planned, or done?"

The chat surface should make it clear that early conversation can be exploratory
and does not need to become a task immediately.

## First Work Item

Once there is enough chat context, Flight Deck should make "Get it done"
available as the natural next action.

The user should be able to create a ready task from the thread and select the
expected output:

- doc
- task
- chat response

This is the moment where the product teaches that chat is exploration and tasks
are commitments.

## First Review

When the task reaches review, the user should see:

- the source chat
- the completed deliverable
- the task evidence
- the next obvious action

This reinforces the traceable work model.

## Empty State Variants

### Empty Docs

Do not show only "No docs yet."

Offer:

- create a doc from scratch
- create a doc from a chat via "Get it done"
- import or paste existing material when import support exists

### Empty Tasks

Do not show only "No tasks yet."

Offer:

- create a task directly
- create a task from chat
- view examples of useful task prompts

### Empty Chat

Do not show only "No messages yet."

Offer:

- start a chat in the current scope
- ask an agent to inspect or plan something
- record a voice note

## Acceptance Criteria

- A new user can understand the core loop without reading documentation.
- The first session leads toward an actual task, doc, or response.
- Empty states are scoped to where the user is working.
- Onboarding does not hide the normal Flight Deck UI behind a separate wizard.

