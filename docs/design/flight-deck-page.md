# Design: Basecamp-Style Flight Deck Page

**Task:** 388a8f9a
**Scope:** Be Free (d5713ab5)
**Status:** Design
**Date:** 2026-03-29

---

## Problem Statement

The Flight Deck page (`navSection === 'status'`) is the workspace landing page — the first thing a user sees after login and the place they return to for orientation. Today it contains:

1. A hero greeting with scope picker
2. A reports grid (conditionally shown)
3. A "Recent Work" feed (time-range filtered)
4. Two placeholder sidebar panels ("Approvals" and "Coming Up")

This is functional but flat. Basecamp's HQ page works because it answers three questions at a glance: **what needs my attention**, **what's moving**, and **where do I go next**. Our current page answers only "what changed recently" — it lacks prioritized action, upcoming awareness, and per-scope drill-down. The placeholders signal intent but deliver nothing.

The goal is to redesign the Flight Deck page into a Basecamp-style workspace headquarters that surfaces actionable, scope-aware information without requiring the user to visit individual sections.

## Inspiration: Basecamp HQ Patterns

Basecamp's HQ page succeeds through:

- **Project cards** — each project is a visual tile with latest activity, letting you scan many projects at once
- **Pings and notifications** — personal attention items are separated from project-level activity
- **Activity timeline** — a reverse-chronological feed showing what happened across all projects
- **Doors metaphor** — each section within a project is a "door" (message board, to-dos, schedule, etc.)

We adapt these concepts to Wingman's scope-oriented, local-first model:

| Basecamp concept | Wingman adaptation |
|---|---|
| Project card | Scope card — one per active scope (product/project/deliverable) |
| Pings | Attention panel — assigned tasks, mentions, pending approvals |
| Activity timeline | Recent Work feed (already exists, enhanced) |
| Doors | Section shortcuts within each scope card |
| HQ header | Hero greeting with scope focus picker (already exists) |

