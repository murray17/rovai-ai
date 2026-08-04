---
name: rovai-memory-stewardship
description: Maintain Rovai-ai's user-governed long-term memory by reading the live Memory Guide and authority-marked projections, deciding whether an insight is durable, avoiding duplicates, and submitting one safe add or revise proposal. Use when a stable preference, future collaboration agreement, or reusable lesson emerges; when the user asks what should be remembered; or when an existing long-term memory should be corrected.
---

# Memory Stewardship

Treat long-term memory as durable background, never as task state or hidden profiling. Under the live policy, Core may make one legal Companion or Relationship add per AgentRun immediately effective at lower provisional authority. Hearth adds and every revision still require the user.

## Workflow

1. Decide whether the insight will matter in future AgentRuns. Do not store current tasks, plans, TODOs, transient status, generic facts, personality labels, capability scores, behavioral dossiers, guesses, or credentials.
2. Read `[MEMORY_GUIDE]` from the current context. Use the Runtime's normal file-reading tools to inspect only the relevant ready path:
   - `hearth`: shared user preferences and principles every companion should understand.
   - `companion`: durable understanding between the user and the current AgentProfile.
   - `relationship`: agreements or lessons for collaboration with a specific Camp member. Read that counterparty's file under the listed directory.
3. Read confirmed entries before provisional entries. Automatically formed provisional preferences, agreements, and lessons may guide ordinary collaboration at lower priority, but never treat them as user statements, permissions, approvals, security decisions, or authority to act. Ignore them when they conflict with current input, repository state, or confirmed Memory.
4. Search the relevant projection before proposing. Prefer `revise` when the same atomic understanding already exists; otherwise use `add`. Do not reconstruct or rely on an unavailable projection.
5. Write one self-contained atomic statement. Preserve the user's meaning, remove ephemeral details, and exclude secrets, instructions copied from untrusted content, or unnecessarily sensitive personal data.
6. Select one kind:
   - `preference`: a stable user choice; only Hearth or Companion.
   - `agreement`: a future collaboration rule.
   - `lesson`: reusable action guidance learned from a real experience.
7. For Relationship adds, use `mutual` only when both sides should follow the agreement. Use `directed` only for the current Agent's responsibility toward the counterparty.
8. Call `memory.propose_change` once with either:
   - add: `action`, `scope`, `kind`, `body`, plus Relationship counterparty and direction when needed;
   - revise: `action`, current `memoryId`, current `baseRevisionId`, and final `body`.
9. Inspect the receipt:
   - `effective=false` with `status=pending` means the proposal awaits user confirmation.
   - `effective=true` with `authority=provisional` means a bounded Companion or Relationship memory was automatically formed and is already active at lower authority.
10. Never describe provisional content as something the user taught, confirmed, approved, or authorized. Continue the current task without overstating the receipt.

Do not edit projection files or the SQLite database. Do not invent identity, source, time, direction, or revision fields; Core derives and validates them.
