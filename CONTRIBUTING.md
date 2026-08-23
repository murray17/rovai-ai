# Contributing to Rovai AI

Thanks for taking the time to contribute to Rovai AI.

Issues and Pull Requests can be written in English or Chinese. Small fixes can go straight to a
Pull Request. For a large architecture, Runtime, protocol, persistence, or product change, please
open an Issue first so we can agree on the boundary before implementation.

## Architecture at a glance

```text
Rovai Desktop
    ↓
Rovai Core
    ↓
Runtime Adapter Layer
    ↓
Agent Runtime
    ↓
User workspace and Runtime-native capabilities
```

| Layer | Responsibility |
|---|---|
| **Rovai Desktop** | The Electron interface for Camps, members, Tasks, execution, approvals, and memory. |
| **Rovai Core** | The authoritative domain and persistence layer. It owns Camp, Member, Task, Run, approval, evidence, recovery, and memory state. |
| **Runtime Adapter Layer** | Connects Rovai to each Runtime's native protocol, CLI, or ACP interface, and maps context, Sessions, permissions, MCP, Skills, and execution evidence. |
| **Agent Runtime** | Provides model reasoning, native tools, permissions, Sessions, and Runtime-specific capabilities. |
| **User environment** | The user's workspace, Git repository, Runtime configuration, credentials, model provider, and native tools remain user-controlled. |

This is only a quick overview. Current architecture rules live in
[`docs/architecture/`](docs/architecture/), and field-level behavior lives in
[`docs/contracts/`](docs/contracts/).

## Documentation map

Start with [`docs/README.md`](docs/README.md). It explains which documents are current authority
and which are historical evidence.

| Path | What it contains |
|---|---|
| [`CONTEXT.md`](CONTEXT.md) | Domain glossary and stable product terminology |
| [`PRODUCT.md`](PRODUCT.md) | Product purpose, users, and positioning |
| [`DESIGN.md`](DESIGN.md) | Visual system and UI design principles |
| [`docs/architecture/`](docs/architecture/) | Long-lived component responsibilities and ownership boundaries |
| [`docs/contracts/`](docs/contracts/) | Versioned fields, states, errors, wire shapes, and testable behavior |
| [`docs/decisions/`](docs/decisions/) | Why important decisions were made |
| [`docs/versions/`](docs/versions/) | Current version scope, implementation plan, and historical versions |
| [`docs/development/`](docs/development/) | Local development, testing, packaging, and Runtime integration guides |
| [`docs/ui/`](docs/ui/) | Renderer and interaction contracts |
| [`docs/research/`](docs/research/) | Runtime research and evidence; not a support promise |
| [`docs/prototypes/`](docs/prototypes/) | Review artifacts; not production authority |
| [`docs/postmortems/`](docs/postmortems/) | Blameless incident history |
| [`qualification/`](qualification/) | Public demo cases, acceptance evidence, and diagnostics |

Do not create numbered ADR files. When a change modifies a durable boundary, update the current
Architecture, Contract, Context, UI, or Development document in the same Pull Request.

## Development

Install dependencies and start the isolated development app:

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Use `pnpm dev` instead of running `electron-vite dev` directly. The full setup and isolation rules
are in [`docs/development/README.md`](docs/development/README.md).

## Tests

### Common TypeScript and repository checks

```bash
pnpm typecheck
pnpm test
```

### Documentation

```bash
pnpm docs:test
pnpm docs:check
DOCS_BASE_REF=<PR base SHA> pnpm docs:check:ci
```

### Skills

```bash
pnpm skills:test
pnpm skills:check
```

### Rust

For a quick staged-file check:

```bash
pnpm test:rust:staged
```

For a Pull Request that changes Rust:

```bash
cargo fmt --all --check
cargo check --workspace --all-targets
pnpm test:rust:pr
cargo clippy --workspace --all-targets -- -D warnings
```

Before submitting, also run:

```bash
git diff --check
```

If a relevant check cannot run in your environment, say so clearly in the Pull Request instead of
reporting it as passed.

## Adding a new Runtime or ACP Adapter

Use the
[Agent Runtime Integration and Admission Checklist](docs/development/runtime-integration-checklist.md)
as the single starting point.

At minimum, a new Runtime needs evidence for:

1. executable identity, version, fingerprint, and target platform;
2. discovery, availability checks, Probe, and real AgentRun launch;
3. protocol initialization and stable Session identity;
4. Tool output, approval allow/deny, cancellation, and process cleanup;
5. warm continuation and cold resume or history restore;
6. MCP and Skill behavior when those capabilities are claimed;
7. real smoke tests on every platform marked as qualified.

A successful `--version`, ACP `initialize`, or ordinary chat response is not enough to mark a
Runtime as supported. Keep unverified capabilities disabled and document the remaining boundary.

## Pull Requests

Please keep Pull Requests focused and include:

- what changed and why;
- the tests you ran;
- screenshots for visible UI changes;
- exact Runtime and platform evidence for compatibility changes;
- related documentation updates;
- known limitations or follow-up work.

Do not commit credentials, private transcripts, personal absolute paths, machine-specific
configuration, or generated build directories.

Rovai AI is distributed under the [MIT License](LICENSE). By contributing, you confirm that you
have the right to submit the work under that license.
