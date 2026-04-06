# Groups, Shares and Scope Model

**Date:** 2026-04-01
**Task:** `d5b7cb6d-215a-42e7-b50d-5f3351e16f8b`
**Scope:** `d5713ab5-3274-4507-b675-a3ca21d02717`
**Status:** Canonical target model, refreshed against current workspace-key signer flow and SSE sync messaging

---

## 0. Purpose

This document is the single working reference for:

1. How groups should work.
2. The current gaps between that target model and the implementation.
3. The work packages needed to close those gaps.
4. The current signer and sync-transport implications that now exist in the live code.

The intended model is:

- `scope` is for human-readable organization, lineage, and UI filtering.
- `groups` and per-record `shares` are the access-control primitives.
- Tower mediates read and write access from group membership, key material, record payloads, and version rules.
- `group_id` is the stable identity of a group.
- `group_npub` plus `group_epoch` are rotating crypto-delivery state, not the durable product identity of the group.
- the workspace session key is now the normal runtime signer for request auth and owner-payload crypto once bootstrapped
- SSE is now part of the Flight Deck sync path and must be treated as part of the access/update contract even though it does not authorize reads by itself

---

## 1. How Groups Should Work

### 1.1 Core Principles

- A workspace contains people, groups, records, scopes, and storage objects.
- Access to records is enforced through each record version's shares and group payloads, not by direct scope lookup.
- Every record must preserve an owner-readable path through an owner-encrypted payload.
- Every non-owner read or write must resolve through a group.
- The stable access-control identity of a group is its UUID `group_id`.
- The rotating crypto identity of a group is the epoch keypair represented by `group_npub` and `group_epoch`.
- The real user key is the root identity used to bootstrap and register workspace session keys.
- The workspace session key is the default runtime signer for NIP-98 API auth, `signature_npub`, and owner-payload encryption when available.
- The current group epoch key is used for group payload encryption/decryption and live delegated write proofs.
- SSE notifications are advisory transport messages that tell clients what to refresh; actual visibility is still enforced by Tower on record fetch.

### 1.2 Group Model

Each group should be understood as two layers:

**Stable group identity**

- `group_id`
- `owner_npub`
- `name`

**Rotating crypto state**

- current `group_npub`
- epoch history in `v4_group_epochs`
- wrapped member keys in `v4_group_member_keys`

This separation is important:

- `group_id` should be used anywhere the product means "this logical group".
- `group_npub` should be used only where the system means "the crypto identity for a specific epoch".

### 1.3 Group Provenance

The target model does not need group provenance fields such as `group_kind` or `private_member_npub` to explain or enforce access.

There are only two things that matter to the core contract:

- an owner can create and manage groups
- records are shared to groups, and group membership plus key material governs access

If provenance fields are retained in implementation for bootstrap or UI convenience, they should be treated as optional metadata only. They should not shape the core data model, and they should not be required to explain how authorization works.

### 1.4 Runtime Signer Model

There are three distinct signer/key roles in the current system and the plan must treat them separately:

**Real user identity**

- the durable human identity
- used to bootstrap and register the workspace session key
- still required as the fallback path when a workspace key is not yet available

**Workspace session key**

- signs the top-level NIP-98 request to Tower
- becomes `signature_npub` on new record versions
- encrypts `owner_payload` in the new owner-payload envelope format
- is resolved by Tower back to the real user identity for ownership and membership checks

**Current group epoch key**

- encrypts and decrypts `group_payloads`
- signs the delegated group write proof for non-owner writes
- rotates independently of the workspace session key

Implications:

- `signature_npub` is no longer always the user's real npub.
- Owner-payload crypto and delegated group-write proof crypto are separate concerns.
- The workspace session key does not replace the group key. It replaces the user's real key on the normal runtime request path.

### 1.5 Record Model

Each record should be understood as four separate concerns:

**Ownership**

- `owner_npub`
- `owner_payload`
- `signature_npub`

**Organization**

- `scope_id`
- scope lineage fields

**Stable access intent**

- `shares`

**Versioned crypto delivery**

- `group_payloads`

