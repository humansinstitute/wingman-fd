# Agent Chat Trigger Handoff And Bot Provisioning Baseline

Status: decision note, phase 1 / WP03
Last updated: 2026-04-07
Source work package: `../../../../docs/design/001_agent_chat/phase1/FlightDeck/workpackage_03.md`
Canonical design: `../../../../docs/design/001_agent_chat/agent_chat.md`

## Purpose

Pin the Tower-visible persistence path that Flight Deck will use for the
Agent Chat trigger record in v1, inventory the fields Wingmen will need to
read once that record is synced, and confirm that adding a bot to the
trigger's target group results in decrypt-capable wrapped keys for that
bot. This document is a contract pin. Implementation of the trigger
record itself is phase 2 Flight Deck work.

## Decision — record family

The Agent Chat trigger is a **new, independent Tower-synced record family
owned by Flight Deck**. Pinned identifiers:

| Item | Value |
| --- | --- |
| Sync family id (local key in `sync-families.js`) | `agent_chat_trigger` |
| `collection_space` stamped into the inner payload | `agent_chat_trigger` |
| `record_family_hash` | `${APP_NPUB}:agent_chat_trigger` (produced by `recordFamilyNamespace()` in `src/app-identity.js`) |
| Inner payload `type` | `agent_chat_trigger_v1` |
| Dexie table (phase 2 to add) | `agent_chat_triggers` (suggested) |

This family name is the cross-repo contract. Wingmen will filter for
exactly `${workspace_app_npub}:agent_chat_trigger` when subscribing, and
will look for `type === 'agent_chat_trigger_v1'` inside the decrypted
payload. The family name must not be redefined in phase 2 without
updating `agent_chat.md`.

### Why not extend `workspace_settings`?

The current workspace settings record in `src/translators/settings.js`
already carries an in-band `triggers: []` array (harness trigger rules
consumed by the legacy trigger flow, see `src/triggers-manager.js`).
Agent Chat triggers are a different contract with a different audience
(Wingmen bot subscribers, not the harness signer flow) and a different
visibility requirement (the record must be encrypted to a group the bot
is a member of — see "Encryption envelope" below). Overloading
`workspace_settings` would fuse two unrelated lifecycles and would make
it impossible for a bot to decrypt just the Agent Chat trigger without
also being a reader on all workspace settings. A dedicated family is
the cheaper path and matches `agent_chat.md` §"Trigger Configuration
Contract".

## Tower-visibility confirmation

The record lives on the exact same V4 record envelope that Flight Deck
already writes for every other family:

1. Flight Deck builds an `innerPayload` with `app_namespace = APP_NPUB`,
   `collection_space = 'agent_chat_trigger'`, `schema_version = 1`,
   `record_id`, and `data` (the v1 shape below).
2. Flight Deck encrypts an `owner_payload` via `encryptOwnerPayload`
   (workspace-key path in `src/translators/record-crypto.js`).
3. Flight Deck calls `buildGroupPayloads(group_ids, innerPayload)` to
   produce per-group ciphertexts keyed by current epoch.
4. Flight Deck signs and POSTs the record to Tower through
   `src/api.js` `upsertRecord` (same path every other family uses).
5. Tower persists it, emits the normal SSE advisory, and the
   `record_family_hash = ${APP_NPUB}:agent_chat_trigger` is visible to
   any subscribed actor that can read at least one of the record's
   `group_payloads[].group_id` entries.

This is the same Tower path that `workspace_settings`, `channels`,
`chat_messages`, etc. already ride. **The trigger record is Tower-visible
by construction; Dexie is a local cache only, not the handoff contract.**

No new Tower route is required. The only missing pieces are
Flight-Deck-side: the translator, the Dexie table, the `sync-families.js`
entry, and the UI that writes it. Those are phase 2.

## v1 payload shape

Mirrors the recommended shape from `agent_chat.md` and extends it with
the fields phase 2 Wingmen routing needs without rediscovery.

```json
{
  "app_namespace": "<APP_NPUB>",
  "collection_space": "agent_chat_trigger",
  "schema_version": 1,
  "record_id": "<uuid>",
  "data": {
    "type": "agent_chat_trigger_v1",
    "enabled": true,
    "scope": "workspace",
    "workspace_owner_npub": "<owner npub>",
    "source_app_npub": "<APP_NPUB>",
    "target_group_id": "grp_...",
    "target_group_npub": "npub1...",
    "updated_at": "2026-04-07T00:00:00.000Z",
    "record_state": "active"
  }
}
```

Notes on fields that are not explicit in the design doc but that phase 2
will need:

- `source_app_npub` is included in the payload even though it is always
  `APP_NPUB` today. The canonical routing key in `agent_chat.md`
  (`workspace_owner_npub + source_app_npub + channel_id + thread_id +
  target_bot_npub`) requires it, and if Flight Deck ever forks into
  multiple app families we must not retrofit a missing field.
