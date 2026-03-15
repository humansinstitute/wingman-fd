# Coworker V4 Agent Connect

This page is the semantic guide for agents connecting to this Coworker v4 workspace.

Use it together with:

- OpenAPI: `https://sb4.otherstuff.studio/openapi.json`
- Docs UI: `https://sb4.otherstuff.studio/docs`
- Health: `https://sb4.otherstuff.studio/health`

OpenAPI tells you how to call the API. This guide tells you what the data means.

## Primary flow

1. Ask the user to open the avatar menu.
2. Ask the user to click `Agent Connect`.
3. Ask the user to paste the copied JSON package into the agent session.

The package contains:

- `guide_url`: this document
- `service.direct_https_url`: the SuperBased v4 HTTPS endpoint
- `service.openapi_url`: live OpenAPI for the current service
- `service.docs_url`: interactive docs UI
- `service.service_npub`: the service identity for Context VM / service trust
- `workspace.owner_npub`: workspace owner identity
- `workspace.owner_pubkey`: workspace owner pubkey in hex
- `app.app_npub`: the Coworker app/schema identity
- `connection_token`: a v4 connection key another Coworker or agent can use

## What SuperBased v4 is in this app

Coworker v4 uses a workspace-scoped append-only record system.

- The backend exposes HTTP endpoints for groups and records.
- Records are versioned. New writes append a new version instead of mutating the old row.
- Visibility is controlled through group payloads attached to each record version.
- The current frontend still uses plaintext JSON inside `owner_payload.ciphertext` and `group_payloads[].ciphertext`.
- The route and payload shapes are intended for future encrypted payloads, even though the current translator layer is still plaintext.

## Core identities

There are three important identity layers:

### 1. Service identity

- Field: `service.service_npub`
- Meaning: the SuperBased service identity
- Use: trust/context for Context VM or service-level integrations
- Do not confuse this with workspace ownership

### 2. Workspace owner identity

- Fields: `workspace.owner_npub`, `workspace.owner_pubkey`
- Meaning: whose workspace data is being read or written
- Default: for a personal workspace, this is usually the currently signed-in user
- Important: v4 write routes currently require `owner_npub` to match the authenticated Nostr identity

### 3. App identity

- Field: `app.app_npub`
- Meaning: the Coworker app/schema namespace
- Use: record family scoping and data-shape identity
- Do not use this for service discovery

## Connection token

The `connection_token` is a base64-encoded JSON object in this shape:

```json
{
  "type": "superbased_connection",
  "version": 2,
  "direct_https_url": "https://sb4.otherstuff.studio",
  "service_npub": "npub1...",
  "workspace_owner_npub": "npub1...",
  "app_npub": "npub1..."
}
```

If `workspace_owner_npub` is omitted, agents should default to the currently logged-in user for personal workspace use.

## API model summary

### Groups

Groups define sharing boundaries.

- `POST /api/v4/groups`
- `POST /api/v4/groups/{groupId}/members`
- `GET /api/v4/groups?owner_npub=...`
- `DELETE /api/v4/groups/{groupId}`

The current backend treats listed groups as groups owned by the authenticated owner.

### Records

Records are synced through:

- `POST /api/v4/records/sync`
- `GET /api/v4/records?...`

Each synced record has:

- `record_id`
- `record_family_hash`
- `version`
- `previous_version`
- `signature_npub`
- `owner_payload`
- `group_payloads`

Writes are append-only and version-checked:

- create: `version=1`, `previous_version=0`
- update: `version=N`, `previous_version=N-1`
- stale writes are rejected

## Record families used by Coworker v4

Coworker scopes record families with the app namespace:

- `<app_npub>:channel`
- `<app_npub>:chat_message`
- `<app_npub>:directory`
- `<app_npub>:document`
- `<app_npub>:task`
- `<app_npub>:comment`

The exact `app_npub` comes from the Agent Connect package.

## Payload conventions

All current outbound payloads follow this broad shape:

```json
{
  "app_namespace": "<app npub>",
  "collection_space": "task",
  "schema_version": 1,
  "record_id": "<uuid>",
  "data": {
    "...": "family-specific fields",
    "record_state": "active"
  }
}
```

Important:

- `schema_version` is currently `1`
- `record_state` is usually `active` or `deleted`
- payloads are currently plaintext JSON wrapped in the ciphertext fields

## Family-specific shapes

### Channel

Used for chat channels.

```json
{
  "app_namespace": "<app npub>",
  "collection_space": "channel",
  "schema_version": 1,
  "record_id": "<uuid>",
  "data": {
    "title": "General",
    "participant_npubs": ["npub1...", "npub1..."],
    "record_state": "active"
  }
}
```

### Chat message

Used for channel messages and replies.

```json
{
  "app_namespace": "<app npub>",
  "collection_space": "chat_message",
  "schema_version": 1,
  "record_id": "<uuid>",
  "data": {
    "channel_id": "<channel uuid>",
    "parent_message_id": null,
    "body": "hello world",
    "record_state": "active"
  }
}
```

### Directory

Used for docs folder structure.

```json
{
  "app_namespace": "<app npub>",
  "collection_space": "directory",
  "schema_version": 1,
  "record_id": "<uuid>",
  "data": {
    "title": "Projects",
    "parent_directory_id": null,
    "shares": [],
    "record_state": "active"
  }
}
```

### Document

Used for docs content.

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
