# Wingman Flight Deck As-Built Design

Status: as-built working note  
Reviewed against live code on 2026-04-06  
Companion docs:

- `docs/asbuilt/architecture.md`
- `docs/asbuilt/frontend.md`
- `docs/asbuilt/data model.md`
- `docs/asbuilt/middleware.md`

## Scope

This note describes the UI design Flight Deck actually ships today. It is grounded in the current browser template, stylesheet, and route/state behavior rather than aspirational design docs.

It covers:

- the app shell and navigation model
- the current visual system: typography, color, spacing, radius, shadows, and motion
- recurring layout patterns across sections
- common controls and affordances
- responsive behavior and mobile adaptations
- practical consistency rules that are visible in the code today

Primary files reviewed for this note:

- `docs/asbuilt/architecture.md`
- `docs/asbuilt/frontend.md`
- `docs/asbuilt/data model.md`
- `docs/asbuilt/middleware.md`
- `index.html`
- `src/styles.css`
- `src/app.js`
- `src/main.js`
- `src/task-board-state.js`
- `src/docs-manager.js`
- `src/channels-manager.js`
- `src/flows-manager.js`
- `src/scopes-manager.js`
- `src/workspace-manager.js`

## Design Baseline

### Overall look

Flight Deck currently ships as a light-theme desktop-first SPA with a white/slate base palette and restrained blue as the default accent. The UI does not present a dark mode. Most working screens are intentionally plain and productivity-oriented, while the Flight Deck landing page and Reports screens use more elevated cards, gradients, and shadows.

### Core visual tokens

| Area | Current implementation |
| --- | --- |
| Font stack | System sans: `-apple-system`, `BlinkMacSystemFont`, `"Segoe UI"`, `sans-serif` |
| Base text | `#111827` / dark slate |
| Muted text | `#6b7280` / slate gray |
| Base surface | white |
| Muted surface | `#f8fafc` |
| Hover surface | `#f1f5f9` |
| Default accent | `#3b82f6` |
| Danger | `#ef4444` |
| Radius scale | `6px`, `10px`, `14px` plus many pill/999px shapes |
| Shadows | soft slate shadows, used mainly on avatars, cards, popovers, and modals |

### Typography

- Global typography uses the system UI stack rather than a branded webfont.
- Standard body copy mostly sits in the `0.82rem` to `0.95rem` range.
- Large screen titles are still relatively restrained. The biggest branded/dashboard treatment is the Flight Deck hero heading, which uses `clamp(1.45rem, 2.4vw, 2.25rem)`.
- Small uppercase labels are used heavily for metadata and category markers such as report eyebrows, status labels, workspace labels, and section badges.
- Monospace is reserved for code, build ids, connection keys, record history, and JSON/package exports.

### Spacing, radius, and motion

- The app uses compact spacing overall: most controls and rows sit in the `0.35rem` to `1rem` padding range.
- Dense list screens stay flat and low-radius; more prominent panels move to `18px` to `24px` corner radii.
- Motion is subtle and functional: hover background shifts, slight lift on cards, sidebar slide-in on mobile, thread-width transitions, rotating carets, and opacity-based action reveals.

## App Shell And Navigation

### Top-level shell

After login, the app uses a two-part shell:

- a sticky top header with brand at left and avatar/session controls at right
- a left primary sidebar plus a scrollable main content column

Important shell behaviors:

- `body` uses `100dvh` and `overflow: hidden`
- the main application scroll happens inside `.main-content`, not on the page body
- the header stays visible with `position: sticky`
- the app keeps a persistent "in-app" feel rather than navigating between full-page documents

### Header

The header contains:

- a mobile-only menu button
- the Wingman logo and wordmark
- a circular avatar chip that doubles as sync-status indicator
- an avatar menu for sync state, build id, Agent Connect, Settings, and logout

The avatar chip uses ring color to show sync state:

- green: synced
- orange: pending local changes
- amber: stale
- blue: syncing
- red: quarantined or error

### Sidebar

The sidebar is the primary navigation rail. In the default desktop state it is `198px` wide, with an optional collapsed desktop state at `48px`.