- `workspace_owner_npub` is duplicated inside `data` even though it is
  already present on the record envelope. Wingmen reads from the
  decrypted payload in most hot paths; keeping it inline avoids a join.
- `scope: "workspace"` is fixed in v1. Later phases may add per-channel
  or per-scope narrowing.

## Field inventory — what Wingmen needs and where it lives today

### Channel participants

- Dexie: `channels.participant_npubs` (array column). Index not defined
  but the field is populated by `src/translators/chat.js` `inboundChannel`
  at line 28: `Array.isArray(data.participant_npubs) ? data.participant_npubs : [record.owner_npub]`.
- Tower envelope: inside the decrypted channel record `data.participant_npubs`.
- Wingmen routing rule from `agent_chat.md`:
  `target_bot_npubs = channel.participant_npubs ∩ trigger target group members`.
  Both inputs are already available to a bot that can decrypt the
  channel record and list members of the trigger target group.

### Group assignments

- Dexie: `groups` table (`group_id`, `owner_npub`, `member_npubs[]`).
  Materialized by `src/channels-manager.js` `refreshGroups` from the
  Tower `/api/v4/groups` response, which returns `member_npubs` for
  every group the viewer can see.
- Tower: `/api/v4/groups` and `/api/v4/groups/{id}/members`.
- Channel→group linkage: `channels.group_ids[]`, derived from
  `record.group_payloads[].group_id` by `inboundChannel`.
- Wingmen (as the bot actor) will hit the same `/api/v4/groups` route
  to resolve trigger target group membership and enumerate candidate
  target bots.

### Source app identity

- `src/app-identity.js` exports `APP_NPUB` (default
  `npub1hd37reqgfcnz3pvzj4grknd2nkzc94p9ercmunrxx22razr2rfxsw6dns5`,
  overridable via `VITE_COWORKER_APP_NPUB`).
- Every inner payload stamps `app_namespace: APP_NPUB`.
- Every record family hash is `${APP_NPUB}:<collection_space>`, computed
  by `recordFamilyNamespace()` in `app-identity.js` and re-exported by
  each translator's local `recordFamilyHash`.
- For Agent Chat v1 the producing app is always Flight Deck, so
  `source_app_npub === APP_NPUB`. Wingmen should still read the value
  from the payload, not hardcode it.

### Existing settings / materialization paths

- Workspace settings family hash: `${APP_NPUB}:settings` (see
  `src/sync-families.js` line 12, `src/translators/settings.js` line 5).
- Workspace settings Dexie table: `workspace_settings`, schema
  `&workspace_owner_npub, record_id, updated_at` (see `src/db.js`
  line 40).
- Legacy harness triggers live inline on `workspace_settings.triggers`
  (managed by `src/triggers-manager.js`, persisted via
  `saveHarnessSettings`). These are **unrelated** to Agent Chat triggers
  and must not be conflated. Agent Chat adds a new family and new Dexie
  table.
- Sync registration lives in `src/sync-families.js`. Phase 2 will add
  an entry of the shape:
  `{ id: 'agent_chat_trigger', label: 'Agent Chat trigger', hash: recordFamilyHash('agent_chat_trigger'), table: 'agent_chat_triggers' }`
  using a new translator module `src/translators/agent-chat-trigger.js`.

## Encryption envelope — trigger must be readable by the bot

This is the non-obvious constraint phase 2 must not miss.

For a Wingmen bot to consume the trigger via Tower sync, the trigger
record's `group_payloads` must include at least one group whose current
epoch key is held by the bot. Options:

1. **Encrypt to the trigger's own target group** (`target_group_id`).
   The bot is, by definition, a member of that group once it has been
   added there, so its wrapped key is already provisioned. This is the
   simplest rule and is the recommended v1 path.
2. Encrypt to a dedicated "agent control" group. Adds a second
   membership management flow; deferred.

Phase 2 Flight Deck writer MUST populate `group_ids` for the trigger
record from `[target_group_id]` and MUST block saves when the workspace
signer is not currently a member of that group (otherwise
`buildGroupPayloads` will throw on missing loaded key — the error is
usable but the UX should catch it earlier). This also means:

- Changing the target group requires writing a new version of the
  trigger record with new `group_payloads`.
- Rotating the target group's epoch does not invalidate past records
  but does mean the bot must refresh its wrapped keys before its next
  decrypt attempt (standard group rotation behavior, already handled
  by `group-keys.js` `bootstrapWrappedGroupKeys`).

## Wrapped-key provisioning for bots — verification

Claim: adding a bot to the trigger's target group is sufficient to give
that bot a decrypt-capable wrapped key, through the existing Flight Deck
flow.

Trace:

1. UI (or future Agent Chat settings UI) calls `app.addEncryptedGroupMember(groupId, botNpub)`.
2. `channels-manager.js` `addEncryptedGroupMember` (line 283) calls
   `wrapKnownGroupKeyForMember(groupRef, botNpub, ownerNpub)`.
