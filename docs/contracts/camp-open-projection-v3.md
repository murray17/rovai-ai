---
document_type: contract
name: Camp Open Projection
version: v3
status: accepted
source_version: v1.13
last_updated: 2026-08-19
---

# Camp Open Projection v3

本合同完整继承 [Camp Open Projection v2](camp-open-projection-v2.md) 的 Desktop methods、SQLite read
transaction、collection windows、coverage/high-water、earlier message page、AgentRun 取消事实与 data-minimized
instrumentation。v3 只提升 Camp Open wire schema，并为每个 AgentRun 投影 Runtime 模型展示事实。

## Projection

```ts
interface AgentRunView {
  // v2 fields unchanged
  runtimeModel: { modelId: string | null } | null
}

interface CampOpenProjection {
  schemaVersion: 3
  // v2 fields, windows and coverage unchanged
  agentRuns: AgentRunView[]
}
```

`runtimeModel` 的封闭语义：

- `null`：不是 `runtime_default`，本版不提供额外模型展示；
- `{ modelId: null }`：Run 使用默认策略，但没有可信 Runtime observation；
- `{ modelId: string }`：Run 使用默认策略，值为首个可信 Runtime observation。

完整 `CampSnapshot` 同步提升为 Read Model schema 32。Core 从同一 SQLite read transaction 读取保存的模型来源
与 nullable observation；Renderer 不读取 catalog、成员配置或请求事件来补值。

首次成功写入会追加 `agent_run.runtime_model_observed` 并推进 Run version。Desktop 将
`agent_run.runtime_model_observed` 作为当前 Camp projection invalidation；它不进入 `timeline` 窗口、
CampMessage、Canonical Runtime Activity 或 Execution Evidence。没有观测时字段保持默认回退，不属于 partial
或 error coverage。

## References

- [Camp Open Projection v2（历史）](camp-open-projection-v2.md)
- [Camp Open Read Path](../architecture/camp-open-read-path.md)
- [Run Process Detail Surface v11](run-process-detail-surface-v11.md)
- [V1.13-D01](../versions/v1.13/decisions.md#v1-13-d01)
