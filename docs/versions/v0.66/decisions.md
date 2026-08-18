---
document_type: version-decisions
version: v0.66
lifecycle: historical
last_updated: 2026-08-18
---

# v0.66 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0168](#adr-0168) | Planned Shutdown Preserves Runtime Terminal Authority | `accepted` |

<!-- legacy-adr:begin id=ADR-0168 source-file-sha256=d844bf818cce9130c1ebc9346362d48a136d2b1a26d4e61591dc9669a0b19228 -->
<a id="adr-0168"></a>

## ADR-0168: Planned Shutdown Preserves Runtime Terminal Authority

迁移时原路径：`docs/adr/0168-planned-shutdown-preserves-runtime-terminal-authority.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0168
title: Planned Shutdown Preserves Runtime Terminal Authority
status: accepted
date: 2026-08-12
decision_scope: cross-version
source_version: v0.66
supersedes: []
intended_supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0168 -->
<a id="adr-0168-context"></a>
### Context

Rovai Desktop currently terminates Core directly during an intentional quit, restart or update. A Runtime may already
have accepted an AgentRun input at that point, so process termination alone cannot prove whether the Native Turn
completed, failed, cancelled or produced external effects. Reusing CampTurn cancellation would also write a broader
user cancellation intent and fence the very Runtime terminal result that planned shutdown still needs to receive.

Planned shutdown remains inside one live Core generation. It can therefore preserve the current Runtime route long
enough to request a stop and accept a matching terminal observation without claiming cross-process Native Turn
reconciliation.

<a id="adr-0168-decision"></a>
### Decision

1. Planned shutdown is a Core process-lifecycle protocol, not CampTurn Stop. It atomically closes new execution launch
   admission, then requests stop only for active executions owned by the current Core generation. It does not write a
   CampTurn cancellation intent or `AgentRun.cancel_requested_at`.
2. Runtime terminal and domain-result routes remain admitted during a bounded drain window. Only a terminal
   observation bound to the current generation, live route, AgentRun, execution epoch and Adapter Turn correlation may
   settle that Run; Provider Turn identity participates when the Adapter supplies it but is not universally required.
3. Runtime success retains normal success invariants. A reliable Runtime `failed` or `cancelled` observation after a
   planned stop may use a private abortive settlement that first closes the same Run's unresolved local obligations and
   then records its terminal state. Interrupt success, process exit, route detach, reap and shutdown-induced transport
   failure are never terminal proof.
4. `CampTurn.cancelled` requires an explicit CampTurn cancellation intent. Without that intent, a required Run-local
   cancellation is incomplete responsibility and eventually makes the Turn failed; an optional Run-local failure or
   cancellation does not prevent completion.
5. At the monotonic deadline Core closes terminal settlement admission, drains transactions already inside that
   boundary, then closes and drains live Runtime route callbacks before fencing Built-in leases and reaping unresolved
   Runtimes. An accepted input without a reliable terminal remains non-terminal and is handled by the existing
   accepted-input recovery blocker on the next Core generation.

This decision locally refines ADR-0062, ADR-0077, ADR-0079, ADR-0123 and ADR-0164 without replacing their remaining
Stop, Fleet or restart-recovery rules.

<a id="adr-0168-consequences"></a>
### Consequences

- Intentional quit, restart and update can preserve real Runtime terminal outcomes without inventing cancellation or
  resending accepted input.
- Core must own linearizable execution launch, generation-local terminal settlement and live Runtime route callback
  admissions. Desktop must wait for the Core shutdown report and actual child exit.
- Adapters that emit a reliable same-generation terminal can settle during shutdown even without cross-process Turn
  identity; adapters that only expose process exit remain outcome-unknown.
- Run, Message Delivery and CampTurn projections must retain terminal source and reason so planned shutdown is not
  presented as ordinary user cancellation.
- Shutdown remains bounded. It reduces, but cannot eliminate, `accepted_input_outcome_unknown`.

<a id="adr-0168-rejected-alternatives"></a>
### Rejected Alternatives

- **Reuse CampTurn cancellation.** It broadens intent to sibling Runs and Deliveries and fences normal Runtime terminal
  completion after `cancel_requested_at` is written.
- **Stop the Scheduler loop and then kill Runtime processes.** Detached claim/launch work can cross that boundary, and
  process exit does not prove an AgentRun terminal result.
- **Treat interrupt acknowledgement or process exit as cancellation.** Both prove only a control or transport event,
  not Provider terminal outcome.
- **Require cross-process Provider Turn IDs.** Planned shutdown still has the current live route; imposing restart
  reconciliation requirements would reject valid same-generation terminals from otherwise supported Adapters.
- **Wait without a deadline.** A hung Runtime could prevent Rovai from ever exiting.

<a id="adr-0168-references"></a>
### References

- [v0.66 版本目标](README.md)
- [Planned Shutdown 架构](../../architecture/planned-shutdown.md)
- [Planned Shutdown v1 合同](../../contracts/planned-shutdown-v1.md)
- [ADR-0079：Two-Phase Cancellation](../v0.24/decisions.md#adr-0079)
- [ADR-0123：Exclusive AgentRun Runtime Fleet](../v0.41/decisions.md#adr-0123)
- [ADR-0164：Accepted Input Recovery](../v0.64/decisions.md#adr-0164)
<!-- legacy-adr-body:end id=ADR-0168 -->
<!-- legacy-adr:end id=ADR-0168 -->
