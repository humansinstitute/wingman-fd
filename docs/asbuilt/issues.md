# Wingman Flight Deck As-Built Issues

Status: as-built working note
Reviewed against live code on 2026-04-08
Companion docs:

- `docs/asbuilt/architecture.md`
- `docs/asbuilt/data model.md`
- `docs/asbuilt/middleware.md`
- `docs/asbuilt/frontend.md`
- `docs/asbuilt/design.md`
- `docs/asbuilt/important.md`

## Scope

This note captures the obvious follow-up issues surfaced while reviewing the live repository against the refreshed as-built documentation set. These are concrete gaps, inconsistencies, risky technical debt, or stale assumptions visible in the repo today.

## Issues

### 1. Access pruning coverage still lags the live materialized schema

Evidence:

- `src/access-pruner.js` only scans `channels`, `scopes`, `tasks`, `documents`, `directories`, `reports`, `schedules`, and `audio_notes`.
- `src/db.js` materializes `flows`, `approvals`, `persons`, and `organisations` as first-class workspace tables.
- `src/translators/flows.js`, `src/translators/approvals.js`, `src/translators/persons.js`, and `src/translators/organisations.js` all persist local `group_ids`.

Why this matters:

- Non-owner viewers can keep locally cached rows for newer group-scoped families after access is revoked.
- The repo already treats prune as a cache-cleanup step, so missing family coverage is an obvious consistency gap.

Practical follow-up:

- Extend prune and stale-group-ref repair coverage to the newer group-bearing families.
- Add tests that tie prune coverage to the live workspace-table and translator set.

### 2. Flows is a visible product section, but it is still not a first-class route/title target

Evidence:

- `index.html` renders a visible `Flows` sidebar item and a live `navSection === 'flows'` page.
- `src/app.js` sets `navSection = 'flows'` in real navigation paths.
- `src/app.js` `getRoutePath()` has no `flows` case and falls back to `/flight-deck`.
- `src/route-helpers.js` `KNOWN_PAGES` does not include `flows`.
- `src/page-title.js` has no `flows` title case, so tab titles fall back to the default branch.

Why this matters:

- Browser history, deep-linking, refresh behavior, and tab titles are not aligned with a section that is already live in the UI.
- Maintainers have to remember that Flows is “real” in the template but still incomplete in the shared routing helpers.

Practical follow-up:

- Promote `flows` to a first-class route in both route builders and route parsers.
- Add a dedicated document-title case so the browser tab reflects the active section.

### 3. Workspace session-key bootstrap appears to be present in code but not wired into the live runtime

Evidence:

- `src/crypto/workspace-keys.js` still contains a full bootstrap/cache/register flow, including `bootstrapWorkspaceSessionKey()`, `setActiveWorkspaceKey()`, and registration helpers.
- Repo-wide usage in this snapshot shows those bootstrap and activation helpers referenced only inside `src/crypto/workspace-keys.js` itself.
- Live runtime code only imports the read-side helpers: `src/api.js` and `src/sync-manager.js` read `getActiveWorkspaceKeySecretForAuth()`, while `src/sync-worker-client.js` exports any already-active key to the worker.

Why this matters:

- The auth layer is built to prefer a registered workspace session key, but this repo snapshot does not show the app actually activating one.
- That makes the intended auth model easy to misread and suggests the browser may still sign most traffic as the logged-in user instead.

Practical follow-up:

- Either wire the bootstrap/registration path into the real workspace lifecycle or document that the user-signer path is the only live path today.
- Add an end-to-end check that proves which signer is actually used for API auth and SSE auth.

### 4. Worker fallback and flush-cadence comments are stale relative to the implementation

Evidence:

- `src/worker/sync-worker.js` still says the module is reusable for “the main-thread fallback path when workers are unavailable”.
- `src/sync-worker-client.js` now throws when a worker cannot be created and explicitly says sync is unavailable until later retry.
- `src/sync-worker-client.js` comments say the independent flush timer runs every 5 seconds.
- `src/worker/sync-worker-runner.js` sets `FLUSH_INTERVAL_MS = 2000`.

Why this matters:

- The live client behavior is now “real worker required”, but parts of the source still describe an older fallback model.
- Even small comment drift matters here because sync recovery and outbox timing are operational behavior, not cosmetic detail.

Practical follow-up:

- Update or remove stale comments so the codebase has one clear source of truth for degraded-worker behavior and flush cadence.
- Keep the as-built docs and source comments aligned whenever sync behavior changes.

### 5. Jobs remains a sizable dormant stub surface in source

Evidence:

- `src/jobs-manager.js` still exposes modal/state helpers, but every load/create/edit/dispatch/toggle/delete/stop action resolves to “Jobs are unavailable in this build.”
- `index.html` still carries a large jobs page and jobs controls, but the nav item is hard-hidden with `x-show="false"` and the section itself is disabled behind `x-if="false && 'jobs-hidden'"`.
- `src/app.js` still carries jobs state fields inside the root Alpine store.

Why this matters:

- The repo keeps a non-trivial amount of dead-adjacent UI/state surface that is not reachable in the shipped navigation.
- That increases maintenance cost and makes it harder to tell whether Jobs is a near-term feature, a placeholder, or legacy scaffolding.

Practical follow-up:

- Either remove the dormant jobs surface deliberately, or complete the backend/UI contract and make it reachable again.
- If it must stay parked, keep it isolated and explicitly documented as non-live code.

### 6. The shipped UI is still concentrated in one very large Alpine store and one very large template

Evidence:

- `src/app.js` is 4,756 lines and still ends by composing one root `Alpine.store('chat', storeObj)`.
- `index.html` is 6,021 lines and remains tightly coupled to `$store.chat.*`.
- The repo has extracted managers and shell helpers, but the runtime state model is still centered on the single root store.

Why this matters:

- Cross-cutting changes still converge on one large state object and one large template.
- That keeps ownership boundaries fuzzy and raises the regression cost of routine UI work.

Practical follow-up:

- Continue extracting section ownership into smaller runtime boundaries instead of extending the root store/template.
- Treat future UI work as a chance to reduce direct `$store.chat` coupling.

### 7. Legacy Coworker identifiers still span product, auth, storage, and deploy surfaces

Evidence:

- `package.json` still uses the package name `coworker-fe`.
- `src/app-identity.js` still reads `VITE_COWORKER_APP_NPUB`.
- `src/auth/secure-store.js`, `src/db.js`, and `src/hard-reset.js` still depend on `CoworkerV4*` IndexedDB names.
- `src/auth/nostr.js` still uses `APP_TAG = 'coworker-v4'` and “Authenticate with Coworker”.
- `src/agent-connect.js` still emits `kind: 'coworker_agent_connect'` and “another Coworker/agent session”.
- `ecosystem.config.cjs` still contains old coworker paths and labels.

Why this matters:

- Some of these names are compatibility-critical and some are only stale branding or deploy residue, but the repo does not clearly separate the two.
- That makes future rename work risky because maintainers have to guess which strings are safe to touch.

Practical follow-up:

- Inventory which legacy identifiers are contract-sensitive versus renameable.
- Document that boundary before any wider naming cleanup.
