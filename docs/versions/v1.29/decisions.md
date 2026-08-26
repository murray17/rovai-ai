---
document_type: version-decisions
version: v1.29
lifecycle: current
last_updated: 2026-08-26
---

# v1.29 决策记录

本文件只记录本版本满足准入门槛的重要取舍；当前行为规范由链接的 Architecture 与 Contract 拥有。

<a id="v1-29-d01"></a>
## V1.29-D01：移除采用原子 cutover 与持久 reconciliation 两阶段协议

### 背景

成员移除会同时碰到 Run、Delivery、Gather、Task 和 Default Lead。把全部 Runtime 中断与终态结算塞进一个
SQLite 事务既不真实，也会让长耗时外部效果阻塞权威写入；只做最终一致又会在窗口期继续接受离队成员的业务效果。

### 决定

移除命令以 membership generation/version CAS 原子结束关系、切换必要的 Lead、写取消意图、终结尚未分派的
工作并释放 Task。事务提交即形成 cutover。仍需 Runtime/Delivery terminal settlement 的工作写入持久
reconciliation，由正式终态路径推进，UI 只展示其进度。

当前规范见[动态 Camp 队员关系](../../architecture/dynamic-camp-membership.md)和
[Camp Membership v1](../../contracts/camp-membership-v1.md)。

### 后果

- “已离队”不再依赖外部进程是否已经退出；
- 终态证据可以继续收口，但不能越过 publication fence 产生新公开效果；
- 崩溃重启后 reconciliation 可从持久状态继续，而不是猜测移除是否完成。

### 被拒绝方案

- **一个事务宣称所有取消完成：** SQLite 提交不能证明 Runtime 与外部效果已终止；
- **先后台取消、最后才结束 membership：** 窗口期会继续授权业务写入。

<a id="v1-29-d02"></a>
## V1.29-D02：授权绑定 membership lifetime，不允许离开后再次添加复活旧工作

### 背景

仅检查 `actor_can_write_camp` 或当前 active membership，会让同一个 Agent 在离开后再次添加时重新满足旧
Run/Delivery 的条件。Agent ID 相同不代表旧 membership lifetime 仍有效。

### 决定

Camp 使用单调 membership generation，每段成员关系使用单调 version。AgentRun、每项 Agent 业务工具、
Delivery admission、Gather initiator/completion 与普通 publication 必须匹配冻结的 exact membership version。
普通 outbound Delivery 的 dispatch/retry 还必须匹配 source Run 的 exact membership lifetime；source 离开时，
pending Delivery 在 cutover 中终态化，已 materialized 下游 Run 纳入 reconciliation。终态 evidence 使用独立窄
授权，只能结算既有责任，不能恢复业务工具或公开发布。Active member 的 add 只有相同 capability overrides
可以 no-op；不同 overrides 必须 conflict，能力变更不能借 add 绕过 lifetime 收口。

当前规范见 [Camp Membership v1](../../contracts/camp-membership-v1.md)、
[Message Delivery v6](../../contracts/message-delivery-v6.md)、[Gather v4](../../contracts/gather-v4.md)和
[Missing-Send Recovery Publication v2](../../contracts/missing-send-recovery-publication-v2.md)。

### 后果

- 再次添加在产品上仍是普通添加，但在授权上是新的 lifetime；
- 所有 Agent 业务工具共用统一 exact-run fence，不依赖各 handler 自行记得补检查；
- 已接受的普通 outbound A2A 不能在 source lifetime 结束后新建或重试下游 Run；
- Missing-Send 和普通公开输出不会成为绕过离队 cutover 的旁路。

### 被拒绝方案

- **只检查当前 active：** 旧工作会在再次添加后复活；
- **只给 send 加 fence：** Task、Memory、History 或其他业务工具仍可越权。

<a id="v1-29-d03"></a>
## V1.29-D03：Collaboration State 保持 v2，只在新 Run 冻结当前 peers

### 背景

动态名册需要让未来 Run 看见新队员，但没有必要把内部 generation、reconciliation 或变更叙事暴露给模型。
原位修改已开始 Run 的 System Context 也不可复现。

### 决定

每个新 AgentRun 在 Context 冻结时读取当前 active CampMember 集合，继续生成 Collaboration State v2。已冻结
Run 不打补丁；不新增 `rosterVersion`、membership delta 或“某成员本轮离队”字段。内部 version 只用于 Core
授权与证据。Send target admission 独立读取当时的当前 active 名册，不受 source Run frozen peer projection 限制；
因此旧 Run 可以联系后来加入的成员，同时仍受自己的 exact source membership lifetime fence 约束。

### 后果

- 后续 Run 自然得到新 peers，当前 Run 维持可复现字节；
- 旧 Run 不需要等待下一 Run 才能寻址后来加入的当前成员；
- 模型上下文没有与业务无关的动态状态噪声；
- 本版本不改变模型上下文选择、Formatter 或 wire；变化仅来自用户在 Run 前更新了既有选择所读取的领域数据。

### 被拒绝方案

- **给旧 Session 广播 roster delta：** 会产生不可重放的中途 System 状态；
- **把 frozen peers 当成 strict target roster：** 会把模型可见快照误作 send admission 权威，并阻止已确认的当前成员寻址；
- **向模型暴露 generation：** 它不是模型决策所需能力，也不是授权 token。

<a id="v1-29-d04"></a>
## V1.29-D04：外部成员事件只作受信提示，Core 命令仍是唯一权威

### 背景

未来 channel 或外部 roster 同步可能乱序、重放或来自错误租户。直接把“加入/离开”事件视为授权会扩大 System
写入面，并使同名来源互相污染。

### 决定

外部提示只有在 System component 位于 allowlist、Camp 已绑定 exact source namespace/binding，且 source
reconciliation generation 恰为上一代加一时才能进入同一正式 add/remove 命令。失败不推进来源水位，也不改变
Camp membership。Renderer/User 路径不携带 source authority。

### 后果

- 重放、跳代、错绑定和未知组件 fail closed；
- 外部同步复用正式 cutover、版本 CAS 与审计，不形成第二套写模型；
- source binding 是内部集成 seam，不是 Agent 或普通 Desktop API。

### 被拒绝方案

- **按事件到达顺序直接写名册：** 网络顺序不能证明领域顺序；
- **只校验一个全局来源名：** 不足以隔离 Camp/租户绑定与 reconciliation generation。
