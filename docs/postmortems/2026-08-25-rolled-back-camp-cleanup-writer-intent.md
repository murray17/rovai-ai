---
document_type: postmortem
incident_id: INC-2026-08-25-CAMP-CLEANUP-WRITER-INTENT
incident_date: 2026-08-25
status: closed
systems:
  - camp-attachment-publication
  - camp-attachment-view-recovery
  - agent-run-admission
  - agent-run-scheduler
  - pending-camp-lifecycle
  - macos-packaged-app
last_updated: 2026-08-26
---

# 已回滚的 Camp 清理写入意图阻断 AgentRun 准入

> **爱丽丝的小结：** View 明明已经 `ready`，门却还是不开；不是附件有问题，而是一条已回滚
> cleanup 仍挂着 `unresolved` writer intent。Gate fail closed 没错，错在终态的两个轴没有一起
> 结清。补丁不该拆门，只要精确结清旧账，并让以后每次取消都原子落账。

## 摘要

2026-08-25，一个 AgentRun 从 17:20 起始终保持 `queued`，其 CampTurn 则一直为 `running`。
它没有 lease、`startedAt`、failure 或投影出的 wait reason；对应 Member 与 Runtime 已 ready，
也没有其他非终态 Run 占用容量。Scheduler 日志快照包含 607 次失败 claim，错误均为
`camp_attachment_view_not_ready`。随后在一个没有附件的第二个 Camp 中，使用新的 pre-claim
verification 路径复现时，Run 在 Runtime 启动前以公开错误
`camp_attachment_view_unavailable` 失败，不再无限排队。

两个表现来自同一个阻断：这些 Camp 的 Published Attachment View 均为 `ready`，但 journal
中保留了一条已取消的 `camp_delete_cleanup` operation，处于自相矛盾的终态
`status = rolled_back, resolution_state = unresolved`。

准入 predicate 把每一条 unresolved journal row 都视为活跃 publication writer intent，没有
考虑 operation kind 或终态 status。即使没有需要完成的 publication、没有非终态 operation、
甚至没有任何附件，它仍会拒绝整个 Camp。只读扫描发现，两个 live Camp 具有这一精确旧状态，
而没有 live Camp 存在真正非终态的 unresolved operation。

旧状态的产生，是因为统一 publication lifecycle 增加了 resolution 轴，而原有 Camp cleanup
cancellation 路径仍只结算 status 轴。当天早些时候合并的 attachment-local degradation 修复
没有创建 cleanup row；它只是通过 pre-claim verification 把潜伏症状从无限 queued Run 变成
明确终态失败，从而暴露了既有生命周期缺陷。

