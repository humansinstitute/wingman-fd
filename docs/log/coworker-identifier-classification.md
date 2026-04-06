# Decision: Classify legacy Coworker identifiers before rename work

Date: 2026-04-06
Task: FD As-Built Remediation 05

## Context

The as-built report (issue #6) identified that legacy `Coworker` naming leaks through product, auth, and deploy surfaces. A blind search-and-replace would break persisted browser data, cross-repo contracts, and deploy configuration.

## Decision

Produce a compatibility inventory that classifies every `Coworker` identifier by rename safety before any renaming happens. Six categories were used:

- **migration-sensitive**: IndexedDB names (`CoworkerV4SecureAuth`, `CoworkerV4`) and the `coworker-v4` APP_TAG. These are persisted in user browsers and signed events — cannot be renamed without a versioned migration.
- **external-contract**: `coworker_agent_connect` kind and published docs. Renaming requires coordinated Yoke + agent updates.
- **env-var**: `VITE_COWORKER_APP_NPUB`. Renaming requires deploy pipeline updates.
- **deploy-config**: PM2 process names in `ecosystem.config.cjs`. Safe to rename with deploy coordination.
- **internal-low-risk**: `coworker:*` localStorage keys and `coworker-fe` package name. Minor UX reset if renamed.
- **user-facing**: `Authenticate with Coworker` content string. Safe to rename immediately.

## No renames performed

This task stops at the inventory. Only the compatibility note and test coverage were added. Follow-on tasks can use the classification to rename safely in priority order.

## Files added

- `docs/coworker-identifier-compatibility.md` — the compatibility note
- `tests/coworker-identifier-inventory.test.js` — 17 tests validating the inventory
- `docs/log/coworker-identifier-classification.md` — this decision record
