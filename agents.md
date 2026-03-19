# Coworker FE Instructions

This frontend implements the app-side translation and local-first UI described in:

- [../ARCHITECTURE.md](../ARCHITECTURE.md)
- [../design.md](../design.md)
- [../roadmap.md](../roadmap.md)

## Role of this project

- Materialize SuperBased packets into Coworker UI tables
- Keep the UI responsive and local-first
- Make workspace switching and active-page sync feel immediate

## Hard rules

- Do not render raw SuperBased packets directly
- Do not put sync, crypto, or schema migration work on the main UI thread
- Keep one translator per record family, even if related families share a module
- Keep local tables shaped for UI use, not transport convenience
- After code changes, always run `bun run build` so the local `dist/` output is refreshed

## Storage and sync

- Prefer per-collection tables over one generic mega-table
- Store rows fully decrypted and materialized for fast UI reads
- Use workers for background sync, decryption, encryption, migration, and reconciliation
- Treat targeted sync for the active page as a first-class requirement

## Workspace model

- The signed-in user is identified by their `npub`
- A workspace is separate from the user identity
- In v1 each workspace has one authority backend
- The UI should make current workspace context obvious
- Do not design around per-person backend fanout

## Future direction

- Keep the FE ready for more record families beyond chat
- Keep notification and workspace switching generic
- Expect replication later, but do not complicate v1 UI around it
