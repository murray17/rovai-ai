---
document_type: model-context-change
version: v1.69
change_id: public-history-hint-additional-messages
revision: 4
confirmation_status: confirmed
confirmed_by: Principal
confirmed_at: 2026-09-24T18:02:40Z
confirmed_revision: 4
authority: proposed-model-input-change-statement
implementation_status: in_progress
last_updated: 2026-09-25
---

# 公共历史提示增加额外可见消息判断：revision 4（已确认）

本提案以当前公开 Camp [ContextManifest／Formatter v29](../../contracts/context-manifest-evidence-v29.md)、[Run Facts v7](../../contracts/run-facts-v7.md)、[Profile v9](../../contracts/context-delivery-profile-v9.md)、[Camp History v10](../../contracts/camp-history-v10.md) 和 Session Charter revision 13 为变更前基线。它完整包含 Principal 本轮给出的 P／T／I／A 检查规则、无额外消息文案，以及后来补充的“确认存在时明确提示存在额外可见消息”分支。新增两个“存在额外消息”分支的**完整英文文案**在本提案中确定。revision 2 确认了简洁 Charter 文案与查询失败回滚 claim；revision 3 曾错误地撤销 Charter 改写，未获确认。revision 4 恢复 Charter 改写，同时遵从 Principal 的明确边界：旧 Native Session 不换 Session、不改原系统提示词，下一轮只注入新动态内容。下述 Native Binding 兼容策略与 revision 2 不同，Principal 已在完整 revision 4 提交后明确授权实施（Camp 消息 `0be09c9c-9fe3-4b55-9804-3ae65b15c532`）。

## 变更前：完整相关结构和文本

新公开 batch Run 动态上下文顺序：

```text
[COLLABORATION_STATE]?
[SELF_ACTIVE_TASKS]?
[RUN_FACTS]
[WORKSPACE]?
[RUN_INPUT]
```

```ts
type PublicRunFacts = {
  attachmentOutputRoot: string
  historyHint: string
  mission?: { missionId: string; title: string; status: 'needs_you' | 'not_started' | 'in_progress' | 'completed'; updateNotice?: string }
  taskContext?: TaskContextFact
  sessionContinuity?: SessionContinuityFact
  externalEffect?: ExternalEffectFact
}
```

`historyHint` 仅从以下两句选择；`P` 为上次有效接受执行记录的公屏尾（零值表示没有记录）：

```text
P > 0: The latest public message before your last recorded run in this Camp had sequence {P}.
P = 0: No public-message boundary from a previous run is recorded for you in this Camp.
```

当前 Session Charter 的相关两条全文：

```text
- Preserve existing user work. Do not infer omitted content; retrieve it only when the current work requires it. Memory indexes and retrieval keys are discovery hints; read a Memory before relying on it.
- Use `rovai camp read` for relevant Camp history. The boundary in `RUN_FACTS.historyHint` is a reference point, not a record of messages read or work completed.
```

现有 `RUN_INPUT` 权责条目：

```text
- RUN_INPUT.messages is the complete ordered set of immediate work items claimed for this Run. Treat every item as active input; quoted text remains reference material.
```

## 变更后：完整相关结构和文本

动态 section 顺序及 `PublicRunFacts` 顶层 shape **逐字不变**。仍只有一个 `historyHint: string`；不暴露判断结果、计数、额外消息 ID、第二份边界或新的工作项。`RUN_INPUT` 及其完整有序领取集合、正文、引用和附件均不变。`historyHint` 依据 claim 时冻结的 `P` 与布尔存在性结果选择以下四种**完整**文本：

| 上次边界 | 额外消息判断 | 完整文本 |
| --- | --- | --- |
| `P > 0` | 确认不存在 | `The latest public message before your last recorded run in this Camp had sequence {P}. As of this run's start, all visible messages after that sequence are already in RUN_INPUT or were written by you.` |
| `P > 0` | 确认存在 | `The latest public message before your last recorded run in this Camp had sequence {P}. As of this run's start, there are additional visible messages after that sequence beyond RUN_INPUT and messages written by you.` |
| `P = 0` | 确认不存在 | `As of this run's start, all visible messages in this Camp are already in RUN_INPUT or were written by you.` |
| `P = 0` | 确认存在 | `As of this run's start, there are additional visible messages in this Camp beyond RUN_INPUT and messages written by you.` |

