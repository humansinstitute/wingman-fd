# Emoji Reactions For Chat Messages And Comments

Status: design proposal
Last updated: 2026-04-30
Primary artifact: `/Users/mini/code/wingmanbefree/wingman-fd/docs/design/emoji-reactions.md`

## Goal

Add lightweight emoji reactions to chat messages and comments.

The first usable slice should support:

- a default quick reaction, shown as `:smile:` in the design and rendered as the platform emoji in the UI
- choosing another allowed emoji from a small picker
- reacting to a chat message in the main feed
- reacting to the parent message or any reply in a chat thread
- reacting to task comments
- reacting to document comment roots and replies
- showing reaction pills directly on the target message or comment
- showing whether the current signed-in user has already reacted
- syncing reactions across Flight Deck and Yoke through Tower record sync

## Non-Goals

This design does not add:

- free-form arbitrary Unicode emoji input in the first slice
- reaction analytics
- reactions to documents, tasks, flows, approvals, or opportunities themselves
- editing another user's reaction
- Tower-specific reaction endpoints
- required Flight Logs integration

Those can be added later without changing the core data model.

## Current State

Flight Deck already has the target surfaces:

- chat messages use the `chat_message` family and materialize into `chat_messages`
- threaded chat replies are also `chat_message` records with `parent_message_id`
- comments use the generic `comment` family and materialize into `comments`
- task comments, document comments, document comment replies, and approval preview comments all reuse the `comment` family
- comments carry `target_record_id` and `target_record_family_hash`
- document comments also carry `anchor_block_id`, `anchor_line_number`, and `comment_status`

Tower already stores generic encrypted records by `record_family_hash`, so a new record family does not require a new Tower table or endpoint.

Yoke already mirrors shared Flight Deck families through SQLite, `src/sync.js`, and `src/translators.js`. If reactions are shared workspace state, Yoke must materialize them even if the first CLI does not expose a reaction command.

## Core Decision

Add a new shared record family:

```text
reaction
```

Do not store reactions inside `chat_message`, `comment`, `document`, or `task` payloads.

Reasons:

- Reactions are multi-user concurrent writes. Embedding them in the target record would create version conflicts any time two people react to the same message or comment.
- Users should be able to react without checking out or rewriting the target record.
- The target's encrypted payload should not churn just because reaction counts changed.
- A reaction can use the same access groups as its target while remaining independently deleted or restored.
- The same model works for chat messages and comments.

## Record Contract

### Family

```text
record_family_hash = `${recordFamilyNamespace()}:reaction`
collection_space = "reaction"
schema_version = 1
```

### Payload

```json
{
  "app_namespace": "npub1...",
  "collection_space": "reaction",
  "schema_version": 1,
  "record_id": "reaction uuid",
  "data": {
    "target_record_id": "chat or comment record id",
    "target_record_family_hash": "app:chat_message or app:comment",
    "emoji": "smile",
    "emoji_shortcode": ":smile:",
    "reactor_npub": "logical user npub",
    "record_state": "active"
  }
}
```

### Field Rules

- `target_record_id`: required. The record receiving the reaction.
- `target_record_family_hash`: required. Initially only `:chat_message` and `:comment` are supported.
- `emoji`: required canonical token. Use a constrained ASCII token such as `smile`, `thumbs_up`, `heart`, `eyes`, `party`.
- `emoji_shortcode`: required display shortcode derived from `emoji`, such as `:smile:`.
- `reactor_npub`: required logical actor. This should be the real workspace user where available, not merely a workspace session key signer.
- `record_state`: `active` or `deleted`.

The envelope `signature_npub` remains the signer identity. The payload `reactor_npub` is the actor identity shown in the UI. This distinction matters because workspace session keys can sign on behalf of a real user.

### Uniqueness

A user can have at most one active reaction for the same:

```text
target_record_family_hash + target_record_id + emoji + reactor_npub
```

The local database should enforce or emulate this with a compound index. Tower does not need to enforce it in the first slice because Tower stores generic records. Clients should dedupe during materialization.

### Toggle Semantics

When the current user clicks an emoji:

1. If an active matching reaction exists, soft-delete that reaction by writing a new version with `record_state = "deleted"`.
2. If a matching deleted reaction exists locally, reuse its `record_id` and write a new version with `record_state = "active"`.
3. If no matching reaction exists, create a new reaction record at version 1.

