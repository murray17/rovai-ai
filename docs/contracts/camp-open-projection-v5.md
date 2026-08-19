---
document_type: contract
name: Camp Open Projection
version: v5
status: accepted
source_version: v1.15
last_updated: 2026-08-19
---

# Camp Open Projection v5（运行中 Evidence 完整投影）

本合同完整继承 [Camp Open Projection v4](camp-open-projection-v4.md) 的 Desktop methods、wire schema 3、
Read Model schema 32、SQLite read transaction、activation-aware `camps.enter`、其他 collection window、
coverage/high-water、earlier message page、AgentRun 取消与 Runtime 模型事实，以及 data-minimized instrumentation。
v5 只替代 `executionEvidence` 的 non-terminal window：运行中的执行过程不再受最新 80 条限制。

## 完整 non-terminal Evidence

- `camps.enter` 与 `camps.open` 在同一个 SQLite read transaction 中返回当前 Camp 所有
  `queued | running | waiting` AgentRun 的全部 Execution Evidence；
- Core 不再对这些 Evidence 应用条目数上限，按既有 `occurredAt + agentRunId + sequence` 稳定顺序返回；
- terminal AgentRun 的 Evidence 仍不进入普通 Camp open，用户展开精确 Run 后继续通过
  `agentRunEvidence.list` 稳定分页读取；
- `coverage.executionEvidence.totalCount` 继续统计 Camp 全部持久 Evidence，`loadedCount` 是本次完整载入的
  non-terminal Evidence 数，`omittedCount` 只包含 terminal Run Evidence；只有没有 terminal omission 时
  `complete=true`；
- 单条 Evidence 的 preview/Managed Blob、Tool 输出 disclosure 与按需完整内容读取边界不变。完整运行过程
  不等于把大正文或 Blob 全文挂载进 Camp open。

Renderer 必须把上述投影与带稳定 `evidenceId` 的 live Runtime event 去重合并，并在当前 Main Window Session
内保留全部已接收 live event，不得再以最后 600 项或其他最后 N 项裁剪运行中 Run。Camp refresh、重载或
中途进入均以 Core 的完整 non-terminal Evidence 恢复前缀，后续 live event 继续追加。

该选择有意让 Camp open 响应大小和 Renderer live state 随当前 non-terminal Evidence 增长；执行过程的完整、
可审阅 chronology 优先于固定条目数首屏预算。消息、Task、Delivery、Turn、AgentRun、Approval 与 Timeline
继续使用 v4 继承的窗口，不随本合同扩大。

## Acceptance

- 一个 non-terminal AgentRun 拥有 85 条、1000 条或更多 Evidence 时，Camp open 从 sequence 1 开始完整返回，
  不只返回最后 80 条；
- Renderer 接收第 601 个 live event 后仍保留第 1 个，并继续按 Evidence identity 去重；
- terminal Run 仍按需分页，Tool 大结果仍只渲染有界 preview；
- wire schema 3、Read Model schema 32、activation-aware enter、high-water 与其他 collection coverage 不变。

## References

- [Camp Open Projection v4（历史）](camp-open-projection-v4.md)
- [Camp Open Read Path](../architecture/camp-open-read-path.md)
- [Camp 会话工作区](../ui/components/conversation-workspace.md)
- [V1.15-D01](../versions/v1.15/decisions.md#v1-15-d01)
