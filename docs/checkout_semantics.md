# Checkout Semantics For Record Types

This document is the implementation reference for adding checkout/edit behavior to a Flight Deck record type.

Checkout is an edit lock for an existing Tower record version. It is not a creation primitive. A record type can use checkout for updates while still creating new records through the normal optimistic create path.

## Policy Vocabulary

Flight Deck uses the generic Library checkout policy primitives exposed through `src/record-checkout-policy.js`.

Valid policies:

- `checkout_required`: updates to an existing record require an active checkout held by the actor. Accepted writes auto-release when `checkout.consume_on_success` is true.
- `optimistic_write`: normal non-checkout write flow. Checkout metadata is not required and stale checkout metadata is stripped before sync.

Current default registry:

- `document`: `checkout_required`
- `directory`: `checkout_required`
- `task`: `optimistic_write`
- `scope`: `optimistic_write`
- `chat`, `chat_message`, `channel`, `comment`: `optimistic_write`

Task detail editing currently opts task updates into `checkout_required` at the app/runtime seam with `getTaskDetailCheckoutPolicyConfig()`. That keeps task creation optimistic while making task edits checkout-managed.

## Core Rule

Create and update are different operations:

- Create: `previous_version: 0`, `version: 1`. Do not acquire checkout. Do not attach checkout metadata. Queue a normal pending write.
- Update: `previous_version` equals the latest local/Tower version and `version` increments by one. If policy is `checkout_required`, acquire checkout before edit and attach checkout metadata to the update envelope.
- Delete/archive: treat as an update to an existing record, usually by writing `record_state: "deleted"` or equivalent. If policy is `checkout_required`, it needs checkout.
- Retry: preserve the original pending write semantics. Do not silently add or remove checkout policy in retry code unless that pending write was created for that policy.

Tower enforces this same distinction. For `checkout_required` families, creates may omit checkout because there is no prior server version to lock. Updates require checkout.

## Create Flow

Use this flow for any new record, even if future edits to that family are checkout-managed.

1. Build the local row with `version: 1`, `previous_version` omitted or `0`, and `sync_status: "pending"`.
2. Persist locally first so the UI remains local-first.
3. Build actor-encryptable write fields with `getRecordWriteFieldsForStore()` from `src/preferred-write-group.js`.
4. Build the outbound envelope with the family translator, filtered `group_ids`, selected `write_group_ref`, and `signature_npub: this.signingNpub`.
5. Queue the envelope with `addPendingWrite({ record_id, record_family_hash, envelope })`.
6. Do not call `ensureLockManagedCheckout()` or `attachCheckoutRequiredCheckoutToEnvelope()` for the create.
7. Flush normally with `flushAndBackgroundSync()`.

Example from tasks:

```js
const writeFields = await getRecordWriteFieldsForStore(this, localRow, {
  label: "Task write",
});

const envelope = await outboundTask({
  ...localRow,
  group_ids: writeFields.group_ids,
  signature_npub: this.signingNpub,
  write_group_ref: writeFields.write_group_ref,
});

await addPendingWrite({
  record_id: recordId,
  record_family_hash: envelope.record_family_hash,
  envelope,
});
```

## Checkout-Managed Edit Flow

Use this flow for editing an existing record type when the policy for that edit path is `checkout_required`.

1. Open existing records in view/read mode by default.
2. On Edit, acquire checkout for the record and family.
3. If acquire fails, stay in view mode and show the mapped checkout/access error.
4. Let the user change local draft state while checkout is held.
5. On Save, build one updated envelope from the original version to the next version.
6. Attach checkout metadata with `attachCheckoutRequiredCheckoutToEnvelope(record, envelope, { checkoutPolicyConfig, intent: "edit" })`.
7. Queue the pending write with the same `checkout_policy_config` used to acquire/attach checkout.
8. Flush. Tower accepts the update and consumes/releases the checkout when `consume_on_success` is true.
9. On Cancel/Close without saving, release checkout.

Example shape:

```js
const checkoutPolicyConfig = this.getMyRecordCheckoutPolicyConfig();

await this.ensureLockManagedCheckout(record, myRecordFamilyHash, {
  intent: "edit",
  checkoutPolicyConfig,
});

const writeFields = await getRecordWriteFieldsForStore(this, updated, {
  label: "My record write",
});

const envelope = await outboundMyRecord({
  ...updated,
  group_ids: writeFields.group_ids,
  previous_version: previous.version,
  signature_npub: this.signingNpub,
  write_group_ref: writeFields.write_group_ref,
});

const managedEnvelope = await this.attachCheckoutRequiredCheckoutToEnvelope(updated, envelope, {
  intent: "edit",
  checkoutPolicyConfig,
});

await addPendingWrite({
  record_id: updated.record_id,
  record_family_hash: managedEnvelope.record_family_hash,
  envelope: managedEnvelope,
  checkout_policy_config: checkoutPolicyConfig,
});
```

