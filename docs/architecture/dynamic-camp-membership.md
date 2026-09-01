---
document_type: architecture
architecture: dynamic-camp-membership
authority: dynamic-camp-membership-component-boundaries
status: accepted
last_updated: 2026-09-01
---

# 动态 Camp 队员关系架构

字段级合同见 [Camp Membership v2](../contracts/camp-membership-v2.md)，决定理由见
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
          ├─ run + delivery + gather terminal settlement
          └─ completed reconciliation audit
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

Cutover transaction 先验证 expected generation/version，再结束关系、保证至少一位成员并完成必要 Lead 替换。
直接复用 affected deliveries/run IDs 两个 selector：成员自身 lifetime 的 Run、收件 Delivery、它发起的 Gather、
普通公开 A2A 来源 Delivery 及已物化的目标 Run；不递归扩张。未物化 Delivery 保留既有原因码，已物化 Delivery
经目标 Run settlement 收口，开放 Task 恢复 pending/unassigned，Gather/item 按现有逻辑取消。

每个 affected Run 直接调用统一终态 helper，只重算 affected Turns；reconciliation 的 target/settled 计数相等，
status/completed_at 同事务完成。Runtime 后台清理与审计无关。同轮无关 Run 继续，ChannelTurnRequest 保持
admitted 直到 Turn 真正终态且正常 Outbox 完成；成员移除不调用 whole-Turn abort 或渠道整轮关闭。

## 外部同步

外部 roster 事件只是命令来源提示。System adapter 先证明 allowlisted component、Camp-bound namespace/binding
和 exact next reconciliation generation，再进入同一 add/remove transaction。来源水位与领域效果原子提交；
事件乱序、重放、跳代或错 namespace 都不会改变成员关系。

## Read side 与 Renderer

[Camp Open Projection v14](../contracts/camp-open-projection-v14.md)投影当前 generation、成员 version 与历史尚未完成的
reconciliation；新 cutover 已同事务完成，不产生持续收口等待。Renderer 使用权威 removal preview 解释影响，以 exact values 提交；成功后重读 Camp，不在本地
模拟关系。最后成员操作保持可发现但禁用，添加候选来自当前存在且不在 active set 的 AgentProfile。