This keeps a stable version chain per user's reaction while avoiding writes to the target message or comment.

## Access And Encryption

Reactions inherit delivery groups from the target record.

For chat messages:

- load the target chat message
- load its channel
- use the channel `group_ids` and preferred write group

For comments:

- load the target comment
- load the comment's target record when possible
- use the same delivery group logic as comment writes:
  - task comment reactions inherit task write groups
  - document comment reactions inherit document write groups
  - comment reply reactions inherit the root/target record groups

If the client cannot resolve an encryptable target group, it must block the reaction write and show an error rather than creating an owner-only reaction that other viewers cannot see.

## Local Shape

Flight Deck should add a Dexie table:

```text
reactions:
  record_id,
  target_record_id,
  target_record_family_hash,
  emoji,
  reactor_npub,
  record_state,
  updated_at,
  &[target_record_family_hash+target_record_id+emoji+reactor_npub]
```

Materialized row:

```js
{
  record_id,
  owner_npub,
  target_record_id,
  target_record_family_hash,
  emoji,
  emoji_shortcode,
  reactor_npub,
  sender_npub,
  record_state,
  version,
  created_at,
  updated_at,
}
```

`sender_npub` should remain available for consistency with existing comment/message rendering, but reaction display should prefer `reactor_npub`.

## Display Model

Every target surface should receive a derived reaction summary, not raw reaction rows in markup.

Suggested helper output:

```js
[
  {
    emoji: 'smile',
    emoji_shortcode: ':smile:',
    count: 3,
    reacted_by_me: true,
    reactor_npubs: ['npub1...', 'npub1...'],
  }
]
```

Rules:

- hide deleted reactions
- group by `emoji`
- count unique `reactor_npub` values
- sort with current user's reacted emojis first, then by count descending, then by configured emoji order
- show a compact pill under the message/comment body
- quick click on an existing pill toggles the current user's reaction for that emoji
- a small add button opens the picker
- the default quick action writes `smile`

## Flight Deck Impact

Required files for the implementation slice:

- `src/translators/reactions.js`
  - add `recordFamilyHash`, `inboundReaction`, and `outboundReaction`
  - validate supported target families and canonical emoji tokens
- `src/sync-families.js`
  - register `{ id: 'reaction', label: 'Reactions', hash, table: 'reactions' }`
- `src/db.js`
  - add Dexie schema table and migration
  - add `getReactionsByTarget`, `getRecentReactionsSince`, `upsertReaction`, and helper queries for batch target loading
- `src/worker/sync-worker.js`
  - import `inboundReaction`
  - add `REACTION_FAMILY`
  - materialize pulled reaction records into `db.reactions`
- `src/app.js`, `src/chat-message-manager.js`, and `src/docs-manager.js`
  - hold reaction rows for the currently visible sections
  - expose summary/toggle helpers
  - reuse target group resolution instead of inventing a reaction-specific access path
- `index.html`
  - render reaction pills on chat messages, thread parent/replies, task comments, and doc comment roots/replies
  - add default quick reaction and picker controls near existing message/comment actions
- `src/styles.css`
  - compact reaction pill and picker styling
- `tests/`
  - add translator, DB, store helper, and UI-facing unit coverage
- `dist/`
  - rebuild with `bun run build` after source changes

Approval preview comments can reuse the same comment rendering helper once the base comment surfaces are wired.

## Tower Impact

Tower should remain generic for the first slice.

Expected Tower changes:

- no new SQL table
- no new reaction-specific route
- no new OpenAPI operation
- no change to record version enforcement
- no change to group visibility filtering

Tower validation to check:

- `POST /api/v4/records/sync` accepts the new `record_family_hash`
- `GET /api/v4/records` fetches reaction records by family
- `GET /api/v4/records/summary` reports reaction freshness
- SSE/freshness events include the reaction family the same way they include comment and chat families

If Tower has any allowlist or checkout policy mapping for known family suffixes, add `reaction` there. Reactions should not be checkout-required.

## Yoke Impact

Required Yoke changes if reactions are shared workspace state:

- `wingman-yoke/src/db.js`
  - add `reactions` table
- `wingman-yoke/src/translators.js`
  - add `inboundReaction` and `outboundReaction`
  - share the same canonical emoji tokens as Flight Deck
