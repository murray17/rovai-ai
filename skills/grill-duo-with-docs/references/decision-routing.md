# Decisions and current authority

Repository navigation, version pointers and governance override these defaults. Resolve the unique current version from `docs/versions/README.md`, not directory names or example versions.

| Confirmed content | Owner |
| --- | --- |
| Domain terms and concept boundaries | Applicable `CONTEXT.md` |
| Component responsibilities, authority, data/control flow | `docs/architecture/` |
| Fields, states, protocols, errors, idempotency, concurrency and recovery | `docs/contracts/` |
| Important current-version rationale, tradeoffs and consequences | That version's single `decisions.md` |
| Implementation, migration, acceptance and temporary measures | Current Version directory |
| Renderer/UX contract | `docs/ui/` |
| Development and operations | `docs/development/` |
| Reversible local implementation choice | Code, tests or no durable record |

Add a version decision only when all three hold: later change is costly; code/specification alone cannot explain why; and real alternatives required a tradeoff.

A decision explains the choice. Put resulting current semantics directly in their owning authority; a link to rationale is insufficient. Do not create numbered ADR files, maintain a global accepted/superseded graph, or rewrite historical decisions to hide a new change.
