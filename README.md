# release-flow-pilot

A small, working demonstration of trunk-based development and release engineering (PLT-1652).
Merges to `main` deploy DEV; Release Please prepares versions; TEST and PROD deploy only
frozen release tags; PROD waits for a human approval.

- Design: [docs/superpowers/specs/2026-11-23-release-flow-pilot-design.md](docs/superpowers/specs/2026-11-23-release-flow-pilot-design.md)
- Environments (local Docker on the deploy Mac): DEV http://dev.localhost:4101,
  TEST http://test.localhost:4102, PROD http://prod.localhost:4103

The demo checklist is added at the end of the pilot build.
