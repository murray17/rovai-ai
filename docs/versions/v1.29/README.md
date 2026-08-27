---
document_type: version-overview
version: v1.29
lifecycle: historical
authority: version-scope-and-status
design_status: confirmed
implementation_status: completed
model_context_change: false
last_updated: 2026-08-26
---

# Rovai-ai v1.29：Camp 动态队员管理

> 当前状态：动态 Camp membership 的 Core、Desktop IPC、Renderer、自动化门禁与隔离真实 App 验收均已完成；
> 后继 Message Delivery zero-attempt cancellation hotfix 已完成实现与自动化验证，不替换当前 App。

前置版本：[v1.28 Grok Build + MiniMax M3](../v1.28/README.md)已按冻结时事实转为 historical。

## 版本目标

允许用户在已创建的 Camp 中继续增加或移除队员，同时保证成员关系变化不会复活旧 Run、Delivery、Gather
或业务工具授权。新增只影响之后冻结的 AgentRun；移除以原子 cutover 立即停止新业务效果，再由持久
reconciliation 完成已接受工作的正式结算。

## 交付范围

- Migration 110 建立 `v1.23 / projection schema 64`，增加 Camp membership generation、membership
  reconciliation、外部来源绑定和 Delivery admission membership version；旧非终态技术工作 clean break；
- Migration 111 将当前 Data Contract 升为 `v1.24 / projection schema 65`，只放宽 Message Delivery 的零 attempt
  cancelled terminal；显式/批量取消共用同一转换，迟到 projection completion 和 restart 不能复活终态；
- 新增 `camps.members.add`、`camps.members.removalPreview`、`camps.members.remove` Desktop API；增加使用
  exact membership generation/version 的添加、预览和移除命令；
- 添加不创建 Conversation，也不修改已冻结 AgentRun 的 Collaboration State；曾离开的 Agent 再次添加仍是一次
  普通“添加队员”，产品不暴露 rejoined 状态；对 active member（包括 away）的相同 overrides 为 no-op，不同
  overrides 返回 capability conflict，不由 add 静默修改能力或旋转 lifetime；受信 source 的 accepted no-op
  正常推进自身 reconciliation generation；
- Camp 始终至少保留一位 active member。移除 Default Lead 时优先使用有效 successor；若剩余成员全部暂离，
  允许暂时没有 Lead，待有人归队后由既有 reconciliation 恢复。非 Lead 不接受无意义的 replacement；
- 移除在同一提交中结束 membership、推进 generation、切换 Lead、取消目标 Run/Gather/Delivery 并释放未终态
  Task；普通 pending outbound A2A 同步终态化，已 materialized 下游 Run 纳入持久 reconciliation，后者只通过
  正式 Run/Delivery terminal settlement 推进；
- 每个 Agent 业务工具都绑定 exact Run membership version；Delivery 和 Gather completion 冻结接收者/发起者
  membership version，普通 outbound Delivery 另校验 source Run lifetime。离开后重新添加得到新的 membership
  lifetime，不会恢复旧授权；
- 旧 Run 的冻结 peers 不是 strict target roster；其新 send 可寻址后来加入的当前 active member，但 accepted
  Delivery 不能越过 source membership cutover；
- 普通公开输出与 Missing-Send Recovery 统一经过 publication fence；窄 terminal evidence 可以结算旧工作，
  但不能在离队后发布内容；
- 外部成员同步仅是提示：只有 System allowlist、已绑定的 source namespace/binding 和严格递增的 reconciliation
  generation 可以提交正式领域命令；
- Camp 会话“当前会话”区域增加添加入口；成员行只保留一个 `•••` 菜单，收纳模型信息展开与移除。最后一位
  成员的移除操作可见但禁用，并解释“Camp 至少需要一位队员”；
- 移除确认先读取权威影响预览，展示 Run、Task、Delivery、Gather 影响；冲突可刷新重试，正在 reconciliation
  的成员在会话区显示非阻塞状态。

## 模型上下文边界

`Collaboration State` 保持 schema v2，既有选择与冻结规则不变。每个新 AgentRun 在冻结时读取当下 active peers；已冻结 Run 不被原位
补丁修改。模型不会收到 `rosterVersion`、membership generation、成员变化 delta 或“某某本轮已离队”之类
额外叙事，授权与对账状态只属于 Core。因此本版本没有 Formatter/Profile/Manifest 或模型输入合同变更；
只是既有 v2 投影开始消费用户新近改变的权威成员数据。

## 验收

验收状态由[实施计划](implementation-plan.md)维护。交付必须覆盖 add/remove 幂等和冲突、最后成员、Lead
替换、所有业务工具 exact-run fence、Delivery/Gather/terminal publication、Migration clean break、双主题与键盘
交互，以及从 current-main Migration 110 数据库执行 Migration 111 的零 attempt 取消与重启幂等回归。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | 本概览、[实施计划](implementation-plan.md)、[决定](decisions.md)与[版本索引](../README.md)共同切换 `current_version`。 |
| Decisions | 已更新 | [v1.29 决定](decisions.md)冻结 cutover/reconciliation、exact membership lifetime、稳定模型投影、受信外部来源边界及零 attempt 取消的独立后继迁移。 |
| Contracts | 已更新 | 新增 [Camp Membership v1](../../contracts/camp-membership-v1.md)，并升级 [Camp Open Projection v7](../../contracts/camp-open-projection-v7.md)、[Message Delivery v7](../../contracts/message-delivery-v7.md)、[Gather v4](../../contracts/gather-v4.md)及[Missing-Send Recovery Publication v2](../../contracts/missing-send-recovery-publication-v2.md)。 |
| Architecture | 已更新 | 新增[动态 Camp 队员关系](../../architecture/dynamic-camp-membership.md)，并同步 Camp open、A2A、Gather、Built-in 与基础不变量。 |
| UI | 已更新 | [Camp 会话工作区](../../ui/components/conversation-workspace.md)冻结添加入口、成员菜单、移除预览、最后成员和 reconciliation 状态。 |
| Runtime Activity | 确认无需更新 | 成员变化使用 Core 领域事件与既有 Run/Delivery terminal activity，不新增 Runtime activity kind。 |
| Runtime compatibility | 确认无需更新 | 不改变 Adapter、Runtime 启动协议、模型或宿主平台资格。 |
| Documentation routing | 已更新 | [文档导航](../../README.md)、Contracts、Architecture 与 Decisions 当前入口均加入动态 membership 路由。 |
| Root README | 确认无需更新 | 本次扩展既有 Camp 管理能力，不改变项目定位或长期支持声明。 |
