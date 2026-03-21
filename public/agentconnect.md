# Deprecated

`/agentconnect.md` is kept only for compatibility.

Use [`/llms.txt`](/llms.txt) instead.

```json
{
  "app_namespace": "<app npub>",
  "collection_space": "document",
  "schema_version": 1,
  "record_id": "<uuid>",
  "data": {
    "title": "Scratch Pad",
    "content": "# Notes",
    "parent_directory_id": "<directory uuid or null>",
    "shares": [],
    "record_state": "active"
  }
}
```

### Task

Used for the kanban/task board.

```json
{
  "app_namespace": "<app npub>",
  "collection_space": "task",
  "schema_version": 1,
  "record_id": "<uuid>",
  "data": {
    "title": "Review API docs",
    "description": "Confirm routes and payloads",
    "state": "new",
    "priority": "sand",
    "parent_task_id": null,
    "board_group_id": null,
    "scheduled_for": null,
    "tags": "docs,api",
    "shares": [],
    "record_state": "active"
  }
}
```

Task state values currently used in the frontend:

- `new`
- `ready`
- `in_progress`
- `review`
- `done`
- `archive`

### Comment

Used for task notes/comments and other record-linked comments.

```json
{
  "app_namespace": "<app npub>",
  "collection_space": "comment",
  "schema_version": 1,
  "record_id": "<uuid>",
  "data": {
    "target_record_id": "<task or doc uuid>",
    "target_record_family_hash": "<family hash>",
    "parent_comment_id": null,
    "body": "Need follow-up here",
    "record_state": "active"
  }
}
```

## Sharing semantics

Sharing is implemented through `group_payloads`.

- Private records usually have no `group_payloads`
- Shared records copy the same payload into one or more group payload entries
- `group_payloads[].group_npub` is the share target
- `group_payloads[].write` indicates write-capable sharing

Current frontend conventions:

- tasks can carry `board_group_id` to indicate which group board they belong to
- docs/directories use explicit `shares` metadata in payload data
- chat channels/messages inherit their group visibility from the channel/share setup
- comments inherit visibility from the target record's group ids when created

## Current limitations and realities

Agents should understand these current v4 realities:

### Plaintext payloads

The payloads are not yet real encrypted ciphertext. They are plaintext JSON placed in the ciphertext fields by the translator layer.

### Owner-auth writes

The current backend write route requires:

- `body.owner_npub` to match the authenticated Nostr identity

That means shared group membership is enough for read visibility, but not automatically enough for arbitrary delegated writes through the current v4 HTTP contract.

### Append-only writes

Agents should never assume in-place mutation. Always write a new version with the correct `previous_version`.

## Guidance for external agents

- Use `guide_url` first for semantics
- Use `service.openapi_url` for exact HTTP shapes
- Use `connection_token` when another Coworker/agent session needs to connect to the same service
- Treat `workspace.owner_npub` as the primary workspace scope
- Treat `app.app_npub` as the Coworker schema namespace
- Prefer reading the latest version of each record family rather than assuming local cache truth