“this run's start”仅表示当前 claim 的消息快照，非实时断言。`P > 0` 的断言仅针对 `(P, T]`，不保证更早历史已经提供。确认存在仅表示有额外**可见**消息，不要求读取、不授予新的工作责任、不暗示消息内容与当前任务相关；查询失败则回滚 claim，不构造本轮 Run 或伪造结果。无边界时必须检查 `<= T` 的实际历史，不因为是首轮就推断不存在。

新建 Native Session 的 Session Charter 更新为 revision 14；第一条逐字保留，第二条替换为 Principal 已选择的简洁原文：

```text
- Preserve existing user work. Do not infer omitted content; retrieve it only when the current work requires it. Memory indexes and retrieval keys are discovery hints; read a Memory before relying on it.
- Proceed directly when `RUN_INPUT` and your existing context are sufficient; use `rovai camp read` only for missing Camp context needed by the current work. The boundary in `RUN_FACTS.historyHint` is a reference point, not a read or completion marker.
```

**已存在的 Native Session** 保留当时投递的 Charter、Bootstrap Evidence 和原系统提示词，不覆盖、不补丁、不因本次变更重投新版 Charter，也不因本次变更切换 Session；下次新 Run 仅注入按本轮 claim 冻结的新 `RUN_FACTS.historyHint` 与原本的动态区段。原有恢复机制如需重投 Bootstrap，也只能沿用该 Binding 冻结的原证据，不能改成新版 Charter。新建 Native Session 才收到上面的新版 Charter。现有 `RUN_INPUT` 权责条目逐字保留，不增加自动公屏历史、摘要、已读记录或其他 Charter 指导。

## 选择、冻结和权限边界

只在当前 Camp／Agent 的同一个 batch claim `Immediate` 事务里，使用 `P`（当前 Agent 上次有效 accepted 的公屏尾；零表示无记录）、`T`（本轮 claim 的公屏尾）、`I`（**最终**领取并进入 `RUN_INPUT.messages` 的所有 message ID）和 `A`（当前 Agent ID）。`P > 0` 时检查 `P < message.sequence <= T`；`P = 0` 时检查 `message.sequence <= T`。在范围内沿用 `camp.read` 对当前 Agent 的当前 Camp 时间线可见性：同 Camp、非 tombstone；已撤回而仍可显示 `Message withdrawn` 的占位符仍是可见消息。不得用 waiting Delivery 候选替代历史可见集合；后者会遗漏发给其他 Agent 的公屏消息和撤回占位符。

对可见消息，只排除 `message.id IN I` 以及 `message.author_type = 'agent' AND message.author_id = A`。只执行无正文、无数量、无分页上限的 `EXISTS` 查询。发给其他 Agent、但对当前 Agent 可见且未进本轮 `RUN_INPUT` 的消息**计入额外消息**；本 Agent 未领取的队尾也计入，不能因收件人、唤醒对象或消息并非当前责任而排除。读取和判断不领取 Delivery、不改变撤回资格、不推进 accepted 水位。claim 后的新消息、撤回或 accepted 水位变化不能改变本轮判断；如果查询失败，事务回滚且不领取消息、不创建该 Run；正常 claim 的判断只有 true 或 false。

在 `agent_run` 内部冻结本轮 claim 使用的 `P` 与布尔判断，不复制正文、列表或历史快照；只对新 batch Run 写入。`context.rs` 构造 RUN_FACTS 时从 Run 内部冻结值选择文本，同 Run 再次加载使用原 ContextManifest／payload；不从当前 `conversation` 的 accepted 水位或更新后的消息状态重算。本轮输入、额外消息以及旧会话的工作责任不因此更改。

