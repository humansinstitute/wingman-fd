# Design Note: Remove Jobs UI from Flight Deck

Status: draft
Date: 2025-03-25

## Problem Statement

Flight Deck added a Jobs page (commit `aeec5a5`) that provides a browser UI for managing job definitions and dispatching job runs against the Wingman Autopilot harness. This UI duplicates capability that belongs agent-side in Yoke / Autopilot, and introduces several problems:

1. **Wrong control plane.** Job definitions, scheduling, and dispatch are operational concerns. The established pattern (see Flight Logs, harness settings) is that Yoke owns operational control and Flight Deck is the human-facing workspace. Putting CRUD for job definitions in the browser breaks that boundary.

2. **Direct harness coupling.** The jobs UI calls the Autopilot harness API directly from the browser (`/api/jobs/definitions`, `/api/jobs/runs`, `/api/jobs/dispatch/:id`). These endpoints are not part of Tower's contract and bypass the sync/translator pipeline that all other Flight Deck data flows through.

3. **No Dexie materialization.** Jobs state lives in component variables, not in Dexie tables. This violates the core Flight Deck design rule: render from Dexie-backed local state, not raw API responses.

4. **Maintenance surface.** The implementation adds ~40 state variables, 3 modals, 141 lines of CSS, and a full mixin file — all tightly coupled to harness API shape that Autopilot owns and can change independently.

## Decision

Remove the Jobs page, navigation entry, modals, state, styles, and mixin from Flight Deck entirely. Job dispatch stays agent-side in Wingman Autopilot.

## What Flight Deck Keeps

- **Autopilot settings section.** The existing Settings > Autopilot panel (`wingmanHarnessUrl` field, save/open buttons) remains. This is the configuration seam — Flight Deck stores the harness URL as a synced SuperBased settings record, and Yoke / Autopilot consume it.

- **Harness link visibility gate.** The `hasHarnessLink` computed property stays. It already gates the Autopilot sidebar item and the triggers feature. Removing jobs does not affect these.

- **Future read-only awareness (optional).** If Flight Deck later wants to show job run status (e.g., a badge or status line), it should do so through a synced record family materialized in Dexie — not by calling harness endpoints directly from the browser.

## What Gets Removed

| Area | Files / Sections | Notes |
|------|-----------------|-------|
| Mixin | `src/jobs-manager.js` | Delete entire file |
| App state | ~40 job-related properties in `src/app.js` store | Remove from store object |
| Mixin wiring | `jobsManagerMixin` import and `applyMixins` call in `src/app.js` | Remove import + call |
| HTML | Jobs nav item, `#jobs-section`, 3 modals (new/edit/dispatch) in `index.html` | Remove all markup |
| CSS | `.jobs-*`, `.schedule-card`, modal styles in `src/styles.css` | Remove ~141 lines |
| Routing | `'jobs'` entry in `KNOWN_PAGES` in `src/route-helpers.js` | Remove from set |
| Page title | Any `'jobs'` case in `src/page-title.js` | Remove if present |

## Data Model Impact

None. Jobs were never stored in Dexie, never synced through Tower, and never part of a record family. There is no migration or data cleanup needed.

## API Contract Impact

None. The harness endpoints (`/api/jobs/*`) are owned by Autopilot, not Tower. Flight Deck never published or consumed these through the shared contract.

## Component Interaction After Removal

```
Flight Deck                         Tower                    Autopilot
    │                                 │                         │
    │── syncs harness URL setting ───▶│                         │
    │                                 │                         │
    │   (no direct harness calls)     │                         │
    │                                 │                         │
    │                           Yoke ─┼── /api/jobs/* ─────────▶│
    │                                 │                         │
```

Flight Deck writes the Autopilot URL into a SuperBased settings record. Yoke (or Autopilot's own scheduler) reads that configuration and manages job lifecycle directly. Flight Deck has no runtime dependency on the harness API.

## Edge Cases

- **Users who bookmarked `#jobs`.** After removal, navigating to `#jobs` should fall through to the default route (status/flight-deck page). The existing route-helpers fallback handles unknown pages already.

- **Harness URL still set but jobs page gone.** No issue — the URL is used by the Autopilot sidebar link and triggers feature, which are unaffected.

- **Future job visibility in Flight Deck.** If needed later, the right path is: Autopilot writes job run status into a Tower record family → Flight Deck syncs and materializes it in Dexie → UI renders from local state. This preserves the local-first design rule.

## Open Questions

1. **Should triggers follow the same pattern?** Triggers also call harness endpoints directly. If jobs are being removed for bypassing the sync pipeline, should triggers be evaluated for the same treatment?

2. **Read-only job status badge.** Is there near-term value in showing "N jobs running" as a badge on the Autopilot nav item? If so, what's the preferred data path — a lightweight poll, a synced settings record, or deferred entirely?

## Implementation Checklist

The working tree already has most of these changes in progress (see `git status`). The remaining steps are:

1. Confirm all jobs markup, state, and styles are fully removed
2. Verify `#jobs` route fallback works (navigates to default page)
3. Run `bun run test` — no jobs-related tests should remain
4. Run `bun run build` to update `dist/`
5. Manual smoke test: sidebar, settings, triggers still work with harness URL set