The target shape is:

**Stable share metadata**

```json
[
  { "type": "group", "group_id": "uuid", "access": "read" },
  { "type": "group", "group_id": "uuid", "access": "write" },
  { "type": "person", "person_npub": "npub...", "via_group_id": "uuid", "access": "read" }
]
```

`shares` should express the intended policy. It should not carry rotating crypto state like `group_npub` or `group_epoch`.

**Versioned group payload metadata**

```json
[
  {
    "group_id": "uuid",
    "group_epoch": 3,
    "group_npub": "npub...",
    "can_write": true,
    "ciphertext": "..."
  }
]
```

`group_payloads` are the actual encrypted delivery paths for a specific record version.

In the current runtime, `owner_payload` is normally encrypted by the workspace session key when available, while the record remains owned by `owner_npub`.

### 1.6 Read Model

The intended read contract is:

**Owner reads**

- The owner can read their own record through `owner_payload`.

**Non-owner reads**

- A user can read a record only if Tower can find at least one record group payload for that record version where:
  - the payload references a group the user is a member of
  - the user holds a non-revoked key for the matching `group_epoch`
  - the record payload can be decrypted with that epoch's group key

Implications:

- Read access is not granted by scope.
- Read access is not granted by `shares` alone.
- `shares` describes intended access, but Tower enforces from `group_payloads` plus membership/key material.
- A newly added member does not automatically gain historical access to older record versions unless those records are explicitly reauthored as new versions under the current epoch.

### 1.7 Write Model

The intended write contract is:

**Owner writes**

- The owner can write new versions of their own records through the normal version chain.
- In the current runtime this usually means a request authenticated by the workspace session key, not the raw user key.

**Non-owner writes**

For a non-owner to write a record, Tower should require all of the following:

1. The top-level request is authenticated by either the real user key or a registered workspace session key.
2. Tower resolves that signer to the real user identity for ownership and membership checks.
3. The user is a current member of the chosen write group.
4. The client presents a valid live write proof signed with the current key for that write group.
5. The target group has write permission on the record:
   - for a new shared record, the new record version must include a writable group payload for that group
   - for an update, the prior version must already grant write access to that group
6. The record version chain is valid.

Implications:

- Write access is not granted by scope.
- Write access is not granted by `shares` alone.
- Non-owner writes are mediated by Tower using resolved user identity, current group membership, current group proof, prior record permissions, and version rules.
- The target state should prefer stable `write_group_id`, but the current codebase still accepts legacy `write_group_npub` in several paths during migration.

### 1.8 Scope Model

Scope should be treated as:

- human-readable organization
- lineage and hierarchy
- board and screen filtering
- the source of the inherited sharing policy for records in that scope

Scope should not be treated as:

- an authorization primitive
- a substitute for record-level group payloads

Tower should still authorize from the record version's actual shares and group payloads, not by consulting scope directly at read time.

However, moving a record to a different scope should create a new record version even if no user-visible content changed. That new version should:

- inherit the new scope's groups and read/write policy
- rewrite the record's stable `shares`
- regenerate the record's `group_payloads`

This means scope is not the enforcement primitive, but scope changes are expected to materialize into new per-record access state. That is what a user would expect when moving a record from a broad scope to a restricted scope.

### 1.9 Sync and SSE Messaging Model

Flight Deck now has a live sync transport layer in addition to the record and group model:

- the sync worker owns one SSE connection per active workspace
- the SSE connection is authenticated with a token signed by the workspace session key
- Tower emits `record-changed` when a record version is accepted
- Tower emits `group-changed` when group membership or epoch state changes
- the worker debounces record events by family and performs targeted pulls
- `group-changed` causes a group refresh so new keys and membership arrive before later record pulls
- `catch-up-required` forces a full sync when the replay cursor is no longer available
- `heartbeat`, reconnect, and fallback-to-polling behavior are part of the real runtime contract

Important boundary:

- SSE does not grant read access.
- SSE is advisory transport only.
- Tower still enforces visibility when the client performs the follow-up pull.

