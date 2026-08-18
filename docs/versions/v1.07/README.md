---
document_type: version-overview
version: v1.07
lifecycle: current
authority: version-scope-and-status
design_status: proposed
implementation_status: not_started
model_context_change: true
last_updated: 2026-08-18
---

# Rovai-ai v1.07：显式 Public-only、A2A 边指导与 Principal 投影

> 当前状态：[模型上下文变更 revision 1](model-context-change-a2a-public-only.md) 已于
> `2026-08-18T15:29:27+08:00` 由 `murray17` 二次确认；ADR 与合同仍为 proposal，implementation 仍为
> `not_started`。本次确认不是开始实现指令，也不表示 Schema、当前 Contract 或版本常量已经改变。
>
> 前置版本：[v1.06 Camp History Target 与 Public A2A 可见性](../v1.06/README.md)

## 版本目标

把“公开 CampMessage”和“调度 Agent”彻底分开：为显式发送增加 Core 强制的 public-only 寻址意图；用
forward/return 专属动态指导阻止确认、感谢、盖章、收口、待命和重复结论继续唤醒成员；并把唯一人类用户
在所有 Agent 可见正文中稳定投影为 `@Principal`。Runtime automatic final 与 Missing-Send Recovery 永远
保持 recipient-free，不从正文推导 Agent recipient。

## 提案范围

- `camp.message.send` 增加 `publicOnly` / `--public-only`，内部与持久层使用
  `AgentAddressingMode::{Automatic, PublicOnly}`；
- public-only 在正文寻址 parser 前生效，与 `to`、`taskId` 冲突，但允许 `mentionUser` /
  `--to-principal`；
- canonical flag 为 `--to-principal`，`--to-user` 只保留不可发现的输入归一化 alias；
- `camp.message.send` canonical result、clean-break v2 事件与 compact Agent output 分别公开寻址意图和解析
  结果；旧事件误名 `publicOnly` 由准确的派生结果 `recipientFree` 替代；
- ordinary A2A `forward | return` 在 `CURRENT_INPUT` 前增加必需、边专属的 `[A2A_GUIDANCE]`；direct 与
  `gather_completion` 不出现；
- Human 消息投影保持 `@你`，Agent 上下文与 Camp History 工具统一投影 `@Principal`；
- Context Formatter 18→19、ContextManifest 16→17，并通过 binding compatibility clean break 创建新
  Native Session；Bootstrap v3 / Formatter 3 保持；
- Gather Completion Input 2→3，仅冻结 Agent audience 的 request/captured-body 投影与证据；Gather lifecycle、
  limits、fallback 和预算保持；
- Built-in Tool Transport v15 完整继承 v14 的 `LocalIpcEndpoint + IPC v2` 后再加入本版 CLI/catalog
  变化；实现必须原子从 v13 跨到 v15；
- Missing-Send Recovery v1 的 policy 与十个 Adapter 的 `if_no_accepted_send` 保持不变；
- 采用开发期本地数据 clean break：不迁移或兼容 v1.06 Camp/Message/Task/Runtime 历史，不提供旧 Schema
  reader、backfill、双写或旧 UI cache 修复；实际 reset 仅能在明确开始实现后进行。

## 永久负向边界

```text
Runtime automatic final / missing-send recovery
  → recipient-free CampMessage
  → literal Text only
  → effectiveRecipients = []
  → deliveryIds = []
  → replyToCampMessageId = null
  → zero A2A allocation
  → zero Agent wakeup
```

只有显式 `rovai send` 或既有 `rovai gather` 可以创建 Agent Delivery。本版不增加 fallback final parser，
不根据 final 中的 `@agent_N`、显示名或行位置创建 Delivery。

## 明确不做

- 不因本次二次确认自动修改实现、Schema、当前 accepted Contract 表项/语义、版本常量或 fixture；
- 不关闭 return continuation 的 Missing-Send Recovery；合法静默与 recovery suppression 留到第二阶段
  独立 ADR；
- 不扩大普通 send 的 inline addressing 语法，不对礼节性正文做自然语言分类；
- 不修改 Gather 产品语义、A2A 深度、fanout 或预算；
- 不把 `publicOnly` 输入、`agentAddressingMode` 意图与 `recipientFree` 派生结果混为一谈；
- 不新增 Principal 数据表、ID、actor、多用户绑定或身份迁移；
- 不改写 Structured Content 或 Human body/FTS cache，不以字符串替换产生 `@Principal`；
- 不把 Delivery、Run、lineage、depth、caller ID 或 `edgeKind` 暴露给模型。

