---
document_type: implementation-plan
version: v0.05
lifecycle: historical
authority: implementation-plan-and-acceptance
last_updated: 2026-07-23
---

# Lumen AI v0.05 实施计划与验收清单

> 生命周期：历史实施与验收快照；五个检查点均已完成。当前版本见
> [v0.07 Hearth & Camp](../v0.07/README.md)。
>
> 版本范围：[README.md](README.md)
>
> 跨版本约束：[ADR-0009](../../adr/0009-reproducible-context-delivery.md)、[ADR-0011](../../adr/0011-stable-team-tool-gateway.md)
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

> 实施状态：已完成（2026-07-23）。ContextManifest 已成为 Runtime 唯一输入；Native Session 先确认换绑代际再冻结载荷，条件压缩、附件元数据、投递回执和恢复路径均已落地。

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

> 实施状态：已完成（2026-07-23）。

目标：先在不依赖某个 Adapter 的情况下证明 A2A 原子协议。

实施内容：

- 增加强类型 `TeamPostMessage` 命令和窄化 Tool Schema；Bridge 注入可信 Native Binding 凭证，Core 动态解析当前 Run/Epoch。
- 同一事务创建 InboxMessage、目标 ConversationMessage、投递 ACK、目标 queued AgentRun 和事件；复用稳定 Runtime Tool Call ID 做幂等。
- 目标 Readiness/Adapter Capability 预检；忙碌排队，未就绪或不支持时零写入失败。
- 继承 CampTurn/Task，不改变 Assignee；每条消息一个 Run，回复继承 Correlation。
- 实现深度 5、每 Turn 16 个 A2A Run及 2/12 预警；旧 Binding/Epoch、跨 Camp、Self Send 和超限全部拒绝。
- 实现本地 stdio Team MCP Bridge 与 Core 私有 IPC；Bridge 不直接打开 SQLite。

实施结果：

- `TeamToolService` 先用当前 Native Binding 凭证解析唯一 active AgentRun，再在命令事务内重新校验 Binding、Epoch、Camp、成员、Task、Runtime Capability、回复方向与配额。
- 模型输入固定为 `recipientAgentId`、`body`、`inReplyToMessageId` 和 `references`；Runtime Tool Call ID 与凭证摘要共同形成命令幂等身份，原始凭证不进入命令记录或 SQLite。
- 本地 Bridge 复用 `lumen-core team-mcp-bridge` 子命令，凭证只从私有环境读取；它以 stdio 提供 MCP，以权限收紧的短路径 Unix Socket 调用 Core，不接触数据库。
- 同一事务先建立 Inbox 与接收方消息，再建立 A2A Run并补齐双向引用和 delivered ACK；失败注入测试证明不会留下半消息、半 Run 或前进后的 Conversation Sequence。
- 目标繁忙时每条请求保留独立 queued Run并由现有 Scheduler 串行；回复继承 Correlation、CampTurn 与 Task，Task Assignee 不变。
- 深度 5、每 Turn 16 个 A2A Run、2/12 预警、旧凭证、Self Send、未就绪目标、非法引用和幂等冲突均有确定性结果。

完成门：

- 命令级测试覆盖原子回滚、幂等重放、忙碌排队、未就绪零写入、回复链、Task 继承和配额。
- 杀死 Bridge/Core 后，已提交目标 Run 从权威状态恢复；未提交调用不留下半消息。
- 模型参数无法伪造 sender、Camp、Run、Epoch 或 Task。

## 检查点 4：Codex、OpenCode、Copilot 与 Claude Code Adapter

> 实施状态：已完成（2026-07-23）。三个本机真实 CLI 均已完成追加式工具发现和调用；完整 App 内 A→B→A 与重启链路归入检查点 5。

目标：让已验证 Adapter 获得一致 Team Tool 与 Charter 语义。

实施内容：

- Adapter Capability Snapshot 增加 Team Tool/Charter 注入能力；升级后按本机探测重新计算，不使用 CLI 版本白名单。
- Codex、OpenCode 和 Claude Code 在每个 Run 传入同一 Native Binding 的 Team MCP 配置，验证 Resume 不重复注册工具；动态配置变化强制 Native Session 换绑。
- Copilot 每个 AgentRun 创建新 ACP Host，使用相同 CLI MCP 配置，再 `session/load` 恢复 Native Session。
- Adapter 使用最高可用的追加指令通道；不能安全追加时，把 Charter 放在该 Session 首个冻结 Run Payload 前，不替换原生 System Prompt。
- Antigravity App 显式报告 `team_tool_unsupported`，继续通过 `agy` companion 原路径执行非 A2A Run。

实施结果：

