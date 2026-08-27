---
document_type: postmortem
incident_id: INC-2026-08-27-CAMP-ATTACHMENT-A2A-QUIESCENCE
incident_date: 2026-08-27
status: remediation_in_progress
systems:
  - camp-attachment-publication
  - camp-published-attachment-view
  - public-a2a-message-delivery
  - agent-run-admission
  - managed-attachment-v2
last_updated: 2026-08-27
---

# Camp 附件发布等待活跃 AgentRun，阻断带附件 A2A

> **奥黛丽的小结：** 新附件送出前，系统先要求整座 Camp 安静；可发件人自己正是那个不能先
> 停下的人。PR #88 已把新写入拆成独立 Managed Attachment，使保存与 Delivery 不再等待旧
> Run；但 v2-only Run 仍受 legacy View 牵连的 P0 关闭前，我不会把这件事写成彻底结束。
> 真正要守住的是两条各自清楚的边界：字节安全落盘，消息及时交付。

## 摘要

2026-08-26 至 2026-08-27，对当前 `main` 的源码检查确认：AgentRun A 在执行中向 B 发送新附件
时，Core 会先提交 CampMessage 和 pending Delivery，再把 Delivery 置为
`projection_blocked / attachment_projection / attempt=0`。后台 publication worker 只有取得
Camp Attachment View 的写准入，并等整个 Camp 的活跃 Runtime 全部 quiescent 后，才会把附件
加入 Runtime View、释放 Delivery 并开始 dispatch。

每个 AgentRun 又会在整个运行生命周期持有同一 Camp 的附件读准入。于是 A 发附件时，A 自己就
构成 publication 无法越过的活跃 Runtime：附件 Delivery 在 A 结束前必然不能 dispatch；Camp 中
还有其他长 Run 时，等待范围会进一步扩大。单次 mutation attempt 有 55 秒 deadline，超时只会
把 publication 记为 `recovery_required` 并保留持久恢复能力，不会让已经 gated 的 Delivery 绕过
附件投影。若 Camp 持续存在活跃 Run，用户就会看到带附件 A2A 长时间没有开始。

一个被阻断的 Delivery 还会成为同一 Camp、同一 recipient 的 pending FIFO predecessor。因此，
纯文本消息本身虽然不会创建附件 gate，也可能被更早的带附件 Delivery 间接拖住。这解释了为何
用户感受到的症状可能从“一条附件消息没有送达”扩大为“后面的 A2A 也不再推进”。

系统性根因不是复制速度或文件大小，而是旧模型把三件事绑定在同一个 Camp-wide Published
Attachment View generation 上：附件的长期保存、既有 Runtime 的文件可见性，以及 Message
Delivery 的准入。为保证所有活跃 Runtime 看到同一 View，系统牺牲了新消息的活性；而发送动作
恰好发生在持有读准入的 Runtime 内，形成稳定的生命周期环。

