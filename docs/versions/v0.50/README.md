---
document_type: version-overview
version: v0.50
lifecycle: historical
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
last_updated: 2026-08-09
---

# Rovai-ai v0.50：Self Identity、Collaboration 与 Model Context Projection 边界

> 当前状态：Self/Peer Collaboration baseline 已完成实现与验收；Model Context Projection、分层
> Evidence、Task Notice/Charter 与 Bootstrap Redelivery v2 已在同一 v0.50 clean break 中完成代码、
> 合同与版本级全量验证；`implementation_status: complete`。
>
> 前置版本：[v0.49 通用与启动设置、双人追问 Skill](../v0.49/README.md)

## 版本目标

v0.50 消除同一模型输入中“旧的完整 Self Identity”和“新的三字段 self member”同时出现的
语义冲突。一个 Native Session 只允许 `MEMBER_IDENTITY` 表达当前 Agent 自身身份；
`COLLABORATION_STATE` 只服务 peer routing，不得补丁、更新或覆盖 self。

同一未发布版本还冻结语义无损的模型投影精简：把模型可见 DTO、ContextManifest Evidence、Runtime
Input Delivery Evidence 与内部领域状态分开，只移除模型不需要的证据字段和默认值，不改变选择、预算、
恢复、accepted-ACK、隐私或授权。

本版本冻结以下合同断代：

```text
Native Session Bootstrap v3
Bootstrap Formatter v3
AgentRun Context Formatter v11
ContextManifest v8
Context Delivery Profile v2
Data Contract v0.50 / projection schema 27 / Migration 68
Bootstrap Redelivery Envelope v2
Bootstrap Redelivery Formatter v2
```

v3/3/11/8 是同一个尚未发布的 v0.50 草案最终版本轴，不因讨论步骤或中间提交再次升版；Profile v2
继续拥有不变的选择算法和预算。Redelivery v1 已是 v0.48 持久合同，因此 marker/wording 改变形成
v2/2。逐项审查与明确否决项见
[Model Context Projection 设计审查](model-context-projection-review.md)，长期权威见
[ADR-0147](../../adr/0147-lossless-model-context-projection-and-layered-delivery-evidence.md)；字段级实施与
验收由本版本实施计划、共享 fixture、Migration 68 和代码共同冻结。

长期理由见 [ADR-0146](../../adr/0146-sole-native-session-self-identity-and-peer-routing-projection.md)，
字段级 shape 与 ACK 规则见
[Collaboration State v2](../../contracts/collaboration-state-v2.md)。

## 唯一 Self Identity

`MEMBER_IDENTITY` 保持 schema v1 和固定六字段顺序：Name、Team Role、Professional
Responsibilities、Personality Traits、Working Principles、Growth Topic。它不进入 AgentRun
Dynamic Context，不保存 Identity Blob、snapshot、digest、revision 或历史版本，也不增加每轮
Identity Update。

身份编辑不会强制轮换 Native Session，也不要求下一 Run 立即看到新值。只有既有 eligible
Bootstrap boundary 才从最新 AgentProfile 原子读取全部六字段，包括新 Session、既有 Resume
Bootstrap 路径和 compaction 后的 Bootstrap redelivery。

Session Charter 明确声明：

```text
MEMBER_IDENTITY is the sole self-identity projection for this Native Session.
COLLABORATION_STATE describes peer routing identity only and never updates,
patches, or overrides self identity.
```

## Collaboration State v2

最终模型投影固定为：

```json
{
  "schemaVersion": 2,
  "peers": [
    {
      "agentId": "agent_2",
      "name": "Peer",
      "teamRole": "Reviewer",
      "professionalResponsibilities": "Review the change"
    }
  ],
  "defaultLeadAgentId": "agent_1",
  "selfIsDefaultLead": true
}
```

`peers` 是稳定的 current CampMembers 减去 `snapshot.agent_id`。`away` 和已发起 leave request
但 `CampMember.status` 仍为 `active` 的队员继续保留，直到关系正式变为 `left`；实际寻址、Presence、
Runtime、Capability、配额与 fencing 资格由 Core 在调用时实时重判。

