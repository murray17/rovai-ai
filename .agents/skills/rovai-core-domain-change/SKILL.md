---
name: rovai-core-domain-change
description: Use when changing a Rovai Core command, domain aggregate, SQLite schema or migration, read model, event log, delivery/claim flow, or ContextManifest. Routes edits through the owning Architecture and versioned Contract before touching the large Core files.
---

# Rovai Core Domain Change

## Trigger

Use for changes to `crates/rovai-core` behavior, a domain command result, a
migration, a read-side projection, an event payload, run admission, or a
ContextManifest field.

## Read First

1. The task row in `docs/README.md`.
2. `docs/architecture/foundational-invariants.md`.
3. The owning `docs/architecture/<topic>.md` and current
   `docs/contracts/<topic>-vN.md`.
4. `docs/versions/README.md` (`current_version`) and that version's plan.
5. `crates/rovai-core/src/application.rs` (command gateway) and
   `crates/rovai-core/src/db.rs` (schema, migration chain, transactions).

## Workflow

1. Find the existing command enum, dispatch arm, result type, and idempotency
   receipt. Extend that path; do not add a second command or table that
   duplicates it.
2. Confirm the transaction boundary and replay behavior before editing state.
   Accepted commands must survive restart and retry without duplicating effects.
3. Change the narrowest owning Contract. Accepted old versions stay intact; new
   field-level behavior gets a new version file and reference updates.
4. Add schema changes only inside the existing migration chain in `db.rs`.
   Never create tables or indexes ad hoc at startup.
5. Update the read model and `packages/contracts` projections together. Model
   context gets facts, not raw database rows.
6. Add a focused Rust test beside the owning module, then run the PR-level
   regression.

## Reuse Points

- Command gateway and result envelopes: `application.rs`
- Schema, migrations, transactions, leases: `db.rs`
- Read projections: `read_model.rs`
- Context assembly: `context.rs`
- Runtime boundaries: `runtime.rs`, `agent_runtime_adapter.rs`

## Forbidden

- A parallel command, store, migration table, or event log for one feature.
- Raw SQL outside the migration chain.
- Weakening approval, isolation, data-dir lease, or Runtime ownership checks.
- Rewriting accepted historical Contracts, Version Decisions, or versions.

## Verify

```bash
cargo test -p rovai-core --lib <owner>::
pnpm test:rust:pr
pnpm typecheck
pnpm docs:check
```
