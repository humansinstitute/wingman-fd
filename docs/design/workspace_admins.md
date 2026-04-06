# Workspace Admins

**Date:** 2026-04-06
**Status:** Working draft

## Purpose

Define who should be allowed to see and mutate workspace-level control-plane surfaces in Flight Deck, and what Tower must enforce so this is not just UI theatre.

## Problem We Are Trying To Solve

- A regular workspace member can currently reach admin-looking surfaces in Settings, including workspace profile fields and sharing/group controls.
- The current model mixes ordinary content sharing with workspace administration.
- Some actions are already Tower-restricted, while others appear to be writable through normal record sync.
- We need a smaller, explicit authority model before adding more delegated roles.

## Current Behaviour Observed

- Flight Deck currently shows `Workspace`, `Connection`, `Automation`, `Data`, and `Sharing` tabs to any workspace member.
- The `Sharing` tab exposes group creation, group editing, group deletion, and invite-link generation UI.
- Tower already restricts group mutations to `canManageWorkspace(workspaceOwnerNpub, userNpub)`.
- Today, `canManageWorkspace` resolves to "workspace owner npub or creator npub".

Important terminology question:

- In the current schema, `workspace_owner_npub` is the workspace/service identity.
- `creator_npub` is the human who created the workspace.

Decision:

- when we say "workspace owner" in product language, we mean the human creator/operator
- `creator_npub` is the initial human admin
- `workspace_owner_npub` remains the workspace/service identity in the transport and storage model

More importantly:

- Flight Deck does not currently use Tower's `PATCH /api/v4/workspaces/:workspaceOwnerNpub` route when saving the workspace profile.
- Instead, it writes workspace name, description, and avatar through the generic `settings` record family.
- That write path uses the workspace default shared group as the write-group reference when available.

Immediate lockdown requirement:

- canonical workspace profile updates must be explicitly locked down to the current creator/admin authority
- Flight Deck should stop treating workspace profile edits as ordinary shared-record writes
- Tower's workspace update route should be the path for canonical workspace metadata

My current read is:

- A normal member probably cannot mutate groups today because Tower already blocks that server-side.
- A normal member may be able to mutate workspace profile/settings today if they can produce a valid write proof for the workspace default group.
- Scope creation and scope editing also appear to use normal shared-record writes, so they are likely member-writable today if the chosen group path permits it.

I have not executed those writes against Tower from a member account during this pass, but the code paths line up that way.

## Initial Position

I think we should introduce one explicit workspace-level capability first:

- `workspace_admin`

I think that capability should be represented by a protected bootstrap group, not by ordinary content-group membership.

Proposed shape:

- create a protected system group at workspace bootstrap, for example `group_kind = 'workspace_admin'`
- store its stable id on the workspace row, for example `admin_group_id`
- seed it with the initial human operator set, starting with `creator_npub`
- expand `canManageWorkspace` to mean:
  - `creator_npub`
  - or current member of `admin_group_id`

My lean is that the creator should remain the root fallback even if admin-group data becomes damaged.

Protected-group requirements:

- the admin group must always exist for the lifetime of the workspace
- it cannot be deleted
- it cannot be repurposed into an ordinary content group
- it should not be renameable through normal group-edit flows

Open implementation choice:

- whether admin-roster changes are allowed to any current admin or only to `creator_npub`

Current lean:

- start stricter if needed, but the document does not require that decision to land before the base admin model

## Why I Do Not Want To Reuse Ordinary Shared Groups

I do not think "member of some arbitrary group" should imply workspace administration.

Reasons:

- content-sharing groups answer "who can read or write this record"
- admin authority answers "who can change workspace policy and workspace structure"
- those are different classes of power
- we should be able to protect the admin group from rename/delete/accidental reuse

So my position is:

- admin authority should be explicit
- backend checks should call that explicit authority
- UI should derive from that authority instead of guessing from record writeability

## What Should Be Admin-Only In V1

My current lean is to make these admin-only:

- workspace profile changes: name, description, avatar, slug
- group lifecycle: create, edit, delete, add member, remove member
- invite-link generation
- scope lifecycle: create scope, rename scope, move scope, change scope sharing groups
- shared automation or harness settings, if they are meant to affect the whole workspace
- workspace-scoped connection settings, if they are truly shared rather than personal

Inline question:

- Should slug changes be stricter than other workspace profile edits because they break bookmarked URLs? My lean is either creator-only or admin-plus-extra-confirmation.

Decision:

- slug changes should be stricter than ordinary profile edits
- at minimum they require an explicit confirmation step because they break bookmarked URLs and other deep links

Decision:

- all scope creation and editing is admin-only in the first version
- regular members can still work inside existing scopes through the record/group sharing model
- scopes are expected to be relatively stable workspace structure, not fast-moving member-managed objects

## What Should Not Need Admin

My current lean is that these should remain non-admin:

- reading records already shared to you
- creating or editing ordinary records inside groups/scopes you already have write access to
- local-only client cleanup such as "remove this workspace from my browser"
- personal settings that are not intended to affect other members

Inline question:

Decision for v1:

- scopes remain workspace-governed
- members do not create personal/private scopes in the first version

## Split Workspace Metadata From App Settings

I think the current `Workspace` screen is hiding two different categories of data inside one form.

### Category A: canonical workspace metadata

- name
- description
- avatar
- probably slug

My lean:

- these should be updated through Tower's workspace route, not through the generic `settings` record family
- they are authority-managed workspace metadata, not just another shared document

### Category B: app-level workspace settings

