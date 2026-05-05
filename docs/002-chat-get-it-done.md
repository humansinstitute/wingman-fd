# Chat Get It Done

Status: product design
Last updated: 2026-05-05

## Purpose

"Get it done" is the default transition from exploratory chat into committed
work. It should let a user turn a thread into a ready task without losing the
conversation context that caused the work to exist.

Chat remains the place for exploration. Tasks become the accountability layer.

## Entry Point

From any chat message or thread:

1. User opens the ellipsis menu.
2. User selects "Get it done".
3. Flight Deck opens a task creation modal.

The current scope should be selected by default.

## Modal Fields

Required:

- Task title or prompt: short user-authored instruction for what should happen.
- Assignee: defaults to the person or agent being chatted with.
- Output type: one of `doc`, `task`, or `chat response`.

Optional:

- Scope override.
- Extra instructions.
- Additional references.

## Assignment Defaults

Default assignment should follow the conversation shape:

- One-to-one chat with an agent: assign to that agent.
- Group chat: assign to the last participant who is not the current user.
- If a workspace has a configured assigned agent, use that agent when no clearer
  participant exists.
- The user can override assignment before creating the task.

## Output Types

### Doc

Create a document shell immediately and attach it as the expected deliverable.

The created task should include:

- source link to the chat thread
- deliverable link to the new document
- reference link to any explicitly selected supporting records

### Chat Response

Mark the current thread as the expected update location.

The created task should include:

- source link to the chat thread
- deliverable expectation that the assignee posts the final response back into
  the same thread

### Task

Use when the expected output is a follow-up task rather than a doc or reply.

The created task should include:

- source link to the chat thread
- deliverable expectation that the assignee creates a new task when complete

## Task Creation Behavior

The task should be created in `ready` state.

The task description should include:

- the user's quick prompt
- a reverse-order excerpt of the chat thread, up to the latest 256 characters
- a clickable reference to the full chat thread
- any selected output instructions
- any extra references the user added

The short excerpt helps the task remain readable on the board. The full thread
link keeps the complete context available without bloating the task body.

## Pipeline Behavior

After creation, the normal task pipeline picks up the ready task.

NO CODE CHANGE HERE. Just update the default dispatch prompt for a task kick off. 

The pipeline should:

1. Read the task.
2. Follow source and reference links.
3. Expand the relevant chat context.
4. Edit the task description if it needs a better execution brief.
5. Execute or dispatch the work.
6. Attach the deliverable.
7. Post validation evidence.
8. Move the task to review when ready.

## Link Behavior

All links in the task description and references must be clickable.

Clickable links should route to the correct Flight Deck surface when possible:

- chat thread
- task
- doc
- scope
- flow
- approval
- storage object

If a linked object cannot be opened directly, Flight Deck should show a useful
fallback instead of leaving a dead link.

## Acceptance Criteria

- A user can create a ready task from a chat thread in under one minute.
- The created task clearly explains what to do.
- The source chat thread is preserved as a clickable source link.
- The selected output type creates a clear deliverable expectation.
- The assignee default is useful but always overridable.
- An agent can start from the task alone and recover the needed context.