## Proposed Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Hero: Welcome {name}, where will we focus today?           │
│  [Scope picker typeahead ▾]                                 │
├─────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────┐ ┌─────────────────────────┐ │
│ │  ⚡ Attention               │ │  📅 Coming Up            │ │
│ │  • 3 tasks assigned to you  │ │  • Standup in 2h         │ │
│ │  • 1 task overdue           │ │  • Deploy window Fri     │ │
│ │  • 2 unread thread replies  │ │  • Sprint end 2026-04-03 │ │
│ └─────────────────────────────┘ └─────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│  Reports (if any)                                           │
│  [metric] [timeseries] [table]  — existing report cards     │
├─────────────────────────────────────────────────────────────┤
│  Scope Cards                                                │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│  │ Product A     │ │ Project X    │ │ Deliverable Y│        │
│  │ 4 open tasks  │ │ 2 open tasks │ │ 1 open task  │        │
│  │ 1 new doc     │ │ 3 new msgs   │ │ due Apr 5    │        │
│  │ last: 12m ago │ │ last: 3h ago │ │ last: 1d ago │        │
│  │ [Tasks][Docs] │ │ [Tasks][Chat]│ │ [Tasks]      │        │
│  └──────────────┘ └──────────────┘ └──────────────┘        │
├─────────────────────────────────────────────────────────────┤
│  Recent Work                        │ (existing feed,       │
│  • Chat: "deploy fix" in #ops  12m  │  now full-width       │
│  • Task: "auth bug" updated    3h   │  below scope cards)   │
│  • Doc: "API spec" edited      1d   │                       │
└─────────────────────────────────────────────────────────────┘
```

### Information Hierarchy (top → bottom)

1. **Hero + scope focus** — orientation, scope selection (exists)
2. **Attention + Coming Up** — personal actionable items (replaces placeholders)
3. **Reports** — dashboards and metrics (exists, unchanged)
4. **Scope cards** — per-scope summary tiles (new)
5. **Recent Work** — full activity feed (exists, enhanced)

## Detailed Component Design

### 1. Hero Section (existing — minor enhancement)

**No structural change.** Keep the greeting and scope picker typeahead. The scope picker already drives `selectedBoardId` which filters tasks, calendar, and reports.

**Enhancement:** When a scope is selected in the hero, the scope cards section scrolls/highlights that scope card. The hero acts as both a scope filter for tasks/reports AND a quick-jump for the scope cards below.

### 2. Attention Panel (replaces "Approvals" placeholder)

Purpose: answer "what needs my action right now?"

**Data sources (all from Dexie — no new API calls):**

| Item type | Query | Display |
|---|---|---|
| Assigned tasks (open) | `tasks` where `assigned_to_npub === myNpub` and state not `done`/`archived` | Count + "N tasks assigned to you" |
| Overdue tasks | Assigned tasks where `due_date < today` | Count + "N overdue" |
| Unread chat mentions | From `unreadStoreMixin` channel/thread unread state | Count + "N unread replies" |
| Pending scope approvals | (Future — not available yet) | Placeholder text |

**Implementation approach:**
- New computed getter `flightDeckAttentionItems` in `app.js` or a new `flight-deck-manager.js` mixin
- Queries run against already-loaded Dexie data (`this.tasks`, `this.channels`, unread state)
- No sync worker changes needed
- Each attention item is clickable — navigates to the relevant section/record

**Scope awareness:** When the hero scope picker is active, attention items filter to that scope's task/doc/chat set. When "All" is selected, show workspace-wide attention.

### 3. Coming Up Panel (replaces "Coming Up" placeholder)

Purpose: answer "what's ahead in the next few days?"

**Data sources:**

| Item type | Query | Display |
|---|---|---|
| Tasks with due dates | `tasks` where `due_date` is within next 7 days | Title + relative due date |
| Schedules | `schedules` that fire within next 48h | Title + next occurrence |
| Scope milestones | Scopes with `target_date` in next 14 days | Scope title + "due {date}" |

**Implementation approach:**
- New computed getter `flightDeckComingUp`
- Pure Dexie queries on `this.tasks`, `this.schedules`, `this.scopes`
- Date math against the user's local time
- Items sorted by chronological proximity (soonest first)
- Each item clickable — navigates to the record

### 4. Reports Section (existing — no change)

The `flightdeck-reports-section` already renders report cards (metric, timeseries, table, text). No design changes needed. It sits between the attention panels and scope cards.

**One minor change:** If the hero scope picker is filtering, reports should respect that filter. Check whether `flightDeckReports` already filters by `selectedBoardScope` — if so, no change needed.

### 5. Scope Cards (new)

Purpose: Basecamp-style project tiles for each active scope.

**What is a scope card?**

Each card represents one scope (product, project, or deliverable) and shows:

- **Title** and **level** badge (product / project / deliverable)
- **Open task count** for this scope
- **Recent activity count** (changes in last 24h across tasks, docs, chat in this scope)
- **Last activity timestamp** (relative)
- **Quick-nav buttons** — "Tasks", "Docs", "Chat" — each navigates to the section with this scope pre-selected
- **Progress indicator** (if the scope has tasks): done/total ratio as a thin progress bar

**Data model:**

```js
// Computed from existing state — no new DB tables or API calls
{
  scopeId: 'uuid',
  title: 'Mobile App v2',
  level: 'project',            // product | project | deliverable
  parentTitle: 'Consumer Products',  // parent scope title for context
  openTaskCount: 4,
  totalTaskCount: 12,
  recentActivityCount: 3,      // items updated in last 24h
  lastActivityAt: '2026-03-29T10:00:00Z',
  hasDocs: true,               // scope has linked docs
  hasChat: true,               // scope has linked channels
  targetDate: '2026-04-15',    // scope target_date if set
}
```

**Filtering:**
- Show only scopes with `record_state !== 'deleted'`
- Sort by: last activity (most recent first), then alphabetical
- When hero scope is "All" — show top-level product scopes as cards (collapsed hierarchy)
- When hero scope is a specific product/project — show child scopes as cards
- Cap at ~12 visible cards, with "Show all scopes" link to the Scopes section

**Implementation approach:**
- New computed getter `flightDeckScopeCards` in `scopes-manager.js` or a new mixin
- Cross-references `this.scopes`, `this.tasks`, `this.documents`, `this.directories`
- Task counting uses the same `matchesTaskBoardScope()` logic already in `task-board-scopes.js`
- No new Dexie tables, no new API endpoints

**Card click behavior:**
- Click card body → set hero scope to this scope (updates `selectedBoardId`)
- Click "Tasks" → `navigateTo('tasks')` with board pre-set to this scope
- Click "Docs" → `navigateTo('docs')` with scope filter applied
- Click "Chat" → `navigateTo('chat')` (scope-linked channel if identifiable)

### 6. Recent Work Feed (existing — layout change)

**Current state:** 2-column grid with Recent Work on left, sidebar panels on right.

**New state:** Full-width below scope cards. The sidebar panels (Approvals, Coming Up) move up to the attention row as first-class panels. Recent Work gets full width since it's the detailed feed.

**Data enhancement:** Add scope badge to each recent work item. The `boardScopeId` field already exists on task/report items — extend to chat and doc items by looking up their scope assignment.

## CSS / Layout Changes

### New grid structure for status-section

```
.status-section
  .flightdeck-hero                    (existing)
  .flightdeck-attention-row           (new — 2 panels side by side)
    .flightdeck-attention-panel       (new)
    .flightdeck-coming-up-panel       (new)
  .flightdeck-reports-section         (existing — unchanged)
  .flightdeck-scope-cards             (new — responsive grid)
    .flightdeck-scope-card            (new — individual card)
  .flightdeck-recent-section          (existing Recent Work, now full-width)