- harness URL
- triggers
- possibly other shared Flight Deck settings later

My lean:

- if these are workspace-global operator settings, keep them shared but admin-gated
- if these are operator preferences, move them to per-user settings instead

Inline question:

Current lean:

- keep harness/triggers as shared workspace-level operating configuration for now
- revisit per-admin tuning later only if there is a strong operational need

## UI Direction

I do not think we should show editable admin surfaces to non-admin members and rely on Tower to reject them later.

My current UI lean:

- non-admins can still see basic workspace identity
- non-admins should not see misleading editable workspace forms
- `Sharing` should be hidden or read-only for non-admins
- scope-management controls should be hidden or disabled for non-admins
- `Connection` and `Automation` should follow the same rule if they are workspace-level controls

Decision:

- do not show admin-only settings surfaces to non-admins
- do not show read-only admin panes that the member cannot act on
- for now, the settings tabs that matter are `Connection` and `Data`
- admin-only workspace-management surfaces should be reduced to the places where the acting user can actually perform the action

## Scope Managers Later, Not First

I can see the appeal of a separate scope-management role, but I do not think we should start there.

Why:

- it adds another policy axis before we have made workspace administration coherent
- it is not yet clear whether scope management is truly delegated often enough to deserve first-class policy
- it risks mixing "can manage taxonomy" with "can read/write content in that scope"

My current recommendation:

- first ship explicit `workspace_admin`
- then decide whether some scopes need delegated managers

If we later add delegated scope management, my bias is:

- make it explicit on the scope model, for example `manager_group_id` or `manager_group_ids`
- do not infer scope-management authority from ordinary record shares

Inline question:

Decision:

- keep scope management under workspace admins for now
- do not introduce delegated scope-manager policy in the first pass

## Proposed Rollout

1. Settle terminology: service identity vs human creator vs workspace admin.
2. Add protected `workspace_admin` bootstrap group and `admin_group_id` on the workspace row.
3. Expand Tower authorization so workspace-management checks use explicit admin membership.
4. Move canonical workspace metadata updates onto the workspace route.
5. Decide whether harness/triggers stay shared-admin or become per-user.
6. Add a single Flight Deck capability such as `canAdminWorkspace` and gate the settings surface from that.
7. Revisit delegated scope managers only after the base admin model feels solid.

## Implementation Plan

### 1. Tower Data Model

- add a protected bootstrap admin group at workspace creation
- add `admin_group_id` to the workspace row
- treat `creator_npub` as the initial human admin
- preserve `creator_npub` as the root fallback for workspace-management checks

Notes:

- `default_group_id` remains the broad shared-content group
- `admin_group_id` becomes the protected workspace-control group

### 2. Tower Authorization

- update `canManageWorkspace(workspaceOwnerNpub, actorNpub)` to resolve true for:
  - `creator_npub`
  - or a current member of `admin_group_id`
- keep group lifecycle routes behind `canManageWorkspace`
- keep scope-management routes or scope-management record writes behind explicit admin checks once those server paths exist
- keep canonical workspace metadata updates behind `PATCH /api/v4/workspaces/:workspaceOwnerNpub`

Lockdown target:

- ordinary membership in the default shared group must not grant workspace-control authority

### 3. Flight Deck Capability Model

- add one client capability such as `canAdminWorkspace`
- derive it from authoritative workspace/admin membership data, not from generic record writeability
- use that capability to gate:
  - workspace profile editing
  - group management
  - invite-link generation
  - scope creation and scope editing
  - shared automation/harness settings
  - any workspace-scoped connection controls that are shared rather than personal

### 4. Workspace Profile Refactor

- stop saving workspace name, description, avatar, and slug through the generic `settings` record family
- use Tower's workspace update route for canonical workspace metadata
- add an explicit confirmation flow for slug changes

Notes:

- slug is a client-facing routing concern, but because it breaks existing links it should be treated as a privileged mutation

### 5. Shared App Settings Review

- keep `harness` and `triggers` as shared workspace-level operating settings for now
- admin-gate those settings in Flight Deck
- revisit later whether any of them should become per-user operator preferences

### 6. Settings IA And Visibility

- reduce the non-admin settings surface
- do not show admin-only tabs or panes to non-admins
- for now, keep `Connection` and `Data` as the primary visible settings tabs for ordinary members
- move or hide workspace-management controls unless the acting user is an admin

### 7. Scope Policy

- make scope creation/editing admin-only in v1
- keep normal record creation/editing available to users who already hold the necessary group access
- do not add delegated scope-manager roles in this implementation pass

### 8. Validation

- verify a non-admin member cannot:
  - edit workspace profile
  - mutate groups
  - generate invite links
  - create or edit scopes
- verify an admin can still perform those actions
- verify ordinary shared-record work remains unchanged for non-admin members
- verify slug changes require explicit confirmation and do not occur accidentally

## Current Lean

One explicit admin group created at workspace bootstrap feels like the right minimum.

The important part is not just hiding buttons. We need to separate:

- canonical workspace metadata
- shared app/operator settings
- ordinary content writes

Once those are separated, the admin story becomes much easier to explain and much harder to accidentally bypass.

## Settled So Far

- product-language "workspace owner" means the human creator/operator
- `creator_npub` is the initial human admin
- add a protected, non-deletable admin bootstrap group
- workspace profile, group lifecycle, invite generation, and scope management are admin-only
- scope structure is intentionally slow-moving and workspace-governed
- non-admins should not see admin-only settings UI
- keep the first pass simple and do not add delegated scope managers yet
