# Wingmen Live Session Drawer Deep-Link Decision

## Context

One open question was whether future Flight Deck interoperability would need brand-new Wingmen session metadata fields for related-record links.

## Findings

Flight Deck already has strong native support for some record ids:

- tasks:
  - `taskid` is already a route parameter in [src/route-helpers.js](/Users/mini/code/wingmanbefree/wingman-fd/src/route-helpers.js)
  - task detail already restores from route state in [src/app.js](/Users/mini/code/wingmanbefree/wingman-fd/src/app.js)
  - canonical task URLs already exist in [src/app.js](/Users/mini/code/wingmanbefree/wingman-fd/src/app.js)
- documents:
  - `docid` is already a route parameter
  - document detail already opens from that id in [src/docs-manager.js](/Users/mini/code/wingmanbefree/wingman-fd/src/docs-manager.js)
- flows:
  - Flight Deck already stores `flow_id` and `flow_run_id` on tasks
  - flow-run step navigation can already resolve sibling tasks from `flow_run_id`
  - there is no first-class `flowid` or `flowrunid` route parameter yet

## Decision

For a first interoperability slice:

- `taskIds` are already sufficient for Flight Deck deep links
- `flowId` and `flowRunId` are already sufficient for in-app lookup and contextual navigation
- no new Wingmen metadata fields are needed just to support task and flow entry into Flight Deck

## Consequences

- If product later wants stable shareable Flow URLs, that should be solved by adding route support in Flight Deck, not by inventing duplicate session metadata fields in Wingmen.
- If product later wants direct doc links from the drawer, that is a different problem because current Wingmen session metadata does not carry doc ids.
