# Remove Flight Deck page padding

**Date:** 2026-03-30
**Scope:** Layout / CSS

## Decision

Remove the arbitrary left and right padding on the Flight Deck page shell so content extends to the full available width.

## Changes

Five padding sources were zeroed out (items 4–5 found during re-review on 2026-03-31):

1. **`body`** — `padding: 0.5rem 2rem` → `padding: 0.5rem 0`
   Removed the 2rem left/right page-level padding. Vertical padding preserved.

2. **`.main-content`** — `padding-left: 1.5rem` → `padding-left: 0`
   Removed the gap between sidebar border and content area.

3. **`.status-section`** — right padding zeroed in base rule and both responsive breakpoints
   - Base: `2.4rem 1.5rem 2rem 0` → `2.4rem 0 2rem 0`
   - `≤960px`: `padding-right: 1rem` → `padding-right: 0`
   - `≤720px`: `1rem 1rem 1.5rem 0` → `1rem 0 1.5rem 0`

4. **`body` mobile breakpoint (≤768px)** — `padding: 0.5rem` → `padding: 0.5rem 0`
   The mobile media query was using shorthand `0.5rem` which applied to all four sides, re-introducing 0.5rem of left/right padding on screens ≤768px. This was missed in the initial fix.

5. **`.placeholder-panel`** — `padding: 1.25rem` → `padding: 1.25rem 0`
   This is a direct child of `.main-content` (People section placeholder). The shorthand applied 1.25rem to all sides including left/right, creating a visible horizontal gap.

## What was preserved

- `body { max-width: 1400px }` — page still centers on wide screens
- `body` vertical padding (top `0.5rem`)
- `.sidebar` `border-right` visual separation
- Mobile `.main-content { padding-left: 0 }` (already zero, now consistent with desktop)
- All inner section padding (chat, tasks, docs, settings, reports) unchanged

## Rationale

The padding was cosmetic whitespace that reduced usable content width without serving a structural purpose. Individual content sections already manage their own internal spacing.