Yoke should currently be treated as request/response sync. The SSE contract is an active Flight Deck runtime concern, not yet a shared transport assumption across all clients.

### 1.10 Figures

Figure 1 captures the intended separation between owner access, shared group access, and encrypted group delivery.

![doc-block-image-2026-03-31T06-02-38.png](storage://025796ad-4a82-4a9a-9ac7-e79d466088e5)

Figure 2 captures the intended mediation role of Tower: users hold memberships and epoch-bound key material, while Tower authorizes record reads and writes based on ownership, group access, and versioned payload rules.

![fc1d6dd1-3150-4b52-b066-5873610fb37d.png](storage://03c034b2-e83a-4f1c-8a8d-501876c7ba1c)

---

## 2. Current Gaps in Implementation

### 2.1 Stable Group Identity and Rotating Crypto Identity Are Not Cleanly Separated Everywhere

The target model requires a hard split:

- stable `group_id` for product identity
- rotating `group_npub` plus `group_epoch` for crypto delivery

The current codebase still mixes these references in client state and translator fields. In practice, some fields named `group_npub` hold a UUID, and some arrays such as `group_ids` may carry either a UUID or a rotating group reference depending on the translation path.

This is the most important structural gap because it makes the model harder to reason about and creates fragility around rotation, cache repair, and pruning.

### 2.2 The Authorization Contract Is Correct in Tower but Not Expressed Cleanly in the Product Model

Today, Tower read and write enforcement is based on:

- record group payload rows
- current membership
- epoch-matched key material
- current group write proofs for non-owner writes
- version-chain rules

That is the right enforcement shape.

The gap is that the product and document model still tend to talk as if `shares` directly controls authorization. That is too loose. `shares` is intended policy metadata; Tower actually authorizes from payloads, keys, memberships, and version rules.

### 2.3 The Runtime Signer Model Is Under-Documented

The live code now uses workspace session keys in Flight Deck, Yoke, and Tower:

- Tower resolves NIP-98 signers through the workspace-key mapping
- `signature_npub` is expected to match the authenticated signer, which may be the workspace key
- owner-payload encryption prefers the workspace key path

The current plan does not describe this clearly enough. It still reads too much like the user's real key directly signs and encrypts the normal runtime path.

That is now incorrect in the live code and it makes failures harder to debug:

- invalid-MAC investigations become confusing if the document does not distinguish workspace-key owner-payload crypto from group-payload crypto
- auth mismatches are harder to reason about if `signerNpub` and `userNpub` are treated as the same actor
- the group write proof can be mistaken for the main request signer even though they are separate proofs

### 2.4 Non-Owner Write Paths Still Accept Rotating Group References

The target model should prefer stable `write_group_id`.

The current implementation still allows `write_group_npub` paths. That means stale rotating references can be carried longer than necessary and makes write failures harder to reason about after a group rotation.

The plan should also reflect the real current state more precisely:

- Flight Deck still uses `buildWriteGroupFields()` heuristics
- several outbound translators still speak in `write_group_npub` terms even when a UUID is present
- Yoke client sync still prefers `write_group_npub` and drops `write_group_id` when both exist

So the correct plan is a staged migration, not a hand-wave that the fallback can simply disappear immediately.

### 2.5 Scope Moves Do Not Yet Cleanly Materialize Access Changes

The intended model is:

- scope organizes work
- scope carries the inherited sharing policy for records in that scope
- shares and group payloads control the actual per-record access enforced by Tower

The gap is that moving a record between scopes is not yet documented and enforced as a guaranteed new version that rewrites the record's inherited shares and group payloads.

The target behavior is:

- moving a record to a new scope creates a new record version
- the new version inherits the new scope's read/write groups
- the new version updates the record's shares and encrypted group payloads accordingly

That is the expected user behavior. A scope move from "everyone" to "top secret" must update access.

### 2.6 Local Pruning and Cache Repair Still Depend on Mixed Group References

The access pruner and local selectors currently work across a mixed world of `group_id` and `group_npub`. That is survivable, but it is not the canonical target state.

The gap is not that the pruner is definitively wrong in all cases. The gap is that the local model is not normalized strongly enough to make rotation and stale references boring.

### 2.7 Historical Access Semantics Need To Be Explicitly Documented and Tested

The current crypto model correctly means:

- a newly added member gets the current epoch key
- that member does not automatically gain access to old record versions encrypted to older epochs

This is a valid security property.

The remaining gap is documentation and validation:

- this behavior should be stated clearly in the model
- tests should lock this in so workarounds are not reintroduced later

### 2.8 The SSE Sync Contract Is Missing From This Plan

The live Flight Deck runtime now depends on SSE for real-time propagation of record and group changes:

- Tower emits `record-changed` and `group-changed`
- the worker owns replay, debounce, reconnect, catch-up, and fallback-to-polling behavior
- the worker refreshes groups when a group event lands

The current plan does not treat this transport as part of the model. That is now a real gap because:

- group rotation and membership changes are no longer just data-model concerns; they also need correct event emission and client refresh behavior
- scope/share fixes can be correct in storage but still feel broken if group changes do not propagate through SSE correctly
- signer changes and workspace-key registration now affect whether the SSE connection exists at all

### 2.9 Terminology and Field Naming Still Blur the Model

Examples of the current naming problem:

- fields named `group_npub` sometimes carry stable group identifiers
- `shares` and `group_payloads` are discussed as if they are the same layer
- scope-linked defaults can be mistaken for scope-based authorization

This is not cosmetic. It makes the system harder to maintain and easier to misuse.

---

## 3. Work Packages to Close Gaps

### WP1. Canonical Group, Signer, and Share Contract

Define and ratify the canonical data model:

- `group_id` is the durable group identity everywhere in product logic
- `group_npub` plus `group_epoch` are payload/epoch fields only
- `shares` is stable policy metadata only
- `group_payloads` is the encrypted delivery layer only
- `scope` carries the inherited sharing policy that must be materialized onto each record version
- the real user key, workspace session key, and group epoch key have distinct responsibilities that must be named explicitly

**Deliverables**

- Short architecture note for Tower, Flight Deck, and Yoke
- Final JSON shapes for `shares`, `group_payloads`, write-group fields, and signer-related fields
- Explicit rule that `shares` must not include rotating crypto state
- Explicit rule that provenance fields like `group_kind` are not part of the canonical access model
- Explicit rule that the workspace session key is the default runtime signer, while the group epoch key remains the delegated write-proof signer

**Acceptance criteria**

- A new engineer can explain read and write mediation without conflating scope, shares, payloads, workspace signer flow, and group-proof flow.

### WP2. Client Normalization to Stable `group_id`

Normalize all client-side product references to stable UUIDs:

- inbound translators normalize local `group_ids` to UUIDs
- local share records use `group_id` and `via_group_id`
- board assignments and write-group references prefer UUIDs
- display layers resolve labels from UUIDs

**Deliverables**

- Translator updates
- local-state migration or repair pass
- selector and pruner updates

**Acceptance criteria**

- Local state no longer needs to carry rotating `group_npub` as the primary group reference.
- A group rotation does not require downstream product logic to special-case stale product refs.

### WP3. Runtime Signing and Write Contract Hardening

Make the intended runtime signing and write path explicit:

- document the workspace session key as the default signer for NIP-98 auth, `signature_npub`, and owner-payload encryption
- keep live write proof semantics tied to the current group epoch key
- prefer `write_group_id`
- stage the removal of `write_group_npub` across Flight Deck, Yoke, Tower, and tests
- improve rejection reasons and diagnostics when signer npub, resolved user npub, and write-group proof do not line up

**Deliverables**

- API contract update
- runtime signer contract note covering real-user fallback, workspace-key default, and delegated group proof
- staged removal plan for `write_group_npub`
- one-time migration or record rewrite plan where current data depends on the wrong reference shape
- tests for owner writes, non-owner writes, workspace-key-signed writes, rotated groups, and stale write refs

**Acceptance criteria**

- Non-owner write failures are predictable and easy to diagnose, including cases where the authenticated signer is a workspace key.

### WP4. SSE Sync Messaging Contract

Make the live propagation path explicit:

- define the authoritative SSE event set and payload contract
- keep worker-owned replay, debounce, reconnect, and fallback rules explicit
- define which group mutations must emit `group-changed`
- document that SSE is advisory transport only and visibility is enforced on pull
- explicitly treat Yoke as polling/request-response until parity work is scheduled

**Deliverables**

- Tower and Flight Deck architecture note for SSE ownership and event flow
- event schema for `connected`, `heartbeat`, `record-changed`, `group-changed`, and `catch-up-required`
- reconnect and catch-up rules tied to workspace-key auth
- tests or rehearsal notes for rotation, membership changes, reconnect, and cursor eviction

**Acceptance criteria**

- Group and record changes propagate to active Flight Deck clients through SSE without relying on the old steady polling loop.

### WP5. Scope Move Re-Sharing Contract

Make the product rule explicit:

- moving a record to a new scope creates a new record version
- the new version inherits the new scope's read/write groups
- the new version updates shares and regenerates group payloads
- no silent mismatch is allowed between a record's scope and its inherited access state

**Deliverables**

- product contract for scope moves
- UI wording update
- implementation for scope-move-triggered access regeneration
- tests for moves from broad scopes to restricted scopes and back

**Acceptance criteria**

- Moving a record from an open scope to a restricted scope immediately produces a new record version with the restricted access set.

### WP6. Historical Epoch Access Contract

Define what should happen when a new member joins a group:

- only future/current-epoch content is readable
- older record versions remain inaccessible unless they are explicitly reauthored as new versions under the current epoch

**Deliverables**

- product policy
- user-facing documentation
- validation tests for member add/remove and epoch rollover

**Acceptance criteria**

- The team can state clearly that adding a member does not expose older encrypted record versions, and the product behavior matches that decision.

### WP7. Terminology Cleanup and Documentation

Align language across code, UI, and docs:

- stop describing scope as an auth primitive
- stop describing `shares` as if it is the sole enforcement layer
- stop describing the workspace session key and group write proof as if they are the same signer role
- move provenance fields such as `group_kind` out of the canonical access explanation
- document owner payloads, group payloads, signer roles, epoch rules, and SSE behavior clearly

**Deliverables**

- updated design docs
- updated inline comments where needed
- glossary of group, share, scope, payload, epoch, workspace key, signer, and write proof terms

**Acceptance criteria**

- The design document, UI copy, and code terminology all describe the same model.

### WP8. Validation Suite

Add end-to-end validation around the canonical model:

- owner read path
- non-owner read path
- workspace-key owner-payload path
- non-owner write path with live proof
- group rotation
- member removal
- member addition
- stale local refs
- pruning after membership change
- SSE reconnect, replay, and catch-up-required handling

**Deliverables**

- integration tests
- migration validation
- manual rehearsal checklist

**Acceptance criteria**

- The system can demonstrate the target model under rotation, membership changes, and cache repair scenarios.

---

## 4. Recommended Sequence

Recommended order:

1. Ratify the canonical model, signer roles, and terminology.
2. Normalize client state to stable `group_id`.
3. Harden the runtime signing and write contract around workspace keys and `write_group_id`.
4. Lock the SSE sync messaging contract for record and group propagation.
5. Implement scope-move-triggered share and payload regeneration.
6. Lock historical epoch access behavior in docs and tests.
7. Lock the model with tests and rollout validation.

---

## 5. Immediate Conclusions

- Pete's core model is the correct target direction.
- Scope should be documented as organization and UI lineage, not authorization.
- Shares should be stable access-intent metadata only.
- Group payloads should be documented as the actual encrypted delivery and enforcement path.
- The workspace session key is now part of the canonical runtime model, not an implementation detail.
- The group epoch key still matters independently because delegated group write proofs are separate from the workspace signer.
- Flight Deck real-time correctness now depends on the SSE event and refresh contract as well as the record/group data model.
- The biggest implementation gaps are the incomplete separation between stable `group_id` and rotating `group_npub`, and the under-documented split between workspace-key signing and group-key proof signing.
