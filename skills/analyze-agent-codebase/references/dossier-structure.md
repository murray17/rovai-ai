# Analysis axes and dossier structure

Use for a full architecture analysis or a requested dossier. A focused question need not cover every axis.

## Select relevant axes

Use only mechanisms present in the code and relevant to the question. Merge topics sharing a call chain; split when control or data authority differs.

| Axis | Questions | Evidence |
| --- | --- | --- |
| Runtime topology | Entries, processes, dependency wiring, control owner? | entry points, routers, factories, registries, launches |
| Execution and planning | Start, loop, stop, retry, recovery; independent plan? | loops, state enums, schedulers, model calls, transitions |
| Subagents and collaboration | Who creates or addresses whom; context, isolation, results? | spawn/send paths, schemas, run links, reducers |
| Tasks and progress | Prompt text or persistent object; who owns transitions and completion? | schemas, handlers, state machines, cancellation tests |
| Context, sessions, Memory | How is input materialized or compressed; what survives each boundary? | context builders, checkpoints, stores, recovery tests |
| Models, tools, permissions | Provider selection, registration, dispatch, authorization? | adapters, dispatchers, gates, receipts |
| Skills and instructions | Discovery, selection, loading; relation to tools and prompts? | discovery, manifests, prompt projections |
| Storage and middleware | Authoritative stores, transactions, queues, caches, events? | migrations, stores, middleware, consumers |
| Observability and recovery | Trace, retry, idempotency, crash-recovery limits? | logs, receipts, checkpoints, restart tests |
| Design and extension | Stable interfaces; layers affected by a new capability? | interfaces, plugin points, conformance tests |

## Classify from evidence

**ReAct:** require the loop action -> environment execution -> observation -> further reasoning in the same run state -> explicit termination. One tool call is insufficient.

**Plan-and-Execute:** require an independent plan consumed by an executor, advancing execution state, and an explicit revision/replanning trigger. A TODO, UI plan, or prompt checklist is insufficient. For hybrids, identify owners of termination, replanning, and persistence.

**Subagents:** establish identity type; creator/selector; copied, referenced, summarized, or rematerialized context; process/session/workspace/permission/cancellation boundaries; result channel; and how the caller distinguishes accepted, running, completed, failed, and unknown. A thread-pool worker, parallel sample, or prompt persona is not by itself a subagent.

**Context and history:** distinguish run working state, model-visible materialization, native continuation/checkpoint, long-term Memory, business history such as Tasks/Conversations, and trace/audit evidence. State each one's writer, authority, lifetime, read path, and access rules. Sharing a database does not make them one semantic layer.

**Tools and instructions:** a Tool is an executable contract; a Skill is guidance; a prompt is model input; permission/approval authorizes actions. Trace their connections. A Skill grants no capability or permission, and prompt text alone does not prove runtime discovery or loading.

## Dossier layout

Follow repository routes and naming. Otherwise use a new directory without overwriting existing work, for example:

```text
docs/agent-codebase-analysis/
  index.md
  runtime-topology.md
  execution-and-collaboration.md
  context-memory-tools-and-skills.md
  storage-recovery-and-extension.md
```

Merge sparse topics; split independent authority boundaries. Keep one `index.md`, or `README.md` if the repository requires it.

The index gives scope, revision, date, exclusions, 5-10 key findings with evidence status, a small topology/flow diagram, reading order, documentation drift, and valuable unknowns. Do not duplicate every topic summary.

Each topic covers:

1. Conclusions with `confirmed`, `inferred`, or `unknown` status.
2. Entry -> wiring -> state -> effects -> recovery/presentation.
3. Components, responsibilities, authorities, and boundaries.
4. An evidence table: claim, status, source and symbol, test/runtime evidence, limits/counterevidence.
5. Tradeoffs and extension points.
6. Unknowns, platform differences, documentation conflicts, and verification paths.

Localize report headings and status labels to the user's language. Omit irrelevant sections, but retain evidence status and unknowns. Use small Mermaid diagrams for complex flows and text for simple chains.

## Evidence and final checks

- Cite `path:line` plus symbols; symbols help when lines drift.
- Keep claims within what evidence proves. Unit tests do not establish all runtime behavior.
- Trace generated code to its generator or label it as generated.
- Use locked-version official source or documentation for dependencies; otherwise mark the behavior as an assumption at the boundary.
- Quote only essential code.
- Reverse-check every major claim and production connection, including flag, adapter, platform, and fixture limits.
- Replace vague qualifiers with precise claims or evidence labels. Avoid invented capabilities, unsupported pattern names, and duplicate overviews.
- For read-only work, check that the worktree is unchanged; for document work, limit the diff to authorized documents and necessary navigation.
