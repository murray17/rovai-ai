# AGENTS.md

## Project documentation

- Documentation map, authority boundaries, and task-based reading rules: [`docs/README.md`](docs/README.md). Read this first for architecture, implementation, planning, or documentation work.
- Current version architecture and implementation status: follow the canonical `current_version` pointer and `current` row in [`docs/versions/README.md`](docs/versions/README.md); do not hard-code a version path here.
- When creating a version or changing `current_version`, follow the canonical [version transition checklist](docs/versions/README.md#版本切换清单) and record every conclusion in the new version overview.
- Current cross-version architecture navigation: [`docs/architecture/README.md`](docs/architecture/README.md); current authority and decision-rationale routing: [`docs/decisions/CURRENT.md`](docs/decisions/CURRENT.md); decision admission and historical governance: [`docs/decisions/README.md`](docs/decisions/README.md).
- Do not create numbered ADR files. When adding or changing a Version Decision, Architecture, Contract, version document, or documentation route, run the generic documentation gates described in [`docs/decisions/README.md#自动治理`](docs/decisions/README.md#自动治理). Do not add feature-, version-, or Skill-specific checker exceptions.
- Local environment, development run, tests, and macOS builds: [`docs/development/README.md`](docs/development/README.md).
- Before adding, merging, permanently disabling, or deleting Rust tests, follow the canonical
  [Rust test admission and retirement policy](docs/development/testing.md#rust-测试准入与退役门槛).
- Before starting Electron, `rovai-core`, a packaged App, or a real Runtime, read and follow
  [`docs/development/local-workflow.md`](docs/development/local-workflow.md). Use `pnpm dev` rather than
  bare `electron-vite dev`; never run the daily App from `dist/`, and never point development or acceptance
  processes at daily Electron `userData`.
- Do not treat historical version documents as current constraints, and do not infer implementation completion from historical decision status. Follow the conflict rules in `docs/README.md`.

## Frontend design

- For any UI/UX or renderer-facing change, read [`DESIGN.md`](DESIGN.md) and
  [`docs/ui/README.md`](docs/ui/README.md) first.
- Read `PRODUCT.md`, when it exists, only when the task depends on users, product purpose,
  positioning, terminology, or durable brand commitments.
- When a matching `apps/desktop/.impeccable/surfaces/*.md` brief exists for a Renderer target, use
  it as local surface strategy. It cannot override current Architecture, Contracts, current version scope,
  `DESIGN.md`, or theme contracts.
- Impeccable is optional provider-local tooling. It may be installed under the current coding
  agent's native skill directory; do not assume `.agents/skills/impeccable`, a slash command, or a
  specific provider.
- When native skill discovery is unavailable, read the installed `impeccable/SKILL.md` and its
  referenced files directly. The skill is not a repository authority.
- Do not install or enable Impeccable hooks or plugins without explicit user approval.
- Incremental work preserves the established Rovai AI visual world. Do not enter a
  replacement-world flow unless the user explicitly requests a redesign.

## Project knowledge distillation (2026-10-19)

This section is a compact task router distilled from the current repository. It
does not replace `docs/README.md`, the owning Architecture, or the current
Contract.

### Authority order

1. Live behavior and targeted test evidence.
2. Current source, migrations, contracts, and build configuration.
3. `docs/architecture/`, the owning `docs/contracts/*-vN.md`, the single
   `current_version` in `docs/versions/README.md`, and
   `docs/decisions/CURRENT.md`.
4. Historical version documents, research briefs, and postmortems: context
   only, never current constraints.

### Non-negotiable repository facts

- Stack: pnpm 11, Node >= 24, Electron + React + TypeScript, and a Rust
  workspace with `rovai-core`, `rovai-host`, and `rovai-web`.
- Domain vocabulary is normative: Thread (not Conversation), Mission (not
  Task), User for new structured current-user projections, and Gather is
  retired.
- `crates/rovai-core/src/db.rs` and `application.rs` are the largest authority
  files. Search them before adding a parallel command, migration, store,
  snapshot, or event path.
- Contracts are versioned files. Change the narrowest owning contract, add or
  advance its version deliberately, and run the documentation gates.
- All code changes land through a task branch and a Pull Request targeting
  `main`; do not push directly to `main`.
- Development must go through `pnpm dev`. It supplies an isolated `userData`
  and isolated Skill Library. Never point Core at the daily data directory,
  run from `dist/`, or use bare `electron-vite dev`.
- Development, packaged-app acceptance, daily installation, and real-runtime
  probes are separate channels with separate isolation evidence.
- Do not install Impeccable hooks/plugins, start MCP servers, call providers,
  or read credentials, cookies, or tokens without explicit user approval.

### Change-to-verification matrix

| Change | Minimum verification |
| --- | --- |
| Renderer or ordinary TypeScript | `pnpm typecheck` plus the focused test |
| Rust Core | Targeted `cargo test -p rovai-core --lib <owner>::`, then `pnpm test:rust:pr` |
| Preload/IPC transport | `pnpm test:desktop-bridge` |
| Electron layout or native window flow | The matching `pnpm test:*` fixture and `pnpm build:desktop` |
| Documentation, Contract, Architecture, Version Decision | `pnpm docs:test` and `pnpm docs:check` |
| Skill authoring | `pnpm skills:test` and `pnpm skills:check` |
| Packaged desktop | `pnpm build:desktop` plus isolated acceptance |

Scenario-specific project skills live in `.agents/skills/`.
