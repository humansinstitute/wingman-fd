# Wingman Flight Deck As-Built Design

Status: as-built working note  
Reviewed against live code on 2026-04-08  
Companion docs:

- `docs/asbuilt/architecture.md`
- `docs/asbuilt/frontend.md`
- `docs/asbuilt/data model.md`
- `docs/asbuilt/middleware.md`

## Scope

This note describes the UI design Flight Deck actually ships today. It is based on the live browser template, stylesheet, app boot path, and section managers rather than target-state design notes.

It covers:

- app shell, section layout, deep-linking, and modal composition
- live visual rules in `src/styles.css`
- shell boot and routed composition from `src/main.js` and `src/app.js`
- design-impacting behavior from the current task, docs, chat, flows, scopes, workspace, title, and service-worker seams

Primary files reviewed for this refresh:

- `docs/asbuilt/architecture.md`
- `docs/asbuilt/frontend.md`
- `docs/asbuilt/data model.md`
- `docs/asbuilt/middleware.md`
- `index.html`
- `src/styles.css`
- `src/main.js`
- `src/app.js`
- `src/task-board-state.js`
- `src/docs-manager.js`
- `src/channels-manager.js`
- `src/flows-manager.js`
- `src/scopes-manager.js`
- `src/workspace-manager.js`
- `src/page-title.js`
- `src/service-worker-registration.js`

## Design Baseline

### Overall look

Flight Deck still ships as a light-theme, desktop-first SPA with a white/slate base frame and blue as the default accent. It does not ship a dark mode. The shell, chat, docs browser, tasks, scopes, and people surfaces stay fairly flat and operational; Flight Deck status, reports, some approval surfaces, and most centered modals use softer gradients, deeper radii, and more visible shadows.

### Core visual tokens

| Area | Current implementation |
| --- | --- |
| Font stack | `-apple-system`, `BlinkMacSystemFont`, `"Segoe UI"`, `sans-serif` |
| Base text | `#111827` |
| Muted text | `#6b7280` |
| Base surface | `#ffffff` |
| Muted surface | `#f8fafc` |
| Hover surface | `#f1f5f9` |
| Default accent | `#3b82f6` |
| Danger | `#ef4444` / `#dc2626` |
| Radius scale | `6px`, `10px`, `14px`, with frequent `12px` to `24px` cards and many pill/999px shapes |
| Shadows | soft slate shadows, stronger on avatars, report cards, popovers, modals, and mobile nav |

### Typography

- Global typography stays on the system UI stack; there is no branded webfont.
- Body text generally lands between `0.82rem` and `0.95rem`.
- The largest heading treatment remains the Flight Deck hero title at `clamp(1.45rem, 2.4vw, 2.25rem)`.
- Small uppercase labels are heavily reused for report eyebrows, section labels, scope levels, sync labels, settings labels, and count chips.
- Monospace appears only in technical surfaces such as build ids, JSON export, package content, and other code-like values.

### Spacing, surfaces, and motion

- The shell is compact. Row-level UI usually lives in `0.35rem` to `0.85rem` padding bands.
- Working lists stay visually flat; higher-emphasis cards step up to `18px` to `24px` radius and visible shadow.
- Motion is restrained and functional rather than decorative:
  - pulsing sync dots
  - report/list card lift on hover
  - sidebar width and mobile slide-over transitions
  - thread-width transitions in chat
  - rotating carets in workspace/scope navigation
  - fade-in row actions and comment triggers
  - overlay fades for modals and image preview

## App Shell And Boot

### Boot sequence

`src/main.js` currently boots in this order:

1. hard-reset guard
2. `initApp()`
3. build service-worker registration
4. build-version checking
5. global image modal initialization

This matters for the shipped UX:

- the shell is still one Alpine store registered as `Alpine.store('chat', storeObj)`
- `index.html` is still coupled directly to `$store.chat.*`
- service-worker registration is silent in production; `src/service-worker-registration.js` itself does not render UI
- when a later refresh-to-latest flow is triggered elsewhere, the service worker can activate and reload into the new build

### Top-level shell

After login, the app uses:

- a sticky header
- a left primary sidebar
- a scrollable main content region

Important shell behavior:

- `body` is locked to `100dvh` with `overflow: hidden`
- the app scroll happens inside `.main-content`, not the page body
- the header remains sticky
- mobile nav is a slide-over drawer, not a full-page route transition

### Header

The header currently contains:

- a mobile-only menu button when logged in
- Wingman logo and wordmark
- an avatar/session chip with sync-state ring
- an avatar menu with sync summary, build id, Agent Connect, copy-ID, sync, settings, and logout actions

Sync state is encoded both by ring color and dot color:

- green: synced
- orange: pending local changes
- amber: stale
- blue: syncing
- red: quarantined or error

## Navigation, Deep-Linking, And Title Behavior

### Sidebar

The desktop sidebar is `198px` wide, with a collapsed desktop state at `48px`. On mobile it becomes a fixed left drawer.

First-class visible nav items today:

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

Conditional or suppressed items:

- Jobs is present in the template but hard-hidden with `x-show="false"`
- Autopilot only appears when a harness link exists

Sidebar-specific design patterns:

- a pinned focus-scope typeahead at the top
- flat nav rows with muted text until hover/active
- unread dots for Chat, Docs, and Tasks
- nested channel list only while Chat is active
- workspace switcher card anchored in the footer

### Shared focus scope

The current board/scope picker model is a design-level organizing rule, not just task state:

- the selected focus scope is reused by Flight Deck, Tasks, Calendar, Reports, Flows, and docs filtering
- that focus is persisted per workspace slug in local storage
- Tasks and Calendar also reuse the same scope for descendant toggles and task projection
- Flow creation inherits the selected board scope when possible

This means “scope” is one of the main cross-section design anchors in the live product.

### Route model

Routes are path-backed and query-backed at the same time.

Current section paths include:

- `/<workspace-slug>/flight-deck`
- `/<workspace-slug>/chat`
- `/<workspace-slug>/tasks`
- `/<workspace-slug>/calendar`
- `/<workspace-slug>/docs`
- `/<workspace-slug>/reports`
- `/<workspace-slug>/people`
- `/<workspace-slug>/schedules`
- `/<workspace-slug>/scopes`
- `/<workspace-slug>/settings`

Query params currently carry design-significant detail state such as:

- `workspacekey`
- `scopeid`
- `channelid`
- `threadid`
- `folderid`
- `docid`
- `commentid`
- `versioning`
- `reportid`
- `taskid`
- `view`
- `descendants`

Important as-built behavior:

- `applyRouteFromLocation()` restores section state, then restarts live queries
- workspace slug or `workspacekey` can trigger a workspace switch
- workspace switching is not in-place UI only; `handleWorkspaceSwitcherSelect()` navigates by setting `window.location.href` to the new slug URL

### Document title

`src/page-title.js` gives the browser tab a section-aware title, but only for a subset of sections:

- explicit titles exist for `status`, `tasks`, `calendar`, `schedules`, `docs`, `people`, `scopes`, `settings`, and `chat`
- docs titles can include the current folder or document title
- chat titles can include the current channel label

Current limitation:

- `reports`, `flows`, `jobs`, and `autopilot` have no dedicated title case in `buildFlightDeckDocumentTitle()`
- those sections currently fall back to the default chat-style title behavior

## Modal Composition

The live shell uses one large template with many overlay surfaces rather than a separate routed modal system.

### Global overlays near the top of `index.html`

- catch-up sync overlay
- manual sync progress modal
- scope repair progress modal
- workspace bootstrap modal
- connect modal
- Agent Connect export modal

These all sit above the normal shell and use either the generic modal backdrop or dedicated sync overlays.

### Section and record overlays later in the template

Current modal/backdrop surfaces also include:

- doc versioning
- doc sharing
- doc scope assignment
- doc move and move-scope confirmation
- doc comment creation
- schedule create/edit
- new group and edit group
- channel settings
- report fullscreen modal
- new channel modal
- flow editor
- flow start confirmation
- approval detail
- approval history
- audio recorder
- generic record/version status surfaces