3. `group-keys.js` `wrapKnownGroupKeyForMember` (line 290) loads the
   current epoch key from the in-memory group-key cache and calls
   `personalEncryptForNpub(botNpub, key.nsec)` — NIP-44 encryption of
   the group nsec to the bot's pubkey.
4. The result `{ member_npub, wrapped_group_nsec, wrapped_by_npub }`
   is POSTed to Tower at `/api/v4/groups/{groupId}/members` by
   `api.js` `addGroupMember` (line 146).
5. Tower persists the wrapped-key row keyed by `member_npub`.
6. When the bot later authenticates to Tower as itself and calls
   `GET /api/v4/groups/keys?member_npub=<botNpub>` (`api.js`
   `getGroupKeys` line 182), Tower returns the wrapped entries.
7. Bot-side `bootstrapWrappedGroupKeys` (`group-keys.js` line 131)
   NIP-44-decrypts each `wrapped_group_nsec` using the bot's own nsec
   (`personalDecryptFromNpub(wrapped_by_npub, wrapped_group_nsec)`),
   producing the decrypt-capable group key.

The encryption is symmetric over npubs — the code path does not
distinguish human members from bot members, so any bot that owns a
nostr secret key will successfully decrypt a wrapped_group_nsec that
was created for its npub. **Provisioning works today.**

### What is still required of Wingmen / Tower (out of scope for WP03)

- Tower must accept the bot's NIP-98 auth as itself for
  `/api/v4/groups/keys?member_npub=<botNpub>` and for any record pull.
  That is the WP02 workspace-key contract.
- Wingmen must persist the bot nsec and use it for NIP-44 decrypt, not
  the human root key. That is the WP01 / WP04 bootstrap work.

No gap has been identified in the Flight Deck half of wrapped-key
provisioning. WP03 records this as **no blocker** for phase 1.

## Gaps and backlog items for phase 2 Flight Deck

These are intentionally not implemented in WP03. Each one becomes a
phase 2 Flight Deck task:

1. **Add `agent_chat_trigger` sync family registration** in
   `src/sync-families.js` with `table: 'agent_chat_triggers'`.
2. **Create `src/translators/agent-chat-trigger.js`** exporting
   `recordFamilyHash('agent_chat_trigger')`, `inboundAgentChatTrigger`,
   and `outboundAgentChatTrigger`. Use the v1 payload shape above.
3. **Add the `agent_chat_triggers` Dexie table** to `src/db.js`
   `WORKSPACE_STORES` (and to the migrations block). Suggested schema:
   `&record_id, target_group_id, updated_at`.
4. **Writer path**: build a workspace-settings subsection for Agent
   Chat. The writer must validate that the active signer has the
   target group's epoch key loaded before calling
   `outboundAgentChatTrigger` + upsert, and must surface a clear error
   otherwise. The writer MUST set `group_ids = [target_group_id]` so
   `buildGroupPayloads` produces a payload the bot can decrypt.
5. **Live query / Alpine state**: read-side materialization so the UI
   can display the current trigger without re-fetching.
6. **Delete / disable semantics**: tombstone via `record_state:
   'deleted'` on the existing V4 envelope, same as other families.
7. **Cross-link from the existing harness trigger UI** (or a new Agent
   Chat settings panel) so the v1 rule is discoverable without
   colliding with the legacy `workspaceTriggers` array in
   `workspace_settings`.

All seven are phase 2 scope. None of them are blocked by other repos
except for (4), which implicitly assumes the bot has been added to
the target group through the existing `addEncryptedGroupMember` flow
— which we confirmed works above.

## Acceptance check against WP03

- [x] Trigger handoff path is unambiguous: V4 record envelope with
      `record_family_hash = ${APP_NPUB}:agent_chat_trigger`, upserted
      through the existing Flight Deck Tower path.
- [x] Wrapped-key provisioning rule for bots is explicit: add the bot
      via `addEncryptedGroupMember` on the target group;
      `wrapKnownGroupKeyForMember` + Tower `/groups/{id}/members` do the
      rest. Bots use the same NIP-44 unwrap code path as humans.
- [x] Phase 2 Flight Deck implementation can proceed without
      rediscovery: translator module, Dexie table name, sync family
      registration, writer constraints, and payload shape are all
      pinned above.
- [x] Exact record family name is pinned:
      `agent_chat_trigger` → `${APP_NPUB}:agent_chat_trigger`,
      payload type `agent_chat_trigger_v1`.

## Non-blockers / non-goals

WP03 does not and should not:

- implement the translator, Dexie table, or UI — phase 2
- widen into trigger rule expressions (multiple rules, channel scoping,
  conditional dispatch) — explicitly deferred in `agent_chat.md`
  §Decisions item 1
- change the legacy `workspaceTriggers` harness flow in
  `src/triggers-manager.js` — separate contract, separate audience
- touch Tower routes (none needed)
- touch Wingmen or Yoke code
