# AGENTS.md

## Project documentation

- Documentation map, authority boundaries, and task-based reading rules: [`docs/README.md`](docs/README.md). Read this first for architecture, implementation, planning, or documentation work.
- Current version architecture and implementation status: follow the canonical `current_version` pointer and `current` row in [`docs/versions/README.md`](docs/versions/README.md); do not hard-code a version path here.
- When creating a version or changing `current_version`, follow the canonical [version transition checklist](docs/versions/README.md#版本切换清单) and record every conclusion in the new version overview.
- Current cross-version architecture navigation: [`docs/adr/CURRENT.md`](docs/adr/CURRENT.md); lifecycle, admission, and generated history rules: [`docs/adr/README.md`](docs/adr/README.md). Read only the ADRs relevant to the task.
- When adding or changing an ADR, Architecture, Contract, version document, or documentation route, run the generic documentation gates described in [`docs/adr/README.md#自动治理`](docs/adr/README.md#自动治理). Do not add feature-, version-, or Skill-specific checker exceptions.
- Local environment, development run, tests, and macOS builds: [`docs/development/README.md`](docs/development/README.md).
- Do not treat historical version documents as current constraints, and do not infer implementation completion from ADR status. Follow the conflict rules in `docs/README.md`.

## Frontend design

- For any UI/UX or renderer-facing change, read and follow [`docs/ui/README.md`](docs/ui/README.md).
