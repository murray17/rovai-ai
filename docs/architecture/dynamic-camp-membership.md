---
document_type: architecture
architecture: dynamic-camp-membership
authority: dynamic-camp-membership-component-boundaries
status: accepted
last_updated: 2026-08-26
---

# 动态 Camp 队员关系架构

字段级合同见 [Camp Membership v1](../contracts/camp-membership-v1.md)，决定理由见
[v1.29 决策记录](../versions/v1.29/decisions.md)。

## 权威模型

```text
User Desktop command / trusted System hint
                 │
                 ▼
       Membership command transaction
       ├─ generation + member-version CAS
       ├─ add ordinary active lifetime
       └─ remove atomic cutover
          ├─ lead switch / task release
          ├─ run + delivery + gather cancellation intent
          └─ durable reconciliation
                         │
                         ▼
             formal terminal settlement
```

Camp 聚合拥有 active set、membership generation 和 Default Lead；CampMember 行拥有一个 Agent 在该 Camp 的
关系历史与单调 version。AgentProfile Presence 是独立轴。Renderer、外部 channel 和 Runtime 都不能直接改表或
从可见行推导授权。

## 添加与 Context

添加命令只改变成员集合和 generation。它不预建 Conversation、Run 或私有 Session。Scheduler/Context builder
在以后新接受的 Run 上读取当时 active members，并继续产生 Collaboration State v2；旧 Run 保持原冻结 bytes。
曾离开的 Agent 再次添加会获得同一 CampMember 行的新 version，但产品语义仍是普通添加。对已经 active 的成员，
相同 capability overrides 是 no-op，不同 overrides 是显式 conflict；add 不兼任能力更新或 lifetime rotation。

Context freeze 不等于 target roster freeze。仍属于当前 membership lifetime 的旧 Run 可以在新的 send admission 中
寻址后来加入的 active member；目标是否合法始终由该次 send 的当前名册决定，旧 Context 不因此原位变化。

## 移除与收口

Cutover transaction 先用 expected generation/version 防止 stale UI，然后结束关系、保证至少一位成员并完成
必要 Lead 替换。所有未终态 Task 释放为 pending/unassigned；未分派责任在事务内终结；在途 Runtime 工作写入
取消请求并进入 reconciliation。该 lifetime 尚未 materialize 的普通 outbound A2A 同时终态化，已 materialized
的下游 Run 纳入 reconciliation。提交后所有 Agent 业务工具、普通 outbound Delivery materialization/retry 和
publication 都按旧 exact membership version fail closed。

Reconciliation 不拥有第二套取消动作；它只聚合正式 Run/Delivery/Gather terminal settlement。窄 terminal
authority 可以报告可靠终态与外部效果不确定性，但不能调用业务工具或发布消息。这样 UI 可诚实显示“正在收口”
而不把 SQLite 提交冒充 Runtime 已停止。

## 外部同步

外部 roster 事件只是命令来源提示。System adapter 先证明 allowlisted component、Camp-bound namespace/binding
和 exact next reconciliation generation，再进入同一 add/remove transaction。来源水位与领域效果原子提交；
事件乱序、重放、跳代或错 namespace 都不会改变成员关系。

## Read side 与 Renderer

[Camp Open Projection v7](../contracts/camp-open-projection-v7.md)投影当前 generation、成员 version 与 active
reconciliation。Renderer 使用权威 removal preview 解释影响，以 exact values 提交；成功后重读 Camp，不在本地
模拟关系。最后成员操作保持可发现但禁用，添加候选来自当前存在且不在 active set 的 AgentProfile。