每个 peer 只包含 Agent ID、Name、Team Role 和 Professional Responsibilities。Personality
Traits、Working Principles 与 Growth Topic 不进入 peer projection。默认 Lead 只输出 ID 引用和
派生 Boolean；self 是 Lead 时不重复 self 的姓名、角色或职责文本。

## 完整投影 digest 与 accepted ACK

`collaboration_state_digest` 永远针对 self 过滤、隐私过滤和 Lead 派生后的完整 Collaboration
State v2 对象计算 canonical JSON digest，与本轮是否渲染无关。`collaborationStateIncluded` 独立
记录该 Manifest 是否实际包含 `[COLLABORATION_STATE]`。

只有以下模型可见变化会使后续 Dynamic Context 重新渲染该区段：peer 集合、peer routing
identity、`defaultLeadAgentId` 或 `selfIsDefaultLead`。self 六字段编辑、`present → away` 和
leave-requested 等不改变最终投影的内部变化不会触发重复投递。

可靠性顺序保持：

```text
build complete Collaboration State v2
  → freeze digest + inclusion in ContextManifest / Runtime Input Delivery
  → Runtime Input accepted
  → advance conversation.native_collaboration_state_digest
```

发送失败、`delivery_unknown`、process loss 或未 accepted 的输入不推进水位；后续输入仍会重新
投递同一最新完整投影。

## 一次性 clean break

Migration 68 只接受精确的 v0.48/schema 26、且 Migrations 66 和 67 均已应用的状态作为
升级源。旧合同下当前 Binding、
Native Session、accepted public/collaboration 水位、Bootstrap redelivery Requirement、Resume
Attempt、compaction observer 状态、ContextManifest、Bootstrap Evidence 和 Runtime Input
Delivery 技术投影表行与可达引用全部清理；旧非终态 Run/Turn fail closed，旧 frozen delivery context
link 被移除。失去引用的 content-addressed Managed Blob 字节留给既有通用 GC 回收，不构成旧合同读取路径。

Camp、公共消息、Task、Conversation 和终态 Run/Turn 等已经完成的业务历史保留。新技术表只接受
Bootstrap v3/Formatter 3、Context Formatter 11 和非空 inclusion；没有旧 `members`、
`defaultLead`、formatter 或 nullable evidence 的翻译、双写和 Resume 兼容分支。该版本迁移是合同
断代，不是身份编辑触发的 Session rotation。

## 本版本不做

- 不要求身份修改下一次 Run 立即生效；
- 不增加 identityVersion、identityDigest、Identity Blob 或身份历史；
- 不增加 `[MEMBER_IDENTITY_UPDATE]`；
- 不把完整 Identity 放回每个 Dynamic Context；
- 不因 Profile 更新强制创建新 Native Session；
- 不修改既有 eligible Bootstrap delivery matrix；
- 不把 peer 的三个私有身份字段、Presence 或 Runtime 资格投影给模型。

## 已实现的 Model Context Projection 与 Evidence 边界

模型可见 Dynamic Context 使用独立 model
DTO，但 `messageId`、`sequence`、`senderType`、`senderId`、`replyToMessageId` 等 canonical 名称不改；
`sourceConversationId` 和 attachment digest 只进入 ContextManifest Evidence。compact JSON 省略空附件和
未截断的 `bodyLength`/`bodyTruncated`/continuation 默认状态；截断正文使用 `continuation` 承载可直接执行
的 canonical `camp.read` item 输入。整条历史省略只投影 count、可能不连续的 sequence envelope 与
`navigationHint`，不伪造 range locator；精确 omission IDs/reasons 只留在 Manifest。

Context Source State、Model Context Projection、ContextManifest Evidence 与 Runtime Input Delivery Evidence
保持四层分离。Current Input、完整 Collaboration State v2、Memory Entrypoint、Profile v2 选择/预算，
以及与 Profile 分离的现有 96 KiB Runtime gate、accepted-ACK、隐私和实时授权都不改变。不引入
Collaboration Delta、estimated-token budget、
Memory reprioritization、字段缩写或第 13 项建议格式。