Design characteristics across the modal stack:

- most centered modals share white surfaces, soft borders, and larger radii than working screens
- report fullscreen and sync progress modals are more elevated and more visually specialized
- some domains use dedicated overlay classes instead of the shared `.modal-overlay`
- modal composition is state-flag driven directly from the Alpine store rather than route-driven

## Section Layout Patterns

### Flight Deck

Flight Deck is the most editorial top-level section:

- centered welcome headline
- large shared scope typeahead
- report-card grid
- two-column lower grid with Recent Work on the left and approvals/coming-up on the right

Compared with chat, docs, and tasks, this surface uses the most spacious layout and the most visible gradient cards.

### Reports

Reports is a two-pane workspace:

- left report list pane with count chip and active-row styling
- right detail pane that reuses the same report card language at larger scale
- fullscreen report modal for immersive inspection

Report cards are the most distinctive reusable visual component in the codebase:

- gradient card backgrounds
- large radii
- metric cards with oversized numerals
- timeseries bars with blue gradient columns
- trend chips with semantic green/red/slate states

### Chat

Chat stays intentionally flat and communication-first:

- optional channel header with menu
- full-width message feed
- optional thread panel on the right

Design traits:

- message rows are strips, not bubbles
- per-message sync status is a small corner dot
- action menus fade in on hover
- reply affordances are lightweight and only fully appear on hover
- the thread panel has three width states: default, wide, and full
- on mobile, opening a thread hides the main pane and lets the thread take over

### Tasks And Calendar

Tasks has two main visual modes:

- collection mode with create bar, filters, bulk actions, and kanban or list view
- detail mode with a large edit pane plus comment rail

Task-specific visual rules:

- column accents encode task state
- unread tasks get a red outline rather than a separate badge row
- tags, dates, priorities, and states all use compact badges
- summary columns use progress dots and parent-state badges
- the detail editor is dense and form-heavy, but still keeps comments as a visibly separate side panel on desktop

Calendar reuses the same board scope and task data model, but presents it as:

- day, week, month, or year grids
- rounded day/month cards
- task chips inside each period cell

Schedules is adjacent but visually distinct:

- green-accented buttons and focus states
- rounded schedule cards and schedule modal forms

### Docs

Docs mixes flat browsing with a more document-oriented editor.

Browser mode uses:

- search-first toolbar
- compact icon-only actions
- breadcrumbs
- flat document/folder rows
- drag-and-drop move affordances
- scope pills and sharing actions

Editor mode uses:

- breadcrumb/action header
- inline title editing
- preview, source, and block-edit flows
- optional comment gutter per block
- optional sticky `320px` thread rail on the right
- visual connector lines between selected block and selected thread when comments are visible

Important as-built behavior from `src/docs-manager.js`:

- selecting a comment thread forces the comment rail visible
- hiding doc comments also closes the selected thread and clears the connector
- if local comments are missing audio-linked data, the manager can backfill comment/audio families from the backend

### Scopes

Scopes combines two desktop patterns:

- a main column of nested scope cards
- a desktop-only sticky tree navigator on the right

Each scope level has distinct visual encoding through left-border color and badges. The tree navigator is collapsed by default into a narrow strip and expands inline.

The section also surfaces a scope-policy repair action. That repair is visually tied to its own progress modal and inline status copy, which makes scope crypto repair a visible design surface rather than a hidden maintenance action.

### Flows And Approvals

Flows is more card- and modal-driven than most sections:

- header with small action buttons
- approval banner cards near the top
- responsive grid of flow definition cards
- centered flow editor modal
- separate start-confirmation dialog

Visual traits:

- approval cards use warm yellow-to-white gradients
- flow cards are plain white with lighter borders
- step chips use left-border color coding by step type/mode
- task-flow attachment UI is a compact inline picker instead of a full modal

Approvals appear in two places:

- condensed cards on Flight Deck and Flows
- fuller approval detail modal with artifact/task preview and action row

### People And Settings

These sections remain more utilitarian.

People uses:

- top subtabs for People versus Organisations
- flat searchable list views
- slide-into-editor pattern within the same section
- small augment/menu controls embedded in rows

