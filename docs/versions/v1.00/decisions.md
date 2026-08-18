---
document_type: version-decisions
version: v1.00
lifecycle: historical
last_updated: 2026-08-18
---

# v1.00 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0206](#adr-0206) | User-Confirmed Force Camp Deletion | `accepted` |

<!-- legacy-adr:begin id=ADR-0206 source-file-sha256=79a442dffdd3ced005da73d206adfb4abd56a1873eab3c6df60f2dc7254710a3 -->
<a id="adr-0206"></a>

## ADR-0206: User-Confirmed Force Camp Deletion

迁移时原路径：`docs/adr/0206-user-confirmed-force-camp-deletion.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0206
title: User-Confirmed Force Camp Deletion
status: accepted
date: 2026-08-17
decision_scope: cross-version
source_version: v1.00
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0206 -->
<a id="adr-0206-context"></a>
### Context

ADR-0058 permits permanent Camp deletion only after every Run, Turn, approval, delivery, action and
lease has become quiescent. That rule prevents late Runtime callbacks from racing deletion, but it
also makes a Camp undeletable when cancellation or reconciliation cannot finish. The user has
already chosen an irreversible aggregate deletion in the destructive confirmation Dialog; forcing
them to repair history they intend to erase gives stale execution state authority over explicit
local data ownership.

Rovai still has to prevent a live Runtime from recreating deleted state or retaining a reusable
Camp-scoped process. A force path therefore cannot be implemented as a Renderer-only disabled-state
change or an unsupported direct SQLite edit.

<a id="adr-0206-decision"></a>
### Decision

`DeleteCamp` supports an explicit force mode in addition to the existing quiescent mode. Both modes
remain User-only, require an exact Camp version and execute the aggregate deletion in one SQLite
transaction. Omission of force retains the ADR-0058 blocker behavior for compatibility.

After the user accepts the irreversible deletion Dialog, the production Renderer requests force
mode. Core captures the Camp's non-terminal AgentRun identities while holding the database lock,
then commits the existing complete aggregate deletion even when quiescence blockers exist. The
deletion commit is the durable execution fence: late callbacks may observe absence and fail, but
must never recreate the Camp or any owned row.

After commit, Core interrupts or detaches the captured Runtime leases, removes their active
execution registrations, invalidates every Camp-compatible resident process and removes managed
Camp attachments. Runtime or filesystem cleanup is bounded best effort and cannot roll back or
misreport a committed database deletion. Provider-owned history and external effects that already
occurred are not claimed to be erased or reversed.

The confirmation must state that active execution is stopped and that messages, private
Conversation continuity, Runs, approvals and associated local records are physically removed. It
must also state that the project directory is not deleted.

This decision locally replaces ADR-0058's quiescence-only and separate-stop requirements for an
explicit force request. Ordinary non-force deletion, the absence of Archive/Trash, transaction
completeness and external workspace boundaries remain unchanged.

<a id="adr-0206-consequences"></a>
### Consequences

- A stuck or actively running Camp can be removed through one explicit destructive confirmation.
- SQLite deletion remains atomic and authoritative even if Runtime teardown or managed-file cleanup
  reports a later failure.
- Runtime output that arrives after commit is discarded against Camp absence instead of becoming
  durable history.
- An already-started external side effect may complete before process interruption; deletion erases
  Rovai records, not effects in a repository, provider or third-party system.
- Older clients and non-Renderer callers that omit force continue to receive structured blockers.

<a id="adr-0206-rejected-alternatives"></a>
### Rejected Alternatives

- Keep quiescence as an absolute gate: stale cancellation or approval state can permanently deny
  the user's explicit local deletion decision.
- Remove only the Renderer blocker: Core would still reject and the apparent feature would not
  exist.
- Delete SQLite files or rows outside Core: that bypasses idempotency, version checks, aggregate
  completeness, Runtime ownership and managed attachment cleanup.
- Add a durable `deleting` lifecycle: it turns a direct destructive command into another recoverable
  workflow whose stuck state can recreate the original problem.

<a id="adr-0206-references"></a>
### References

- [v1.00 force Camp deletion](README.md)
- [ADR-0058](../v0.15/decisions.md#adr-0058)
- [ADR-0079](../v0.24/decisions.md#adr-0079)
- [ADR-0123](../v0.41/decisions.md#adr-0123)
- [Camp Permanent Deletion v1](../../contracts/camp-permanent-deletion-v1.md)
<!-- legacy-adr-body:end id=ADR-0206 -->
<!-- legacy-adr:end id=ADR-0206 -->
