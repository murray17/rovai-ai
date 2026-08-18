---
document_type: contract
name: Camp Open Projection
version: v2
status: accepted
source_version: v1.12
last_updated: 2026-08-19
---

# Camp Open Projection v2

本合同完整继承 [Camp Open Projection v1](camp-open-projection-v1.md) 的 Desktop methods、SQLite read
transaction、collection windows、coverage/high-water、earlier message page 与 data-minimized instrumentation。
v2 只提升 Camp Open wire schema，并为每个 `AgentRunView` 投影独立取消请求事实。

## Projection

```ts
type AgentRunCancelReasonCode =
  | 'camp_turn_cancelled'
  | 'execution_budget_exhausted'
  | 'user_requested_agent_run_stop'

interface AgentRunView {
  // v1 fields unchanged
  cancelRequestedAt: string | null
  cancelReasonCode: AgentRunCancelReasonCode | null
  cancelAcknowledgedAt: string | null
}

interface CampOpenProjection {
  schemaVersion: 2
  // v1 fields, windows and coverage unchanged
  agentRuns: AgentRunView[]
}
```

完整 `CampSnapshot` 同步提升为 Read Model schema 31。`cancelReasonCode` 是取消来源，不得写入或读取
`terminalReasonCode`；后者继续只表达 Runtime terminal/planned-shutdown 来源。

首屏 `timeline` 窗口继续只包含 v1 已允许的 presentation event。`agent_run.cancel_requested` 是领域事件，
不因此成为 CampMessage 或公共时间线条目。

## References

- [Camp Open Projection v1（历史）](camp-open-projection-v1.md)
- [Camp Open Read Path](../architecture/camp-open-read-path.md)
- [Run Process Detail Surface v10](run-process-detail-surface-v10.md)