## 明确不变

动态 section 顺序、`PublicRunFacts` 顶层 shape、`RUN_INPUT.messages` 的领取权责及完整内容不变。额外消息判断仅生成 `historyHint` 文本，不加入历史正文、ID 列表、计数或新工作项；`camp.read` 默认 20、显式上限 100 和分页行为保持原样。读取和判断不领取 Delivery、不改变撤回资格或 accepted 水位；非 batch 的 v26／v5 合同不变。既有 Native Session 的 Bootstrap Evidence、Charter 和系统提示词原字节不变；本次新版 Charter 仅供新建 Session 使用。

## 版本、数据与恢复

新 Run 的 `historyHint` 模型可见文本与冻结证据改变：新公开 batch Formatter／ContextManifest 从 29 升到 30，Run Facts 内部版本从 7 升到 8；Profile 9 的预算规则和数值不变。**新建 Session 使用 Charter revision 14；旧 Session 保留其原 Charter。**这些 Run 版本用于新输入和证据校验，不代表必须换 Native Session，也不增加按旧／新 Session 分流的 Run 格式。完整 `historyHint` 仍纳入原有 claim 容量估算和最终 payload 字节检查；Principal 明确本次不修正既有容量低估。单聊与非 batch v26／v5 不变。相应更新当前上下文合同和相关架构条款，不重写 v1.68、v29、v7 等历史合同。

**最小 Native Binding 兼容策略：**保持 `native_binding_context_contract()` 的现有 JSON **原值**，包括键名 `sessionCharterRevision` 及其旧值 `13`；在此兼容摘要中，`13` 只表示这一轮可续用的 Bootstrap／Session 兼容基线，**不声明新建 Session 实际收到的 Charter revision**。单独将用于新建 Bootstrap 文本的 Charter revision 标为 `14`，不可把它代入该兼容摘要。也不删除或忽略摘要字段。对其他 Adapter 摘要输入（安装、协议、Session 权限／配置及既有特定指导版本等）保持原有计算与相等校验；因此只有本次兼容的 Charter 文案变化不会旋转旧 Binding 摘要，真实配置或权限变化仍按原机制判为不兼容。今后若 Charter 变更确实不能与旧 Session 兼容，必须再明确提升此兼容基线并按既有规则换 Session，不能把这个例外泛化成永久忽略 Charter。实际 Charter 的原字节以每个 Binding 的 Bootstrap Evidence 为准，而非从兼容基线号倒推。

新增只保存必要内部字段的数据库迁移（接在现有 172 后），不回填历史 Run、不增加既有 Camp／Native Session 的协议感知迁移、不强制 Charter 重投。旧 Manifest、Bootstrap Evidence 和冻结投递保持原字节作为审计，不因部署重写；旧 Manifest 29 仍按原有限制不再续派、恢复、转换或重播。旧 **Native Session** 与旧 **Manifest** 是不同边界：本次 Charter 文案与新 Run 格式不迫使健康的旧 Native Session 换 Session；该会话下的新 Run 仍使用 Formatter／Manifest 30、Run Facts 8 并接收新的动态 `historyHint`。已存在的 Native Binding 按其 `native_binding_id`、generation 加载原 Bootstrap Evidence，校验 digest 后使用原 Charter；本次变更不额外重投新版系统提示词，原有恢复流程若需要重投也仅使用原证据。若仍需续用的旧 Session 原证据缺失或损坏，不能以新 Charter 补写为旧 Session 的原系统提示词，应停止该 Run 的投递并报告证据错误。只有真正新建 Binding／Session 且无既有证据时才生成 revision 14 Charter。如果运行时安装、协议、权限、配置或独立指导版本等因素改变兼容摘要，仍按既有相等校验决定是否换 Session，不将本次要求解释为忽略真实不兼容，也不让旧 Manifest 29 绕过格式门禁。accepted 水位只按既有有效 Runtime accepted ACK 推进；读取、搜索、发布、执行结束、停止或迟到 ACK 均不取得新推进路径。`camp.read` 默认 20、显式上限 100 与分页方式不变。

