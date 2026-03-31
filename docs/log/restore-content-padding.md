# Restore Flight Deck main content horizontal padding

**Date:** 2026-03-31
**Scope:** Layout / CSS
**Reverses:** remove-page-padding.md (partially)

## Decision

Restore horizontal padding on `.main-content` while keeping outer chrome (left nav, header brand, avatar chip) pinned to window edges.

The earlier removal (remove-page-padding.md) went too far — zeroing `.main-content` padding made the content area feel cramped against the sidebar border on laptop screens. Pete requested that the main content have breathing room while the outer shell stays edge-to-edge.

## Changes

1. **`.main-content`** — `padding-left: 0` → `padding-left: 1.25rem; padding-right: 1.25rem`
   Restores horizontal breathing room for the content area between the sidebar and the right window edge.

2. **Mobile `.main-content` (≤768px)** — added `padding-right: 0` alongside existing `padding-left: 0`
   Mobile screens are too tight for content padding; both sides reset to 0.

## What remains unchanged

- `body { padding: 0.5rem 0 }` — no horizontal padding, outer chrome flush to edges
- `.sidebar` — pinned to left edge, no left margin/padding
- `.page-header` — brand lockup and avatar chip reach window edges
- `body { max-width: 1400px }` — page still centers on wide screens

## Tests

Updated `tests/page-padding.test.js`:
- Outer chrome tests verify body, sidebar stay edge-pinned
- Main content tests verify non-zero horizontal padding
- Mobile tests verify padding resets to 0 on small screens

## Rationale

Content sections need breathing room from the sidebar border and the right window edge on laptop-sized screens. The outer chrome (nav, avatar) should remain edge-pinned for a polished, full-width feel. This is the right middle ground between the original too-much-padding and the zero-padding overcorrection.