Visible first-class sections today:

- Flight Deck
- Chat
- Tasks
- Calendar
- Docs
- Reports
- People
- Schedules
- Flows
- Scopes
- Settings

Conditionally rendered sections:

- Jobs
- Autopilot

Sidebar-specific design traits:

- flat list items with muted text until hover/active
- inline SVG icons
- unread dots for Chat, Docs, and Tasks
- contextual nested channel list when Chat is active
- scope focus picker pinned at the top
- workspace switcher card anchored in the footer

### Route and navigation pattern

Visual navigation is section-driven, but the app also preserves deep-linkable context in the URL. Routes currently map to paths like:

- `/<workspace-slug>/flight-deck`
- `/<workspace-slug>/chat`
- `/<workspace-slug>/tasks`
- `/<workspace-slug>/docs`

The query string preserves detail context such as:

- `scopeid`
- `channelid`
- `threadid`
- `docid`
- `folderid`
- `commentid`
- `taskid`
- `reportid`
- `view=list`

That means the design is not just visual section switching; it is intentionally bookmarkable and browser-history aware.

## Section Layout Patterns

### Flight Deck and Reports

These are the most visually polished sections in the current app.

- Flight Deck uses a centered hero, a scope typeahead, a report-card grid, and a two-column dashboard below.
- Reports uses a split-pane workspace with a list pane on the left and a detail pane on the right.
- Both sections use gradient-backed cards, larger radii, and softer, more editorial spacing than the rest of the product.

### Chat

Chat uses a classic messaging layout:

- optional channel header
- main feed column
- optional thread panel on the right

Design characteristics:

- message rows are flat, full-width strips rather than isolated bubbles
- message action menus appear on hover
- a small sync-status dot sits at top-right on each message
- the thread panel can move through default, wide, and full-width states
- composer areas sit at the bottom of each pane with autosizing textareas and optional audio drafts

### Tasks

Tasks has two major modes:

- collection mode with create bar, filters, and either kanban or list view
- detail mode with a task editor and comments side panel

The task collection view favors compact control bars and state-driven visual encoding:

- colored column accents by task state
- red outline for unread tasks
- pills for priority, date, and tags
- avatar chips for assignees

The detail view becomes a denser two-column work surface with:

- editable fields in a responsive grid
- inline scope and flow pickers
- markdown description preview/edit toggles
- threaded comments and audio attachments

### Docs

Docs is split between:

- a browser/list mode
- a document editor mode

Browser mode is flat and file-manager-like:

- search bar plus compact toolbar icons
- breadcrumbs
- flat document and folder rows
- inline scope pills
- drag-and-drop move affordances

Editor mode is more document-oriented:

- breadcrumb header plus compact action cluster
- inline editable title
- block editing, preview mode, and source mode
- optional `320px` sticky comment thread rail
- line-anchored comment affordances in the gutter

The docs area is one of the strongest examples of mixed modes in the product: browser, editor, thread, and modal workflows all coexist in one section.

### Calendar and Schedules

These screens use card-based planning layouts rather than spreadsheet styling.

- Calendar supports day, week, month, and year groupings.
- Calendar days and month cells are rounded cards with scheduled-task chips inside.
- Schedules uses a vertical list of rounded cards and green-accented create/edit forms.

### Scopes

Scopes combines two patterns:

- nested scope cards in the main column
- a desktop-only sticky tree navigator on the right

Each scope level has a distinct left-border or badge color, making the hierarchy visible without heavy indentation alone.

### Flows and Approvals

Flows uses:

- a header with compact actions
- approval-banner cards near the top
- a responsive card grid for flow definitions
- centered modal editors for creating and editing flows

Approval detail uses a modal panel that expands into multi-column preview mode on larger screens.

### People and Settings

These are more utilitarian than the dashboard screens.

- People uses a tabbed list/editor pattern for People versus Organisations.
- Settings uses horizontal tabs with stacked bordered panels underneath.
- Both sections lean on standard form fields and inline action menus rather than bespoke visual treatments.