## Current Patterns

Documents:

- Documents use checkout by default through the family registry.
- `enterSelectedDocEditMode()` acquires checkout before switching from preview/read mode to edit mode.
- Document save attaches checkout metadata before queuing the update.
- Document comments remain separate optimistic records by default; they should not inherit document checkout unless explicitly opted in.

Tasks:

- Task creation is optimistic. It does not acquire checkout and does not attach task checkout policy to the create pending write.
- Task detail opens in view mode.
- Task detail Edit acquires checkout with a task-specific runtime policy config.
- Task Save writes one task update record, attaches checkout metadata, queues with `checkout_policy_config`, and flushes.
- Quick field mutations, delete/archive, drag/drop, or cascade updates are updates. If they use the task checkout policy seam, they must acquire or already hold checkout. Avoid hidden checkout-managed writes from read mode unless the UX explicitly communicates the lock.

## Adding Checkout To Another Record Type

Use this checklist.

1. Decide the UX mode split: records should load read-only/view-first if edits require checkout.
2. Add a policy config seam for this edit path. Prefer local/runtime opt-in first:

```js
getMyRecordCheckoutPolicyConfig() {
  return {
    recordFamilyHashes: {},
    familySuffixes: {
      my_family: "checkout_required",
    },
  };
}
```

3. Do not change the global default registry unless the product decision is to make that family checkout-managed everywhere.
4. Keep creates on the normal `addPendingWrite` path with no checkout metadata.
5. Gate entry into edit mode with `ensureLockManagedCheckout()`.
6. Build exactly one update envelope on save where possible.
7. Attach checkout metadata with `attachCheckoutRequiredCheckoutToEnvelope()`.
8. Include `checkout_policy_config` on the pending write for checkout-managed updates.
9. Pass policy config through worker, SSE, retry, and force-submit paths if the write can travel through those paths.
10. Add tests for create without checkout, update without checkout rejected, update with checkout accepted, non-owner with write access, no-access blocked, and idempotent acquire retry.

## Identity And Transport Rules

Do not mix checkout endpoint identity fields with sync record identity fields.

Checkout endpoints use:

- `workspace_service_npub`
- `user_npub`
- `workspace_user_key_npub`
- `signer_npub`

Sync records use:

- `signature_npub`

Compatibility aliases such as `owner_npub`, `ws_key_npub`, and `lockManaged` names may still exist at boundaries. Do not remove them casually, but do not introduce them into new internal APIs.

Important distinction:

- `user_npub` is the human/actor whose edit permission is being checked.
- `workspace_user_key_npub` is the delegated signing key for the workspace.
- A user editing through a delegated workspace user key is not a collaborator by definition. Do not write tests or UI messages that treat workspace key delegation as collaborator permission.

## Access And Sharing Rules

A write is only useful if the actor can later read the record and if intended recipients receive readable payloads.

For creates:

- `write_group_ref` chooses the group used to authorize non-owner writes.
- The created record must include a writable group payload for the write group when the creator is not the workspace owner.
- Scope selection should drive write group and delivery group decisions. Do not recompute downstream groups independently in a way that diverges from the selected scope.
- Delivery groups are who can decrypt/read. Write group is who authorizes the write. They often overlap, but they are not the same field.
- If record status shows delivery keys missing, other users may not see or decrypt the record even if sharing UI says the group has write privileges.

For updates:

- Preserve or intentionally repair `scope_policy_group_ids`, `board_group_id`, `group_ids`, and `shares` from the existing record.
- Use the shared helpers in `src/preferred-write-group.js` for write-group selection and actor-encryptable delivery groups. Do not add record-type-specific group/write selection logic.
- When building the outbound encrypted payload, only encrypt group payloads for delivery groups whose keys are loaded for the current actor. Keep the record's share/delivery metadata in local state, but do not try to re-encrypt another user's private group payload.
- Use `getRecordWriteFieldsForStore(store, record, { label, writeGroupRef })` for publish/update/delete envelopes. It returns the outbound `group_ids` and `write_group_ref` after filtering to groups the actor can encrypt. Explicit write refs outside that filtered group set are ignored as unsafe.
- If scope changes, recalculate the scoped policy patch once and use it for both local state and the outbound envelope.
- Non-owner updates require write access on the prior version, not just on the proposed new version.

