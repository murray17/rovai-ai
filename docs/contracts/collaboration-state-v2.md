---
document_type: interface-contract
contract: collaboration-state
version: 2
authority: agentrun-peer-routing-identity-projection
status: accepted
last_updated: 2026-08-09
---

# Collaboration State v2

Collaboration State v2 是 AgentRun Dynamic Context 中唯一的 peer routing identity 合同。它不拥有
self identity、寻址准入或 Runtime 资格。Self/peer 生命周期的决策理由见
[ADR-0146](../versions/v0.50/decisions.md#adr-0146)。

## 1. Model-visible shape

存在该区段时，格式固定为：

```text
[COLLABORATION_STATE]
{
  "schemaVersion": 2,
  "peers": [
    {
      "agentId": "agent_2",
      "name": "Peer",
      "teamRole": "Reviewer",
      "professionalResponsibilities": "Reviews the requested change."
    }
  ],
  "defaultLeadAgentId": "agent_1",
  "selfIsDefaultLead": true
}
[/COLLABORATION_STATE]
```

顶层四个字段都必须存在：

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `schemaVersion` | literal `2` | 当前且唯一可写版本 |
| `peers` | peer array | 稳定 current CampMembers 减去 self |
| `defaultLeadAgentId` | Agent ID 或 `null` | 当前 Camp Default Lead 的 ID 引用 |
| `selfIsDefaultLead` | Boolean | `defaultLeadAgentId == snapshot.agent_id` 的派生值 |

每个 peer 恰好包含：

| 字段 | 来源 |
| --- | --- |
| `agentId` | `AgentProfile.id`，模型与工具使用的稳定 routing identity |
| `name` | `AgentProfile.display_name` |
| `teamRole` | `AgentProfile.team_role` |
| `professionalResponsibilities` | `AgentProfile.professional_responsibilities` |

对象不包含 `personalityTraits`、`workingPrinciples`、`growthTopic`、Presence、leave request、busy、
Runtime、Capability、quota、fence、current Turn 或 changes hint。未知字段不属于合同。

## 2. Peer selection and ordering

Core 对当前 Camp 的 CampMember 与 AgentProfile 做权威读取：

```text
candidate = CampMember.status == active
         && AgentProfile.profile_status != removed

peer = candidate && AgentProfile.id != snapshot.agent_id
```

`present` 与 `away` 都进入 peers。`leave_requested_at` 和 `leave_request_command_id` 不参与选择；关系
仍为 `active` 时继续保留，只有正式 `left` 才移除。永久 removed Profile 不再是 current CampMember。

顺序使用稳定的 `AgentProfile.member_order`，再以 Agent ID 打破平局。Presence、请求离队时间、
Runtime readiness 和消息到达顺序不能重排 peers。

该目录不承诺调用资格。`camp.message.send` 和其他 Core admission 在实际调用时重新验证 current
membership、Presence、Runtime、Capability、quota、lineage、single-slot 与 fencing；缓存的 peers
不能授权或保证执行。

## 3. Self and Default Lead

`snapshot.agent_id` 永远不进入 peers，即使 self 是唯一成员或 Default Lead。

- peer 是 Lead：`defaultLeadAgentId` 指向 peers 中对应 `agentId`，`selfIsDefaultLead=false`；
- self 是 Lead：`defaultLeadAgentId` 等于 self Agent ID，`selfIsDefaultLead=true`，但没有 self peer
  object 或 self identity 文本；
- 没有 Lead：`defaultLeadAgentId=null`、`selfIsDefaultLead=false`。

`defaultLead` object、Lead Name、Lead Team Role 和 Lead Responsibilities 不属于 v2。

## 4. Complete projection digest

Core 必须先构建完整最终对象，再计算：

```text
collaboration_state = build_collaboration_state(current_members, snapshot.agent_id)
collaboration_state_digest = canonical_json_digest(collaboration_state)
```

该 digest 总是完整 v2 投影的 digest，包括空 peers、Lead ID 和 Boolean；它不是内部 Member rows、
presence-filtered subset、已渲染片段或某次 delta 的 digest。self 六字段和 peer 的三个私有身份字段从未
进入输入，因此不能影响 digest。

Materialization 判断：

```text
collaboration_changed = bootstrap_required
                     || conversation.native_collaboration_state_digest
                        != collaboration_state_digest
```

无论 `collaboration_changed` 是否为真，ContextManifest 都记录完整
`collaborationStateDigest`；`collaborationStateIncluded` 单独记录本轮是否实际渲染区段。当前
Context Formatter v11 / ContextManifest v8 中两个证据都必填，inclusion 不可为 `null`。

因此：

- self Identity Update 不改变 projection，不触发 section；
- `present → away`、leave request 或内部字段变化在最终对象相同时不触发 section；
- peer public routing identity、peer current membership 或 Default Lead 变化会改变 digest 并触发；
- Bootstrap-required 输入仍携带一份完整当前目录，即使值与进程内先前计算相同。

## 5. Runtime Input Delivery and ACK

ContextManifest 冻结 digest、inclusion 和 exact Dynamic Context bytes。Runtime Input Delivery 绑定该
Manifest；Recovery 复用冻结内容，不能用后来 Profile、CampMember 或 Lead 状态重算。

只有 Delivery 状态被 Core 持久确认为 `accepted` 后，才能在同一 Native Binding generation fence
内执行：

```text
conversation.native_collaboration_state_digest =
    delivery.context_manifest.collaboration_state_digest
```

`prepared`、send failure、`delivery_unknown`、`not_accepted`、process loss 或缺少 accepted ACK 都不
推进。若 watermark 未推进，后续可发送输入必须继续比较并重新投递最新完整 projection。ACK 推进完整
digest，与该轮 `collaborationStateIncluded` 是 true 还是 false 无关；false 表示该完整 projection
已与当前 accepted watermark 相同。

## 6. Contract axes and clean break

当前组合是：

```text
Native Session Bootstrap v3
Bootstrap Formatter v3
AgentRun Context Formatter v11
ContextManifest v8
Data Contract v0.50 / projection schema 27 / Migration 68
```

Migration 68 删除旧 Bootstrap Evidence、ContextManifest 和 Runtime Input Delivery 技术投影，重置
旧 Binding/Session/watermark，并终结旧合同非终态 Run/Turn；Camp、消息、Task、Conversation 和终态
Run/Turn 业务历史保留。新表只接受当前 axes 和非空 inclusion。

没有 v1 `members`/`defaultLead` 翻译、旧 formatter 读取、nullable inclusion、legacy digest 字段、
双写或 Resume compatibility。历史 migration DDL 中的旧字段名只描述一次性输入 schema，不是当前
运行时合同。

## 7. Acceptance vectors

至少覆盖：

- 新 Native Session 的 `MEMBER_IDENTITY` 仍是完整固定顺序六字段；
- self 永远不在 peers，self Lead 只输出 ID/Boolean；
- peer Lead、无 Lead、空 peers；
- peer `present/away` 和 leave-requested 状态保持相同 projection；正式 left 后移除；
- self 六字段编辑不改变 digest，不渲染 section，不轮换 Session；
- peer Name/Role/Responsibilities 编辑改变 digest并在下一 accepted input 刷新；
- peer Personality/Principles/Growth 编辑不进入 projection；
- `delivery_unknown` 不推进 watermark，随后 accepted ACK 推进冻结完整 digest；
- v68 保留完成业务历史、删除旧技术 projection、失败旧非终态执行，并可重复启动；
- 数据库拒绝旧 Bootstrap/formatter 和 nullable inclusion。
