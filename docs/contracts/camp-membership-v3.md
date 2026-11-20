---
document_type: protocol-contract
contract: camp-membership-v3
authority: empty-camp-membership-and-removal
status: accepted
version: 3
source_version: v1.72
last_updated: 2026-10-13
---

# Camp Membership v3

继承 [v2](camp-membership-v2.md) 的命令权限、generation/version CAS、来源验证、定向事务结算与
exact lifetime fence。本版允许已存在的 Thread 没有 active member，取消最后一位成员保护；
不改变显式创建 Dialog 的初始队伍校验或 Pending 首条消息的原子邀请协议。

显式更换队长使用 `threads.changeDefaultLead({ threadId, successorAgentId })`。Core 在同一事务内校验
`camp.default_lead.change` 权限，以及继任者仍为活跃、在场且未申请离开的成员。成功后递增 Thread 版本，
多个有效选择以最后一次提交为准。添加或移出成员继续使用各自的 generation/version 校验。

## 空会话与接收者

- 最后一位队员离开后 Thread 保持原 ID、工作区、active 状态与公开历史，不自动删除或改成 Pending。
- Default Lead 为 null，不创建系统队员，不把输入转交会话外队员。全体暂离同样没有可接收者，
  但仍保留各自 membership，与零成员状态分别投影。
- 原 membership 的开放 Task 在同一事务释放为 pending/unassigned；已结束 Task、消息、身份、
  Run 和审计保留。未来加入不自动分配任务、发送草稿或重启旧工作。
- 添加首位 present 队员时，现有 add 事务将其设为 Default Lead；按顺序批量邀请仍逐人 CAS。
- Default/broadcast 执行请求没有可接收者时拒绝 `camp_message.no_addressable_member`，不发布
  该输入或建立 Delivery。显式提及只按当前资格验证，不能回退到另一人；无执行的公开记录语义保持。
- Renderer 保留本地正文、引用与附件。无可接收者且没有有效待邀请 Atom 时禁止发送，提供邀请/管理
  入口。Active 的“邀请并发送”继续复用 add-then-send；添加失败或发送失败均保留输入。
- 已有回复/延续接收者失效时继续要求显式修复，加入新人不能静默改投。

## 当前会话移出预览

`ThreadMemberRemovalPreview` 增加 `remainingMemberCount: number`，由 Core 计算排除目标后的有效
current membership 数量，包含暂离成员。`removable` 仅因目标关系已非 active 而为 false，
`blockerCode` 收窄为 `camp.member_not_active | null`；`camp.last_member_required` 退出。

移除仍提交 preview 的 exact generation/version。有效 successor 保持当前顺序规则；无 successor
时允许 null。最后一位暂离队员也可移出。所有入口共用原 membership-ending 事务和结算路径。

## 永久移除预览与提交

`MemberRemovalPreview` 保留 existing count、profile version 和 name 字段，增加：

```ts
affectedThreads: Array<{
  threadId: string
  title: string
  remainingMemberCount: number
  wasDefaultLead: boolean
  nextDefaultLeadAgentId: string | null
  nextDefaultLeadDisplayName: string | null
}>
```

`currentThreadMembershipCount`、`defaultLeadThreadCount`、`soleMemberThreadCount` 与影响列表一致。
`soleMemberThreadCount` 表示会变空的会话数量，不是删除阻止条件。`removable` 只取决于当前非终态
AgentRun 数量；`agent_profile.sole_camp_member` 退出。执行中的永久移除仍拒绝
`agent_profile.non_terminal_runs`，名称必须精确匹配，Profile version 必须一致。

Preview 是读取时影响说明，不预留 membership，也不新增跨会话锁。提交在原事务中重验 Profile、
名称、执行状态，并结束提交时全部 active membership；任一步失败全部回滚。
界面展示将变空的会话、队长交接及任务释放。阻止或提交失败时保留确认输入，并可重新读取影响；
重新读取发现姓名变化则清空名称确认，要求按新名称确认。

本版无数据库迁移、无模型 Context 字段/模板变化；现有 nullable Lead 与历史关系行承载全部状态。
