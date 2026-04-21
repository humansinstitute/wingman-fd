# Clickable Local File Links

Status: derived review copy
Last updated: 2026-04-21
Canonical source: `/Users/mini/code/wingmen/docs/feature-clickable-local-file-links.md`

This file mirrors the implementation-ready design from the Wingmen repo so
Flight Deck review can happen inside the local `wingman-fd` docs tree. The
canonical contract remains
`/Users/mini/code/wingmen/docs/feature-clickable-local-file-links.md`.

## Goal

Let a user click a local file reference that appears in agent output and open
that target in the existing Files surface without manually browsing through the
file tree.

The v1 contract is:

- activate bare absolute local paths in chat-style output
- activate markdown links whose destination is a local absolute path
- route clicks into the existing `/files/...` flow
- keep backend docs/files authorization as the trust boundary
- avoid turning the chat renderer into generic markdown rendering

## Scope

In scope:

- live session conversation
- private chat
- archived-session dialog
- bare absolute paths without spaces
- markdown links to local absolute paths
- angle-bracket markdown destinations for paths with spaces

Out of scope:

- general rich-markdown rendering in chat
- ordinary remote hyperlink activation
- arbitrary `file://` text links
- line-number jumps
- client-side scope prevalidation
- new backend resolver routes

## Main Decisions

- Keep v1 scoped to local file activation only.
- Extend `renderChatMessageHtml(...)` instead of replacing the current
  plain-text-first renderer.
- Use `/files/<path>` as the bootstrap contract, including absolute-path slugs.
- Accept normal full-page navigation in v1 rather than adding SPA-only click
  interception.
- Ignore `:line` suffixes for navigation while leaving the visible text intact.
- Render local-looking paths as links based on syntax alone and let the backend
  reject out-of-scope targets.

## Current System Facts

The approval review re-checked the main contract against the current code:

- [`src/ui/rendering/chat-message-content.js`](/Users/mini/code/wingmen/src/ui/rendering/chat-message-content.js)
  still renders non-image text as escaped content inside
  `<pre class="wm-message-plain">`.
- [`src/ui/files/api.js`](/Users/mini/code/wingmen/src/ui/files/api.js)
  already supports `/files/<slug>` bootstrap through
  `parseFilesPathFromUrl()` and `navigateToFilesSlug(slug)`.
- [`src/server/docs-routes.ts`](/Users/mini/code/wingmen/src/server/docs-routes.ts)
  still resolves requested paths against the active workspace docs root and
  rejects out-of-scope access.

That means the feature remains a targeted Wingmen frontend change, not a Flight
Deck implementation project and not a new backend authorization model.

## Implementation Shape

Primary implementation files:

- [`src/ui/rendering/chat-message-content.js`](/Users/mini/code/wingmen/src/ui/rendering/chat-message-content.js)
- [`src/ui/files/api.js`](/Users/mini/code/wingmen/src/ui/files/api.js)
- [`src/server/docs-routes.ts`](/Users/mini/code/wingmen/src/server/docs-routes.ts)
- [`src/ui/styles.css`](/Users/mini/code/wingmen/src/ui/styles.css)

Relevant renderer consumers:

- [`src/ui/live/conversation-window.js`](/Users/mini/code/wingmen/src/ui/live/conversation-window.js)
- [`src/ui/live/chat-component.js`](/Users/mini/code/wingmen/src/ui/live/chat-component.js)
- [`src/ui/views/live-view.js`](/Users/mini/code/wingmen/src/ui/views/live-view.js)
- [`src/ui/chat/private-chat.js`](/Users/mini/code/wingmen/src/ui/chat/private-chat.js)
- [`src/ui/home/archive.js`](/Users/mini/code/wingmen/src/ui/home/archive.js)

Recommended implementation steps:

1. Add a focused helper such as
   `src/ui/rendering/local-file-links.js` to parse supported local-link forms.
2. Update `renderChatMessageHtml(...)` to pass non-image text blocks through
   that helper while keeping the `<pre class="wm-message-plain">` container.
3. Emit internal anchors under `/files/` with a dedicated class such as
   `wm-local-file-link`.
4. Add narrow styling for readability inside the existing transcript
   presentation.
5. Add parser, rendering, and files-route tests for the supported shapes and
   regression cases.

## Supported Examples

- `/Users/mini/code/wingmen/docs/feature-clickable-local-file-links.md`
- `[design doc](/Users/mini/code/wingmen/docs/feature-clickable-local-file-links.md)`
- `/Users/mini/code/wingmen/src/server.ts:625`
- `[My Report](</Users/mini/Documents/My Report.md>)`

Generated href examples:

- `/Users/mini/code/wingmen/docs/design.md`
  -> `/files//Users/mini/code/wingmen/docs/design.md`
- `/Users/mini/code/wingmen/src/server.ts:625`
  -> `/files//Users/mini/code/wingmen/src/server.ts`
- `[My Report](</Users/mini/Documents/My Report.md:3>)`
  -> `/files//Users/mini/Documents/My%20Report.md`

## Acceptance Snapshot

- Clicking a supported local file reference opens the Files surface on that
  target.
- Uploaded image markdown continues to behave exactly as it does today.
- Ordinary remote links do not become clickable as a side effect.
- Out-of-scope local-looking paths fail closed through the existing backend
  docs/files checks.
- The change ships with renderer and files-route regression coverage.

## Approval Recommendation

Approve the brief for implementation. The design is tightly scoped, matches the
current Wingmen renderer/files/docs architecture, and produces a concrete Flight
Deck review copy without introducing extra backend contracts or broader markdown
behavior.
