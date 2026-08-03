---
document_type: adr
id: ADR-0094
title: Formal Qualification Isolation and External Effect Coverage
status: accepted
date: 2026-08-03
decision_scope: cross-version
source_version: v0.34
supersedes: []
superseded_by: null
---

# ADR-0094: Formal Qualification Isolation and External Effect Coverage

## Context

ADR-0090 permits formal evaluation on a real host with recorded network access and
`preserved_uncontrolled` ambient MCP state. The current Runner can detect Core user messages and
resolved approvals, compare workspace trees, and inspect portions of Runtime execution evidence. It
cannot attribute every filesystem write to a process, prove that a shared-user editor did not mutate
the workspace, or determine the terminal identity of arbitrary shell, network, Git remote, or ambient
MCP effects.

Treating “no recorded event” as zero human intervention or settled external effects would turn an
observation gap into a favorable result. A formal Hard Pass needs an environment contract that can
establish absence and settlement without claiming that non-adversarial Qualification is a general
security sandbox.

## Decision

Every Formal Qualification Trial MUST bind a versioned, digested Intervention Isolation Profile in
its Qualification Environment Manifest. The Profile covers the complete post-dispatch interval and
defines authority for Core commands, approvals, configuration, Runtime lifecycle, workspace writers,
process ancestry, network access, Git remotes, external tools, and observation continuity.

The formal baseline is isolation-first: a disposable VM, dedicated host session, or dedicated
non-interactive OS execution identity owns the private Core control interface and Trial workspace.
No editor, interactive shell, second Runner, or unrelated writable process may share the identity or
workspace after dispatch. The Runner freezes allowed Core and Runtime process roots and verifies
their descendants through the Delivered Workspace Freeze Barrier. A GUI Runtime qualifies only when
its dedicated graphical session satisfies the same Profile.

The Profile also freezes authorized Runner automation: passive observation, deadline watchdog,
evidence capture, fencing, and bounded post-terminal cleanup are evaluator actions rather than human
intervention. Product-owned Core recovery and predeclared Runtime retry are subject execution facts,
not human intervention. An operator initiating, approving, editing, restarting, reconfiguring, or
continuing any of them after dispatch is intervention.

A shared login identity, operator promise, start/end tree diff, best-effort watcher, or temporal
correlation with Runtime Tool events cannot establish complete Intervention Coverage. Such an
environment may produce diagnostic evidence but not a Formal Trial Pass Rate.

Post-Dispatch Human Intervention is `absent | present | indeterminate`:

- `absent` requires complete Profile coverage and no intervention fact;
- `present` is an observed human message, approval decision, configuration or workspace mutation,
  continuation, Runtime control, or other covered intervention and is a valid Hard Outcome failure;
- `indeterminate` is any required observation gap and makes the Trial Evaluation Pending rather than
  failing the Qualification Team Configuration.

The Profile MUST be admitted completely before dispatch; a known preflight coverage gap makes the
attempt Invalid without running the team. Unexpected post-dispatch loss of required coverage first
makes the accepted execution Evaluation Pending. If the lost interval cannot be recovered under the
same frozen identities, ADR-0092's retained Invalid transition applies instead of assigning a failure
to the team.

External Effect Settlement is `settled | unsettled | indeterminate`:

- `settled` requires potential external mutation channels to be disabled or every accepted mutation
  to have a correlated side-effect identity and terminal receipt;
- `unsettled` means an observed mutation began or was accepted without a known terminal or compensated
  state and fails Orchestration Convergence;
- `indeterminate` means a mutation-capable channel lacks complete observation and makes evaluation
  pending.

Formal profiles therefore block unaudited write-capable network traffic and Git remote mutation.
Read-only package access uses a frozen allowlist or controlled cache. External MCP mutation is allowed
only through a ledgered authorization and receipt path with side-effect identity. A
`preserved_uncontrolled` ambient MCP environment is diagnostic-only.

Isolation establishes an evidence boundary, not resistance to a privileged malicious operator. The
Profile, account/session identities, writable roots, network policy, process observations, coverage
gaps, and effect receipts remain private evidence with a safe redacted summary.

This decision locally replaces ADR-0090's permission for preserved uncontrolled ambient tools and
ordinary shared-host operation to participate in future Formal Trial evidence. It does not reclassify
or recompute the immutable v0.31 or v0.32 historical Trials.

## Consequences

- A formal “zero human intervention” claim now requires positive coverage evidence rather than lack
  of a recorded Core event.
- Existing mixed-user local workflows and uncontrolled ambient MCP configurations become diagnostic
  until an isolation profile is implemented and admitted.
- GUI Runtime qualification may require a dedicated graphical host/session and can lag CLI Runtime
  diagnostics.
- Network and external Tool setup becomes more expensive, particularly for package caches,
  authorization receipts, and mutable MCP integrations.
- Observation failure no longer lowers a team score, while an observed unsettled effect remains a
  real convergence failure.

## Rejected Alternatives

- **Infer human absence from Core messages and approvals alone.** Rejected because same-user
  workspace, configuration, shell, and Runtime interventions remain invisible.
- **Correlate file changes with Runtime Tool timestamps.** Rejected because correlation is neither
  complete writer identity nor proof that another process did not write.
- **Allow uncontrolled network and ambient MCP while reporting settlement.** Rejected because remote
  mutations may have no observable identity or terminal receipt.
- **Treat coverage gaps as team failures.** Rejected because harness observability is not a property
  of the Qualification Team Configuration.
- **Retroactively invalidate earlier Qualification results.** Rejected because historical Trial
  semantics and evidence identities remain immutable.

## References

- [ADR-0062: Interruptible Run Trees and Unsettled External Effects](0062-interruptible-runs-and-unsettled-external-effects.md)
- [ADR-0090: Team Delivery Qualification Evidence Boundary](0090-team-delivery-qualification-evidence-boundary.md)
- [ADR-0092: Recoverable Qualification Evaluation Integrity](0092-recoverable-qualification-evaluation-integrity.md)
