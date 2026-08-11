# B 底部执行台 · 数据来源审计

本表以当前 `main` 的 `AgentRunView`、`CampSnapshot`、`MessageDeliveryView`、`AgentRunExecutionEvidenceView`、`buildLiveExecutionProgress` 和 `RunExecutionDisclosure` 为准。原则是：只展示已有事实；没有稳定来源的内容不由 Renderer 补写。

| UI 内容 | 当前来源 | 展示规则 |
| --- | --- | --- |
| Agent 名称、头像、身份 | `CampSnapshot.members` 及其 Agent profile | 直接显示；入口 identity 为 `(campId, agentId)`。 |
| 是否存在执行入口 | `CampSnapshot.agentRuns` 按 `agentId` 聚合 | 同一 Agent 的所有 Run 只产生一个 pill；终态 Run 也计入历史过程。 |
| Agent pill 状态 | 该 Agent 当前非终态 Run；没有非终态 Run 时取最新 Run 的 `status` | 只用于长期入口的状态提示，不在过程面板中重复成“状态”字段。 |
| `purpose` | `AgentRunView.purpose` | 当前直接执行通常是完整用户草稿，A2A 可能是内部执行文案。用户已确认不在本面板展示，也不生成阶段标题。 |
| `expectedOutput` | `AgentRunView.expectedOutput` | 字段存在，但当前直接执行写入通用固定句，现有 Drawer 也未展示。用户已确认本面板不展示。 |
| 时间区间 | 起点 `startedAt ?? createdAt`；终点 `endedAt`，非终态显示“现在” | `09:42–09:46` 可以由真实时间戳格式化得到。当前生产 UI 主要显示 `runDurationLabel`，改为绝对区间只需 Renderer 格式化，不需要新字段。 |
| Run 状态 | `AgentRunView.status`，等待原因可取 `waitReason` | 用于 Agent pill 聚合、默认聚焦选择和轨道状态造型；不渲染“状态”事实行。 |
| Run 边界元数据 | `id`、`invocationKind`、`a2aDepth`、`campTurnId` 与生命周期时间 | 作为低权重事实显示，不提供 Run 选择器。 |
| 当前责任 | **没有 Agent 级字段** | 不从最新 Run 推导，不展示。`responsibilityKey` 是内部 identity，不是产品文案。 |
| 协作投递 | `CampSnapshot.messageDeliveries` / `MessageDeliveryView` | 数据层仍保留接收 Agent、状态、等待条件、目标 Run、失败码和时间；本稿的会话 footer 与 Agent 过程只显示收件人身份，不渲染“已送达 / 等待审批”状态标签。完整状态留在右侧上下文投递表面。 |
| 进展说明 | `agent.text.delta`，持久化后对应 evidence `kind: narration` | 仅 Runtime 明确输出时显示；`agent.reasoning.summary.delta` 与 `agent.thought.delta` 被过滤，不能拿来填 UI。 |
| 执行计划 | `runtime.plan` / `runtime.plan.delta`，持久化后对应 `plan` evidence | 仅事件存在时显示 explanation 和 steps。 |
| 工具标题 | evidence 的 `canonical.toolName`，其次 `presentationHint` / activity-domain fallback | 由 `buildLiveExecutionProgress` 生成，不能臆造业务阶段名。 |
| 工具详情与结果 | Runtime item 的 output、command、file change 或 tool input；状态来自 canonical outcome/phase | 有证据才渲染；截断内容通过现有 `agentRunEvidence.getContent` 展开。 |
| 历史证据 | snapshot 的 `executionEvidence`；不足时由 `agentRunEvidence.list` 补齐 | 终态 Run 仍可加载；`reasoning_summary` 不展示。 |
| 默认聚焦 | 同一 Agent 的 Run，按时间取最新 `running`；没有时取最新 `queued` / `waiting` | 用户显式点击 Agent 后滚动到该 Run，并默认展开已有证据；只移动视觉位置，不抢键盘焦点。 |
| 公共最终回复 | `CampMessageView.body`；可以通过 `sourceAgentRunId` 与 Run 关联 | 它属于公共时间线。第一版不自动搬进执行台，避免重复消息。 |
| 会话 Task 条目 | `TaskView.status`、`TaskView.title`、`taskAssigneeName(...)` | 与 main 的 `TaskTimelineCard` 一致，只显示状态、标题、负责人；description、Criteria、blocker、audit、AgentRun 不进入会话条目。 |
| 消息复制 | `CampMessageView.body`；交互复用 `MessageSurface` / `MessageCopyButton` | 只渲染 hover/focus 出现的图标按钮；不增加消息级执行入口或“定位”动作。 |
| 数字进度百分比 | **没有来源** | 当前 `LiveExecutionProgress` 不提供百分比；不展示类似 `68%` 的进度条。 |
| “读取发布配置与最近变更，识别出支付回调为高风险点。” | **没有稳定结构化来源** | 只有当这句话本身出现在公开 narration 或 `CampMessageView.body` 时才能原文显示；Renderer 不总结、不推断。 |

## 用户指出的示例

- “扫描本周发布变更”：没有独立的“阶段标题”字段；本面板不展示，也不从 `purpose` 或工具调用推导。
- “09:42–09:46”：来自 `startedAt ?? createdAt` 到 `endedAt` 的格式化结果，可提供。
- “已完成”：来自 `status === 'succeeded'`，只在 Agent pill 等入口状态中使用，不作为面板事实行。
- “当前责任”：没有 Agent 级真源，本面板不展示。
- “预期交付”：字段存在但具体业务文案不是当前 main 自动生成的，本面板不展示。
- “读取发布配置与最近变更，识别出支付回调为高风险点。”：不是现有模型中的稳定字段。修订稿已从执行台移除；公共消息中若 Runtime 确实发送过相同正文，仍可作为消息显示。

## 对应 main 代码

- `packages/contracts/src/index.ts`：`AgentRunView`、`AgentRunExecutionEvidenceView`、`CampSnapshot`、`MessageDeliveryView`。
- `apps/desktop/src/renderer/src/ui-model.ts`：`buildLiveExecutionProgress` 的 narration、plan、tool 映射和 reasoning 过滤。
- `apps/desktop/src/renderer/src/CampWorkspace.tsx`：`RunExecutionDisclosure`、历史 evidence 加载、终态展示与 `runDurationLabel`。
