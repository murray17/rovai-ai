---
document_type: version-decisions
version: v1.40
lifecycle: current
last_updated: 2026-09-03
---

# v1.40 决定

<a id="v1-40-d01"></a>
## V1.40-D01：Single Chat 复用现有执行体系，并冻结私有输出路由

### 背景

普通 Camp Session 的 CLI 合同要求 Camp-visible 结果通过 `rovai send` 发布，仅替换 Prompt 无法阻止正文进入
公屏。另一方面，Single Chat 仍然是一次用户输入、一个队员责任、一次 Runtime 投递和一个 terminal result；为它
复制 Turn、Run、Context、ACK、取消和 Scheduler 会制造两套相互漂移的执行系统。通用 Capability DSL 也远超 v1
只有一个封闭模式的需求。

### 决定

Single Chat 是 `Conversation.kind` 与现有 CampTurn/AgentRun 上的封闭模式。Run 创建时不可变冻结
`invocationKind=single_chat`、`responseDelivery=conversation_message`、`operationPolicy=single_chat_v1`、策略版本和
目标 Conversation。Core 在 Built-in Router 入口和通用 operation 边界两次执行固定 allowlist；Runtime terminal
路由按冻结字段把 final 只写入私有 Conversation，并跳过 CampMessage、Missing-Send Recovery 和外部 Channel。
Prompt 只指导行为，不承担授权或路由安全。

### 后果与替代方案

- 复用现有 AgentRun、Manifest、Delivery、Binding、Evidence 和 Cancellation，普通 Camp 投影显式排除 Single Chat。
- `single_chat_v1` 是代码内封闭枚举；新增允许项必须修改合同、Core 与测试，不接受任意组合配置。
- Runtime 原生 delegation、内部模型调用和 Provider 工具不属于 Rovai Built-in policy 的能力承诺。
- 拒绝 Prompt-only 隔离，因为 Runtime 仍可直接调用普通 CLI；拒绝第二套执行聚合和通用 Policy DSL，因为两者都增加
  不必要的恢复、迁移和一致性成本。

<a id="v1-40-d02"></a>
## V1.40-D02：重启取消当前回复，结束不建立 successor cleanup fence

### 背景

Single Chat 可以把 Native Session 恢复、Native Turn 对账和私有 transcript replay 设计成专用恢复系统，也可以在用户
结束旧对话后等待旧 Runtime 完全退出再允许新对话。这些方案会引入新的产品状态、重放风险与跨 Conversation 排队；
现有 Cancellation Settlement 已能诚实表达“不再等待这轮回复”，而精确 Run/epoch/Binding 身份能够隔离迟到事件。

### 决定

App、Core 或 Runtime Host 重启命中的非终态 Single Chat Run 直接结算为 `cancelled`，Conversation 保持 active，用户
可发送下一条消息。只有用户“结束”使 Conversation `active → ended`；提交后旧私有路由立即关闭，同时沿用既有
Run cancellation/cleanup。用户可立即创建并发送同一队员的新 Conversation，不增加跨 Conversation cleanup fence。
底层容量限制只由现有 Scheduler readiness/failure 表达。

### 后果与替代方案

- 不出现 `app_restart`、`recovery_blocked`、旧输入重发、私有摘要恢复或 Native Turn reconcile 产品状态。
- 同一 Conversation 的后续执行仍遵守既有 Conversation-local cleanup 隔离；新的 Conversation 不继承该隔离。
- 旧回调必须按精确 Run、execution epoch、Conversation 和 Binding 身份归属，不能按 `campId + agentId` 投影。
- 拒绝自动 transcript replay，因为无法证明等价上下文与 exactly-once；拒绝 predecessor cleanup 等待，因为它把旧
  Runtime 的退出时延错误提升成新 Conversation 生命周期的一部分。