- `wingman-yoke/src/sync.js`
  - add `{ collection: 'reaction', table: 'reactions', mapper: inboundReaction }`
  - persist reaction rows in `mapRowForTable`
- `wingman-yoke/tests/translators.test.js`
  - cover inbound/outbound reaction payloads
- `wingman-yoke/tests/schema-compat.test.js`
  - validate reaction payloads against the published Flight Deck schema

Optional later Yoke commands:

- list reactions for a message/comment
- react/unreact to a message/comment
- include reaction summaries in agent-readable chat/comment output

## Published Schema Impact

Add:

```text
../sb-publisher/schemas/flightdeck/reaction-v1.json
```

The schema must be published with the other Flight Deck schemas before Yoke schema compatibility is considered complete.

The schema should keep `additionalProperties: false` so clients do not silently diverge.

## Wingmen And Agent Runtime Impact

Wingmen does not need to change for the first UI slice.

Potential later impact:

- if Wingmen session views render chat/comment history directly, add reaction summaries there
- if agents should react from tools, add the capability through Yoke first and expose it through Wingmen MCP/runtime second
- if reactions should influence agent attention or notifications, define that as a separate policy rather than mixing it into the base sync family

## Notification And Read Cursor Policy

Initial policy:

- a reaction does not update the target chat message/comment `updated_at`
- a reaction does not bump chat thread order
- a reaction does not mark a channel unread
- a reaction does not reopen a resolved document comment

Rationale:

- reactions are lightweight acknowledgements
- changing read/unread behavior would make common smile clicks noisy
- the reaction family can still sync live without disturbing message ordering

If product wants reaction notifications later, add a separate notification policy keyed by `target_record_id` and `reactor_npub`.

## Implementation Sequence

1. Add the published `reaction-v1.json` schema in `../sb-publisher/schemas/flightdeck`.
2. Add Flight Deck translator tests and `src/translators/reactions.js`.
3. Add Flight Deck Dexie table and DB helper tests.
4. Register the sync family and worker materialization.
5. Add reaction summary/toggle helpers for visible chat messages and comments.
6. Render reaction pills and the default `smile` quick action in chat.
7. Render the same controls in task and document comments.
8. Add Yoke SQLite, translator, sync, and schema-compat support.
9. Run targeted tests in Flight Deck and Yoke.
10. Run `bun run build` in Flight Deck and include regenerated `dist/`.

## Test Plan

Flight Deck:

- `tests/reactions-translator.test.js`
  - inbound materializes reaction payload
  - outbound writes valid family hash and payload
  - deleted reaction round-trips
  - workspace session signer does not erase `reactor_npub`
- `tests/reactions-db.test.js`
  - upserts by `record_id`
  - dedupes active reactions by target/emoji/reactor
  - excludes deleted rows from summary helpers
- `tests/chat-message-manager.test.js`
  - reaction summaries render for main feed, thread parent, and thread replies
  - clicking the default `smile` creates a pending reaction write
  - clicking an active own pill soft-deletes the reaction
- `tests/doc-comments-anchors.test.js` or a new `tests/doc-comment-reactions.test.js`
  - document comment root and reply reaction summaries stay attached to the right comment
- `tests/sync-repair.test.js`
  - reaction family is registered and repairable by family id
- `bun run build`

Yoke:

- `bun test tests/translators.test.js tests/schema-compat.test.js tests/sync.test.js`

Tower:

- run existing records tests
- add a small summary/SSE/family allowlist test only if Tower has a family allowlist that would reject `reaction`

## Rollout Notes

This can roll out without data migration because there are no existing reactions.

Clients that do not yet understand `reaction` records will ignore that family. They will not lose target message/comment content because reactions are separate records.

If Flight Deck ships before Yoke support, agents using Yoke will not see reactions. That is acceptable only if the product decision is "browser-only first." If reactions are part of shared collaboration state, ship Yoke materialization in the same pass.

## Open Questions

1. Should the first emoji set be fixed to a small allowlist, or should users be able to enter any emoji?
2. Is the default quick reaction definitely `smile`, or should it be `thumbs_up`?
3. Should one user be allowed to add multiple different emoji reactions to the same target?
4. Should reactions be visible in Yoke/agent summaries in the first release, or is materialization enough?
5. Should a reaction by someone else ever create a notification, unread marker, or activity entry?
6. Should reactions be allowed on approval preview comments immediately, or only after the underlying task/document comment surface is opened?
