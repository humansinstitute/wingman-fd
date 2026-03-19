# Wingman Flight Deck

Local-first frontend for Wingman Be Free.

Run model:
- Dev: run locally via Wingman/PM2
- Prod: publish the built static site for the live deployment
- Do not use Docker for local Flight Deck development

App namespace:
- The frontend app namespace comes from `VITE_COWORKER_APP_NPUB`
- If that env is unset, the fallback is defined in `src/app-identity.js`

Schema workflow:
- Published record-family manifests live in `../sb-publisher/schemas/flightdeck`
- `bun run test` validates real Flight Deck outbound payloads against those published schemas
- If a record payload changes, update the schema manifests and republish them with `sb-publisher`

Backend deployment note:
- `docs/tower-backend-prod.md` covers the Tower env, Docker commands, and admin connection-token flow from the Flight Deck side

See [../ARCHITECTURE.md](../ARCHITECTURE.md) for the current build frame.
