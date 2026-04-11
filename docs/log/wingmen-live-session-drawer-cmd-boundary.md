# Wingmen Live Session Drawer Cmd Boundary

## Context

Task `539eeac6-a5c7-444b-97f7-42a3ed2716e6` adds a left-side session drawer to the Wingmen Live screen. The current upstream owner at [../../wingmen/src/ui/views/live-view.js](/Users/mini/code/wingmen/src/ui/views/live-view.js) already has a broad `Cmd` menu with session controls, repo actions, app actions, transcript utilities, attachments, terminal controls, and destructive stop actions.

Without an explicit boundary, the next implementation pass could treat "the drawer will likely absorb a large portion of the current CMD menu over time" as permission to migrate everything in one shot.

## Decision

The first drawer slice stays narrow.

Move into the drawer now:

- session metadata display
- goal editing
- current next-action editing
- Night Watch enabled or disabled state and toggle
- related-record display
- Night Watch history preview and modal path

Keep in `Cmd` for now:

- `Git`
- `Gitea`
- `App`
- `Open Web View` or `Close Web View`
- `Open Artifact` or `Close Artifact`
- `Scroll to end`
- `Last question`
- `Copy chat`
- `Rename session`
- `Attach image`
- `Upload file`
- `Record voice note`
- `Terminal`
- `Stop Session`

## Why

- The acceptance targets only require drawer entry, metadata, Night Watch controls, related records, responsive layout, and a Night Watch history modal.
- Migrating the broader `Cmd` surface now would turn this into a control-menu rewrite instead of a session-drawer task.
- Keeping the first slice narrow reduces merge risk with the existing upstream menu wiring and with the conflicting dirty-tree Flight Deck experiment in this repo.
- Requirement 6 explicitly frames the larger `Cmd` absorption as gradual future work.

## Consequences

- The next implementation pass should not treat missing Git, app, terminal, or attachment actions in the drawer as a blocker for the first shipment.
- Follow-up tasks can separately decide which additional `Cmd` surfaces move next, after the metadata drawer is stable.