[PR #88](https://github.com/murray17/rovai-ai/pull/88) 的 commit
[`5a0fff63`](https://github.com/murray17/rovai-ai/commit/5a0fff638276625ea513dcda65369b094f2b2998)
引入 Managed Attachment v2：新 Composer/Agent 文件经 durable ingest intent、私有 staging、一次
copy、opaque final promote 和最终 SQLite 事务成为独立不可变资源；CampMessage 只保存有序引用，
Delivery 直接进入普通 Dispatch Pump，不再创建 legacy publication operation 或 projection gate。
Fast Rust CI 已通过，且回归测试证明源 Run 保持 `running` 时，4 个共 14 MiB 的附件已提交，目标
Delivery 在源 Run 终结前开始 attempt。

截至本复盘发布时，修复仍不能标记为 closed。PR #88 仍为 Draft，其正文明确保留一个 P0：v2-only
Context 和 Runtime dispatch 仍无条件取得 legacy Camp Attachment View receipt/read admission，并在
claim 前检查 legacy unresolved writer intent。一个无关的非 ready legacy publication 仍可能以
`camp_attachment_view_not_ready` 拒绝新的 v2-only Run。PR 当前的 Rust database smoke、Clippy 和
文档治理检查也尚未形成通过证据。因此本文状态为 `remediation_in_progress`；“新 v2 写入不等待旧
Run”的主链已实现，不等于完整隔离、合并或部署已经完成。

本复盘不归咎个人。旧 View 的一致性和 fail-closed 规则最初在各自范围内保护了附件完整性；缺口
来自没有在跨越 Runtime lifetime 的完整序列上同时验证安全性与活性。

## 事故元数据

| 字段 | 值 |
|---|---|
| 发现方式 | 用户提交 Managed Attachment v2 方案并询问是否需要处理；随后对 current-main 写入、publication worker、Run admission 与 Delivery FIFO 做源码核查 |
| 事故分类 | 确定性架构/实现缺陷；实际受影响 Camp 数量与最长等待时间未保留为结构化证据 |
| 受影响路径 | Composer 或 AgentRun 首次发送新附件所创建的 CampMessage 与 Public A2A Delivery |
| 直接触发 | 新附件发送发生时，同一 Camp 至少有一个持有附件读准入的活跃 AgentRun；Agent 自己发送时此条件天然成立 |
| 用户可见症状 | 附件消息已经接受，但目标 Agent 的 Delivery 保持 `projection_blocked / attempt=0`，无法在源 Run 结束前启动 |
| 放大条件 | 其他长时间 Run 持续占用 Camp；同 recipient 的后续 Delivery 被 pending FIFO predecessor 阻挡 |
| 不直接受影响 | 没有更早 blocked predecessor 的纯文本发送；历史附件读取本身；与本路径无关的成员关系授权 |
| 数据完整性 | 没有证据表明附件字节、CampMessage 或 Delivery 被错误投递或损坏；旧路径选择阻断而不是暴露未验证 View |
| 当前修复 | PR #88 的 Managed Attachment v2 新写入与普通 Delivery dispatch 主链 |
| 当前状态 | 主链修复已实现；legacy Run admission 隔离 P0、完整验收与 required CI 尚未关闭，未合并、未部署 |

## 分析范围与证据状态

- 旧实现基线：`origin/main` commit
  [`f588c773`](https://github.com/murray17/rovai-ai/commit/f588c773c2652a9e78887a31d17de8ed37524bb0)。
- 修复实现：PR #88 head commit
  [`5a0fff63`](https://github.com/murray17/rovai-ai/commit/5a0fff638276625ea513dcda65369b094f2b2998)。
- 运行需求证据：当前 Camp sequence 68–73，包含用户给出的最小 v2 目标、源码核查结论，以及对三张
  窄持久化表边界的确认。
- 代码证据：legacy semantic publication、View mutation/quiescence、AgentRun lifecycle read admission、
  Delivery FIFO；以及 v2 Migration 112、ingest、send transaction、Context SQL union 和回归测试。
- 自动化证据：PR #88 的 `Rust fast tests` 与 `Windows x64 compile gate` 通过；同一 head 的
  `Rust database smoke`、`Rust fmt and clippy`、`docs-governance` 未通过。
- 未知项：没有保留某次真实 blocked Delivery 的完整数据库、日志、截图或开始/恢复时间；因此本文不
  声称具体事故持续时长、用户数量或数据规模。等待关系和 FIFO 放大来自可达的确定性控制流，不是对
  生产影响数量的估算。
- 边界：本复盘是历史证据，不替代当前 Architecture、Contract、版本状态或 PR 合并门禁。

## 关键结论与证据

| 结论 | 状态 | 代码/测试证据 | 限制或反证 |
|---|---|---|---|
| 新 legacy 附件 Delivery 在 dispatch 前被 projection gate 占用 | 已确认 | `CampAttachmentPublicationService::gate_deliveries` 写入 `projection_blocked`、`attachment_projection`、`attempt=0` | 非附件消息不会自行创建该 gate |
| Publication 必须等待整个 Camp quiescent | 已确认 | `drive_camp_attachment_publications` 依次取得 write admission、调用 `wait_for_camp_attachment_quiescence`，再 promote 和 release Delivery | Copy 本身已在 SQLite mutex 外执行，但仍不能越过 lifecycle gate |
| 源 Run 会阻止自己的附件在其终结前 dispatch | 已确认 | AgentRun launch 持有 `CampAttachmentReadAdmission`，只在 Run launch/terminal 路径结束后释放并重新唤醒 projection worker | 这是生命周期依赖，不是线程永久死锁；Run 结束后可以恢复 |
| 单次 55 秒超时不能保证 Delivery 有界完成 | 已确认 | write/quiescence 共用 55 秒 deadline；失败持久化 `recovery_required` 后 worker 返回，Delivery 继续等待精确恢复 | Timeout 保护 worker 不无限挂起，但不提供消息 liveness SLA |
| 更早的 blocked Delivery 可以拖住后续同 recipient A2A | 已确认 | `dispatch_delivery` 把更小 `queue_sequence` 的任意 pending predecessor 视为 FIFO blocker | 其他 recipient 的队列不因此直接受阻 |
| Managed v2 已移除“新写入等待旧 Run”的主耦合 | 已实现、待合并 | Migration 112 三表、v2 ingest/commit 路径，以及 `running_source_sends_fourteen_mib_without_waiting_for_camp_publication` | 测试证明 Delivery attempt 已开始，不等同于所有 Runtime launch 边界均已解除 legacy 依赖 |
| 相同 v2 attachmentId 可只新增 Message ref | 已实现、待合并 | `reference_existing` 与 `composer_ingest_promotes_once_and_commits_only_v2_rows` | 当前公共产品流是否暴露所有 reply/forward 复用入口需由各调用合同继续约束 |
| v2-only Runtime launch 已与 legacy View 完全隔离 | 未成立，P0 | Scheduler 仍调用 `verified_camp_attachment_admission`、`database_has_unresolved_writer_intent` 和 `GenerationFencedV1` authorization | PR #88 正文已将此列为 Known merge blocker |

## 影响

旧路径先提交公开语义，再异步完成 Runtime View projection。用户或发送 Agent 可以得到 accepted
结果，但 B 不会在 A 仍运行时收到可开始的 Delivery。对于长时间分析、工具调用、等待外部输入或
多 Agent 并行 Camp，这会破坏一个核心协作预期：A 无需先退出，才能把刚生成的文件交给 B 继续工作。

最小影响链为：

```text
AgentRun A 持有 Camp attachment read admission
  -> A 发送新附件
  -> CampMessage committed
  -> Delivery = projection_blocked / attempt=0
  -> publication 请求同一 Camp write admission + quiescence
  -> A 未终结，因此 publication 不能完成
  -> B 不能在 A 结束前开始
```

当 publication attempt 在 55 秒内无法取得安全写窗口时，它进入 `recovery_required`。系统仍保留
恢复证据，也可以在 Run 终结释放 read admission 后再次唤醒 worker；但这只能保证安全恢复，不保证
用户等待有界。Camp 始终有运行工作时，阻断可以持续。

同一 recipient 的 Delivery 按 `queue_sequence` 保持 FIFO。后续纯文本 Delivery 即使处于普通
`never_attempted` 路径，dispatch 时也会看到更早的 pending attachment Delivery，并转为等待。因此
直接影响来自新附件，用户感受到的范围却可能覆盖该 recipient 后续的普通 A2A。

没有证据表明系统把不完整文件交给了 Runtime、投递给错误成员或丢失了 CampMessage。问题是可用性
与协作活性，而不是已确认的数据泄露或静默损坏。

## 发现与响应

用户首先给出一个严格限界的 v2 方案：新附件只经 staging、一次复制、独立不可变 Managed
Attachment 和 CampMessage ref，明确禁止等待活跃 Run、Camp-wide generation mutation、per-Run copy、
Inline fallback 或 Host broker。随后询问当前问题是否会造成与先前类似的 A2A 长期停滞。

源码核查先从 Message send 的持久结果向后追踪。`gate_deliveries` 证明附件 Delivery 在 attempt 前被
projection gate 占用；publication worker 证明 release 发生在 View write/quiescence 之后；AgentRun
launch/release 路径又证明活跃 Run 在整个生命周期持有读准入。把三段代码串起来后，可以不依赖时序
猜测地得出：发送附件的源 Run 本身足以阻止目标 Delivery 在它结束前开始。

检查 recipient FIFO 后又确认，症状可能向后续普通 A2A 扩散。由此将修复目标限定为“拆开新附件
durable publication 与 Runtime visibility”，而不是调小 55 秒 deadline、为某个 Runtime 增加特判，或
继续修补 generation fencing。

PR #88 随后增加 Managed Attachment v2。代码检查确认，新 Agent 与 Composer ingress 均先建立 durable
intent，在私有 same-filesystem staging 完成复制和 receipt，再 no-replace promote 到
`.managed-v2/<attachment-id>/payload/`；最终事务原子写入 resource、Message refs、CampMessage、普通
Deliveries、Draft 消费和 committed intent。Replay 复用 command result，不重新读取 Agent source。

审阅 PR head 时同时发现，Scheduler/Runtime launch 仍把所有新 Run 包在 legacy View admission 中。这不会
让本次 v2 ingest 重新创建 projection gate，却意味着历史 legacy writer 状态仍可拒绝只引用 v2 的新 Run。
该项已由 PR 正文记录为 P0，故本复盘没有把“主链已修”扩大解释为“完整问题已关闭”。

## 时间线

所有时间均为 Asia/Shanghai。用户观察到先前类似 A2A 停滞的准确时间没有作为结构化事故数据保留。

| 时间 | 事件 |
|---|---|
| 2026-08-20 05:12 | Commit [`63543116`](https://github.com/murray17/rovai-ai/commit/635431162ba16fe8c9c5bf88acc9bbab7463130f) 引入 Camp Published Attachment View、Run lifecycle read admission、55 秒 View mutation deadline 与 quiescence。 |
| 2026-08-20 13:47 | Commit [`7545f129`](https://github.com/murray17/rovai-ai/commit/7545f1295427dce453fab60193f7c0dc7c9adbde) 进一步串行化 Camp attachment publication。 |
| 2026-08-20 18:57 | Commit [`99df95b7`](https://github.com/murray17/rovai-ai/commit/99df95b75c4a6fa8eda82f9cf254cdaf8ba679b2) 统一 Composer publication 与 Agent file delivery，并让附件 Delivery 进入 projection gate。 |
| 2026-08-26 23:59 | 用户提出 Managed Attachment v2 最小方案，要求新附件发布和 Message Delivery 永不等待旧 Run。 |
| 2026-08-27 00:00 | 源码核查确认 current main 的 Delivery gate、Camp-wide write admission 与 active Runtime quiescence 依赖。 |
| 2026-08-27 00:03 | 进一步确认源 Run 超过 deadline 或 Camp 持续活跃时会表现为长期 A2A 不推进，并冻结三张窄持久化表边界。 |
| 2026-08-27 02:34 | Commit [`5a0fff63`](https://github.com/murray17/rovai-ai/commit/5a0fff638276625ea513dcda65369b094f2b2998) 实现 Managed Attachment v2 主链。 |
| 2026-08-27，PR 建立后 | PR #88 的 Rust fast tests 与 Windows compile 通过；database smoke、Clippy 与 docs-governance 未通过，PR 保持 Draft，并明确记录 v2-only Run 的 legacy admission P0。 |

## 技术根因

### 安全 View 与消息活性共用了同一把 Camp-wide 门

旧设计希望每个 Runtime 在一个 AgentRun 生命周期内看到稳定的 Camp attachment filesystem View。
因此 Run 启动时取得 read admission，直到 Runtime 工作结束才释放。向同一 View 加入新文件则需要 write
admission；为了不改变任何仍在运行的 Runtime 所见目录，worker 还会检查数据库 active Runtime，并要求
Runtime fleet 成功 fence 到 quiescent。

这个模型用于只读快照时是自洽的，但 Agent file send 把写入触发放到了持有 read admission 的 Run 内：

```text
A Run lifecycle ─────── holds read admission ───────> terminal
       |
       +-- send attachment
              |
              +-- publication needs write admission + no active Runtime
                                      ^
                                      |
                         cannot be true while A runs
```

这不是传统意义上的永久 mutex deadlock：deadline 会退出，Run 终结也会释放 admission 并再次唤醒 worker。
但它是确定性的活性依赖——B 的开始被错误地排在 A 的终结之后。只要 A 的工作需要 B 先处理附件才能
继续，产品层面就形成协作死结。

### 三种领域事实被折叠进一个 publication generation

旧流程用同一 operation/generation 同时表达：

1. 公开消息所引用的附件字节是否已经安全保存；
2. Camp 中所有既有 Runtime 是否已经能看到同一个 View；
3. 目标 Message Delivery 是否允许开始 attempt。

第 1 项只需要不可变资源与原子语义提交；第 2 项属于具体 Runtime/Session 的可见性；第 3 项应由消息、
recipient、FIFO、capacity 和授权拥有。把它们绑定后，最宽的 Camp-wide 条件成为每条新附件消息的
前置条件。

### Recovery 保护一致性，没有恢复活性

55 秒 deadline 防止单个 projection task 永久等待，`recovery_required` 又保留了 crash-safe journal。
这些防护都正确偏向 fail closed，却没有一个承诺 gated Delivery 在有限时间内转为 attempted 或 terminal。
当失败原因只是“健康的源 Run 仍在执行”时，重复 recovery 也不能改变条件。

### FIFO 把局部阻断放大为连续协作停顿

Message Delivery 的 recipient FIFO 需要后来的 Delivery 等待所有更小 `queue_sequence` 的 pending
predecessor。`projection_blocked` 仍是 pending，因此附件 publication 不只是延迟自身，也能使后续普通
消息进入 `target_busy` 等待。附件子系统的局部活性问题由此扩散到 A2A 调度体验。

## 促成因素

### 测试重点偏向完整性与恢复

旧覆盖充分验证 generation、digest、staging、rollback、terminal projection failure 和 restart recovery，
却没有把断言放在最重要的跨组件 seam：源 Run 仍为 `running` 时，目标 Delivery 必须已经开始。

### 短 Run 会掩盖生命周期依赖

Run terminal 路径会释放 read admission并主动唤醒 publication worker。对很快结束的 Run，附件稍后仍会
送达，看起来像普通异步延迟；只有长 Run、依赖下游结果的 Run 或 Camp 持续并发时，问题才清晰暴露。

### Timeout 容易被误读为有界用户等待

55 秒只限制一次 mutation attempt，不限制 Delivery 从 accepted 到 attempted 的总时间。进入
`recovery_required` 后仍需新的安全窗口和恢复触发，因此不能把 worker deadline 当作消息 SLA。

### Message-owned 附件身份阻碍复用

Legacy `message_attachment` 以消息为所有者。同一附件再次 mention/reply/forward 不能只新增引用；复用旧
表会继续把稳定资源身份与一次 publication operation 混在一起，也会把 View gate 带回新路径。

### 安全边界缺少分层命名

“Camp Attachment View ready”同时被用于描述 filesystem receipt、writer intent 和 Run admission。
局部名称强调安全状态，却没有提醒调用者：把它作为所有新 Delivery 的必经 gate 会改变协作顺序。

## 既有防护为何没有阻止事故

- Copy 已在 SQLite mutex 外运行，避免了数据库长锁，却没有释放 Camp View lifecycle write admission。
- View read/write lock 防止运行中目录被原位改变，正确保护了 legacy generation，却让发送者阻止自己的写入。
- Runtime fleet quiescence/fence 保证旧 View 一致性，但作用域是整个 Camp，而不是新消息或目标 Session。
- `projection_blocked` 防止 B 在附件未投影时提前读取不完整文件，却把 Runtime visibility 变成 Message
  Delivery 的全局前置条件。
- `recovery_required` 与 startup reconciliation 能保留、重试和终结 operation，不提供“源 Run 结束前开始
  dispatch”的活性保证。
- Zero-attempt cancellation 允许用户安全停止 blocked Delivery，只解决可取消性，不解决正常 dispatch。
- 既有单测分别覆盖附件 publication、Run admission 和 Delivery FIFO，没有覆盖三者组合后的生命周期环。

## 不属于根因的事项

- 不是 14 MiB 或多文件导致；任意首次发布的新附件都进入同一 gate。文件越大只会增加 gate 前复制时间。
- 不是 B 忙或 Runtime unavailable；即使 B 空闲，projection gate 也在普通 dispatch 之前阻止 attempt。
- 不是 source membership cutover、动态名册或目标寻址错误；这些 fence 位于不同授权边界。
- 不是纯文本 Send 自己创建了 attachment projection；但它可能被更早的 pending attachment predecessor
  按 FIFO 间接延迟。
- 不是数据库损坏或 attachment digest mismatch；健康附件和一致数据库也能稳定进入此等待关系。
- 不是把 deadline 从 55 秒调小即可解决；更短 deadline 只会更快进入 recovery，不会让 B 更早开始。

## 修复与恢复

PR #88 采用独立 Managed Attachment v2，而不是继续修改 legacy generation：

1. Migration 112 增加 `managed_attachment`、`camp_message_attachment_ref`、
   `managed_attachment_ingest_intent`，并给 Camp 增加单调 `attachment_revision`；
2. Composer Draft 在 Send 前仍留在私有 Prepared storage；Agent 文件只从 exact execution workspace 或
   `ROVAI_RUN_TMP` 准入；
3. Core 先持久化 intent 和 reservation，再在数据库 mutex 外完成一次 copy、file/tree receipt、fsync、
   opaque final reservation、atomic rename 和 final revalidation；
4. 最终 SQLite 事务重新授权 Draft revision 或 source Run，并原子提交 available attachment、CampMessage、
   ordered refs、普通 Deliveries、Draft 消费与 committed intent；
5. v2 Delivery 不写 `projection_blocked`、`pre_dispatch_gate` 或 legacy operation association，commit 后直接
   唤醒普通 Dispatch Pump；
6. 同 Camp 再次引用同一个 v2 attachmentId 只新增 ref，不复制 payload；
7. staging 或 promote 后、DB commit 前崩溃，由 startup reconciler 把 pending intent 标为 abandoned 并清理
   orphan；commit 后、pump 唤醒前崩溃则由既有 pending Delivery restart pump 恢复；
8. 历史 v1 数据不批量迁移、不双写；legacy verifier/rebuild 忽略 `.managed-v2` 子树。

新表不是三套通用平台，而是三个窄责任：不可变资源、消息引用和 crash/quota 操作日志。把 intent 状态塞进
资源表虽然可以减少一张表，却会混合“尚未成为公开事实的临时操作”和“已提交的不可变实体”，使 promote/
commit 恢复约束更难表达；复用 legacy message-owned 表则会重建本次根因。

尚未完成的恢复边界是 Runtime launch。当前 scheduler 仍无条件执行 legacy View authorization 与
unresolved-writer check。修复必须让没有 legacy attachment dependency 的 v2-only Run 不再被无关 legacy
operation 拒绝，同时保留真正需要读取历史 v1 View 的 Run 的 fail-closed 安全性。关闭该 P0 前，PR 不应合并。

## 做得好的地方

- 用户把目标限制为一个可验证结果：A 继续运行时，附件可以立即交给 B，避免演变成通用授权平台重写。
- 诊断从 Delivery、publication、Run admission 到 FIFO 做了完整逆向追踪，没有把“异步”当作原因。
- Legacy gate 在故障中保持 fail closed，没有把 staging 或未验证 View 暴露给 Runtime。
- v2 保留一次 copy、final receipt、durable intent 和原子语义提交，没有以削弱 crash safety 换取速度。
- 三张表分别拥有稳定身份、引用与操作恢复，使相同附件 ref-only 复用成为可测试事实。
- 回归把断言放到了源 Run 仍 `running`、目标 Delivery 已 attempt 的跨组件 seam，而不只检查文件存在。
- PR 正文主动记录剩余 legacy admission P0，没有把已完成的 send seam 误报为整个链路已隔离。

## 可以改进的地方

- Architecture/Contract 在把 runtime-wide View 设为 Message Delivery gate 前，应同时写出安全不变量和活性不变量。
- 任何跨 Run publication 方案都应有强制验收：producer 未终结时，consumer 已开始；其他 sibling Run 不能
  改变这一顺序。
- Worker deadline、recovery state 与用户可见 liveness 应分别命名和度量，避免把“可恢复”理解成“会及时完成”。
- Delivery 诊断应直接展示 `preDispatchGate`、阻断 operation 与 FIFO predecessor，而不是让用户从“没有
  新 Run”反推原因。
- 当前版本文档的 `completed` 与验证清单必须只在 required CI 和已记录 P0 全部关闭后成立，不能仅依据本地
  选择性测试。
- v2-only 与 legacy-dependent Run 应由显式 dependency/authorization 选择区分，不能继续无条件经过旧 receipt。
- 应补齐完整 runtime-level 验收，证明 warm Session 可见性策略或 fresh Session fallback，而不只证明 Delivery
  row 已开始 attempt。

## 幸运之处

- 阻断发生在 Runtime input 之前，没有证据显示 B 读取了不完整或错误附件。
- 旧 operation、Delivery gate 和 queue sequence 都是持久事实，使根因可以从代码与数据库合同精确重建。
- 根因可以通过新增独立写模型隔离，不需要批量迁移历史 payload 或重写所有 Runtime Adapter。
- 现有 Camp-scoped attachment root 已能承载 opaque v2 子树，无需新增 global root、Host broker 或 per-Run copy。
- 用户在 PR 合并前要求核查与复盘，剩余 legacy admission P0 仍可作为显式 blocker 处理。

## 纠正与预防措施

状态反映本复盘发布时的实现和 CI 证据。开放事项必须进入当前版本规划、PR 或后续可追踪工作；本文本身
不创建新的架构权威。

| ID | 措施 | 责任角色 | 优先级 | 状态 | 证据或目标 |
|---|---|---|---|---|---|
| CAA-01 | 让所有新 Composer/Agent 附件经独立 Managed v2 ingest，不取得 legacy View write admission、不等待活跃 Run、不创建 projection gate | Camp Attachment Lifecycle | P0 | 已实现，待合并 | PR #88；`managed_attachment.rs`；`attachment_send_commits_managed_v2_and_dispatches_without_projection_gate` |
| CAA-02 | 用源 Run 仍为 running、4 个共 14 MiB 文件、Delivery 已 attempt、零 legacy operation/gate 的回归锁定核心顺序 | Core Testing | P0 | 已实现；fast CI 通过 | `running_source_sends_fourteen_mib_without_waiting_for_camp_publication` |
| CAA-03 | 为 ref-only 复用、staging/promote pre-commit crash、restart cleanup 与 DB-only Context path 建立回归 | Core Testing | P1 | 已实现，待完整门禁 | `composer_ingest_promotes_once_and_commits_only_v2_rows`、`startup_reconcile_abandons_staging_and_promoted_precommit_intents`、`managed_v2_context_projects_the_database_path_without_probing_the_payload` |
| CAA-04 | 移除 v2-only Run 对 legacy receipt/read admission、pre-claim unresolved-writer gate 和 Runtime Input Delivery legacy receipt 的无条件依赖 | AgentRun + Attachment Runtime | P0 | 未完成，合并阻断 | PR #88 `Known merge blocker`；目标回归：非 ready legacy publication 不阻断 v2-only Run |
| CAA-05 | 证明其他长时间 sibling Run 不影响新 v2 ingest、Delivery dispatch 或 source Run 生命周期 | Core Acceptance | P0 | 待补证据 | 目标：Camp 内另有 running Run，v2 Delivery 仍在其结束前开始，且不取得 Camp mutation admission |
| CAA-06 | 冻结 Runtime/Session 对新增 child 的可见性策略；不能证明 live append 时，后续引用更晚 revision 的 Run 使用 fresh Session/process，旧 Run 不停止 | Runtime Integration | P1 | 待补设计与验收证据 | 目标：跨 Adapter attachment revision acceptance；不得回退到 generation-fenced v1 |
| CAA-07 | 覆盖 legacy payload 缺失/损坏的历史读取与转发降级，确保新 v2 消息、Delivery 与 Run 不被阻断 | Legacy Compatibility | P1 | 待补证据 | 目标：历史 Message 可打开；转发生成新的 v2 unavailable tombstone，不复用 legacy ID |
| CAA-08 | 关闭 PR #88 的 database smoke、Clippy、docs-governance 与所有 required checks，并让版本状态/验证清单与最终证据一致 | PR Owner + Release Engineering | P0 | 未完成，合并阻断 | 目标：PR #88 非 Draft、required checks 全绿、无 Known merge blocker |
| CAA-09 | 为 attachment-gated Delivery 增加脱敏诊断：gate、operation state、等待 active Runtime 数和 FIFO predecessor；不得暴露路径或正文 | Core Observability | P2 | 已计划 | 目标：Diagnostics contract review 与 bounded event/log |

## 复发判据

出现以下任一情况，即视为本事故复发：

- 新 v2 附件 ingest 获取 Camp Attachment View write admission，或调用 legacy quiescence/generation mutation；
- 源 AgentRun 仍在执行时，新附件 Delivery 必须等其终结后才能第一次 attempt；
- Camp 中一个无关 sibling Run 可以使新 v2 Message/Delivery 等待、fence 或停止；
- 新 v2 Delivery 被写为 `projection_blocked`、带 `attachment_projection` gate 或关联 legacy publication
  operation；
- 一个 pending attachment gate 继续作为 FIFO predecessor 长期阻断同 recipient 后续普通 A2A；
- v2-only Run 因无关的 legacy View receipt 或 unresolved writer intent 被拒绝；
- 相同 Camp、相同 v2 attachmentId 再次引用发生第二次 payload copy；
- pre-commit crash 产生公开 Message/Delivery，或留下无法由 durable reconciler 处理的 staging/final orphan；
- 回归只证明 Message committed 或文件存在，没有证明 producer 仍 running 时 consumer dispatch 已开始。

真正需要读取 legacy v1 附件的 Run 对不安全 legacy View fail closed，不属于复发；复发条件是新 v2 路径
仍被无关的 Camp-wide legacy lifecycle 支配。

## 经验

附件安全和协作活性不能由同一个最宽 gate 代为拥有。不可变 payload 是否安全落盘，是 attachment resource
的事实；一个 Runtime 是否能读取后来增加的 child，是 Session/Adapter 的事实；一条消息何时可以交给 B，
是 Delivery 的事实。只有把三者分开，才能既不暴露未验证文件，也不要求 A 先结束才能请 B 接手。

Crash recovery 也不能替代 liveness。`recovery_required` 说明系统知道还有账要收，并不说明用户会在有限
时间内看到进展。任何安全的异步协议都应同时回答：失败后怎样恢复，以及健康条件下最晚何时越过下一个
用户可见 seam。

最后，测试必须围绕用户需要的事件顺序，而不只是内部状态。这里最有价值的断言不是“View 最终 ready”，
而是“A 仍在运行，B 已经开始”。它直接表达了多 Agent 协作的产品承诺，也会阻止未来以 generation、
projection 或兼容层名义重新引入同一种等待。

## 参考资料

- [PR #88：Managed Attachment v2 nonblocking ingest](https://github.com/murray17/rovai-ai/pull/88)
- [旧实现基线 `f588c773`](https://github.com/murray17/rovai-ai/commit/f588c773c2652a9e78887a31d17de8ed37524bb0)
- [引入 Published Attachment View 的 commit `63543116`](https://github.com/murray17/rovai-ai/commit/635431162ba16fe8c9c5bf88acc9bbab7463130f)
- [统一 publication 与 Agent file delivery 的 commit `99df95b7`](https://github.com/murray17/rovai-ai/commit/99df95b75c4a6fa8eda82f9cf254cdaf8ba679b2)
- [Camp Attachments 与 Legacy Published View 架构](../architecture/camp-published-attachment-view.md)
- [Camp Attachment v6](../contracts/camp-attachment-v6.md)
- [Camp Message Send v13](../contracts/camp-message-send-v13.md)
- [Message Delivery v8](../contracts/message-delivery-v8.md)
- [Legacy Camp Published Attachment View v4](../contracts/camp-published-attachment-view-v4.md)
- [v1.29 决定 V1.29-D06](../versions/v1.29/decisions.md#v1-29-d06)
- [Managed v2 ingest、恢复与回归](../../crates/rovai-core/src/managed_attachment.rs)
- [Agent send 与 14 MiB nonblocking 回归](../../crates/rovai-core/src/team_tool.rs)
- [Runtime attachment admission 与 publication worker](../../crates/rovai-core/src/main.rs)
- [Message Delivery FIFO 与 dispatch](../../crates/rovai-core/src/message_delivery.rs)
