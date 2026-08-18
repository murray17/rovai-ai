---
document_type: renderer-contract
contract: run-process-detail-surface-v11
authority: agent-process-detail-placement-and-runtime-model-surface
status: accepted
last_updated: 2026-08-19
---

# Run Process Detail Surface v11（实际 Runtime 模型）

本合同完整继承 [Run Process Detail Surface v10](run-process-detail-surface-v10.md) 的执行台位置、Tool chronology、
Runtime failure、Recovery Blocker、planned shutdown、取消活动与 AgentRun 局部停止语义。v11 只为使用
`runtime_default` 的 Run 增加首个可信实际模型观测与原位展示。

## 1. 配置策略与 Run 观测

成员保存的 Runtime 配置和单次 AgentRun 的实际模型是不同事实：

- `runtime_model_selection_json.source == runtime_default` 表示本次 Run 没有向 Runtime 指定固定模型；
- model catalog、catalog default、请求参数、冻结 sentinel、usage 与文本输出都不能证明实际模型；
- 只有 Runtime-native、结构化、可归因到当前 Thread/Session 的字段可以形成观测；
- 固定模型 Run 不投影本版额外模型展示，不以保存值伪装观测。

## 2. 十 Runtime 观测来源

| Runtime | 唯一允许的观测来源 |
| --- | --- |
| Codex | thread start/resume response 顶层非空 `model` |
| OpenCode、GitHub Copilot、Kiro、Qoder、CodeBuddy、Qwen Code、TRAE | ACP Session `models.currentModelId`；缺失时读取 `configOptions[id=model].currentValue` |
| Claude Code | 通过 expected Session ID 校验后的 `system/subtype=init` 顶层非空 `model` |
| Antigravity | 通过 conversation identity 校验后的 structured init event 明确 model 字段 |

Antigravity 允许的结构化形状只包括顶层 `model` 和 `init.model | init.model_id | init.modelId`；字段可以是
非空 string，或含明确 `id` 的对象。缺少字段时保持无观测，不遍历任意 payload。

Adapter 统一产生内部事件：

```text
runtime.model.observed
{ modelId: string }
```

## 3. 持久化与首值冻结

Core 只在以下条件同时成立时记录：

```text
agent_run.id == agentRunId
agent_run.execution_epoch == executionEpoch
runtime_model_selection_json.source == runtime_default
runtime_observed_model_id IS NULL
modelId.trim() is non-empty and bounded
```

首次记录写入规范化后的 model ID，增加 `agent_run.version` 与 `updated_at`，并追加
`agent_run.runtime_model_observed`。之后收到的相同或不同模型都不覆盖；本合同不跟踪 Run 中途换模。
固定模型、旧 execution epoch、无效 ID 或已经观察的 Run 均保持不变。观测是 best-effort 展示事实，拒绝或
持久化失败只记录诊断，不得使 Run 失败、取消或进入 needs-attention。

## 4. Read Model

`AgentRunView` 增加：

```ts
interface AgentRunView {
  runtimeModel: { modelId: string | null } | null
}
```

- `null`：固定模型或其他非 `runtime_default` 来源；不显示本版额外 Run 字段；
- `{ modelId: null }`：默认策略，尚未得到可信模型；
- `{ modelId: "..." }`：默认策略，已经记录首个可信模型。

完整 CampSnapshot 使用 Read Model schema 32，Camp Open 使用
[Camp Open Projection v3](camp-open-projection-v3.md)。`agent_run.runtime_model_observed` 只触发当前 Camp
projection invalidation，不进入 CampMessage、Runtime Activity 或公共时间线。

## 5. ExecutionDrawer 展示

模型字段位于每个 Run 既有 `.execution-run-meta`，与时间等元信息共享稳定布局：

- `{ modelId: null }` 显示 `模型 Agent 运行时默认`；
- `{ modelId: "..." }` 显示 `模型 {modelId} · 默认`；
- `runtimeModel == null` 不增加字段；
- 不在 Drawer 顶部、Agent 入口、Inspector Tab、Toast 或时间线重复展示。

model ID 使用等宽字体与单行省略，不能使 Drawer 或 App 出现水平滚动；可聚焦元素和 `title` 必须恢复完整
值。底部与 Inspector 复用同一 DOM/组件状态，Day/Night 和 200% zoom 保持同一信息层级。首次观测刷新可以
通过当前上下文的 polite live region 宣布，但不得移动焦点、自动打开 Drawer 或改变 Run selection。

## 6. 验收

- 十种 `AdapterKind::ALL` 均落入 Codex、ACP、Claude 或 Antigravity 的明确观测路径；
- 默认策略覆盖未观察与已观察两态，固定模型覆盖不新增字段；
- 首值 write-once、错误 epoch、固定模型拒绝与非法 ID 不影响 Run；
- 长 model ID 在底部/Inspector、最小窗口和 200% zoom 无横向溢出且可获取全文；
- Runtime 模型事件只刷新 projection，不创建消息、Toast 或焦点变化。

## References

- [Run Process Detail Surface v10（历史）](run-process-detail-surface-v10.md)
- [Camp Open Projection v3](camp-open-projection-v3.md)
- [Camp 会话工作区](../ui/components/conversation-workspace.md)
- [Runtime Catalog Boundaries](../architecture/runtime-catalog-boundaries.md)
- [V1.13-D01](../versions/v1.13/decisions.md#v1-13-d01)
