# Mention Popover Z-Index Fix

**Date:** 2026-04-04
**Scope:** Modal layering / z-index only

## Problem

When typing `@flow` (or any @mention) inside the flow editor modal's step instruction textarea, the mention suggestion popover rendered behind the modal overlay. The suggestions were visible below the modal but not interactive or usable.

## Root Cause

- `.mention-popover` had `z-index: 200`
- `.flow-editor-overlay` had `z-index: 1000`

The popover was painted below the modal in the stacking context.

## Fix

Raised `.mention-popover` z-index from `200` to `1100`, placing it above all modal overlays (`1000`) but below persistent UI anchors (`9999`).

## Files Changed

- `src/styles.css` — z-index bump on `.mention-popover`
- `tests/mention-popover-zindex.test.js` — regression test asserting mention popover z-index exceeds flow-editor-overlay z-index

## Validation

- Unit test: `bun run test tests/mention-popover-zindex.test.js` — 4/4 pass
- Visual: @mention popover now renders above the flow editor modal when triggered from a step instruction field