- Capability Snapshot 以真实 Installation 探测结果声明 Charter 与 Team Tool 能力，不使用 CLI 版本白名单；Antigravity App 不声明 Team Tool。
- Team Tool 凭据绑定 Native Binding/Generation，而不是 AgentRun；同一 Binding 的 Provider Connector 可以跨 Run 复用。Core 在每次调用时动态解析当前 Run/Epoch，换绑和旧 Epoch 立即失效。
- Codex 在共享 App Server 的每 Thread 请求上追加 `lumen_team` 配置；不覆盖用户的其他 MCP 或原生 System Prompt，并保留原生延迟工具发现行为。
- OpenCode 与 Copilot 的 Team Run 使用独立 ACP Host。OpenCode 从 ACP Session 获得附加 Server，并只允许 `lumen_team_*`；Copilot 使用 `0600` 临时配置文件与窄化 Server Allow，Host 退出即删除，启动时清理崩溃残留。
- Claude Code 使用本机探测到的 `--print`、JSON、`--session-id`/`--resume`、`--append-system-prompt` 和 `--mcp-config` 能力；私有 MCP 配置只追加 Lumen Server，不启用 `--strict-mcp-config`。
- MCP Bridge 的成功结果遵循结构化输出 Schema；错误结果只使用标准 MCP Error Content，避免 OpenCode 等客户端用成功 Schema 覆盖真实 Core 错误。
- Codex CLI 0.145.0、OpenCode CLI 1.18.0 和 Copilot CLI 1.0.73 已在本机实际发现并调用唯一的 `team.post_message`，且都收到预期的 `team_tool.core_unavailable` Smoke 结果；Claude Code CLI 2.1.206 已验证真实 `--print`、`--resume`、追加 Charter 与 MCP 配置路径；这些验证不形成上游版本锁。

完成门：

- 支持 Team Tool 的 Adapter 均能追加、发现并调用唯一的 `team.post_message`，且不替换原生 System Prompt 或用户其他 MCP 配置。
- CLI 能力由运行时探测而非版本字符串决定；已测试版本只记录为证据。
- Copilot/OpenCode Team Host 按 Run 隔离；Codex/Claude Code 按 Native Binding 配置；复用的 MCP Connector 不能把旧 Run 身份固化在启动参数中。
- 完整 A→B→A、目标 Run 执行、显式回信及 App 重启恢复由检查点 5 的端到端验收覆盖。

## 检查点 5：Read Side、恢复与 App 验收

> 实施状态：已完成（2026-07-23）。Read Model schema v2、Renderer 检查器、三种真实 A→B→A 链路、重启幂等、生产构建与双尺寸打包 App 验收均已通过。

目标：让用户能看到并处理上下文与协作失败，同时证明跨重启收敛。

实施内容：

- Camp Snapshot/Timeline 增加 A2A 请求、排队、回复和失败的可读投影；不增加新的 Review/Handoff 页面。
- 工作区显示 `context_compaction`、`context_overloaded`、`delivery_unknown` 和 Team Tool 不支持/配额错误；可恢复工作由扫描器继续，无法安全重放的状态明确阻塞并保留现有停止/重新发起入口。
- 增加 Context Inspector 的最小只读信息：Manifest、消息范围、Summary、Charter/Formatter 版本、附件元数据、Cursor 边界和选用原因；不显示 Provider 隐藏推理。
- 启动扫描恢复 queued A2A Run 与未决 Context Compaction；遗留 `prepared` Input Delivery 转为 `delivery_unknown` 并停止盲目重发，只有得到权威接收事实后才能继续。
- 完成真实 App、多 Runtime、破坏性重启、构建和 macOS 打包验收。

完成门：

- 用户能从 UI 判断谁请求了谁、目标是否排队/失败、当前 Run 为什么等待上下文。
- 中途杀死 App/Core/Runtime 后不重复 Team Tool、副作用或公共消息，不倒退 Cursor。
- A2A 链必然在成功、失败、取消或限额拒绝中收敛，不能无限互相唤醒。

实施结果：

- `CampSnapshot`/`EventBatch` 升级为 schema v2。Read Side 直接从 SQLite 权威表和确定性关系读取 Inbox、A2A Run、ContextManifest、最新 Input Delivery 与 Compaction Attempt，不建立持久 Projection，也不靠事件回放重建对象状态。
- Context Inspector 只显示消息数量与序列边界、摘要覆盖范围/生成器、Formatter 与完整性 Digest、附件名称/类型/大小/位置。冻结 Prompt、Summary 正文、Work Brief 正文和附件正文均不进入 DTO。
- A2A 活动显示发送者、接收者、Correlation、回复关系、深度与目标 Run 状态。拒绝调用只保留强类型 `command.result` 和源 Run 工具结果，不伪造 InboxMessage。
- `smoke:team-context` 使用本机真实 Runtime 验证四条链：Codex→Codex→Codex、Codex→OpenCode→Codex、Codex→Copilot→Codex、Codex→Claude Code→Codex。每条链均为 depth 0/1/2，显式回复继承 Correlation，所有输入接收后再推进 Cursor；完成后重启 Core，Run/Inbox/Manifest 身份保持不变。
- Codex 同一 Native Binding 的后续新 Turn 已再次成功调用 Team Tool，证明 Provider 复用的 Connector 不会因 AgentRun 更替携带过期 Run 身份；Core 每次调用都重新解析当前 Run/Epoch。
- 短上下文三次验收均没有 Compaction Attempt，证明压缩不是每轮固定步骤。附件正文隔离由 Context 单元测试和 Read Side 敏感正文回归测试固定。
- 打包 App 在 1440×920 与 1040×700 下均显示 2 条 A2A 请求和 3 份 ContextManifest；上下文 Tab 可键盘聚焦，没有横向溢出，也没有渲染冻结 Prompt。
- 最终验证通过：Rust 91 个库测试与 38 个主进程测试（另 4 个手动 Runtime 测试按标记忽略）、25 个 Renderer/TypeScript 测试、Clippy、真实 Claude Code Session Resume、Codex→Claude Code→Codex A2A、Codex Binding 跨 Run 再次调用、Antigravity App companion 续接、生产构建、macOS 打包、严格签名校验和隔离数据目录成员配置验收。

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
| AC-13 | 目标 Runtime 未就绪/Antigravity App | 结构化拒绝且数据库零写入 |
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
