---
document_type: protocol-contract
contract: camp-membership-v1
authority: dynamic-camp-membership-lifecycle
status: accepted
version: 1
last_updated: 2026-08-26
---

# Camp Membership v1 Contract

本合同拥有 Camp 创建后的队员添加、移除、预览、generation、membership lifetime、外部来源和对账语义。

## 1. 状态与不变量

- `Camp.membershipGeneration >= 1`，每次真实成员集合变化恰好加一；幂等 no-op 不推进；
- 每个 Agent 在一个 Camp 只有一行 `CampMember`。再次添加 left 行会把它变为 active、推进该行 `version`，
  产品界面仍只称“邀请队员”，不暴露 rejoined 状态；
- Camp 始终至少一位 active member；Default Lead 若存在必须是 active member；
- add 不创建 Conversation、CampTurn 或 AgentRun。只有以后新接受的执行按当时 active 名册冻结 Context。

## 2. Desktop 命令

```ts
type AddCampMemberCommand = {
  campId: string
  agentId: string
  expectedMembershipGeneration: number
  capabilityOverrides?: Record<string, unknown>
}

type RemoveCampMemberCommand = {
  campId: string
  agentId: string
  expectedMembershipGeneration: number
  expectedMembershipVersion: number
  replacementDefaultLeadAgentId?: string | null
  reason?: string | null
}
```

`camps.members.add` 与 `camps.members.remove` 是 User-authorized typed Desktop mutation。add 对同一 active member
且相同 `capabilityOverrides` 为成功 no-op；若 overrides 不同则拒绝为 `camp.member_capability_conflict`，不得推进
membership version/generation、发出 added event 或使既有 Run 失效。能力修改属于未来独立的 version-qualified
命令，不由 add 兼任。该 active-member 分支独立于 Member Presence：`away` 仍按相同规则 no-op/conflict；只有
left/不存在的真实添加要求 Profile 为 `present`。受信 source 的 accepted no-op 只推进 source reconciliation
generation，不推进 Camp/member version。generation/version 冲突必须拒绝并要求重读。移除 Default Lead 时，
若仍有 `present` 的 active member，必须使用 preview 给出的有效 successor；若剩余 current members 全部暂离，
则允许 successor 为 null，并由既有 Default Lead reconciliation 在有人归队后恢复。移除非 Lead 时不得携带
replacement。

`camps.members.removalPreview(campId, agentId)` 返回：

```ts
type CampMemberRemovalPreview = {
  campId: string
  agentId: string
  displayName: string
  membershipGeneration: number
  membershipVersion: number
  isDefaultLead: boolean
  nextDefaultLeadAgentId: string | null
  nonTerminalAgentRunCount: number
  openAssignedTaskCount: number
  pendingDeliveryCount: number
  runningDeliveryCount: number
  openGatherItemCount: number
  removable: boolean
  blockerCode: 'camp.member_not_active' | 'camp.last_member_required' | null
}
```

Preview 是只读影响说明，不是授权；remove 必须提交 preview 返回的 exact generation/version，并在事务内重做
全部验证。Run 与 Delivery 计数同时包含目标成员自己的工作，以及其当前 membership lifetime 已接受的普通
outbound A2A 和已 materialized 下游 Run。Renderer 遇到冲突只能刷新权威 preview 后让用户重试。

## 3. Cutover 与 reconciliation

成功 remove 在一个提交中结束 membership、推进 generation/version、必要时切换 Default Lead、释放成员的
非终态 Task、取消尚未结算的 Run/Gather/Delivery，并创建需要后续 terminal settlement 的 reconciliation。
该 lifetime 已接受但尚未 materialize 的普通 outbound A2A 在提交内终态化；已经 materialized 的下游 Run 与成员
自己的非终态 Run 一起写入 reconciliation 并请求取消。提交即是业务 cutover：旧 lifetime 不得再产生业务写入、
公开输出或新的下游 Run。

Read side 只投影 `status = reconciling` 的活动项：

```ts
type CampMembershipReconciliationView = {
  id: string
  agentId: string
  membershipVersion: number
  status: 'reconciling'
  reasonCode: string
  targetRunCount: number
  settledRunCount: number
  createdAt: string
  updatedAt: string
}
```

正式 Run/Delivery terminal settlement 推进计数；达到目标后该项从活动投影消失。再次添加不能关闭、重绑定或
复活旧 reconciliation 的工作。

## 4. Exact lifetime fence

每个 AgentRun 冻结创建时的 membership version。所有 Agent 业务工具在 invocation 时必须同时验证 current
Run/lease/binding 与 exact active membership version。Delivery 和 Gather 的附加规则分别由
[Message Delivery v7](message-delivery-v7.md)与[Gather v4](gather-v4.md)拥有。终态 evidence 可以使用只允许
settlement 的窄路径；普通与自动 publication 仍必须匹配 exact lifetime。

目标寻址与 source lifetime 是两条独立规则：旧 Run 的 Context 不补丁，但其新 send 可按 admission 时的当前
active 名册联系后来加入的成员；send 已接受后，普通 outbound Delivery 的 materialization/retry 仍必须匹配
source Run 冻结的原 membership version。

## 5. 外部来源

System source 是 `{namespace, bindingId, reconciliationGeneration}`。只有 Core allowlist 内组件、Camp 内预先
绑定的 exact namespace/binding，以及严格等于上一 source generation 加一的输入可提交。验证与领域命令在
同一事务；失败或 no-op 也按正式结果处理，来源水位只随被接受的下一代推进。普通 User/Desktop 命令没有
source 字段；Agent built-in 不提供名册 mutation。

## References

- [动态 Camp 队员关系](../architecture/dynamic-camp-membership.md)
- [Collaboration State v2](collaboration-state-v2.md)
- [v1.29 决策记录](../versions/v1.29/decisions.md)
