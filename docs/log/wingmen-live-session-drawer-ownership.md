# Wingmen Live Session Drawer Ownership

## Context

Task `539eeac6-a5c7-444b-97f7-42a3ed2716e6` asks for a session-metadata drawer, session goal and next-action editing, Night Watchman on/off, related-record links, and Night Watchman trigger history.

The current `wingman-fd` tree contains:

- workspace-scoped automation settings in `workspace_settings`
- legacy Agent Chat diagnostics in `agent_chat_triggers`
- no existing live-session route
- no existing Night Watchman runtime data model

## Decision

Session-scoped runtime metadata must not be stored in `workspace_settings` or `agent_chat_triggers`.

Instead:

- Wingmen operational APIs should remain the source of truth for live session metadata and Night Watchman history.
- Flight Deck should consume those APIs through the configured harness URL and materialize the results into dedicated local live-session tables or an equivalent isolated adapter layer.

## Why

- `workspace_settings` is shared workspace state. Using it for one live session’s goal or next action would leak runtime state across sessions.
- `agent_chat_triggers` is a legacy workspace automation record with different semantics and should not become a generic session-control bucket.
- The requested Night Watchman history is operational history, not Tower-synced workspace content.
- Keeping session data isolated preserves the current contract split: Tower owns workspace records; Wingmen owns runtime session operations.

## Consequences

- A later production pass will likely require coordinated follow-up in `../wingmen` for the operational read and write endpoints.
- Flight Deck implementation should add a dedicated live-session manager and isolated local storage rather than extending existing settings translators.
- The drawer design can still be completed in Flight Deck now, but implementation must keep the runtime-data boundary explicit.
