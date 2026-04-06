# Schema-sync family parity

## Context

The live sync-family registry in `src/sync-families.js` included 15 families (flow, approval, person, organisation added in Dexie v5/v6), but the schema-sync test and published schema manifests in `sb-publisher` only covered the original 11 families.

## Decision

- Added `flow-v1.json`, `approval-v1.json`, `person-v1.json`, `organisation-v1.json` schema manifests to `sb-publisher/schemas/flightdeck/` derived directly from the outbound translator payload shapes.
- Updated `tests/schema-sync.test.js` to validate all 15 families and added a registry-parity assertion that compares the sync-family registry to the published schema set.
- Updated `tests/sync-repair.test.js` hardcoded family list to include person and organisation.

## sb-publisher touch justification

The test proved a downstream manifest gap: the 4 families had working translators but no published schema files, so the schema-sync validation test could not run. Creating the manifests was the minimal fix.

## Approval schema: flow_step type

Used `"number"` instead of `"integer"` for `flow_step` because the schema validator uses JavaScript `typeof` which returns `"number"` for all numeric values. The existing `task-v1.json` uses `"integer"` but its tests don't exercise that field with a value, so it passes. This is a known quirk of the lightweight validator.