Settings uses:

- horizontal tabs
- stacked panels and lists
- standard form fields and repair cards
- workspace avatar/profile editing
- group management lists and modals

Important design-impacting behavior from `src/workspace-manager.js`:

- visible settings tabs depend on admin ability
- admins see `workspace`, `connection`, `automation`, `data`, and `sharing`
- non-admins are reduced to `connection` and `data`

## Common Controls And Shared Patterns

### Buttons

The live UI reuses a small set of button families:

| Family | Current styling |
| --- | --- |
| Default/global | dark fill, light text, compact radius |
| Primary CTA | dark slate fill with white text |
| Secondary | bordered white/light surface |
| Danger | red text or red fill depending context |
| Domain accents | schedules use green, approvals use green/red/purple, docs/tasks often stay neutral |
| Tiny utilities | icon-only controls, `btn-small`, ellipsis menus, pill actions |

### Chips, pills, badges, and dots

The product relies heavily on compact semantic markers:

- unread dots
- scope level badges
- doc scope pills
- task state/priority/date badges
- report trend chips
- approval status/mode badges
- workspace and sync state indicators

Large legend blocks are uncommon. Small badges carry most state.

### Menus and popovers

The app frequently uses:

- `details`-based menus
- absolute-positioned popovers
- typeahead dropdowns
- workspace switcher popovers
- row-action menus hidden until hover/focus

Almost all popovers use white surfaces, light borders, small radii, and compact row spacing.

### Avatars and identity

Circular avatars are reused across:

- session chip
- workspace switcher
- chat and thread messages
- doc shares/comments
- task assignees
- groups and people rows

Fallbacks are typically dark circles with white initials.

### Rich text and media

Markdown styling is intentionally shared across chat, thread replies, doc comments, task comments, and doc preview:

- line-height around `1.6` to `1.65`
- dark code blocks on slate background
- light inline code chips
- blue links
- simple bordered tables
- left-border blockquotes
- rounded storage-backed images

The same image can also open into a global dark image-preview overlay initialized during boot.

## Responsive Behavior

The app is still desktop-first, but there are explicit mobile changes.

Key breakpoints visible in the current CSS:

- `768px`
  - sidebar becomes a fixed slide-over drawer
  - main content loses side padding
  - chat thread becomes a full-width takeover pane
  - docs comment rail collapses under the document
  - task detail becomes single-column
- `720px`
  - Flight Deck and Reports collapse to single-column stacks
  - report fullscreen modal loses border radius and takes the viewport
  - calendar controls stretch vertically
- `900px`
  - scope tree navigator becomes visible
- `640px`
  - some record/version and modal internals stack

Practical mobile pattern:

- the product prefers overlays, takeovers, and stacked panels over preserving desktop side-by-side density

## Practical As-Built Style Rules

The live implementation suggests these consistency rules:

- Use white/slate as the default product frame.
- Keep navigation, chat, docs browser, scopes, and people flatter than dashboard/report surfaces.
- Reserve deeper shadows, gradients, and larger radii for Flight Deck, Reports, approvals, and modal work.
- Use pills, dots, and small chips for most state.
- Let main scrolling happen inside panes, not at the page body level.
- Keep the shared scope picker central to navigation and section context.
- Prefer inline popovers and local overlays over full page transitions.
- Preserve deep-linkable section/detail state in the URL.
- On workspace switch, accept a full reload into the new slugged shell instead of trying to animate an in-place context swap.

## Known Limits And As-Built Caveats

- There is still no standalone design-system source of truth; the real design system is encoded in `index.html`, `src/styles.css`, and store-driven behavior.
- The visual language is coherent but not token-complete or component-library-driven.
- Some sections are much more polished than others. Flight Deck and Reports are still the most intentionally designed surfaces; Settings, People, and parts of Tasks remain more utilitarian.
- Jobs is present in code but intentionally hidden in this build.
- Autopilot is conditional on workspace harness data and should not be treated as a universal baseline surface.
- Browser tab titles are not fully aligned with every nav section yet; `reports` and `flows` still lack dedicated title cases.
