---
document_type: version-overview
version: v0.89
lifecycle: historical
authority: version-scope-and-status
design_status: accepted
implementation_status: in_progress
last_updated: 2026-08-16
---

# Rovai-ai v0.89：持久 Gather Barrier 与统一 Completion Delivery

> 当前状态：设计、合同、Core、Transport、CLI、Context 与确定性门禁已完成；真实 Runtime v13
> 矩阵已取得 6 个完整 pass、1 个 Gather 主闭环 pass 后外部余额阻塞，以及 3 个本机 Runtime/模型阻塞。
> 已完成 macOS 打包、隔离启动与 `/Applications` 升级；仍需解除这些外部阻塞，才把实现状态改为 complete。
>
> 前置版本：[v0.88 Camp 世界地图环境片段与全局闲时调度](../v0.88/README.md)

## 版本目标

新增 Agent-facing `rovai gather`：当前 Camp Default Lead 用一条共享主题同时派发多个成员；成员继续通过
普通 `rovai send` 或公开 Mention 返回；Core 在所有成员责任终态后，仅向原 Lead Conversation 排入一条
Completion Delivery，并以 mandatory `gather_completed` Current Input 启动一次综合 continuation。

本版本不建立第二套 inbox、scheduler 或私有结果协议。公共消息仍由 `CampMessage` 负责展示，派发、返回
capture、Barrier、completion 与恢复均复用统一 Message Delivery 权威。

## 交付范围

- `team.gather -> rovai gather` 成为 Built-in Transport v13 的第十五项固定命令；输入只有 repeatable `to`
  与一个共享 `body`，最多 16 个 canonical-deduped recipient，且仅当前 Default Lead 可调用；
- 一次接受事务创建一条公共请求消息、N 条 optional forward Delivery、一个 GatherRecord 与 N 个
  GatherItem，并原子预留 N 个成员 Run 责任及一个 completion Run 责任；
- 从当前 Gather 成员 Run 精确返回原 initiator 的 return Delivery 持久标记为 `gather_captured`，消息与
  Structured Mention 正常公开，但该 Delivery 直接 settled 且不物化 Lead Run；
- Item 在尚未物化 Run 时由 Delivery 终态关闭；物化后只由当前 generation 的成员 Run 终态关闭。显式
  return 只作为 evidence，不提前完成 Item；successful zero-return 使用有界 final-output fallback；
- 最后一个 Item 终态时，Barrier 在同一事务冻结 `gather_completed` 输入、将 Gather 标记为 ready 并创建
  唯一 Completion Delivery；Barrier 本身不 spawn Run；
- Completion Delivery 与普通 Delivery 共享原 initiator recipient FIFO、wait condition、attempt fence、
  Runtime readiness、Context gate 与显式 retry；空闲后只 materialize 一个 `gather_completion` Run；
- Formatter v15 / ContextManifest v13 将冻结的聚合输入作为 mandatory Current Input；即使普通历史被省略，
  每个 Item 的 recipient、dispatch Delivery、target Run、终态、captured refs、fallback 与 safe error 仍完整；
- Message Delivery v3 使用 `deliveryKind`、`dispatchDisposition` 与 `completionRole` 判别联合；CampTurn 预算
  分开记录 accepted A2A 与 AgentRun responsibility；
- `skills/cli-operations/**` 增加 Gather 选择与使用说明；`skills/campfire/**` 保持不变；
- Read Side 与 Renderer 只扩展判别联合和类型穷尽处理，不新增 Gather 卡片，也不把 completion 显示为公开
  request recipient。

## 生命周期与恢复

- User Stop、Camp 关闭或原 initiator 离场会取消 Gather，不创建替代 completion，也不转交新 Default Lead；
- Default Lead 更换不改变冻结的 initiator Agent/Conversation；
- forward Retry 复用同一 dispatchDeliveryId/GatherItem 并递增 generation；ready 后不得重开；
- completion Delivery 仅在尚未 materialize 时可重试；`completionRunId` 写入后不得生成第二个 continuation；
- 多个 Gather 相互独立，各自创建一条 Completion Delivery，并按 Barrier commit 顺序进入同一 Lead FIFO；
- startup 不扫描并 dispatch 历史 Gather；既有 `interrupted_before_dispatch` 规则继续要求显式用户处理。

## 明确不做

- 不修改 Campfire、Grill Duo、Review Duo 等协作 Skill 采用 Gather；
- 不支持 per-recipient prompt、Task 绑定、附件、quorum、early return、timeout 或嵌套 Gather DSL；
- 不新增 Agent-facing status/get/cancel 命令或成员专用 return 协议；
- 不解析正文、display name、Mention 字符串或时间窗口判断结果归属；
- 不以 Native Session ID 作为 completion 路由权威，不自动转交新 Lead；
- 不新增专用 Gather UI、私有结果流或第二套 recipient queue。

## 验收边界

- 数据库约束、迁移和并发测试证明一条请求、canonical N Items、唯一 completion、retry generation、
  Stop-vs-Barrier 与 terminal-vs-Barrier 线性化；
- Capture 回归证明公开消息/Mention/reply/reference 正常、Lead 不被逐条唤醒、混合 recipient 仍正常 forward；
- Completion 回归证明原 Conversation FIFO、target busy 等待、多个 Gather 顺序与只 materialize 一次；
- Context 回归证明 48 KiB 上限、Unicode-safe excerpt/fallback、mandatory Item/ref 不因 history eviction 丢失，
  frozen recovery 复用 exact bytes；
- Transport/CLI/catalog/help/Evidence/Skill revision 和十种 Product Runtime discovery/call 路径升级到 v13；
- Rust/TypeScript/文档门禁、macOS package、签名与隔离 App 验收通过后才把实现状态改为 complete。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.88 冻结为 historical；本概览、[实施计划](implementation-plan.md)、[实现规格](implementation-spec.md)与[版本索引](../README.md)建立唯一 current v0.89。 |
| ADR | 已更新 | [ADR-0193](../../adr/0193-durable-gather-barrier-over-unified-message-delivery.md)冻结持久 Barrier/Completion Delivery；[ADR-0194](../../adr/0194-mandatory-typed-gather-completion-current-input.md)冻结 mandatory typed completion input。 |
| Contracts | 已更新 | 新增 Gather v1，并切换 Message Delivery v3、Camp Message Send v8、Built-in Tool Transport v13 与 ContextManifest Evidence v13。 |
| Architecture | 已更新 | 新增[持久 Gather Barrier](../../architecture/durable-gather-barrier.md)，并更新公共 Delivery 与 Built-in Runtime 架构。 |
| UI | 确认无需更新 | 不新增 Gather 卡片或交互；Renderer 只消费扩展后的 Delivery/Run 判别联合并继续正常渲染公共消息。 |
| Runtime Activity | 确认无需更新 | canonical activity vocabulary 不变；新增 operation 仍通过既有 Core Built-in Tool start/terminal evidence 投影。 |
| Runtime compatibility | 已更新 | [Runtime 兼容性清单](../../runtime-compatibility.md)记录 Built-in Transport v13 的十 Product Runtime 验证结果。 |
| Documentation routing | 已更新 | 文档导航、ADR CURRENT、Contract/Architecture 索引与领域术语加入 Gather/Completion 入口。 |
| Root README | 确认无需更新 | 项目定位与公开支持范围不因一个新的内部协作编排原语而变化。 |

## References

- [实施与验收计划](implementation-plan.md)
- [Canonical 实现规格](implementation-spec.md)
- [持久 Gather Barrier 架构](../../architecture/durable-gather-barrier.md)
- [Gather v1 Contract](../../contracts/gather-v1.md)