```

### Responsive behavior

| Breakpoint | Attention row | Scope cards | Recent Work |
|---|---|---|---|
| Desktop (>768px) | 2 columns side-by-side | 3-column grid | Full width |
| Tablet (480-768px) | 2 columns | 2-column grid | Full width |
| Mobile (<480px) | Stacked vertically | Single column | Full width |

### Card styling

Scope cards should follow the existing card aesthetic:
- `background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)`
- `border: 1px solid rgba(148, 163, 184, 0.18)`
- `border-radius: 22px` (matching `status-changes-section`)
- Hover: subtle lift via `box-shadow` increase

## Component Interactions

### Data flow

```
Dexie (source of truth)
  ↓ liveQuery subscriptions
Alpine store (this.tasks, this.scopes, this.channels, etc.)
  ↓ computed getters
Flight Deck computed state:
  - flightDeckAttentionItems
  - flightDeckComingUp
  - flightDeckScopeCards
  - flightDeckReports (existing)
  - statusRecentChanges (existing)
  ↓
index.html templates (x-for loops over computed arrays)
```

### Interaction with existing features

| Feature | Impact |
|---|---|
| Scope picker (hero) | Drives which scope cards are highlighted / expanded |
| Sidebar scope picker | Kept in sync — changing sidebar scope updates hero |
| Task board | Scope card "Tasks" button pre-sets the board scope |
| Unread store | Attention panel reads from existing unread tracking |
| Sync worker | No changes — all data already synced |
| Reports | No changes — already scope-filtered |
| `refreshStatusRecentChanges()` | Enhanced to include scope badges |
| `navigateTo()` | No changes — scope cards call it with section + options |

### Scope picker ↔ Scope cards coordination

When a user selects a scope in the hero picker:
1. `selectedBoardId` updates (existing)
2. Scope cards re-compute to show children of the selected scope
3. Attention and Coming Up filter to the selected scope
4. Reports filter (existing behavior)
5. Recent Work filters to scope (new — use `boardScopeId` on items)

When a user clicks a scope card:
1. Hero scope picker updates to that scope
2. All downstream filtering follows

## Implementation Approach

### Phase 1: Attention + Coming Up (replace placeholders)

**Files to modify:**
- `src/app.js` — add computed getters or create `src/flight-deck-manager.js` mixin
- `index.html` — replace placeholder content in `.flightdeck-side-panel` divs
- `src/styles.css` — attention panel and coming-up panel styles

**Effort:** Low. Data sources already in Alpine store. Pure computed getters + HTML templates.

### Phase 2: Scope Cards

**Files to modify:**
- `src/app.js` or `src/scopes-manager.js` — add `flightDeckScopeCards` computed getter
- `index.html` — add scope cards grid section
- `src/styles.css` — scope card styles, responsive grid

**Effort:** Medium. Requires cross-referencing scopes with tasks/docs counts. Uses existing `matchesTaskBoardScope()` logic.

### Phase 3: Layout Restructure

**Files to modify:**
- `index.html` — restructure status-section from 2-column grid to new layout
- `src/styles.css` — replace `.flightdeck-grid` with new layout

**Effort:** Low-medium. Mostly CSS and HTML restructuring.

### Phase 4: Enhanced Recent Work

**Files to modify:**
- `src/app.js` — add scope badges to `refreshStatusRecentChanges()` items
- `index.html` — render scope badge in change row
- `src/styles.css` — scope badge chip style

**Effort:** Low. The `boardScopeId` field already exists on most items.

## Data Models

### No new Dexie tables required

All data comes from existing tables:
- `tasks` — for task counts, due dates, assignees
- `scopes` — for scope hierarchy, target dates
- `documents` / `directories` — for doc counts per scope
- `channels` / `messages` — for chat activity
- `schedules` — for upcoming schedules
- `comments` — for recent activity

### New computed properties (not persisted)

```js
// Attention items — ephemeral computed state
flightDeckAttentionItems: [
  { type: 'assigned-tasks', count: 3, label: '3 tasks assigned', action: () => navigateTo('tasks') },
  { type: 'overdue', count: 1, label: '1 overdue task', action: () => navigateTo('tasks') },
  { type: 'unread', count: 2, label: '2 unread replies', action: () => navigateTo('chat') },
]

