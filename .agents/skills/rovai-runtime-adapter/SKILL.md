---
name: rovai-runtime-adapter
description: Use when adding, upgrading, probing, or debugging an Agent Runtime adapter (Claude, Codex, ACP, Pi, Cline, DSH, ZCode, Command Code, Antigravity), Runtime catalog admission, native session resume, or usage monitoring.
---

# Rovai Runtime Adapter

## Trigger

Use for a new Runtime, an upstream version change, an ACP/native-session
mismatch, a capability probe, a model catalog entry, or Runtime usage
monitoring.

## Read First

1. `docs/development/runtime-integration-checklist.md`.
2. `docs/architecture/availability-first-runtime.md`,
   `docs/architecture/runtime-catalog-boundaries.md`, and
   `docs/architecture/runtime-monitoring.md`.
3. `docs/runtime-compatibility.md` and the matching
   `docs/research/<runtime>/` evidence folder.
4. `crates/rovai-core/src/agent_runtime_adapter.rs` plus the existing adapter
   family under `acp/`, `antigravity/`, `cline/`, `command_code/`, `dsh/`,
   `pi/`, `zcode/`, `claude.rs`, and `codex.rs`.

## Workflow

1. Decide whether this is an executable Runtime capability, a machine
   availability fact, or a Renderer-only Settings preview. Do not promote one
   layer into another.
2. Reuse the adapter trait and the closest existing family. Add a new adapter
   only when protocol differences are real, not cosmetic.
3. Never infer capability from a version string alone. Capture a probe or
   capability snapshot and keep the evidence under the Runtime research folder.
4. Keep native-session resume, model context, tool transport, approval, and
   usage metering as separate claims. A passing resume does not prove tool
   parity, and a model list does not prove execution support.
5. Verify admission and failure paths: unsupported version, missing binary,
   unavailable host, rejected auth, and interrupted Run.
6. Run targeted Rust tests first, then the PR regression. Real provider calls
   require a separate explicit scope and isolated data.

## Reuse Points

- Adapter contract: `agent_runtime_adapter.rs`
- Fleet and selection: `runtime_fleet.rs`, `runtime.rs`
- Discovery and probes: `runtime_discovery` tests and the adapter module
- Usage and context facts: `monitoring.rs`, `context.rs`
- Settings and catalog projections: `read_model.rs`, Renderer settings views

## Forbidden

- Auto-installing or auto-upgrading a Runtime.
- Treating a Settings preview as an executable catalog entry.
- Marking a capability supported from documentation or a version string.
- Launching a real Runtime against daily data or without a bounded probe.
- Reading credentials, cookies, tokens, or provider account data.

## Verify

```bash
cargo test -p rovai-core --lib <adapter>::
pnpm test:rust:pr
pnpm docs:check
```

Record the exact runtime version, host, command, and evidence path in the
matching `docs/research/<runtime>/` document.