事故最终通过以下方式解决：把已取消 cleanup operation 的 `resolution_state` 结算为 `failed`；
在 startup reconciliation 中只修复这一历史终态形态；并把 cleanup 回归测试扩展到真实的
writer-intent 准入 predicate。修复由 [PR #59](https://github.com/murray17/rovai-ai/pull/59)
合并。受影响数据库保留 Camp、message、attachment、AgentRun 与 audit record。最初受阻的
Run 从未取得 lease，后来失败的 Run 则在向 Runtime 交付输入前停止。

本复盘不归咎个人。Cleanup cancellation 与 publication resolution 最初作为两个独立生命周期
关注点开发，共享准入 seam 上没有表达跨轴不变量。本文旨在明确这一系统缺口及其复发判据。

## 事故元数据

| 字段 | 值 |
|---|---|
| 发现方式 | 用户先报告一个无限排队的 Camp；随后在 attachment-local degradation 构建中确认复现，同一阻断以明确失败出现 |
| 受影响路径 | AgentRun claim 前的 Camp Published Attachment View reconciliation |
| 触发条件 | 一条已取消的 `camp_delete_cleanup` row 保持 `rolled_back / unresolved` |
| 用户可见症状 | 旧 dispatch 路径：Run 无 wait reason 地保持 queued；新 pre-claim 路径：Run 以 `camp_attachment_view_unavailable` 失败；两者均无模型输出 |
| 直接受影响范围 | 已诊断数据库中有两个 live Camp 匹配这一精确旧终态 |
| Runtime 交付 | queued Run 从未取得 lease；后来 failed Run 没有 Runtime input delivery 证据 |
| 数据完整性 | SQLite `quick_check` 通过；安装新 package 前后持久实体计数不变 |
| 解决方案 | Commit [`f1b0bb8`](https://github.com/murray17/rovai-ai/commit/f1b0bb8a541c1abda05ccf1ad0d79deb6bd62f0f) 完成生命周期结算与精确形态 startup repair，并以 [`67a51df`](https://github.com/murray17/rovai-ai/commit/67a51df29c581e5ece27c87737612ef48042c707) 合并 |
| 事故持续时间 | 未计算；第一次用户可见失败和 daily App 恢复验证时间未作为结构化事故数据保留 |

## 影响

最初的 AgentRun 无法越过 queue/admission 边界，因此用户请求没有执行，CampTurn 看似活跃却
没有进展。Scheduler 对同一 candidate 反复重试，却没有持久化 wait 或 terminal reason。在新
打包的 attachment-degradation 构建上重试，则会产生明确终态失败；直到单独的 cleanup lifecycle
修复安装并由 startup reconciliation 结算历史 row，问题才消失。

诊断时，恰有两个 live Camp 存在 `rolled_back / unresolved` 的 `camp_delete_cleanup` operation。
两个 View 都是 `ready`；报告中的 Camp 没有 View entry，也没有 message attachment。最小化
数据库检查返回：

```text
不区分 kind 的 unresolved writer intent：true
非终态 unresolved operation：             false
unresolved publication operation：          false
```

这证明观测到的拒绝范围大于真实风险：gate 因终态 cleanup 记账不一致而拒绝整个 Camp，而不是
在保护进行中的 publication 或未验证附件字节。

恢复过程中没有删除 Camp、CampMessage、attachment、AgentRun、event-log 或 audit row。Failed
Run 没有到达 Runtime input delivery，因此无需协调重复或不确定的外部执行。也没有进行数据库
downgrade；downgrade 不会修复矛盾 operation state，反而可能丢弃较新的派生 projection。

## 发现与响应

用户首先从始终 queued 的 Camp 发现事故。Run projection 没有 lease、`startedAt`、failure 或
wait reason；进程日志则显示 607 次 `camp_attachment_view_not_ready` claim 失败。Member 与
Runtime 均 ready、此前 Run 成功、也没有其他非终态 Run，这排除了容量与 Runtime readiness。

确认复现发生在重启包含最新 attachment-local degradation 修复的 package 后。为排除旧 Core，
先核对构建来源：运行中二进制具有预期的新 Mach-O identity。随后只读检查 Camp View 与
attachment row，发现 View 为 `ready`、entry 为零，也不存在可产生 digest failure 的附件来源。

最新 AgentRun private detail 把拒绝缩小到 `camp_attachment_view_not_ready`。对比宽泛准入
predicate 与两个缩减 predicate 后，只剩一条旧 cleanup operation。数据库范围的只读扫描又
发现另一个 Camp 具有相同终态形态，且没有对应的非终态 unresolved operation。

响应过程有意不删除 journal row，也不手工修改 daily database。修复在正常 startup reconciler
中实现，针对模拟历史 row 测试，经 CI 合并后进入全新 package。这样既保留 journal 证据，又
让每个受影响安装使用相同且确定性的恢复路径。

## 时间线

所有时间均为 Asia/Shanghai。下列数据库 event 时间由持久 UTC 时间戳转换；未保留为结构化
证据的时间保持不精确。

| 时间 | 事件 |
|---|---|
| 2026-08-20 18:59 | Commit [`99df95b`](https://github.com/murray17/rovai-ai/commit/99df95b75c4a6fa8eda82f9cf254cdaf8ba679b2) 统一 attachment publication 与 Agent file delivery。Migration 102 增加默认值为 `unresolved` 的 `resolution_state`，但 cleanup cancellation 仍只更新 `status`。 |
| 2026-08-25 17:13:05.778 | 两个后来观测到的 live Camp 中，第一个把已取消 cleanup 记录为 `rolled_back / unresolved`；其 View 回到 `ready`。 |
| 2026-08-25 17:20:06.601 | 同一 Camp 中后续 AgentRun 进入 `queued`。它从未取得 lease 或 `startedAt`；抽样日志累计 607 次 `camp_attachment_view_not_ready` 拒绝。 |
| 2026-08-25 17:21 | 报告中的 Camp 记录同一旧 cleanup 形态；其 View 回到 `ready` 并保持空。 |
| 2026-08-25 17:33 | [PR #58](https://github.com/murray17/rovai-ai/pull/58) 合并 attachment-local degradation 与 pre-claim verification，没有改变 cleanup cancellation 结算。 |
| 2026-08-25 17:44 | 来自 PR #58 的新打包 Core 用 daily data directory 启动。 |
| 2026-08-25 17:47 | 报告 Camp 中的新 AgentRun 先 queued，随后以 `camp_attachment_view_unavailable` 失败；没有 Runtime input 被交付。 |
| 2026-08-25，失败后不久 | 只读 predicate 最小化证明，持有 gate 的只是终态 cleanup row，而非 publication、attachment 或非终态 operation。全库扫描发现两个受影响 Camp。 |
| 2026-08-25 17:47 | [PR #59](https://github.com/murray17/rovai-ai/pull/59) 开启，包含原子 cleanup 结算、startup repair 与回归覆盖。 |
| 2026-08-25 17:52 | PR #59 在 Rust test、format/Clippy、database smoke、Windows compile 与文档治理检查通过后合并。 |
| 2026-08-25，合并后 | 从合并后 `main` 构建的 package 通过签名/构建 identity 与隔离启动 smoke。安装过程未修改 daily database；恢复将在下一次 canonical App 启动时运行。 |

## 技术根因

Journal 有两个不同目的的生命周期轴：

```text
status：           物理 cleanup 工作是否仍活跃？
resolution_state：该 row 是否仍持有语义 writer intent？
```

取消 Camp deletion 时，cleanup 正确恢复先前 View state，并把 operation status 改为
`rolled_back`。但在 Migration 102 之后，同一 row 默认还有
`resolution_state = unresolved`。Cancellation transaction 没有结算新轴：

```text
camp_delete_cleanup planned / unresolved
                 |
                 | deletion 被取消
                 v
camp_delete_cleanup rolled_back / unresolved
                 |                         ^
                 | terminal status         | 遗留 writer-intent 轴
                 +-------------------------+
```

Startup recovery 有意不处理 `completed` 与 `rolled_back` operation。这对于物理 status 轴是
正确的，却使旧 resolution 轴永远得不到修复。

AgentRun admission 调用 `database_has_unresolved_writer_intent`，其查询会选择 Camp 中任何
`resolution_state = unresolved` 的 row，不限制 publication kind 或非终态 status。因此，终态
cleanup row 在 gate 看来与真实进行中的 publication 无法区分，并产生
`camp_attachment_view_not_ready`。

系统性根因，是这些 seam 之间缺少一个共同不变量：当 operation 在物理与语义生命周期都已
终结时，转换必须原子结算参与后续准入的每个轴。物理上 rolled back 的 publication 仍可能
需要语义 failure resolution，但已取消 cleanup 已没有 publication 工作。单元覆盖只证明
cancellation 把 View 恢复为 `ready`，没有跨越 scheduler 实际使用的 writer-intent predicate。

## 触发条件与发生可能性

缺陷要求运行包含 Migration 102、但不含 PR #59 的构建，并同时满足：

1. Camp 有 Published Attachment View row，因此 cleanup preparation 返回 operation；
2. Core 在 delete 或 pending-discard 业务 mutation 前准备 `camp_delete_cleanup`；
3. 业务 mutation 未应用，或 pre-mutation fence 失败，Core 因而取消 cleanup；
4. 同一 Camp 中后续 AgentRun 到达 dispatch admission。

只要 prepared cleanup 进入受影响的 cancellation function，就会确定性复发：旧 SQL 总会让
新 operation 的默认 resolution 保持 `unresolved`。实测本地 post-migration 样本中，两个
rolled-back cleanup row 均 unresolved（`2/2`）。这个很小且经过筛选的样本能确认机制，但不能
估计总体发生概率；总体频率取决于 prepared cleanup 被取消的频率。

源码检查发现一条条件概率较高的常规路径。`CampWorkspace` 的 draft cleanup effect 只依赖
Camp ID，却捕获 snapshot 的 `activationState`。Pending Camp 的第一条 accepted message 会激活
同一 Camp ID，effect 不会仅因 activation 改变而重建。之后带空 draft 离开时，旧 closure 可能
请求 `camps.discardPending`；Core 正确拒绝已 active Camp，随后取消 prepared cleanup。

持久 command evidence 证实第二条观测 row 走了该路径：cleanup operation 创建后，
`camp.pending.discard` 立即返回 `camp.pending_discard_active`。第一条 row 没有对应 typed command
result，因此确切 caller 未知。Deletion blocker、Runtime fencing failure 或另一种被拒绝的
pending-discard 条件都可能到达同一 cancellation function。生命周期缺陷及其修复不依赖具体 caller。

PR #59 后，所有这些 cancellation route 都会结算 writer intent，不再产生该准入失败。现有
矛盾 row 则由 startup reconciliation 修复。

## 促成因素

### Resolution state 被加入共享 operation table

Publication resolution model 适用于多种 kind 的 row。数据库默认值使新 publication staging
安全，却也让每一条新 cleanup row 都是 unresolved，除非每条终态路径都显式结算它。

### Predicate 名称掩盖了更宽的查询语义

`has_unresolved_publication` 与 `database_has_unresolved_writer_intent` 描述的是语义
publication 概念，SQL 却匹配所有 operation kind。Reviewer 很容易从名称推断出比实际更窄的
predicate。

### Recovery 看 status，admission 看 resolution

Recovery scan 忽略终态 status；admission 则完全忽略 status。两个局部规则各自看似合理，组合后
却让矛盾 row 永久存在并持续阻断 Camp。

### 回归覆盖止于 View state

Cleanup rollback test 只断言 Camp View 回到 `ready`，没有断言 operation resolution state、执行
共享 writer-intent predicate，或尝试后续 AgentRun admission。

### Renderer lifecycle callback 可在常规操作中触发 cancellation

Pending-Camp leave callback 只按 Camp ID 绑定，因此可能比 pending-to-active transition 存活更久。
Core rejection 是正确权威边界，却让有缺陷的 cleanup-cancellation 路径更容易在日常导航中执行。

### 较早症状确实涉及附件完整性

紧邻的前一事故涉及 Authority/View digest mismatch。在修复后再次看到相同公开 Camp error，
即使新 Camp 没有附件，把它首先判断为附件回归也很合理。公开错误没有指出阻断 operation 的
kind 与 lifecycle state。

## 既有防护为何没有阻止事故

- View 回到 `ready`，因此只看 View-state 的 reconciliation 认为 cleanup rollback 已完成。
- Startup recovery 跳过 `rolled_back` row，从不检查旧的正交 resolution 字段。
- Writer-intent check 正确 fail closed，但匹配范围大于它要防护的不安全状态。
- 旧 claim path 记录意外 writer-intent error 后直接返回，没有持久 wait 或 terminal result，反复
  安全拒绝因此表现为无限 queue。
- PR #58 正确把 verification 移到 Run claim 前并增加 attachment-local repair；没有这项生命周期
  缺陷证据，它没有理由改写无关的终态 cleanup row。
- CI 分别覆盖 cleanup rollback 与 publication resolution，没有覆盖完整序列“取消 cleanup，随后
  准入未来 Run”。
- 没有自动不变量或诊断报告仍持有 unresolved writer intent 的终态 operation。

## 不属于根因的事项

- 报告中的 Camp 没有 attachment entry，因此 Agent/user attachment 与 attachment digest 均未导致失败。
- PR #58 没有创建两条旧 cleanup row；它只改变潜伏准入失败的呈现方式。
- 确认复现时 package 并不陈旧；Core 构建 identity 与被测 PR #58 构建一致。
- SQLite schema version 或数据库损坏没有导致失败。`quick_check` 通过，且矛盾 row 在当时 schema
  constraint 下是有效数据。
- 用户重试没有制造 poison state；每次重试只是确定性遇到同一持久终态 row。

## 解决与恢复

修复让新 cancellation 与历史 recovery 收敛到同一终态含义：

1. `cancel_camp_delete_cleanup` 现在会在恢复先前 View state 的同时，原子写入
   `status = rolled_back, resolution_state = failed`。
2. 扫描未完成 operation 前，startup reconciliation 只把历史精确形态
   `kind = camp_delete_cleanup AND status = rolled_back AND resolution_state = unresolved`
   更新为 `failed`。
3. Cleanup 回归测试现在同时证明 View、status 与 resolution tuple，调用真实 writer-intent
   predicate，模拟历史旧 row，运行 reconciliation，并证明 gate 已释放。
4. 变更通过 PR #59 合并并从 merge commit 打包。CI 通过 Rust fast test、database smoke、format、
   Clippy、Windows x64 compile 与文档治理。

Startup update 有意保持很窄。它不重新解释 active operation、publication row、成功 resolution
ledger、View entry、message 或 attachment Authority；只修复已经物理终态的状态，并恢复 cleanup
cancellation 原本应记录的语义结果。

## 做得好的地方

- Failed Run 在 Runtime input delivery 前停止，避免了重复或不确定的外部副作用。
- 对宽泛与最小化 predicate 的只读比较，快速把精确阻断从周边 attachment 系统中分离出来。
- 修复前先扫描影响范围，只找到两个 live Camp 中的一种精确历史形态。
- 现有 journal evidence 让系统能通过确定性 startup repair 恢复，无需删除 Camp 或手工改 daily database。
- 诊断和安装 package 前后，数据库完整性与持久实体计数保持稳定。
- 修复范围小，同时覆盖未来 transition 与历史 recovery，并在合并前通过完整 PR gate。

## 可以改进的地方

- Terminal transition helper 应按构造结算每个与准入相关的轴，不能依赖 caller 记住后续 migration 加入的字段。
- Journal rollback/cancellation 测试应结束在下一个 public seam——Run admission 或 publication eligibility——而不是局部 View state。
- Renderer leave callback 应使用当前 activation state，或在 pending Camp 不改 identity 地激活时失效。
- 意外 dispatch-check failure 应产生有界持久结果或稳定 wait reason，并配有 rate-limited diagnostic，而不是无界 stderr loop。
- Private diagnostic 应以脱敏方式标识阻断 operation kind、status 和 resolution state，避免空 Camp 最初被误诊为 attachment digest failure。
- Startup/support diagnostic 应统计终态/unresolved 矛盾 row，且不暴露 Camp ID 或用户内容。
- 应以结构化里程碑记录事故时间戳，避免事后从进程和数据库证据重建缓解与恢复时长。

## 幸运之处

- 宽泛 gate 在启动前 fail closed；虽然阻断有效工作，却没有向 Runtime 暴露未验证字节。
- 受影响 Camp 为空，因此无需查看用户内容即可排除 attachment-integrity 假设。
- 旧 row 保留精确 operation kind 与终态 status，使历史 repair 可以精确进行，而非广泛重写数据。
- 测量时只有两个 live Camp 匹配该缺陷。

## 纠正与预防措施

状态反映本复盘发布时可用的证据。任何开放事项开始前，责任角色都必须映射到具体维护者。

| ID | 措施 | 责任角色 | 优先级 | 状态 | 证据或目标 |
|---|---|---|---|---|---|
| PM-01 | 在同一事务中结算已取消 Camp cleanup 的 status 与 writer intent | Camp Attachment Lifecycle | P0 | 已完成 | [`f1b0bb8`](https://github.com/murray17/rovai-ai/commit/f1b0bb8a541c1abda05ccf1ad0d79deb6bd62f0f) |
| PM-02 | Startup admission 前只修复历史 `camp_delete_cleanup / rolled_back / unresolved` row | Camp Attachment Recovery | P0 | 已完成 | [`f1b0bb8`](https://github.com/murray17/rovai-ai/commit/f1b0bb8a541c1abda05ccf1ad0d79deb6bd62f0f) |
| PM-03 | 把 cleanup rollback 覆盖扩展到真实 writer-intent predicate 与历史 recovery | Core Testing | P0 | 已完成 | `camp_delete_cleanup_journal_rolls_back_or_recovers_from_the_business_commit` |
| PM-04 | 为每种 operation kind 与 status 增加 table-driven 生命周期矩阵，包括哪些物理终态 row 仍需语义 resolution | Core Testing | P1 | 已计划 | 目标：Camp Attachment journal invariant suite |
| PM-05 | 集中或类型化两个轴上都终态的 transition，防止 status 与 resolution 意外独立结算 | Camp Attachment Lifecycle | P1 | 已计划 | 目标：下一次 journal lifecycle 变更 |
| PM-06 | 增加脱敏 startup diagnostic，报告 terminal/unresolved 矛盾与阻断 admission 的 operation class | Core Observability | P1 | 已计划 | 目标：实现前完成 diagnostics contract review |
| PM-07 | 为本地发布事故记录结构化 detection、mitigation、package activation 与 verified recovery 里程碑 | Release Engineering | P2 | 已计划 | 目标：更新事故与本地发布清单 |
| PM-08 | 同一 Camp 激活时使 pending-Camp leave cleanup 失效或刷新，并增加 Renderer lifecycle 回归 | Camp Renderer | P1 | 已计划 | 目标：下一次 pending-Camp lifecycle 变更 |
| PM-09 | 为意外 dispatch-check failure 提供有界持久结果或稳定 wait reason，并使用 rate-limited diagnostic | Scheduler Observability | P1 | 已计划 | 目标：scheduler error-handling 设计与回归 |

## 复发判据

出现以下任一情况，即视为本事故复发：

- 已取消且 `status = rolled_back` 的 `camp_delete_cleanup` 仍使其 Camp 的
  `database_has_unresolved_writer_intent` 返回 true；
- 已取消 Camp cleanup 留下 `resolution_state = unresolved`；
- Startup reconciliation 没有修复精确历史 cleanup 形态；
- Scheduler 对同一终态-cleanup writer-intent 拒绝反复记录日志，却让 Run 在没有持久 wait 或
  failure reason 的情况下继续 queued；
- 零附件、`ready` 的 Camp 仅因终态 cleanup journal row 被拒绝；或
- Cleanup rollback 测试在 View state 上通过，但 Camp 无法准入下一条合格 Run。

真实 unresolved publication、不安全 root identity、未知 filesystem node、containment error 或
非终态 cleanup 仍是有效的 fail-closed 条件，不属于本事故复发。

## 经验

一个 operation 只有在每个下游 gate 都认同时，才算在两个生命周期轴上真正终结。当同一张表
同时保存物理 operation status 与语义 resolution 时，结束二者的 transition 必须原子结算，并在
下一个 consumer 上测试，而不能只做局部断言。Predicate 名称不能替代对其匹配集的检查；即使
物理 status 已终态，recovery scan 也必须覆盖跨轴矛盾状态。

本事故也说明，fail-closed 边界仍需精确作用域。Attachment integrity failure 应只移除不安全的
attachment availability，而已取消 cleanup 应彻底释放 writer intent。保留公共历史与 audit
evidence，并不要求保留一个旧 gate。

## 参考资料

- [PR #58：attachment-local degradation](https://github.com/murray17/rovai-ai/pull/58)
- [PR #59：释放已回滚 Camp cleanup writer intent](https://github.com/murray17/rovai-ai/pull/59)
- [引入该状态的 commit `99df95b`](https://github.com/murray17/rovai-ai/commit/99df95b75c4a6fa8eda82f9cf254cdaf8ba679b2)
- [修复 commit `f1b0bb8`](https://github.com/murray17/rovai-ai/commit/f1b0bb8a541c1abda05ccf1ad0d79deb6bd62f0f)
- [Camp Published Attachment View 架构](../architecture/camp-published-attachment-view.md)
- [Camp Published Attachment View v4 合同](../contracts/camp-published-attachment-view-v4.md)
- [Camp Permanent Deletion v2 合同](../contracts/camp-permanent-deletion-v2.md)
- [Camp Attachment v5 合同](../contracts/camp-attachment-v5.md)
- [V1.28-D10：attachment-local integrity degradation](../versions/v1.28/decisions.md#v1-28-d10)
- [Cleanup lifecycle 实现与回归](../../crates/rovai-core/src/camp_attachment_view.rs)
- [Writer-intent admission predicate](../../crates/rovai-core/src/camp_attachment_publication.rs)
- [Pending-Camp leave lifecycle](../../apps/desktop/src/renderer/src/CampWorkspace.tsx)
- [Pending-Camp discard caller](../../apps/desktop/src/renderer/src/App.tsx)