// Coming up — ephemeral computed state
flightDeckComingUp: [
  { type: 'task-due', title: 'Auth migration', dueDate: '2026-04-01', action: () => openTask(id) },
  { type: 'schedule', title: 'Standup', nextAt: '2026-03-29T11:00:00Z', action: () => navigateTo('schedules') },
]

// Scope cards — ephemeral computed state
flightDeckScopeCards: [
  { scopeId, title, level, openTaskCount, totalTaskCount, recentActivityCount, lastActivityAt, ... }
]
```

## API Contract

**No new Tower endpoints required.** Everything is computed from already-synced Dexie data. The existing `records/summary` endpoint and per-family sync are sufficient.

## Edge Cases

1. **Empty workspace (no scopes, no tasks):** Show a welcoming empty state with CTAs: "Create your first scope", "Add a task", "Start a conversation". No scope cards, attention/coming-up show "Nothing pending".

2. **Many scopes (>20):** Cap scope cards at 12 most-recently-active. Show "View all N scopes" link. The scope picker typeahead in the hero handles the long list.

3. **No assigned tasks (solo user):** Attention panel shows "No tasks assigned" or omits the assigned section. Coming Up still shows due dates and schedules.

4. **Scope with no activity:** Card shows "No recent activity" with muted styling. Sorted to bottom.

5. **Rapid scope switching:** Computed getters re-evaluate reactively. No debounce needed since all data is local Dexie reads.

6. **Mobile viewport:** Attention + Coming Up stack vertically. Scope cards go single-column. Recent Work stays full-width. No horizontal scrolling.

7. **Stale data during sync:** All data renders from Dexie materialized state. During sync, new data streams in and Alpine reactivity updates the page. No loading spinners needed for the Flight Deck page.

8. **Workspace switch:** `navigateTo('status')` already calls `refreshStatusRecentChanges()`. Scope cards and attention items re-compute because the underlying `this.tasks`, `this.scopes` etc. are refreshed during workspace switch.

## Open Questions

1. **Should scope cards show a progress bar?** A done/total task ratio is available but could be misleading if tasks don't map cleanly to "scope completion". Recommend showing it only when `totalTaskCount > 0`, with muted styling.

2. **Should clicking a scope card navigate to a dedicated scope detail page?** Basecamp has this — you click a project card and see that project's doors. Currently we don't have a per-scope landing page. For v1, clicking the card just sets the hero scope and highlights the card. A dedicated scope page could be Phase 5.

3. **Should the Attention panel include doc comment mentions?** This requires scanning comments for `@mention` tokens that match the current user. The data is available in Dexie but would need mention parsing. Recommend deferring to Phase 2.

4. **Should the hero scope picker expand/collapse the scope cards section?** If the user picks a specific scope, should we show only that scope's card (expanded with more detail) vs. all sibling cards? Recommend: highlight the selected scope card and show its children.

5. ~~New mixin or inline in app.js?~~ **Resolved:** Use a dedicated `src/flight-deck-manager.js` mixin, following the established codebase pattern (`docsManagerMixin`, `scopesManagerMixin`, `jobsManagerMixin`, etc.).

## Files to Modify (summary)

| File | Change | Phase |
|---|---|---|
| `src/app.js` | Import new mixin, wire it in | 1 |
| `src/flight-deck-manager.js` | New mixin with computed getters | 1-2 |
| `index.html` | Replace placeholder panels, add scope cards grid, restructure layout | 1-3 |
| `src/styles.css` | Attention/Coming Up panel styles, scope card styles, layout restructure | 1-3 |
| `src/route-helpers.js` | No change expected | — |
| `src/page-title.js` | No change expected | — |
| `src/db.js` | No change expected | — |
| `src/sync-families.js` | No change expected | — |
| `src/worker/sync-worker.js` | No change expected | — |

## Validation

- `bun run test` — existing tests should pass (no behavioral changes to tested modules)
- `bun run build` — must produce valid dist
- Manual: verify scope cards render with correct counts, attention items are actionable, coming-up shows correct dates, mobile layout stacks correctly
