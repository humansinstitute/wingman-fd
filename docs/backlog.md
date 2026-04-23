# Backlog

Items deferred from active design work. Review periodically.

## SSE Scaling

**Source:** [docs/design/sse-updates.md](./design/sse-updates.md)

If Tower moves beyond single-process deployment (e.g., multiple instances behind a load balancer), the SSE fan-out needs shared state for cross-process event delivery. Options:

- Redis pub/sub between Tower instances
- PostgreSQL LISTEN/NOTIFY (already using Postgres)
- Dedicated SSE fan-out service

Current assumption is users run their own Tower instance (single Bun process), so this is not needed now. Revisit if multi-instance deployment becomes a requirement.
