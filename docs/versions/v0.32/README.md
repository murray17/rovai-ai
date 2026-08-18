---
document_type: version-overview
version: v0.32
lifecycle: historical
authority: version-scope-and-status
design_status: frozen
implementation_status: complete
last_updated: 2026-08-03
---

# Rovai-ai v0.32 Event-Driven Member Calls

> 中文名：事件驱动成员调用
>
> 状态：协议已冻结，生产实施、自动化回归与 Codex/Antigravity 真实 Runtime Smoke 已完成
>
> 前置版本：[v0.31 Default Team Delivery Qualification](../v0.31/README.md)
>
> 跨版本决策：[ADR-0091](decisions.md#adr-0091)
>
> 实施设计：[architecture.md](architecture.md)
>
> 实施门禁：[implementation-plan.md](implementation-plan.md)
>
> Benchmark Review：[benchmark-review.md](benchmark-review.md)

## 版本意图

把团队协作从“Lead 保持 Run 并轮询 Task”改为 Core 驱动的持久输入恢复：任意 Agent 调用其他
成员后可以结束当前 Run；结果到达时，Core 在接收 Conversation 空闲后创建一个新的 Resume
Run。第一阶段严格一条输入对应一个 Run，不做时间合批、Root fan-in 或多向 Execution Graph。

本版本同时完成 breaking rename：`team.post_message` / AGY `post_message` 彻底替换为
`team.call_member` / `call_member`，不保留兼容别名或旧参数。所有 Runtime 继续经过同一
canonical Team Tool catalog、Capability、Binding、Epoch、幂等与 Attested Gateway 边界。

## 交付范围

- 新增持久化 ConversationInput、ReturnObligation 和 CampTurn A2A Run Slot 计数；
- 单 Conversation FIFO、单槽物化、启动/周期对账和 crash-safe exactly-once；
- `returnPolicy=none|required`、显式返回满足、无回复 Core Outcome；
- Run 终态、Obligation 收口、Outcome 入队的单事务不变量；
- CampTurn 聚合与 Stop 扩展到输入/责任；
- Member Call 与 Outcome 的最小 Current Input；
- `list_tasks` 与 Session Charter 明确禁止用 sleep/轮询等待；
- Codex、Claude、ACP、Antigravity Bridge、权限投影、Smoke 和 Qualification 脚本全部改用
  `call_member`；
- v45 Migration 将升级数据库中的旧 `inbox.send` 默认能力和 Camp override 一次性规范化为
  `member.call`；这是持久配置迁移，不注册旧 Tool、Capability alias 或旧请求形状；
- UI/Audit 保留真实 InboxMessage、Input、Run 和 Outcome 链接，不合成伪 Agent 消息。
- OpenCode/Copilot ACP 缺少 item identity 的相邻公开流式片段按语义边界合并；终态 Run 通过
  Evidence 总数和 Camp 授权的按 Run 分页 Read Side 恢复完整执行过程，不受 Camp Snapshot
  最近事件窗口影响。
- 所有 Runtime 的 reasoning/thought 只保留为 Core 权威 Evidence，不进入 Renderer；执行过程
  仅展示公开叙述、计划、Tool、文件动作与错误证据。

## 明确不在范围

- 多回复合批、Root 收敛等待、multi fan-out / multi fan-in；
- graph node、dependency、formal recovery/supersession；
- 被动只读 Agent 通知；
- 从 callee final output 自动构造回复；
- 旧 `post_message`、`source`、`inReplyToMessageId`、`references[]` 或本地数据兼容。

这些能力若需要，将进入后续 Rovai Collaborative Execution Graph，而不是扩展
`call_member` 形成双重语义。

## 完成定义

[implementation-plan.md](implementation-plan.md) 的 Migration、Core 协议、全部 Runtime 投影、
上下文、安全终态、取消、恢复、单元/集成测试、静态检查和 Codex/Antigravity 真实 Runtime
Smoke 已全部通过，v0.32 实施状态为完成。ADR `accepted` 与实施状态仍是两个独立事实。
前序 12 次 post-gate 诊断为 6/12，且全部只使用默认 Lead，已冻结为非正式单体基线。新的
Team Pack revision 4 使用 CAL-001 1.5.0、TQ 2.0、Runner 0.32.6 和修复后的 packaged Core
完成正式校准与 3×4 Trial：严格 Pass Rate 为 **4/12（33.3%）**，功能 Verifier 6/12、变更
边界 10/12、协作协议 12/12。72 个 Run、60 条 Member Call 和 30 次显式 Return 全部收敛，
没有轮询、Core Outcome、预算触发或人工介入；这证明事件驱动协作可用，但最终交付质量仍不
稳定。详见 [Benchmark Review](benchmark-review.md)。
