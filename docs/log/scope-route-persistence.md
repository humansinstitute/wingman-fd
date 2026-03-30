# Scope Route Persistence

**Date:** 2026-03-30
**Task:** 6a2c6e67-6fae-4062-ae18-aaf3811c84b2

## Problem

When navigating between sections (tasks → chat → docs → calendar → reports), the `scopeid` query parameter was only included in the URL for tasks, calendar, and reports. Navigating to chat or docs dropped `scopeid` from the URL, so browser back/forward lost the active scope context.

## Decision

Promote `scopeid` to a global route parameter that is always preserved in the URL, regardless of the active section. This is the simplest fix because:

1. `selectedBoardId` already persists in memory across section switches
2. `parseRouteLocation` already extracts `scopeid` from any URL
3. The scope context is meaningful across all sections (it answers "what am I focused on")

## Changes

### `src/route-helpers.js`
- Added `buildSectionUrl()` helper that always carries `scopeid` when present, usable for programmatic URL construction

### `src/app.js` — `buildRouteUrl()`
- Moved `scopeid` out of the section-specific branches into a global position — it is now always written when `selectedBoardId` is set

### `src/app.js` — `applyRouteFromLocation()`
- Added a global scopeid restoration block before the section-specific branches
- When the URL contains `scopeid` or `groupid`, it is applied to `selectedBoardId` regardless of which section the user navigated to
- For tasks/calendar, falls back to stored board ID when URL has no explicit scope (preserves existing behavior)

### `tests/scope-route-persistence.test.js`
- 23 tests covering: scopeid parse from all sections, buildSectionUrl output, round-trip preservation

## What this does NOT change

- The scope picker UI behavior
- How `selectedBoardId` is validated or persisted to localStorage
- Section-specific params (channelid, docid, taskid, etc.) — those remain section-scoped