Session Charter 将稳定 Task/polling 规则和“额外 peer-coordination send”不变量与 per-Run Task Notice
分开；该不变量不限制 Runtime-specific 用户可见结果交付。Charter 同时移除标题中的 `(v0.47)`；
Redelivery 使用带 `reason="context_compaction"` 的 v2 envelope 和一条不可省略的 Core
recovery authority 语句。Runtime Input Delivery 只冻结 revision、Bootstrap Evidence 引用、presence 与
Envelope/Formatter v2，不保存完整 overlay、Identity bytes 或 combined digest。

## 验收范围

已完成的 Self/Peer baseline 自动验收覆盖：新 Session 的完整六字段 Bootstrap；self 不进入 peers；self 编辑不产生
Collaboration State 更新；peer public routing identity 更新触发新投影；peer 私有字段不泄露；self
为 Lead 时只输出 ID/Boolean；away 与 leave-requested 不改变 peer 投影；`delivery_unknown` 不推进
digest，accepted ACK 才推进；下一 eligible Bootstrap 继续读取最新完整身份；v68 保留业务历史、
终结旧非终态执行与未完成 Delivery，并删除旧技术上下文表行和可达引用。

扩展验收同时覆盖 compact DTO、canonical continuation、Manifest source/attachment/omission/Run Notice
Evidence、Task/Public Output Charter 边界和 Redelivery v2 accepted/unknown 语义。精确检查点和命令证据
见[实施与验收计划](implementation-plan.md)，v0.50 已满足 complete 门槛。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | `docs/versions/README.md` 将 v0.49 按原实施事实冻结为 historical，并把 v0.50 设为唯一 current；本概览和实施计划已建立 |
| ADR | 已更新 | ADR-0146 冻结 Self/Peer baseline；ADR-0147 冻结四层投影/Evidence、Profile/Formatter/Manifest 权责和 Redelivery v2，accepted 不代表已实现 |
| Contracts | 已更新 | Collaboration State v2 已完成；Context Delivery Profile v2 继续只拥有选择与预算，Formatter 11/Manifest 8 fixture 已冻结最终 projection/evidence shape |
| Architecture | 已更新 | Built-in Tool Runtime 与 Bootstrap Redelivery 架构记录已实现的四层 Evidence、Task/Public Output 边界和 Redelivery v2 |
| UI | 已更新 | Inspector 只读展示 typed Run Notice ref 与 Runtime Input Delivery Redelivery v2 evidence，不改变交互或布局语义 |
| Runtime Activity | 确认无需更新 | 不新增或重分类 Canonical Runtime Activity；事件 payload 变化只扩展 Context evidence |
| Runtime compatibility | 确认无需更新 | 不改变 Runtime adapter、上游版本、发现能力或 compaction detector 资格 |
| Documentation routing | 已更新 | `docs/README.md`、Contracts/Architecture/ADR 索引和 `CONTEXT.md` 增加 Self/Peer 与 Model Context Projection/Evidence 当前入口 |
| Root README | 确认无需更新 | 项目定位、常青能力和支持的 Agent Runtime 范围没有变化 |

## References

- [v0.50 实施与验收计划](implementation-plan.md)
- [v0.50 Model Context Projection 设计审查](model-context-projection-review.md)
- [ADR-0146：唯一 Self Identity 与 Peer Routing Projection](../../adr/0146-sole-native-session-self-identity-and-peer-routing-projection.md)
- [ADR-0147：语义无损 Model Context Projection 与分层 Delivery Evidence](../../adr/0147-lossless-model-context-projection-and-layered-delivery-evidence.md)
- [Collaboration State v2](../../contracts/collaboration-state-v2.md)
- [Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md)
- [Native Session Bootstrap Redelivery](../../architecture/native-session-bootstrap-redelivery.md)
- [Rovai-ai 领域词汇表](../../../CONTEXT.md)
