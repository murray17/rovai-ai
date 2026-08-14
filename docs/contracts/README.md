---
document_type: contracts-index
authority: protocol-contract-routing
last_updated: 2026-08-14
---

# 长期接口合同

本目录保存跨版本、字段级且可由测试直接验证的接口合同。ADR 解释为什么选择某个边界，
Architecture 解释组件如何组成，Version 文档记录交付范围；它们都不复制本目录的完整 wire shape。

## 生命周期

- 已接受且带版本号的合同语义冻结，只允许修正错字、链接、元数据和不改变语义的表达。
- 字段、wire shape、错误、幂等或投递语义改变时，创建下一个 `<name>-vN.md`，不得原地改写
  已接受版本；旧版本可继续约束既有持久对象或历史恢复。
- 新增或切换合同版本时必须同步更新下方索引，明确当前入口与 historical 入口。合同的
  `accepted` 只表示该版本语义成立，不表示它是新执行的当前入口，也不表示代码已经实现。

跨版本合同拥有的 JSON Schema 位于 [`schemas/`](schemas/) 并由独立 catalog 固定 raw-byte digest；不得为了新合同
修改已冻结的历史 Version schema catalog。

| 合同 | 权威范围 |
| --- | --- |
| [Benchmark Protocol v3（当前）](benchmark-protocol-v3.md) | 版本化 Run 信封、Product/Environment fingerprint、五层 Evidence、Adapter/derived projection、逐轴比较资格与 disclosure |
| [Semantic Judge Views v1（当前）](semantic-judge-views-v1.md) | Process/Blinded Outcome 双视图、模型可见 evidence allowlist、本地 Evidence ID、双 Replica、逐项 reconciliation 与 Hard Outcome non-interference |
| [Tool Interaction Measurement v1（当前）](tool-interaction-measurement-v1.md) | Opportunity-based Camp/Memory/A2A trace、确定性 oracle/coverage 与独立 Tool-Use Judge 边界 |
| [Paired Collaboration Experiment v1（当前）](paired-collaboration-experiment-v1.md) | Team/Solo pre-registration、fresh arms、typed resources 与 outcome-conditioned paired comparison |
| [Diagnostics Center v1（当前）](diagnostics-center-v1.md) | `diagnostics.check` typed read model、三态分类、显式单项修复映射、Recovery 与集中脱敏的 `rovai-diagnostics-v5` |
| [Accepted Input Recovery v1（当前）](accepted-input-recovery-v1.md) | accepted Runtime input 的启动分类、`recovery_blocked`、Scheduler fence、用户命令与 Stop/预算 outcome-unknown 收敛 |
| [Collaboration State v2（当前）](collaboration-state-v2.md) | peer-only routing identity、稳定 CampMember 选择、Lead ID/Boolean、完整 projection digest、独立 inclusion、accepted ACK 与 v0.50 clean break |
| [Memory Capture v3（当前）](memory-capture-v3.md) | v2 边界加 complete exact-Scope View、copyable Revision target、active body aggregate quota、64 KiB production projection limit 与 Memory-domain clean break |
| [Memory Capture v2 (historical)](memory-capture-v2.md) | v1 捕获/Review/Forget 边界加 flat Agent-relative Scope identity、revise target assertion、durable domain rejection 与 Supersession 原子顺序 |
| [Memory Capture v1 (historical)](memory-capture-v1.md) | 初版 best-effort 在线捕获、actor-bounded add/revise、隔离 Hearth Review Item、双 CAS、候选清除与 Forget safeguard；不含 Scope-identified revise |
| [Built-in Tool Transport v11（当前）](builtin-tool-transport-v11.md) | 十三项固定命令、complete Memory View、copyable Read/revise target、durable Memory rejection 与 v11 catalog/capability |
| [Built-in Tool Transport v10 (historical)](builtin-tool-transport-v10.md) | 十二项固定命令、flat Scope-identified Memory Search/Read/revise 与 v10 catalog/capability |
| [Built-in Tool Transport v9 (historical)](builtin-tool-transport-v9.md) | 统一 `memory.write` 与 effective/review_pending 初版；Search/Read/revise 不含完整 Scope identity |
| [Built-in Tool Transport v8 (historical)](builtin-tool-transport-v8.md) | v0.70 十三项命令、独立 `memory.propose_hearth` 与 Camp Message Send v5；不作为 v0.73 CLI context/catalog 入口 |
| [Built-in Tool Transport v7 (historical)](builtin-tool-transport-v7.md) | v0.67 的 Camp Message Send v4、exact Camp read addressing 与初版渐进式 CLI 教学；不作为 v0.73 CLI context/catalog 入口 |
| [Built-in Tool Transport v7 Errata](builtin-tool-transport-v7-errata.md) | 历史 v7 locator-present recovery 勘误；其 self-write exact-read 语义已由 v8/v9 继承 |
| [Durable Task v3（当前）](durable-task-v3.md) | User/Lead 责任定义、Assignee execution-state update、Camp-wide read、explicit owner、unassigned holding 与 advisory actions |
| [Camp Message Send v7（当前）](camp-message-send-v7.md) | v6 canonical freeze 不变；显示名 alias 只在 logical line 的首个非空白 token 寻址，普通 mid-line prose 不唤醒 |
| [Camp Message Send v6 (historical)](camp-message-send-v6.md) | v5 closed input 与投递链不变；新增当前 Camp 有效成员显示名 alias，但允许任意 parseable body position |
| [Camp Message Send v5 (historical)](camp-message-send-v5.md) | v4 Core 效果与 wire 不变；收窄 `mentionUser` / `--to-user` 的消息局部使用边界，但正文不解析显示名 alias |
| [Camp Message Send v4 (historical)](camp-message-send-v4.md) | v3 显式 Agent 寻址/caller return 加初版 `--to-user`、Structured Current User Mention 与原子通知 |
| [Camp Message Send v4 Errata](camp-message-send-v4-errata.md) | 历史 v4 Current User Attention 生命周期与 locator-present exact verification 勘误；其修正已由 v5 继承 |
| [Notification Episode v4（当前）](notification-episode-v4.md) | v3 精确 signal 生命周期加会话可见来源的有界批量确认与即时角标刷新 |
| [Notification Episode v3 (historical)](notification-episode-v3.md) | v2 精确 signal 加 Journal acknowledgement/Clear/remove invalidation、顺序式队列归约与 reset 清空；不含普通会话可见来源确认 |
| [Notification Episode v2 (historical)](notification-episode-v2.md) | v1 三层模型加 Active Attention、exact HeadsUpSignal、事务式 Renderer cursor、pending-first Approval 与 acknowledge-only action；不含 signal 入队后的精确失效合同 |
| [Notification Episode v1 (historical)](notification-episode-v1.md) | 初版 immutable Occurrence、separate Disposition、materialized Episode、minimal Change Journal、bounded write、typed action、heads-up 与 retention |
| [Current User Attention v4（当前）](current-user-attention-v4.md) | v3 逐来源确认加普通进入会话后的精确可见即已读，不要求通知动作或 DOM 焦点 |
| [Current User Attention v3 (historical)](current-user-attention-v3.md) | v2 精确确认加同 CampTurn 一卡、逐 Mention acknowledgement、最早未确认 action 与导航版本绑定；不含普通会话可见即已读 |
| [Current User Attention v2 (historical)](current-user-attention-v2.md) | v1 当前用户注意力加 Message Mention 独立已读、锚点导航、焦点确认与 Markdown 保真；不含 Episode 聚合 |
| [Current User Attention v1 (historical)](current-user-attention-v1.md) | 当前用户身份、结构化内容与原子通知基线；不含独立已读、锚点窗口与 Markdown 保真勘误 |
| [Missing-Send Recovery Publication v1（当前）](missing-send-recovery-publication-v1.md) | 成功 AgentRun 的 typed final candidate、同 Run accepted-send 抑制、recipient-free 原子恢复消息与 terminal replay/竞态语义 |
| [Pending Camp Activation v1（当前）](pending-camp-activation-v1.md) | 一键 Pending 创建、Snapshot/Navigation activation state、首消息原子激活、mutation guard 与窄 discard/启动清理 |
| [Camp Attachment v1（当前）](camp-attachment-v1.md) | 普通文件/目录联合、Core-owned 只读快照、限制、Draft 原子消费、Snapshot 29 与 Runtime 稳定路径 |
| [Camp Composer Draft v1（当前）](camp-composer-draft-v1.md) | Structured Content、附件引用、持久 reply intent、exact revision mutation、显式接收者修复与 Draft-only user send |
| [Planned Shutdown v2（当前）](planned-shutdown-v2.md) | v1 generation-local reliable terminal 加 durable shutdown cycle、product fence、启动补偿、终态 unknown-effect 保留与 v2 report |
| [Planned Shutdown v1 (historical)](planned-shutdown-v1.md) | Main-only v1 wire、launch/terminal admission、generation-local route binding 与只接受可靠 Runtime terminal 的旧关闭语义 |
| [Built-in Tool Transport v6 (historical)](builtin-tool-transport-v6.md) | v0.62 Camp Message Send v3 transport；不作为 v0.65 parser/help/compatibility 入口 |
| [Built-in Tool Transport v5 (historical)](builtin-tool-transport-v5.md) | v0.54 Task v3 transport；不作为 v0.62 Runtime/CLI compatibility 入口 |
| [Built-in Tool Transport v4 (historical)](builtin-tool-transport-v4.md) | v0.47 Task v2 transport；不作为 v0.62 Runtime/CLI compatibility 入口 |
| [Durable Task v2 (historical)](durable-task-v2.md) | ordinary-Agent create/claim 与受限读取的旧 Task 合同；不作为当前 authority |
| [Built-in Tool Transport v3 (historical)](builtin-tool-transport-v3.md) | v0.46 十二项命令与 Agent Result Projection v1；不作为 v0.47 Runtime/CLI compatibility 入口 |
| [Built-in Tool Transport v2 (historical)](builtin-tool-transport-v2.md) | v0.45 Agent CLI、catalog、IPC、Envelope、receipt、幂等、lease 与旧私有 operation clean break |
| [Camp Message Send v1 (historical)](camp-message-send-v1.md) | v0.45 `camp.message.send` / `rovai send`、Addressing Token、recipient resolution、fanout、lineage 与错误 |
| [Camp Message Send v2 (historical)](camp-message-send-v2.md) | v0.46 隐式 Camp 与 Agent 输入 reply default target；不作为 v0.62 send 入口 |
| [Camp Message Send v3 (historical)](camp-message-send-v3.md) | v0.62 caller return 与 Core-managed reply reference；不含 v0.65 Current User Attention |
| [Message Delivery v2（当前）](message-delivery-v2.md) | `forward | return` 冻结边、target lineage、caller continuation，以及 v1 queue/attempt/recovery/settlement |
| [Message Delivery v1 (historical)](message-delivery-v1.md) | 无 caller-return 分类的 recipient queue、dispatch attempt、waitCondition、retry/cancel 与 settlement |
| [ContextManifest Evidence v12（当前）](context-manifest-evidence-v12.md) | v11 self-active semantics 加 Formatter v14 的 `mentionsCurrentUser`、Structured Content/projected body evidence 与 frozen recovery |
| [Context Delivery Profile v3（当前）](context-delivery-profile-v3.md) | v2 public context 加 self-active Task selection/order/max 8 与 public-history-first budget priority |
| [ContextManifest Evidence v11 (historical)](context-manifest-evidence-v11.md) | Formatter v13 与 self-active empty/omission 语义；不含 Current User Mention metadata |
| [ContextManifest Evidence v10 (historical)](context-manifest-evidence-v10.md) | self-active Task evidence 的旧空集合语义；不作为 Formatter v13 恢复入口 |
| [ContextManifest Evidence v9 (historical)](context-manifest-evidence-v9.md) | bounded public omission evidence；不作为 Formatter v13 恢复入口 |
| [Context Delivery Profile v2 (historical)](context-delivery-profile-v2.md) | 公共引用链与历史 budget 的旧当前合同；不选择 self-active Task |
| [Context Delivery Profile v1 (historical)](context-delivery-profile-v1.md) | AgentRun 公共消息窗口、Unicode scalar 正文截断、历史字符预算与遗漏提示 |
| [Run Process Detail Surface v5（当前）](run-process-detail-surface-v5.md) | v4 accepted-input surface 加 planned-shutdown terminal source/reason 与 cancelled unsettled-effect 诚实投影 |
| [Run Process Detail Surface v4 (historical)](run-process-detail-surface-v4.md) | v3 连续执行过程加 accepted-input“结果待确认”blocker；不含 planned-shutdown terminal source |
| [Run Process Detail Surface v3 (historical)](run-process-detail-surface-v3.md) | Agent 级连续执行过程、任务/队员 Inspector、Approval Dock 与 CampTurn Stop；不含当前 recovery blocker surface |
| [Run Process Detail Surface v2 (historical)](run-process-detail-surface-v2.md) | Agent 级连续执行过程与三 Tab Inspector；不作为当前 Renderer 入口 |
| [Run Process Detail Surface v1 (historical)](run-process-detail-surface-v1.md) | Scheme C 的逐 AgentRun Run Pulse/Drawer 与四 Tab Inspector；不作为当前 Renderer 入口 |
