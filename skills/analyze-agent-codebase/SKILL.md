---
name: analyze-agent-codebase
description: Use to analyze an agent system's architecture or mechanisms from repository evidence, including follow-up questions and analysis documents. Exclude ordinary code review, implementation, fixes, and conceptual questions that need no repository evidence.
---

# Analyze Agent Codebases

Reconstruct behavior from real entry points, call chains, state transitions, and persistence. Documentation explains intent; code and tests establish implementation. Respond in the user's language unless asked otherwise.

## Boundaries

- Follow repository instructions, documentation routes, and read-only constraints.
- Default to read-only. Write analysis documents only when requested; do not modify implementation.
- Use source, dependency wiring, configuration, schemas, migrations, and tests as evidence.
- Label important claims `confirmed`, `inferred`, or `unknown`, localizing these labels in the report. Explain inferences and gaps.
- Cite paths, symbols, and relevant entry-to-effect call chains. Names such as agent, memory, plan, or tool do not prove capabilities.

## Choose the scope

Use the smallest sufficient scope: a vertical slice for a mechanism question, an architecture report for several mechanisms, or a dossier when multiple documents are requested. For a dossier, read [analysis axes and structure](references/dossier-structure.md).

Check existing analyses for scope, evidence, and revision; update the appropriate document instead of creating duplicate overviews.

## Investigate

1. **Freeze scope.** Record repository root, revision, requested questions, exclusions, output format, languages, build entry points, generated directories, and initial worktree state. Distinguish production code from tests, fixtures, examples, generated code, vendors, and historical documents.
2. **Trace the runtime.** Follow entry point -> configuration and dependency wiring -> agent/workflow construction -> execution loop -> model, tool, collaboration, and persistence effects -> events, recovery, and presentation. Follow registries through loaders, macros, decorators, or configuration until the actual implementation is connected.
3. **Trace each question vertically.** Use a real trigger: input -> authorization and validation -> state change -> effects -> result -> error and recovery. Select only mechanisms present in the code.
4. **Record evidence as you read.** Use the table below. A claim about subagents, for example, needs the creator, context transfer, isolation, and result path.
5. **Explain ownership.** Identify control and state authority, sync/async connections, context/session/Memory/history lifecycles, tool/Skill/prompt/permission boundaries, and failure, retry, cancellation, idempotency, and recovery limits. Record documentation drift.
6. **Cross-check.** Reverse-reference key symbols to verify production wiring. Inspect tests, schemas, flags, platforms, adapters, and alternate entries. Tests prove only covered behavior; mark unexecuted checks `not_run`. Compare authoritative documentation unless the user prohibits reading it.

| Claim | Status | Source and call chain | Test or runtime evidence | Limits or counterevidence |
| --- | --- | --- | --- | --- |
| Falsifiable statement | confirmed / inferred / unknown | path:line + symbol | test / fixture / trace | gap or conflicting path |

## Deliver

Lead with conclusions and the runtime picture. Include scope and revision, key flows, each requested mechanism and its evidence status, tradeoffs, constraints, documentation drift, valuable unknowns and verification steps, and source locations or dossier reading order. Quote only the minimum useful code.

For independent evidence domains, bounded collaboration may help when authorized and available. Specify the question, permitted scope, exclusions, evidence format, and stopping condition. The lead retains runtime topology, cross-domain flows, evidence spot checks, conflict resolution, and final conclusions. Avoid overlapping overviews; proceed alone without a suitable collaborator.

Before delivery, trace each major claim back to evidence, separate confirmed facts from inference and unknowns, cover all requested topics, and preserve one dossier entry point. Verify that changes are limited to authorized analysis artifacts.
