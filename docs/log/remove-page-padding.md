# Remove Flight Deck page padding

**Date:** 2026-03-30
**Scope:** Layout / CSS

## Decision

Remove the arbitrary left and right padding on the Flight Deck page shell so content extends to the full available width.

## Changes

Three padding sources were zeroed out:

1. **`body`** — `padding: 0.5rem 2rem` → `padding: 0.5rem 0`
   Removed the 2rem left/right page-level padding. Vertical padding preserved.

2. **`.main-content`** — `padding-left: 1.5rem` → `padding-left: 0`
   Removed the gap between sidebar border and content area.

3. **`.status-section`** — right padding zeroed in base rule and both responsive breakpoints
   - Base: `2.4rem 1.5rem 2rem 0` → `2.4rem 0 2rem 0`
   - `≤960px`: `padding-right: 1rem` → `padding-right: 0`
   - `≤720px`: `1rem 1rem 1.5rem 0` → `1rem 0 1.5rem 0`

## What was preserved

- `body { max-width: 1400px }` — page still centers on wide screens
- `body` vertical padding (top `0.5rem`)
- `.sidebar` `border-right` visual separation
- Mobile `.main-content { padding-left: 0 }` (already zero, now consistent with desktop)
- All inner section padding (chat, tasks, docs, settings, reports) unchanged

## Rationale

The padding was cosmetic whitespace that reduced usable content width without serving a structural purpose. Individual content sections already manage their own internal spacing.