## Common Controls And Reused Patterns

### Buttons

The current UI uses several recurring button families:

| Control family | Current styling |
| --- | --- |
| Default/global button | dark background, light text, compact radius |
| Primary action | dark slate fill with white text |
| Secondary action | white surface with border |
| Danger action | red text or red-tinted fill depending context |
| Tiny utility buttons | `btn-small`, icon-only buttons, ellipsis menus |
| CTA by domain | schedules use green; approvals use green/red/purple action chips |

### Chips, pills, and badges

Small semantic indicators are a core part of the current UI:

- unread dots in nav and channels
- scope level badges
- doc scope pills
- task state and priority badges
- report trend chips
- approval mode/status badges
- workspace and sync state chips

The product prefers compact pills over large legend blocks.

### Menus and popovers

The app frequently uses:

- `details`-based action menus
- absolute-positioned popovers for row actions
- typeahead dropdowns for scopes and other pickers
- footer/workspace popovers in the sidebar

These popovers generally use white backgrounds, soft borders, small radii, and short item rows.

### Forms and pickers

Notable current form conventions:

- inputs, selects, and textareas are kept at `16px` minimum font size to avoid iOS auto-zoom
- search fields and pickers are usually understated white controls with light borders
- scope and board selection frequently use typeahead dropdowns rather than large modal choosers
- many flows reuse the same suggestion-row pattern with avatar plus two-line copy

### Avatars and identity surfaces

Circular avatars are reused across:

- session chip
- chat messages
- thread replies
- doc shares
- task assignees
- workspace switcher

Fallback avatars are usually dark circular fills with white initials.

## Content Styling

Markdown styling is shared across chat messages, task comments, and document comments, with docs preview using a closely related rule set.

Current shared markdown treatment:

- generous line-height around `1.6` to `1.65`
- dark code blocks on slate background
- light inline code chips
- blue links
- simple bordered tables
- left-border blockquotes
- storage-backed images displayed as rounded, bordered media blocks

The design language for rich text is consistent even when the surrounding section layout changes.

## Responsiveness

The app is desktop-first, but there are explicit mobile adaptations.

Key breakpoints visible in the code today:

- `768px`: sidebar becomes a slide-over drawer; main content loses side padding; chat thread becomes a full-width mobile pane
- `720px`: Flight Deck and Reports stack vertically; docs title rows collapse; calendar controls stretch vertically
- `900px`: scope tree navigator appears; approval detail can expand into multi-column preview mode
- `640px`: some modal internals stack, including record version layouts

Practical mobile behavior:

- mobile nav uses a backdrop and slide-in sidebar
- when a chat thread is open on mobile, the main chat pane is hidden so the thread takes over
- desktop-style side rails that do not fit small screens are either hidden or collapsed into a single-column flow

## Practical As-Built Style Rules

The current implementation suggests these consistency rules:

- Use the white/slate base palette as the default product frame.
- Reserve stronger gradient cards and heavier shadows mainly for Flight Deck, Reports, key approval cards, and modals.
- Keep navigation, chat, docs browser rows, and people lists flatter and denser than dashboard surfaces.
- Prefer pills, badges, and dots for status communication instead of large banners inside working screens.
- Use rounded corners more aggressively as the surface becomes more important: rows stay flatter, cards and modals get larger radii.
- Keep destructive and secondary actions behind compact menus where possible.
- Let main scrolling happen inside pane containers, not at the page body level.
- Preserve bookmarkable section/detail state in the URL rather than treating the UI as purely ephemeral.
- On mobile, switch from side-by-side panes to overlays or stacked layouts instead of trying to preserve desktop density.

## Known Limits And As-Built Caveats

- There is no unified formal design system file; the design system is encoded in `index.html` and `src/styles.css`.
- The visual language is consistent enough to describe, but it is not token-complete or component-library-driven.
- Some sections are visibly more polished than others. Flight Deck and Reports are the most "designed" surfaces; Settings, People, and parts of Tasks remain more utilitarian.
- Jobs and Autopilot are conditional surfaces and should not be treated as baseline nav in every runtime.
