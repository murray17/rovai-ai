---
document_type: implementation-plan
version: v0.05
lifecycle: current
authority: implementation-plan-and-acceptance
last_updated: 2026-07-23
---

# Lumen AI v0.05 实施计划与验收清单

> 状态：检查点 1 已完成；检查点 2 实施中
>
> 版本范围：[README.md](README.md)
>
> 跨版本约束：[ADR-0009](../../adr/0009-reproducible-context-delivery.md)、[ADR-0010](../../adr/0010-team-tool-a2a-execution.md)
>
> 文档规则：[文档导航](../../README.md)

## 实施原则

- 分成五个可独立验证的检查点；每个检查点完成代码、Migration、测试和文档状态更新后形成独立提交。
- 先建立持久化事实和强类型命令，再接 Adapter；禁止用 Prompt 约定替代 Core 权限、游标、配额和原子性。
- ContextManifest 是 AgentRun 输入真源；event_log、Renderer 缓存和 Runtime 内存均不能替代。
- Team Tool 是 Inbox/Conversation/AgentRun 的原子本地命令，不建立第二套 Team Message 或通用 Outbox。
- CLI 版本由能力探测决定，不锁死已测试版本；支持声明必须由真实 Runtime Smoke 证明。
- 正常增量能原文交付时不摘要；附件正文不进入 Lumen Prompt。

## 检查点 1：v14 Context 与 A2A Schema

> 实施状态：已完成（2026-07-23）。v14 Schema、迁移诊断、Blob GC Root、Camp 删除边界与迁移/约束测试已经落地。

目标：让 SQLite 先完整表达冻结输入、Native 投递和 A2A 链，不改变现有 Runtime 行为。

实施内容：

- 增加不可变 `context_manifest`、`context_summary`、`context_compaction_attempt`、`runtime_input_delivery` 及必要受管 Blob 引用。
- 为当前 Native Binding 增加 Generation、公共投递游标、Charter Digest、Member State Digest；换绑时原子递增 Generation 并重置新 Session 的投递状态。
- 为 AgentRun 增加 ContextManifest 引用、A2A Parent/Root/Depth 与来源 Inbox 约束；允许同 CampTurn 下追加独立 A2A Run。
- 增加 Context Summary 覆盖连续性、Manifest 唯一性、Delivery Attempt 幂等性和 A2A 深度/来源约束。
- v14 迁移不伪造旧 Native Session 已接收水位；旧非终态 Run 若无法确定输入，按早期项目策略终结或丢弃为最小一致集合。

完成门：

- 新库与 v13 升级均幂等；破坏性 Fixture 不产生半 Manifest、倒退 Cursor 或悬空 A2A 链。
- 一个 AgentRun 只能绑定一个 ContextManifest；同一 Input Attempt 重试不重复写回执。
- Native Binding 换代后新 Cursor 不继承旧 Session 的“已看见”假设。

## 检查点 2：Context Materializer 与投递协议

> 实施状态：未开始。

目标：关闭 RT-02，让 Runtime 只消费不可变输入。

实施内容：

- 实现 Session Charter Builder、Turn Envelope、Collaboration State、Control Signals、Shared Updates、Work Brief 和 Current Input 的版本化 Formatter。
- 实现确定性 ContextManifest Builder；Rendered Payload 写入 ManagedBlobStore 并保存 Digest。
- 正常路径只读取 Native Cursor 之后的公共连续增量；当前输入去重、Agent 自己旧回复过滤和私有 Inbox Current Input 均由测试固定。
- 实现 Bootstrap、ContextSummary 和隔离 Compaction Attempt。只有超过预算时摘要；失败转 `waiting(context_compaction/context_overloaded)`。
- 增加 Runtime Input Delivery 状态：prepared、accepted、delivery_unknown、reconciled；Cursor 只在持久接收回执后 CAS 前进。
- 恢复同一 Run 时只使用冻结 Blob；禁止重新查询新消息扩展 Manifest。

完成门：

- 两个连续 Run 的第二个 Payload 不重复第一轮已接收公共消息。
- 接受前失败不推进，接受后模型失败不回退，模糊崩溃不盲目重发。
- Summary 覆盖范围与原文形成连续前缀；压缩失败不能跳序列。
- 附件只出现名称、类型、大小、位置和稳定引用，没有正文。

## 检查点 3：Team Tool Core 与本地 Bridge

> 实施状态：未开始。

目标：先在不依赖某个 Adapter 的情况下证明 A2A 原子协议。

实施内容：

- 增加强类型 `TeamPostMessage` 命令和窄化 Tool Schema；Bridge 注入可信 Native Binding 凭证，Core 动态解析当前 Run/Epoch。
- 同一事务创建 InboxMessage、目标 ConversationMessage、投递 ACK、目标 queued AgentRun 和事件；复用稳定 Runtime Tool Call ID 做幂等。
- 目标 Readiness/Adapter Capability 预检；忙碌排队，未就绪或不支持时零写入失败。
- 继承 CampTurn/Task，不改变 Assignee；每条消息一个 Run，回复继承 Correlation。
- 实现深度 5、每 Turn 16 个 A2A Run及 2/12 预警；旧 Binding/Epoch、跨 Camp、Self Send 和超限全部拒绝。
- 实现本地 stdio Team MCP Bridge 与 Core 私有 IPC；Bridge 不直接打开 SQLite。

完成门：

