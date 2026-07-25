---
name: memory-stewardship
description: Maintain Lumen's user-governed long-term memory by reading the live Memory Guide and relevant projections, deciding whether an insight is durable, avoiding duplicates, and submitting one safe add or revise proposal for user confirmation. Use when a stable preference, future collaboration agreement, or reusable lesson emerges; when the user asks what should be remembered; or when an existing long-term memory should be corrected.
---

# Memory Stewardship

Treat long-term memory as durable background, never as task state or hidden profiling. The user is the only authority who can make a proposal effective.

## Workflow

1. Decide whether the insight will matter in future AgentRuns. Do not store current tasks, plans, TODOs, transient status, generic facts, personality labels, capability scores, behavioral dossiers, guesses, or credentials.
2. Read `[MEMORY_GUIDE]` from the current context. Use the Runtime's normal file-reading tools to inspect only the relevant ready path:
   - `hearth`: shared user preferences and principles every companion should understand.
   - `companion`: durable understanding between the user and the current AgentProfile.
   - `relationship`: agreements or lessons for collaboration with a specific Camp member. Read that counterparty's file under the listed directory.
3. Search the relevant projection before proposing. Prefer `revise` when the same atomic understanding already exists; otherwise use `add`. Do not reconstruct or rely on an unavailable projection.
4. Write one self-contained atomic statement. Preserve the user's meaning, remove ephemeral details, and exclude secrets or unnecessarily sensitive personal data.
5. Select one kind:
   - `preference`: a stable user choice; only Hearth or Companion.
   - `agreement`: a future collaboration rule.
   - `lesson`: reusable action guidance learned from a real experience.
6. For Relationship adds, use `mutual` only when both sides should follow the agreement. Use `directed` only for the current Agent's responsibility toward the counterparty.
7. Call `memory.propose_change` once with either:
   - add: `action`, `scope`, `kind`, `body`, plus Relationship counterparty and direction when needed;
   - revise: `action`, current `memoryId`, current `baseRevisionId`, and final `body`.
8. Interpret success only as “proposal saved and awaiting user confirmation.” Continue the current task without claiming that the Memory is active.

Do not edit projection files or the SQLite database. Do not invent identity, source, time, direction, or revision fields; Core derives and validates them.
