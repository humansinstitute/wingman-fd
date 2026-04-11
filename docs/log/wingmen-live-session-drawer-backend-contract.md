# Wingmen Live Session Drawer Backend Contract Audit

## Context

The remaining uncertainty on this task is no longer route ownership. It is the exact meaning of the existing upstream metadata and Night Watch contracts that the drawer already depends on.

## Confirmed Metadata Contract

Upstream `PATCH /api/sessions/:id/metadata` currently behaves as follows:

- accepts either a flat patch object or `{ metadata: ... }`
- rejects only non-object or empty-object payloads
- merges the patch into existing session metadata rather than replacing the whole metadata object
- normalizes the merged result through [../../wingmen/src/sessions/session-metadata.ts](/Users/mini/code/wingmen/src/sessions/session-metadata.ts)

Normalization details that matter to the drawer:

- string fields are trimmed
- empty strings normalize back to `undefined`
- `nextAction` is constrained to `none`, `reflect`, `stop`, or `restart`
- `nextActionPayload` stays free text
- `nextActionTemplate` is separate from both
- `bindingType` is constrained to `thread`, `task`, or `flow_run`

## Confirmed Night Watch Contract

Upstream Night Watch currently exposes:

- `GET /api/nightwatch/sessions/:id`
- `POST /api/nightwatch/sessions/:id/enable`
- `POST /api/nightwatch/sessions/:id/disable`
- `GET /api/nightwatch/reports`

Important behavior:

- enabling Night Watch from the current UI first patches session metadata with `goal`, `nextAction`, and `nextActionTemplate`
- only after that metadata patch succeeds does the UI call the Night Watch enable endpoint
- the Night Watch enable endpoint itself only takes runtime settings such as `model`, `maxCycles`, `prompt`, and `intervalMinutes`

## Current Mismatch To Preserve

The upstream drawer currently edits:

- `goal`
- `nextActionPayload`

The upstream Night Watch enable modal currently edits:

- `goal`
- `nextAction`
- `nextActionTemplate`

So the phrase "current next action" is currently split across:

- enum intent in `nextAction`
- free-text detail in `nextActionPayload`
- template text in `nextActionTemplate`

## History Endpoint Limitation

`GET /api/nightwatch/reports` is global only.

The current store returns the newest 50 reports overall, sorted newest-first. There is no dedicated session-history route and no query parameter for `sessionId`.

Consequence:

- the current drawer history preview is correct for recent activity
- it can omit older reports for a busy session when enough newer reports from other sessions exist

## Consequences

- Follow-up drawer work should explicitly decide which of `nextAction`, `nextActionPayload`, and `nextActionTemplate` the drawer owns.
- If session history completeness matters, upstream should add either:
  - `GET /api/nightwatch/sessions/:id/reports`
  - or `GET /api/nightwatch/reports?sessionId=:id&limit=:n`
