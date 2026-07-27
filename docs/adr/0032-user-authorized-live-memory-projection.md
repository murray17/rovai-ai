---
document_type: adr
id: ADR-0032
title: "User-Authorized Live Memory Projection"
status: superseded
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: [ADR-0020, ADR-0030, ADR-0031]
superseded_by: ADR-0053
---

# ADR-0032: User-Authorized Live Memory Projection

## Context

ADR-0020 established user-only formal Memory authority and assumed changes would affect only
future AgentRuns. ADR-0030 made SQLite authoritative and prohibited Agent dependence on Markdown.
ADR-0031 then froze selected Memory bodies into every AgentRun prompt.

Preloading bodies consumes token even when a task does not need long-term memory. The selected
product behavior is instead to provide paths and guidance, allowing each Runtime Agent to decide
when to use its native file-reading tools. This intentionally treats a Memory read like other
tool-time local state: an active Run can observe a newer projection when it reads later.

## Decision

### User authority remains exclusive

Only authenticated user commands create or revise formal Memory or change its Lifecycle.
Agents can submit fenced MemoryProposals but cannot make them effective. Proposal success,
Default Lead status, model confidence, repetition or Agent agreement never substitutes for user
confirmation. User-initiated management does not require a Proposal.

All formal writes use ADR-0001 typed commands, expected versions, idempotency and redacted
events. Renderer, Agent and projection files cannot write authoritative state directly.

### SQLite authority and live Markdown projection

The existing SQLite database remains the sole source of truth for Memory, MemoryRevision,
MemoryProposal, MemorySupersession and their bounded text. Small Memory text remains in SQLite,
not Managed Blob.

Lumen projects current authorized state into deterministic read-only Markdown under private
userData. The files are disposable, atomically replaceable and rebuilt after missing, stale,
corrupt or digest-mismatched observations. They are never reverse-parsed, never authoritative,
and never placed in a project or Git.

Projection runs after the SQLite transaction through best-effort Wake plus stable reconciliation.
A file failure does not roll back a committed Memory and must produce visible diagnostics.

### Memory Guide and native on-demand reads

AgentRun input includes a short `[MEMORY_GUIDE]` section containing:

- what long-term Memory is and its lower authority;
- when reading may help;
- exact paths for the Memory Projection files exposed to this AgentRun;
- the rule that Current Input, Work Brief, permissions, current collaboration and repository
  state override Memory.

The Guide contains no Memory body. The Agent chooses whether, when and which file to read through
the Runtime's native filesystem tools. Lumen does not create a per-Run Memory copy and does not
fall back to full prompt injection.

ContextManifest freezes the Guide text, exposed path list, Guide formatter version and projection
digests observed during materialization. It does not freeze Markdown contents and does not prove
that the Runtime or model read them. A later tool read may observe a projection changed by
add, revise, retire, reactivate, supersede or forget during the same AgentRun. The already frozen
prompt is not rewritten.

This relaxation applies only to native tool-time Memory reads. ADR-0049 continues to govern the
immutable Lumen prompt and its delivery. Runtime lacking reliable file-read capability or
permission reports Memory unavailable rather than receiving hidden inline content.

Lumen exposes only paths allowed by the current Agent and scope-selection protocol. Because
Runtime processes may execute with the same local OS user, those paths are not a Core-enforced
filesystem ACL against an Agent with broad native file permission. Strict isolation would require
a future broker or per-Run projection and is not claimed by this design.

Proposal provenance is never rendered into Agent-readable Projection. Forgotten content is
removed from the next projection, but text already read into a Native Session or copied by a
Runtime remains outside Memory-Domain erasure under ADR-0027.

## Consequences

- Tasks that do not need Memory pay only for a small Guide, not all selected bodies.
- Agents can use their native reading strategies and inspect only the scope files they judge
  relevant.
- Same-Run Memory observation is no longer byte-reproducible: the frozen prompt is stable, while
  later native file reads can see current projection state.
- Projection availability and Adapter filesystem permission become part of effective Memory
  capability; unsupported paths receive no automatic inline fallback.
- Scope path exposure is enforced by Core, but confidentiality against deliberate sibling-path
  traversal depends on Runtime filesystem permissions rather than SQLite authorization.
- SQLite remains the only write truth, so live reads cannot make external Markdown edits
  authoritative.

## Rejected Alternatives

- Injecting selected Memory bodies into every AgentRun: consumes token before relevance is known.
- Creating immutable per-Run Memory files: preserves deterministic reads but adds private copies,
  cleanup and storage work not desired for this product behavior.
- Treating Markdown as writable truth: breaks transactional authority and user confirmation.
- Rebuilding the frozen prompt after Memory changes: violates ADR-0049 input delivery.
- Silently falling back to body injection when file tools fail: makes Runtime behavior and token
  cost unpredictable.
- Claiming path exposure is a filesystem security sandbox: Agents may share the local user's OS
  permissions.

## References

- [v0.10 长期记忆](../versions/v0.10/README.md)
- [ADR-0001: Core Transaction](0001-core-transaction.md)
- [ADR-0009: Reproducible Context Materialization and Delivery](0009-reproducible-context-delivery.md)
- [ADR-0016: Multi-Runtime Execution Boundary v2](0016-multi-runtime-execution-v2.md)
- [ADR-0027: Memory-Domain Forgetting](0027-memory-domain-forgetting.md)
- [Superseded ADR-0020](0020-user-authorized-memory-mutation.md)
- [Superseded ADR-0030](0030-sqlite-memory-authority.md)
- [Superseded ADR-0031](0031-frozen-low-priority-memory-context.md)