- 命令级测试覆盖原子回滚、幂等重放、忙碌排队、未就绪零写入、回复链、Task 继承和配额。
- 杀死 Bridge/Core 后，已提交目标 Run 从权威状态恢复；未提交调用不留下半消息。
- 模型参数无法伪造 sender、Camp、Run、Epoch 或 Task。

## 检查点 4：Codex、OpenCode 与 Copilot Adapter

> 实施状态：未开始。

目标：让三个已验证 Adapter 获得一致 Team Tool 与 Charter 语义。

实施内容：

- Adapter Capability Snapshot 增加 Team Tool/Charter 注入能力；升级后按本机探测重新计算，不使用 CLI 版本白名单。
- Codex 和 OpenCode 每个 Run 传入同一 Binding Team MCP 配置，验证 Resume 不重复注册工具；动态配置变化强制 Native Session 换绑。
- Copilot 每个 AgentRun 创建新 ACP Host，使用相同 CLI MCP 配置，再 `session/load` 恢复 Native Session。
- Adapter 使用最高可用的追加指令通道；不能安全追加时，把 Charter 放在该 Session 首个冻结 Run Payload 前，不替换原生 System Prompt。
- AGY 显式报告 `team_tool_unsupported`，继续通过原路径执行非 A2A Run。

完成门：

- 三个 Adapter 分别完成 A→B→A 的真实异步链，每个 Native Session 工具列表只有一个 `team.post_message`。
- CLI 升级后能力重探测可以继续工作或给出真实 blocker；不会因版本字符串变化直接失效。
- Copilot Host 跨 Run 重建但 Native Session 连续；Codex/OpenCode 的旧 MCP 进程不能冒充新 Epoch。

## 检查点 5：Read Side、恢复与 App 验收

> 实施状态：未开始。

目标：让用户能看到并处理上下文与协作失败，同时证明跨重启收敛。

实施内容：

- Camp Snapshot/Timeline 增加 A2A 请求、排队、回复和失败的可读投影；不增加新的 Review/Handoff 页面。
- 工作区显示 `context_compaction`、`context_overloaded`、`delivery_unknown` 和 Team Tool 不支持/配额错误，提供局部重试或修复入口。
- 增加 Context Inspector 的最小只读信息：Manifest、消息范围、Summary、Charter/Formatter 版本、附件元数据、Cursor 边界和选用原因；不显示 Provider 隐藏推理。
- 启动扫描恢复 queued A2A Run、未决 Context Compaction 和 Input Delivery 对账；Wake Signal 丢失不影响恢复。
- 完成真实 App、多 Runtime、破坏性重启、构建和 macOS 打包验收。

完成门：

- 用户能从 UI 判断谁请求了谁、目标是否排队/失败、当前 Run 为什么等待上下文。
- 中途杀死 App/Core/Runtime 后不重复 Team Tool、副作用或公共消息，不倒退 Cursor。
- A2A 链必然在成功、失败、取消或限额拒绝中收敛，不能无限互相唤醒。

## 验收矩阵

| 编号 | 场景 | 预期结果 |
|---|---|---|
| AC-01 | 正常 Resume 有 3 条新公共消息 | Payload 只含这 3 条，接收回执后 Cursor 前进 |
| AC-02 | Runtime 接受前失败 | Cursor 不变；同 Run 可重发完全相同 Blob |
| AC-03 | Runtime 接受后模型失败 | Cursor 保持已推进；恢复 Resume，不重复输入 |
| AC-04 | 接收结果不确定 | Run 等待对账，不盲目重发 |
| AC-05 | 新 Native Session | Bootstrap 使用摘要/最近原文或可容纳的全量原文 |
| AC-06 | 未读超过预算 | 较早连续区间摘要，最近区间原文；无序列缺口 |
| AC-07 | 摘要失败 | `waiting(context_compaction)`，不调用目标 Agent |
| AC-08 | 必需内容仍超限 | `waiting(context_overloaded)`，无静默裁剪 |
| AC-09 | 当前消息也在 Shared Updates | Prompt 中只出现一次 |
| AC-10 | 当前消息带大附件 | 只有元数据和位置，无附件正文 |
| AC-11 | A 向空闲 B 发消息 | Inbox、ConversationMessage、B Run 原子出现并排队 |
| AC-12 | A 向繁忙 B 连发两条 | 产生两个独立 Run，按序串行 |
| AC-13 | 目标 Runtime 未就绪/AGY | 结构化拒绝且数据库零写入 |
| AC-14 | B 显式回复 A | 同一 Correlation 和 CampTurn 中创建 A 的新 Run |
| AC-15 | A2A 超过深度/数量 | 调用拒绝，不创建消息或 Run |
| AC-16 | 旧 MCP 进程或旧 Epoch 调用 | 身份 Fencing 拒绝 |
| AC-17 | Team Tool 事务中途失败 | 全部回滚，无半消息或半 Run |
| AC-18 | 提交后 Wake 丢失并重启 | Scheduler 扫描 queued Run 并继续 |

## 每个检查点的验证基线

```text
cargo fmt --check
cargo test -p lumen-core
cargo clippy -p lumen-core --all-targets -- -D warnings
pnpm typecheck
pnpm test
pnpm smoke:core
```

涉及真实 Runtime 时追加对应 Adapter Smoke 与 A2A Smoke；涉及 Renderer 时必须启动真实 Electron App 验证错误态、焦点、重启和 1040×700 / 1440×920。最终检查点执行 `pnpm build` 与 `pnpm package:mac`。