## 验证与关键负向测试

1. 首轮只有已领取用户消息：`P = 0`、结果 false，输出无边界的“已覆盖”句；首轮存在更早可见历史：结果 true，不误判首次执行为空。`P > 0` 时分别验证 true／false 的完整英文句。
2. 发给其他 Agent 但当前 Agent 可见的未领取消息、当前 lane 容量未选中的队尾，以及跨越 100 条以上历史的额外消息均给出 true；本轮 `I` 中全部消息、自己发言排除后才允许 false。已撤回占位符计入，tombstone 不计入。
3. 对同一 Run，在 claim 后插入消息、撤回额外消息、推进当前 conversation accepted 水位，检验提示仍来自 claim 快照；反复加载冻结 Manifest/payload 字节完全一致。查询失败时回滚 claim，不生成没有判断结果的新 Run。
4. 四种提示均按现有规则参加 claim 估算与最终 payload 字节检查，不截断 `RUN_INPUT`；不扩大范围修正现有容量低估。检查 `RUN_FACTS` 仅含原字段、动态区段顺序不变，非 batch 与 `camp.read` 分页不变。
5. 新迁移保留旧 Run、Bootstrap 和 Manifest 原字节；旧 Manifest 29 不续派或恢复。以真实旧 Binding／Bootstrap Evidence 和未变的 Runtime 配置为输入，检查本次兼容摘要保持原值，后续新 Run 的 Formatter／Manifest 30、Run Facts 8 和新 `historyHint` 在**同一 Native Session** 投递，本次变更不触发 Bootstrap／系统提示词重投，既有恢复流程仅使用原证据；新建 Session 则拿到 revision 14 Charter。另检查旧 Session 缺失或损坏 Bootstrap Evidence 时拒绝补写新 Charter，Runtime 安装／协议／权限／配置改变时仍按原规则换 Session。Principal 已要求停止测试与子 Agent 验收；以上是待验证场景，未获新指示前不执行测试或双轨 Gate，未执行不得称为通过。

## 二次确认

**历史确认仅适用于 revision 2：**Principal 在完整 revision 2 写出后，于 Camp 消息 `71a91b2d-df04-4e0f-8bb7-213d1110b82d` 表示“没问题，你执行吧”。Principal 随后于消息 `40d1152a-a00b-4d71-9851-1c2147bb3711` 明确不能换 Session，于消息 `f2de4763-69e2-40a0-bbd5-9b6f688f3a04` 进一步纠正：Charter 要改，但老会话不改系统提示词、不要切 Session。revision 3 对这些话的理解有误且未获确认；上述纠正发生在本文 revision 4 **完整写出之前**，不构成 revision 4 的二次确认。Principal 在完整 revision 4 提交后的 Camp 消息 `0be09c9c-9fe3-4b55-9804-3ae65b15c532` 明确表示“那你实现吧，不要做复杂，完成后推到远端分支”；据此确认按 **revision 4** 实施。该确认不撤销先前“别测了、别开子 agent 验收了、容量不处理了”的边界。

## 历史勘误：2026-09-25 Bootstrap Evidence 缺失门禁

本文“旧 Session 缺失证据必须拒绝补写”的要求曾在 PR #529 中实现为 `native_session_id` 已存在即拒绝首次冻结。目标 Camp `rvcamp_01m3bq7gt2ebgb8qs55m4fa179` 的 TRAE 首轮运行证明这一判断会误挡先绑定 ACP Session、再准备首次证据的正常路径；该 Binding 尚无已接受输入，也不是在重写已有证据。Principal 已要求撤回这条判断。当前语义见[Session continuity 与 Bootstrap](../../architecture/foundational-invariants.md#context-session-bootstrap)：已有证据继续按原字节复用和校验，缺失时沿原首次准备路径冻结，损坏时拒绝；Runtime Input Delivery 仍独立决定实际投递。保留上文原确认记录作为当时快照，不再将其中的“缺失即拒绝”作为当前门禁。
