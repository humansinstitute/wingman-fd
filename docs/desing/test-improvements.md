# Flight Deck Test Improvements

Status: historical remediation note; default Vitest lane is currently green
Last updated: 2026-05-03

## Problem Summary

`bun run test` in `wingman-fd` currently runs `vitest run`. As of
2026-05-03, the default Vitest lane is clean against the current working tree.
This note is retained as history for the earlier mixed-runner collection issue
and as guardrail documentation for future test additions.

Earlier sources of failure:

- `tests/coworker-identifier-inventory.test.js` previously imported `bun:test`
- `tests/e2e/workspace-profile.spec.js` imports `playwright/test`
- `package.json` defines `test` as `vitest run`
- `vite.config.js` owns Vitest collection settings

The current default command is:

```bash
bun run test
```

It should stay focused on Vitest-owned tests. Browser e2e remains separate via
`bun run test:e2e`.

## Desired End State

The repo should have three clean lanes:

1. Vitest for normal unit/integration tests
2. Bun test for Bun-only inventory or compatibility checks
3. Playwright for browser e2e

Each lane should be runnable independently and should not accidentally collect files owned by another runner.

## Recommended Remediation

### 1. Narrow the default Vitest collection

Update `vite.config.js` so the `test` block explicitly includes only the Vitest suites and excludes e2e plus Bun-only files.

Recommended shape:

```js
test: {
  environment: 'node',
  globals: true,
  setupFiles: ['./tests/setup.js'],
  include: ['tests/**/*.test.js'],
  exclude: [
    'tests/e2e/**',
    'tests/**/*.bun.test.js',
    'tests/coworker-identifier-inventory.test.js',
  ],
},
```

If the inventory test remains named `*.test.js`, it must stay explicitly excluded. Renaming it is cleaner.

### 2. Move Bun-only tests onto a clear naming convention

Rename Bun-owned tests to a dedicated suffix, for example:

- `tests/coworker-identifier-inventory.bun.test.js`

That makes ownership obvious and removes the need for ad hoc exclusions later.

Recommended rule:

- Vitest files: `*.test.js`
- Bun-only files: `*.bun.test.js`
- Playwright files: `*.spec.js` under `tests/e2e/`

### 3. Add a dedicated Bun test script

Extend `package.json` with an explicit script for Bun-owned tests.

Recommended scripts:

```json
{
  "test": "vitest run",
  "test:bun": "bun test tests/**/*.bun.test.js",
  "test:e2e": "playwright test",
  "test:all": "bun run test && bun run test:bun"
}
```

If Bun glob handling is awkward in the shell, use a small wrapper script or pass explicit paths.

### 4. Keep Playwright isolated

Playwright should only run through `bun run test:e2e`.

Guardrails:

- keep all browser specs under `tests/e2e/`
- do not import Playwright specs from unit-test helpers
- do not let Vitest include `tests/e2e/**`

### 5. Separate CI expectations

CI should not treat all tests as one indistinguishable step.

Recommended CI stages:

1. `bun run test`
2. `bun run test:bun`
3. `bun run test:e2e` only in an environment that provides the browser/runtime prerequisites

This keeps routine code-review feedback fast while preserving the e2e lane.

### 6. Document runner ownership in the repo

Add a short note to `wingman-fd/README.md` or `tests/README.md` covering:

- which runner owns which files
- naming conventions
- which command is the default dev gate
- which commands are expected in CI

Without that, the repo will regress back into mixed-runner collection.

## Historical Implementation Order

1. Keep `tests/e2e/**` out of Vitest.
2. Keep inventory tests on Vitest unless they intentionally require Bun-only APIs.
3. Add a dedicated `test:bun` lane only if Bun-only tests return.
4. Add a combined non-e2e gate only after separate lanes exist.
5. Document the convention when new lanes are added.

## Non-Goals

This note does not propose changing:

- Tower’s workspace-first contract
- Flight Deck app behavior
- Playwright test content

The immediate goal is only to make test results trustworthy again.

## Follow-Up

Adjacent repos likely also have documentation drift around naming and older “Autopilot” / “Coworker” terminology. That should be reviewed separately from the Flight Deck runner cleanup so contract fixes, doc fixes, and test harness fixes do not get conflated.