## 提案验收边界

- public-only 正文中的 canonical ID、有效/过期/歧义显示名、自指和 ancestor lookalike 全部保持 Text，且
  零 Delivery/预算；
- `publicOnly + to/taskId` 原子返回 `message.public_only_conflict / fix_input`，与
  `mentionUser` / `--to-principal` 组合成功；
- Automatic 空解析与 PublicOnly 的结果数组都可为空，但 durable intent、v2 event 和 Agent output 可区分；
- automatic final/recovery 的 canonical Agent ID、显示名、首尾 mention 均不产生 Mention、reply 或 Delivery；
- forward/return guidance 精确文本、触发条件、section 顺序、Manifest evidence 与恢复复用可重现；
- 同一 CurrentUserMention 在 Human 为 `@你`、Agent 为 `@Principal`，Structured Content/content digest 不变；
- Camp search/read/history 的 snippet、body、Unicode scalar offset 与 replay 都使用 Agent 投影；
- v15 只有在 v14 endpoint/IPC2 与本版 catalog 同时满足时才可宣告；v13/v15 混合 fail closed；
- v1.06 本地产品数据整体不进入 v1.07 兼容范围；新库只接受新 Schema/Formatter/Charter 合同。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.06 以 complete 状态冻结为 historical；本概览、计划和版本索引建立唯一 current v1.07 proposal。 |
| ADR | 已更新 | ADR-0216～0218 分别提出显式寻址意图、Transport v15 继承关系和 Principal audience projection；均保持 proposed，未进入 CURRENT。 |
| Contracts | 已更新 | 新增 Camp Message Send v10、Built-in Tool Transport v15、Camp History Retrieval v2、Gather v3 与 ContextManifest Evidence v17 proposal；当前 accepted 入口暂不切换。 |
| Architecture | 确认无需更新 | 当前 Architecture 继续描述已接受实现；组合变化先由 proposal ADR、Contract 与本版模型上下文说明承载，确认后再更新长期架构。 |
| UI | 确认无需更新 | Human Renderer 仍显示既有 `@你`，本轮 proposal 不改变 Renderer wire、交互或视觉合同。 |
| Runtime Activity | 确认无需更新 | 新意图审计字段尚未实施；确认后再判断 Canonical Activity projection，当前 registry 与 evidence classifier 不改。 |
| Runtime compatibility | 确认无需更新 | 尚未运行真实 Runtime 或变更任何已测版本/能力结论；v15 资格是后续实施门槛。 |
| Documentation routing | 已更新 | v1.07 proposal 从版本索引、ADR HISTORY 与 Contract proposal 区进入；现行 Architecture/Contract current 路由保持不变。 |
| Root README | 确认无需更新 | 本提案不改变项目定位、常青能力或已发布支持范围。 |

## 二次确认状态

当前 `model-context-change-a2a-public-only.md` 为 `revision: 1`、`confirmation_status: confirmed`；确认人
`murray17`，确认时间 `2026-08-18T15:29:27+08:00`。该状态只解除模型上下文治理门槛：

1. 写入确认记录后，`pnpm docs:check` 必须通过；
2. ADR/Contract 仍为 proposed，implementation 仍为 `not_started`，尚未执行 clean break；
3. 任何语义修改都必须递增 revision 并使旧确认失效。

## References

- [实施与验收计划](implementation-plan.md)
- [模型上下文变更 revision 1](model-context-change-a2a-public-only.md)
- [ADR-0216](../../adr/0216-explicit-agent-addressing-intent-as-delivery-gate.md)
- [ADR-0217](../../adr/0217-transport-v15-inherits-cross-platform-v14.md)
- [ADR-0218](../../adr/0218-audience-specific-principal-message-projection.md)
- [Camp Message Send v10 proposal](../../contracts/camp-message-send-v10.md)
- [Built-in Tool Transport v15 proposal](../../contracts/builtin-tool-transport-v15.md)
- [Camp History Retrieval v2 proposal](../../contracts/camp-history-v2.md)
- [Gather v3 proposal](../../contracts/gather-v3.md)
- [ContextManifest Evidence v17 proposal](../../contracts/context-manifest-evidence-v17.md)
