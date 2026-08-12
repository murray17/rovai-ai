# AGENTS.md

## Project documentation

- Documentation map, authority boundaries, and task-based reading rules: [`docs/README.md`](docs/README.md). Read this first for architecture, implementation, planning, or documentation work.
- Current version architecture and implementation status: follow the canonical `current_version` pointer and `current` row in [`docs/versions/README.md`](docs/versions/README.md); do not hard-code a version path here.
- When creating a version or changing `current_version`, follow the canonical [version transition checklist](docs/versions/README.md#版本切换清单) and record every conclusion in the new version overview.
- Current cross-version architecture navigation: [`docs/adr/CURRENT.md`](docs/adr/CURRENT.md); lifecycle, admission, and generated history rules: [`docs/adr/README.md`](docs/adr/README.md). Read only the ADRs relevant to the task.
- When adding or changing an ADR, Architecture, Contract, version document, or documentation route, run the generic documentation gates described in [`docs/adr/README.md#自动治理`](docs/adr/README.md#自动治理). Do not add feature-, version-, or Skill-specific checker exceptions.
- Local environment, development run, tests, and macOS builds: [`docs/development/README.md`](docs/development/README.md).
- Before starting Electron, `rovai-core`, a packaged App, or a real Runtime, read and follow
  [`docs/development/local-workflow.md`](docs/development/local-workflow.md). Use `pnpm dev` rather than
  bare `electron-vite dev`; never run the daily App from `dist/`, and never point development or acceptance
  processes at daily Electron `userData`.
- Do not treat historical version documents as current constraints, and do not infer implementation completion from ADR status. Follow the conflict rules in `docs/README.md`.

## Frontend design

- For any UI/UX or renderer-facing change, read [`DESIGN.md`](DESIGN.md) and
  [`docs/ui/README.md`](docs/ui/README.md) first.
- Read `PRODUCT.md`, when it exists, only when the task depends on users, product purpose,
  positioning, terminology, or durable brand commitments.
- When a matching `apps/desktop/.impeccable/surfaces/*.md` brief exists for a Renderer target, use
  it as local surface strategy. It cannot override ADRs, Contracts, current version scope,
  `DESIGN.md`, or theme contracts.
- Impeccable is optional provider-local tooling. It may be installed under the current coding
  agent's native skill directory; do not assume `.agents/skills/impeccable`, a slash command, or a
  specific provider.
- When native skill discovery is unavailable, read the installed `impeccable/SKILL.md` and its
  referenced files directly. The skill is not a repository authority.
- Do not install or enable Impeccable hooks or plugins without explicit user approval.
- Incremental work preserves the established Rovai AI visual world. Do not enter a
  replacement-world flow unless the user explicitly requests a redesign.
