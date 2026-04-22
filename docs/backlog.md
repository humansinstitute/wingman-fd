# Backlog

Items deferred from active design work. Review periodically.

## SSE Scaling

**Source:** [docs/design/sse-updates.md](./design/sse-updates.md)

If Tower moves beyond single-process deployment (e.g., multiple instances behind a load balancer), the SSE fan-out needs shared state for cross-process event delivery. Options:

- Redis pub/sub between Tower instances
- PostgreSQL LISTEN/NOTIFY (already using Postgres)
- Dedicated SSE fan-out service

Current assumption is users run their own Tower instance (single Bun process), so this is not needed now. Revisit if multi-instance deployment becomes a requirement.

## Agent Chat Trigger v1 — Phase 2 Flight Deck Implementation

**Source:** [docs/design/agent-chat-trigger-handoff.md](./design/agent-chat-trigger-handoff.md)
**Parent:** `../../docs/design/001_agent_chat/agent_chat.md` and `../../docs/design/001_agent_chat/phase1/FlightDeck/workpackage_03.md`

WP03 pinned the record family `agent_chat_trigger` (payload type
`agent_chat_trigger_v1`), confirmed Tower-visibility through the existing
V4 record envelope, and verified that adding a bot to a group via
`addEncryptedGroupMember` provisions a decrypt-capable wrapped key.

Phase 2 Flight Deck work required to make the trigger record actually
writable and consumable:

- add `agent_chat_trigger` to `src/sync-families.js` with table
  `agent_chat_triggers`
- create `src/translators/agent-chat-trigger.js` using
  `recordFamilyHash('agent_chat_trigger')` and the v1 payload shape
  pinned in the decision note
- add the `agent_chat_triggers` Dexie table in `src/db.js` with schema
  `&record_id, target_group_id, updated_at`
- writer path: validate the signer currently holds the target group's
  epoch key, then `buildGroupPayloads([target_group_id], innerPayload)`
  so the record is decrypt-capable for bots in that group
- Alpine live-query + read-side state
- delete/disable via `record_state: 'deleted'` on the same envelope
- Agent Chat settings UI distinct from the legacy `workspaceTriggers`
  harness flow in `src/triggers-manager.js`

None of these are blocked by WP01/WP02/WP04; the decision note records
"no blocker" for the Flight Deck half of wrapped-key provisioning.