Current audit coverage:

- `document`, `directory`, and document comments route through managed document helpers and actor-encryptable comment group helpers.
- `task`, task comments, task moves, subtasks, and task force-submit routes use the shared write-field helpers.
- `channel`, `chat_message`, thread replies, thread deletes, and chat audio notes use the shared write-field helpers.
- `flow`, `approval`, flow kickoff tasks, chat-thread flow dispatch tasks, and approval preview comments use the shared write-field helpers.
- `person`, `organisation`, `opportunity`, opportunity comments, and opportunity task backlinks use the shared write-field helpers.
- `scope`, scoped repair writes, schedules, workspace settings, reports repaired through scope changes, and record-status force-submit use the shared write-field helpers.

## Pending Writes And Worker Behavior

Pending writes can carry per-write checkout policy config. The worker batches pending writes by compatible policy config so a checkout-managed task edit does not flip unrelated task creates into checkout mode.

Rules:

- Add `checkout_policy_config` only to writes that were built for that policy.
- Do not attach checkout policy config to creates unless the create intentionally includes checkout metadata.
- Do not strip checkout metadata from checkout-managed updates.
- Do strip stale checkout metadata from `optimistic_write` records.
- If Tower rejects a newer local snapshot with `prior_version_mismatch` and
  reports its latest version, retry the same local snapshot as
  `version: tower_latest + 1` / `previous_version: tower_latest`; do not strand
  the write for manual Force Submit when local is intended to win.
- Error diagnostics should include record id, family, version, previous version, and checkout state.

## Common Pitfalls Seen So Far

- Treating create as checkout-required. This causes new records to stay local with Tower version `0` because the app tries to lock a record that does not exist yet.
- Blocking checkout to workspace owner only. Correct behavior is “actor has write access”, including non-owner members with writable group access.
- Confusing delegated workspace user key with collaborator permission. The workspace user key signs; the real `user_npub` determines actor permission.
- Using `signer_npub` inside sync records. Sync record envelopes must use `signature_npub`.
- Using `signature_npub` in checkout endpoint payloads. Checkout endpoint payloads must use `signer_npub`.
- Forgetting `checkout_policy_config` on a checkout-managed pending update. The worker may treat the family as default policy and strip or reject checkout metadata incorrectly.
- Adding `checkout_policy_config` to unrelated creates. This can accidentally make a default optimistic family behave like checkout-required in the worker batch.
- Allowing hidden update paths from read mode. If a record is checkout-managed, quick edits, drag/drop, delete/archive, and cascade updates need either an explicit checkout UX or must stay disabled/read-only.
- Assuming sharing UI equals actual readability. Other users need matching group payloads and loaded group keys.
- Re-encrypting every historical delivery group on collaborator updates. A collaborator can write through a shared group without having the creator's private group key; outbound envelopes must be limited to actor-encryptable groups.
- Assuming a history `404 record_pull_not_found` always means the record does not exist. It can also mean the local create never reached Tower, the actor cannot see the latest version, or the wrong viewer/workspace key was used.
- Recomputing scope/write groups differently between local row and outbound envelope. The local UI may show the intended scope while Tower stores a record under a different write/read policy.
- Updating with the wrong `previous_version`. Checkout does not bypass version checks; Tower still requires `previous_version` to match the latest version.
- Leaving checkout sessions held on cancel/close. Release on cancel when no save is submitted.
- Renaming compatibility helpers too early. `lockManaged` names still exist as aliases around generic checkout behavior; remove them only in a dedicated compatibility cleanup.

## Minimal Test Matrix For New Checkout Families

Add or update tests that prove:

- Create without checkout succeeds for the family.
- Update without checkout returns `checkout_missing`.
- Update with checkout succeeds and consumes/releases checkout.
- Idempotent acquire retry returns success-equivalent checkout.
- Non-owner with write access can acquire checkout and update.
- Non-owner without write access is blocked before or by Tower with a deterministic error.
- `checkout_conflict`, `checkout_not_owner`, `record_checked_out`, `edit_policy_forbidden`, `workspace_key_missing`, `identity_alias_mismatch`, and `record_pull_forbidden` map to deterministic UI states.
- Default behavior for unrelated families is unchanged.
- Existing optimistic flows do not gain checkout metadata before explicit opt-in.
