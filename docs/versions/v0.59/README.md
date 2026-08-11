---
document_type: version-overview
version: v0.59
lifecycle: current
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
last_updated: 2026-08-12
---

# Rovai-ai v0.59：九 Runtime 的零 send 公共输出恢复发布

> 当前状态：生产实现、完整门禁和九个 Runtime 逐项真实验收均已完成。
>
> 前置版本：[v0.58 可恢复 Runtime 漂移与受控重绑定](../v0.58/README.md)

## 版本目标

为所有九个已交付 Runtime 增加一个 Core-owned Missing-Send Recovery Publication：当且仅当一个
AgentRun 成功结束、该 Run 没有任何已接受的 `camp.message.send`，并且 Adapter 提供了符合其原生
final boundary 的非空且不超过 32 KiB 的候选正文时，Core 原子创建一条无收件人的公共消息。

该能力只恢复“整个 Run 从未 send”的静默失败，不承诺公开的一定是完整最终结论。任意一次已接受
send——包括进度、public-only 或 addressed A2A send——都抑制兜底；Core 不推断 send intent、正文
种类或回复完整度。

## 交付范围

- 在 Adapter catalog 中增加独立于 `RuntimePublicOutputMode` 的 Missing-Send Recovery policy，九个
  Runtime 全部启用，原有 `explicit_send_only` 不变；
- `agent_run.succeed` 接收独立、可选且带 closed provenance 的 recovery candidate；普通
  `finalOutput` 继续拥有 Run 成功语义，候选缺失、不可信、空白或超限不改变成功终态；
- Core 在同一终态事务中以 `sourceAgentRunId + sourceOperationId` 判断该 Run 是否已有成功 send，
  并在 eligible 时创建至多一条 recipient-free、无 Delivery、无 reply-to、无 Task attachment 的
  Public A2A Message；
- user-triggered Run 与 Message-Delivery-triggered target Run 使用相同规则；每个独立静默 Run 可以
  各自产生一条恢复消息；
- Codex 只接受 `turn/completed.turn.items` 最后一个非空 `agentMessage`；Claude Code 只接受匹配
  Session 的 success `result`；Antigravity 只接受未截断、合法 UTF-8、成功 `--print` stdout；
  六个 ACP Runtime 只接受 `end_turn` 时最后一次 tool activity 之后的 assistant suffix；
- ACP collector 优先使用可选 `messageId` 聚合同一条消息；缺失 ID 时只接受连续匿名 suffix；已识别
  与匿名身份混用、或工具之后没有新 assistant 文本时 fail closed；
- terminal event/result 记录 recovery decision、reason、boundary 与 accepted-send fact，但不复制
  recovery 正文；现有 `AgentRun.finalCampMessageId` 关联真正创建的恢复消息；
- 自动化覆盖事务、重放、竞态、边界 collector 和超限；真实验收逐个运行九个 Runtime 的 zero-send
  与 accepted-send suppression，六个 ACP 额外运行真实 tool→final 场景和协议事件 fixture。

## 冻结边界

- 不把九个 Runtime 切换为 `assistant_final_visible`，不改变 ADR-0134 的 ordinary output mode 与
  Exact Final Suppression；
- 不增加 `sendKind`、`intent`、final/progress 分类器或语义完整度判断；任何 accepted send 都抑制；
- 恢复消息不解析正文中的 `@agent_…`，不创建 Effective Recipients、Message Delivery、A2A budget、
  reply-to default、Task attachment 或隐藏私信；字面量 mention 保持 Text；
- 不截断、摘要、拼接不确定输出或退回通用 stdout/stream；超过 `camp.message.send` 32 KiB 上限时
  只记录 `skipped_candidate_too_large` 并保持 Run 成功；
- 不从失败、取消、等待或无法证明 final boundary 的 Run 发布恢复消息；
- 不把一条 tombstoned explicit send 当作“从未 send”：accepted-send 事实一经成立仍抑制恢复；
- 不改变 Renderer 信息架构；恢复消息作为普通 Agent-authored Public A2A Message 进入既有时间线、
  搜索与 Shared Conversation。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.58 按冻结时 `in_progress` 状态转为 historical，v0.59 成为唯一 current，并新增本版本概览与实施计划 |
| ADR | 已更新 | ADR-0162 冻结独立 Missing-Send Recovery policy、全 send 抑制、原子发布与 Adapter final provenance |
| Contracts | 已更新 | 新增 Missing-Send Recovery Publication v1，定义内部候选、eligibility、decision/result 与消息 shape；Camp Message Send v2 保持冻结 |
| Architecture | 已更新 | Public A2A Message 与 Built-in Tool Runtime 增加 Core 终态安全网、四类 Adapter collector 和无 Delivery 边界 |
| UI | 确认无需更新 | 不新增 Renderer surface 或交互；恢复消息沿用既有普通 Agent 公共消息投影 |
| Runtime Activity | 确认无需更新 | 不改变 Canonical Runtime Activity 分类、生命周期或 Evidence 投影；只消费既有原生终态/工具边界形成内部 candidate |
| Runtime compatibility | 已更新 | 已逐项记录九个真实 Runtime 的 zero-send/suppression 证据，并为六个 ACP 记录真实 tool→final 与协议 fixture |
| Documentation routing | 已更新 | 版本、ADR、Contract 与 Architecture 当前入口共同指向 Missing-Send Recovery Publication |
| Root README | 确认无需更新 | 项目定位与支持的 Runtime 集合不变，根 README 不记录版本局部终态恢复机制 |

## References

- [v0.59 实施与验收计划](implementation-plan.md)
- [ADR-0162](../../adr/0162-missing-send-recovery-publication.md)
- [Missing-Send Recovery Publication v1](../../contracts/missing-send-recovery-publication-v1.md)
- [Public A2A Message 与 Message Delivery](../../architecture/public-a2a-message-delivery.md)
- [Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md)
- [Runtime compatibility register](../../runtime-compatibility.md)
