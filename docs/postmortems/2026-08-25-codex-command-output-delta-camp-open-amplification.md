---
document_type: postmortem
incident_id: INC-2026-08-25-CODEX-OUTPUT-DELTA-CAMP-OPEN
incident_date: 2026-08-25
status: closed
systems:
  - codex-runtime-adapter
  - codex-host-ingress
  - execution-evidence
  - camp-open-read-model
  - renderer-runtime-activity
  - agent-run-recovery
last_updated: 2026-08-26
---

# Codex 命令输出增量放大阻断 Camp 打开与恢复

> **爱丽丝的小结：** 这回不是 SQLite 坏了，是我们把每一小段命令输出都当成永久证据，
> 又在非终态 Camp 打开时一口气搬回来。84,620 条记录没有撒谎，系统只是没给数量划边界。
> 先把 Run 收进终态恢复访问，再从最早 ingress 丢掉瞬态 delta，才算真正关上水龙头。

## 摘要

2026-08-25，一个本地会话在应用重启后始终停留于恢复状态。最初报告的 Camp 中有一个旧 Run，
修复它后恢复仍未完成。第二个阻断来自另一个 Camp：其中一个 AgentRun 已停止推进，并以
`waiting / recovery_blocked` 持久化。由于该状态不是终态，每次正常打开 Camp 都会尝试返回该
Run 的全部 Execution Evidence。

该 Run 共积累 84,620 条 Evidence，其中 78,837 条（93.2%）是 `command.output.delta`，即 Codex
执行命令时发出的细小 stdout/stderr transport frame。它们声明的内容总量为 9,027,234 字节；
该 Run 所有 Evidence 内容合计 15,345,180 字节，尚未计入 SQLite 行、JSON Envelope、IPC
序列化、Canonical Activity 挂载以及 Renderer 对象的额外开销。数据库快照总计 120,734 条
Evidence，其中 97,893 条为命令输出增量。SQLite 备份通过 `quick_check`；故障属于读取与投影
放大，而非数据库损坏。

Rovai 曾把每一个 Codex 输出 frame 都当作 append-only 语义 Evidence 持久化，尽管 Codex 终态
`item/completed.commandExecution.aggregatedOutput` 已提供权威 Command 结果。同一批 frame 也
进入 Renderer live state。事务批处理减少了写入开销，却仍为每个 frame 保留一条持久记录和
一个 UI event。Camp open 又刻意为每个非终态 Run 加载完整 Evidence，最终把 recovery-blocked
Run 的 frame 数量放大成无界 open response 和 Renderer 重建。

即时恢复先保留修复前 SQLite 备份，再在不删除 Evidence 的前提下把受影响 Run 收敛为终态
失败。进入终态后，其历史转到既有的 exact-Run lazy read 路径，Camp 不再需要挂载全部 84,620
条记录便可打开。该运维修复并未解决复发风险。

产品修正在两个阶段交付。[PR #69](https://github.com/murray17/rovai-ai/pull/69) 让后续 Codex
命令输出增量成为瞬态数据：它们不再写入 Execution Evidence、更新 Canonical Activity、创建
Managed Blob 或进入 Renderer live state；终态 `aggregatedOutput` 继续作为唯一权威结果。
[PR #72](https://github.com/murray17/rovai-ai/pull/72) 又把丢弃位置前移到 Codex Host stdout
ingress，使输出洪流不会进入 Core 的无界 `codex_tx` 队列。两项变更均有意保留历史 Evidence
与 Blob 数据不变。

本复盘不归咎个人。逐事件持久捕获、完整非终态投影与 streaming 事务批处理，每项在局部上
都可以理解。事故产生于没有任何 seam 拥有端到端 cardinality 不变量，因而未区分 transport
frame 与语义执行事实。

## 事故元数据

| 字段 | 值 |
|---|---|
| 发现方式 | 用户报告会话无法正常关闭；App 重启并修复第一个旧 Run 后仍无法恢复，只读检查随后发现高基数的第二个阻断 |
| 受影响路径 | Codex stdout ingest、Execution Evidence 持久化、非终态 Camp open 投影与 Renderer Runtime Activity 重建 |
| 触发条件 | 一个长时间 Codex Run 产生高基数命令输出 frame，之后以 `waiting / recovery_blocked` 保持非终态 |
| 用户可见症状 | Camp 无法得到可用的 open projection，重启 App 也不能结束“正在恢复会话”状态 |
| 已诊断 Run | 84,620 条 Evidence；78,837 条 command output delta；15,345,180 声明 Evidence 内容字节 |
| 已诊断数据库 | 120,734 条 Evidence；97,893 条 command output delta；SQLite 备份 69,574,656 字节；`quick_check = ok` |
| 数据完整性 | 未发现 SQLite 损坏；修复前备份和全部 84,620 条 Evidence 均保留 |
| 即时恢复 | 把 recovery-blocked Run 收敛为终态失败，使历史 Evidence 转入 exact-Run lazy loading |
| 防止复发 | [PR #69](https://github.com/murray17/rovai-ai/pull/69) 与 [PR #72](https://github.com/murray17/rovai-ai/pull/72) |
| 事故持续时间 | 未计算；用户可见发现、确认和 meaningful paint 恢复时间未作为结构化时间戳保留 |

## 影响

在臃肿 Run 保持非终态期间，受影响 Camp 无法完成正常打开或冷恢复。关闭并重启应用不会减少
工作量，因为 Run 状态与 Evidence 均已持久化；启动会再次选择同一 Camp，并再次进入相同的
open projection。

已诊断 Run 的 Evidence 分布如下：

| Evidence 类型 | 条数 | 声明内容字节 |
|---|---:|---:|
| `command.output.delta` | 78,837 | 9,027,234 |
| `agent.text.delta` | 2,749 | 224,918 |
| `agent.reasoning.summary.delta` | 776 | 94,971 |
| Command started/completed | 777 | 5,020,264 |
| Reasoning summary started/completed | 1,140 | 383,600 |
| File change started/completed | 220 | 557,076 |
| Narration started/completed | 68 | 21,042 |
| Tool call started/completed 与 plan | 53 | 16,075 |
| **合计** | **84,620** | **15,345,180** |

这些字节数来自 `content_byte_count`，不包括 SQLite record/index 开销、payload preview Envelope、
IPC JSON 语法、反序列化后的 Rust/JavaScript 对象、Canonical Activity 挂载、React state 或
排序/重建临时空间。因此 15.3 MB 只是 open path 所处理物料的下界，而不是进程峰值内存。

快照还显示 78,837 条增量集中在单个非终态 Run。整个数据库的 120,734 条 Evidence 中有
97,893 条增量（81.1%），说明这不是语义操作数量与持久 Evidence 体量之间的正常关系。

为恢复访问，没有删除 Camp message、attachment、Command 终态结果或 Evidence 行。产品修复
也没有交付历史迁移或压缩。旧 Camp 仍可保留原始行数；受影响 Run 进入终态后，既有终态历史
lazy loading 会使这些行避开正常 Camp open path。

### 因果边界

保留的备份区分了相邻的两个恢复问题。诊断最初提到的 Camp 中有一个旧非终态 Run，在备份时
Execution Evidence 为零。修复它并未恢复应用，由此才发现第二个 Camp 及其中具有 84,620 条
记录的非终态 Run。本复盘只讨论第二个 delta amplification 阻断。

因此，证据支持两个较窄的结论，而不是一个笼统结论：旧 Run 的生命周期状态导致第一个 Camp
的关闭/恢复缺陷；增量基数则让第二个 Camp 的非终态 open projection 变成无界。不能因为两个
症状出现在同一恢复过程，就把 delta 行说成第一个 Camp 零 Evidence 旧 Run 的原因。

## 发现与响应

事故由用户从产品界面发现，而不是 cardinality 告警。会话先是无法正常关闭；退出并重启应用
后，目标始终停在恢复状态，无法显示有效内容。修复第一个旧 Run 后，用户报告恢复仍未完成，
调查才发现高基数的第二个阻断。

对 daily database 及修复前备份的只读检查确认了四项事实：

- SQLite 完整性正常（`quick_check = ok`）；
- 受影响 Run 为 `waiting`，`wait_reason = recovery_blocked`，且没有 `ended_at`；
- Camp open 语义把该 Run 视为非终态，因而无上限地请求其完整 Execution Evidence；
- 84,620 条 Evidence 中有 78,837 条是 stdout/stderr transport frame，而不是不同 Command
  或 Tool 结果。

恢复前先备份数据库，再把受影响 Run 收敛为终态，同时保留其 Evidence。这让正常 Camp open
能够使用摘要数据，并把终态 Run 历史推迟到用户选择 exact Run 时再加载。保留的备份与当前
数据库中，该 Run 均恰好有 84,620 条 Evidence，因此恢复并未依赖删除事故证据。

第一次产品审查移除了增量持久化和 Renderer delivery，但发现仍有队列风险：Codex stdout
仍会被解析成 `CodexIncoming`，并在 Core 识别后丢弃增量前进入 `mpsc::unbounded_channel`。
第二次修正把分类和丢弃移到 stdout ingress，同时保留 JSON-RPC response 与 server-request
routing，由此同时关闭持久化/读取放大与瞬态队列放大。

## 时间线

所有时间均为 Asia/Hong_Kong。持久 Runtime 时间由 UTC 转换而来；未保留为结构化证据的
时间有意保持不精确。

| 时间 | 事件 |
|---|---|
| 2026-08-25 之前 | Codex `command.output.delta` frame 被规范化为持久 Execution Evidence 和 Renderer live event。Streaming batch 减少事务数，但仍保留逐 frame 基数。 |
| 2026-08-25 20:06:23 | 后来受影响的 AgentRun 被创建并启动。 |
| 2026-08-25 20:07:01 | Run 持久化第一条观测到的 `command.output.delta`。 |
| 2026-08-25 22:31:37 | Run 持久化最后一条观测到的 delta。它共积累 84,620 条 Evidence，其中 78,837 条为 delta，之后呈现为 `waiting / recovery_blocked`。 |
| 2026-08-25，时间未记录 | 用户无法正常关闭第一个会话。退出并重启 App 后，UI 仍停留在恢复状态。 |
| 2026-08-25 22:50 | 修复前保留 69,574,656 字节 SQLite 备份。备份随后通过 `quick_check`，并保留两个恢复阻断供分析。 |
| 2026-08-25 22:52:22 | 最初报告 Camp 的旧零 Evidence Run 收敛为终态 `cancelled`，但恢复仍未完成。 |
| 2026-08-25 23:01:39 | 第二个 Camp 的 84,620 行 Run 从 `waiting / recovery_blocked` 收敛为终态 `failed`；全部 Evidence 仍在。 |
| 2026-08-26 00:39 | [PR #63](https://github.com/murray17/rovai-ai/pull/63) 合并连续 Tool 分组与两级结果披露；它没有创建、删除或压缩 delta Evidence。 |
| 2026-08-26 10:08 | [PR #69](https://github.com/murray17/rovai-ai/pull/69) 合并面向未来数据的 clean break：delta 不再生成 Evidence、Canonical Activity、Blob 或 Renderer live event；终态 aggregate 继续作为权威。 |
| 2026-08-26，PR #69 后 | 修复后的验证 Camp 完成多个 Run，没有新增 `command.output.delta` Evidence。 |
| 2026-08-26 13:04 | [PR #72](https://github.com/murray17/rovai-ai/pull/72) 合并 Host-ingress early drop。生产 ingress 测试向未消费的 receiver 发送 100,000 个有效 delta，观察到零 `CodexIncoming` send，随后终态 event 仍按正确顺序到达。 |

## 技术根因

故障由语义分类缺陷与读取基数耦合共同造成：

```text
Codex 命令 stdout/stderr
  -> 每个 transport frame 产生一个 outputDelta notification
  -> CodexIncoming
  -> Core streaming batch
  -> 每个 frame 一条 Execution Evidence
  -> 每个 frame 一个 Renderer live event

Runtime 连续性结束
  -> AgentRun 保持 waiting / recovery_blocked
  -> Camp open 把 Run 视为非终态
  -> 加载该 Run 的全部 Evidence（无上限）
  -> 序列化 + IPC parse + canonical attachment + 排序/重建
  -> Camp open/恢复无法到达可用界面
```

### Transport frame 被误分类为持久语义 Evidence

`command.output.delta` 只包含部分 stdout/stderr 字节。单个 frame 不会增加新的 Command
identity、生命周期转换、退出状态或最终结果。Codex 已通过 `item/started` 和终态
`item/completed` 提供这些事实，后者的 `commandExecution` payload 包含 `command`、`status`、
`exitCode` 与 `aggregatedOutput`。

同时持久化两类来源，等于以不同粒度重复同一输出：数千条 transport record 加一条终态语义
结果。Managed Blob 阈值可以约束单个大正文，却无法约束数万条各自很小的记录。

### 完整非终态 Evidence 让 transport 基数进入 Camp open

Camp open read model 有意为 `queued`、`running` 和 `waiting` Run 返回完整 Evidence，以便刷新后
重建活跃执行。该 collection 没有行数上限。只有在持久 event 基数由语义约束时，这才是合理的
完整性要求。

受影响 Run 变为 `waiting / recovery_blocked` 后一直留在完整路径。即使 Renderer 并不需要
每个 frame 才能显示最终命令输出，输出 frame 数量仍决定了 open response 大小。

### 只在下游丢弃仍会留下无界 ingress 队列

PR #69 正确地让增量在进入 Core 后变为瞬态，但 Codex stdout reader 仍构造 `CodexIncoming`
并将其发送进 `mpsc::unbounded_channel`。高输出命令可能比 Core 消费和丢弃更快地排入 JSON
event。直接把整个 channel 换成有界阻塞 channel 并不安全，因为同一 reader 还处理 JSON-RPC
response 与终态 event。

PR #72 在 Host ingress 将 method classification 与 route validation 分离。有效 current-route、
stale、malformed、unbound 和 legacy output-delta notification 都在构造 `CodexIncoming` 前被
消费。带 ID 的消息继续使用既有 server-request response 路径，语义/终态 event 则继续进入 Core。

## 促成因素

### 事务批处理优化了错误的单位

Streaming delta 批处理减少了 SQLite 事务开销，提高了吞吐，但持久化单位仍是单个 frame。
这个优化让高基数 ingest 更便宜，却没有对后续 read path 消费的行数设置硬上限。

### Active Evidence 完整性假定 producer 有界

Camp open 合同正确地避免丢失 live execution 状态，却没有区分高价值语义进度与纯 transport
输出。producer/read-model 边界没有最大 event 基数或 payload budget。

### Renderer 使用通用 live-event 路径

输出 frame 进入与 plan、narration、reasoning、Tool 和生命周期更新相同的 live collection。
即使命令展示可使用终态 aggregate output，重复 append、sort 和 progress reconstruction 仍会
在 React state 中放大数据库与 IPC 成本。

### 恢复保留了昂贵分类

连续性丢失后，按当时恢复模型，`waiting / recovery_blocked` 如实表达非终态 Run；但它也让
全部 Evidence 留在 Camp-open 完整路径。重启 App 因而重放工作量，而不是清理它。

### 既有测试只证明普通基数下的正确性

测试覆盖 Evidence 顺序、batching、paging、终态输出与 Renderer 投影，却没有通过生产 ingress
注入 100,000 个输出 frame 并让 receiver 保持不消费，也没有断言零持久行和零 Renderer event。

### 事故可观测性缺少基数与阶段耗时

产品没有在一条诊断记录中报告逐 Run Evidence 类型计数、Camp-open response 字节、JSON parse
耗时、Renderer 重建时间或 meaningful-paint latency。调查需要只读数据库查询与源码还原。

## 既有防护为何没有阻止事故

- SQLite 事务批处理减少了每个事务的写放大，却没有减少行数。
- Managed Blob 阈值作用于单个大正文，不会聚合小 delta 行。
- 稳定 Evidence sequence 与规范 operation identity 保证顺序，却没有 producer cardinality 上限。
- 终态 Run Evidence 已采用 lazy loading；受影响 Run 为 `waiting`，所以终态 history paging 不适用。
- Runtime route 与 epoch fence 会拒绝 stale event；洪流大多来自当时的 current route，因而通过准入。
- Renderer 结果披露延迟了大型终态 Tool 正文，但不会延迟已由 delta 填满的通用 live-event 数组。
- 重启恢复按设计复用持久 Run/Evidence 状态，因此进程重启不是清理机制。

## 不属于根因的事项

- SQLite 损坏没有导致失败；保留备份通过 `quick_check`。
- 终态 `aggregatedOutput` 与 Managed Blob 路径没有制造行数；它们继续是正确的最终输出权威与
  有界大内容路径。
- PR #63 的 Tool 分组与两级披露没有创建历史 delta；它改变 Renderer 展示，同时保留 Core
  Evidence identity 与非终态 open 完整性。
- 其他 Runtime Adapter 不产生 Codex `command.output.delta`。对 13 个 Adapter 的审计确认，每个
  当前 Adapter 都有完整终态语义输出，无需 spool。
- 用户选择的命令不是错误；Host 有责任安全处理有效的高输出 Runtime 流量。
- 重启应用没有制造放大；它只是重新进入同一持久 open 与 recovery 路径。
- 最初报告 Camp 的旧 Run 不含这 78,837 条 delta；它是独立的生命周期阻断，本复盘不把它
  重新分类为 delta 事故。

## 解决与恢复

即时恢复与产品恢复处理了不同层次：

1. 保留并验证修复前 SQLite 备份。
2. 在不删除 Evidence 的情况下，将受影响的 `waiting / recovery_blocked` Run 收敛为终态失败；
   其 84,620 条历史记录继续可通过 exact-Run history read 获取。
3. PR #69 阻止后续 output delta 写入 Evidence、Canonical Activity、Managed Blob 或 Renderer
   live state，同时保留语义 started/completed record、Command identity、status、exit code、
   终态 aggregate output 与 exact Tool result lazy loading。
4. Adapter 审查确认所有当前 Adapter 已提供终态语义输出，因此没有增加 Core/Renderer
   accumulator 或 Adapter spool。
5. Runtime interruption 现在投影 unsettled/stopped，而不伪造权威 cancellation。
6. PR #72 在处理 JSON-RPC response 后、current Thread/Turn route validation 下，于 Codex Host
   stdout ingress 丢弃 output-delta notification；legacy 或不可证明的形态 fail closed。
7. Core 保留早期无条件 transient guard 作为纵深防御，并把它们放在 batching、Runtime lookup、
   shutdown route permit 与数据库读取之前。
8. 生产 ingress 回归在 receiver 不消费时发送 100,000 个 current-route delta，确认 receiver
   为空，再证明 `item/completed` 与 `turn/completed` 仍按顺序到达，终态 aggregate 行为不变。

这些变更只影响后续 Runtime 流量，不迁移、删除、重写、压缩或重建历史 Evidence、Blob 或
Canonical Activity。历史性能修复属于独立治理与迁移问题。

## 做得好的地方

- Daily database 与修复前备份保存了足够结构，能区分损坏、恢复状态、语义操作和 transport frame。
- 精确计数证明受影响 Run 的主要体量来自输出 transport，而非 Command 数量。
- 即时恢复保留全部 Evidence，没有为了让 UI 响应而删除行。
- 审查没有停在数据库和 Renderer 消除，还找到并关闭了剩余的无界 Core ingress 队列。
- 终态命令语义、大输出 Managed Blob、Tool chronology、分组和 exact Tool lazy disclosure 均保留并经过回归测试。
- 两项修复合并前均通过仓库 CI。

## 可以改进的地方

- 每个 Runtime Adapter ingress 都应在新 event type 进入持久或 UI 通用路径前，显式分类 transport 与 semantic。
- 高基数测试应覆盖生产 ingress 和刻意不消费的下游 receiver，而不只是纯 predicate 或正常 consumer。
- Camp-open 诊断应在 IPC 前报告 collection count 与序列化字节，且不记录用户内容。
- Run recovery 应能快速指出是哪一个非终态 collection 主导了阻断的 open response。
- 事故响应应保留结构化的发现、确认、修复、重启与 meaningful-paint 时间戳。
- 历史 delta 处理需要独立审查的迁移/压缩策略，而不是事故专用删除。

## 幸运之处

- 数据库内部一致，且运维修复前保留了备份。
- 高基数数据是 append-only Evidence，因此把 Run 终态化即可恢复既有 lazy-read 边界而不破坏事故记录。
- Codex 终态 event 已包含完整 aggregate output，因此可移除 transport frame 而无需发明新 accumulator。
- 当前非 Codex Adapter 均不依赖 delta 持久行为。
- 在第一项修复被视为完成前，剩余 ingress queue 风险已经被发现。

## 纠正与预防措施

状态反映本复盘发布时可用的证据。任何开放事项开始前，责任角色都必须映射到具体维护者。

| ID | 措施 | 责任角色 | 优先级 | 状态 | 证据或目标 |
|---|---|---|---|---|---|
| CDO-01 | 停止后续 Codex 命令输出 delta 写入 Evidence、Canonical Activity、Managed Blob 或 Renderer live state | Runtime Activity | P0 | 已完成 | PR #69；V1.28-D12 |
| CDO-02 | 在所有当前 Adapter 中保留终态 command/status/exitCode/aggregatedOutput 与大输出 Blob 行为 | Runtime Adapters | P0 | 已完成 | 13-Adapter durability 审计；PR #69 |
| CDO-03 | 在 Codex Host ingress 丢弃 current、stale、malformed、unbound 和 legacy output-delta notification，且不吞掉带 ID 请求 | Codex Runtime | P0 | 已完成 | PR #72；`CodexIngressDisposition` |
| CDO-04 | 证明 100,000 个生产 ingress delta 产生零 `CodexIncoming` send，且不延迟有序终态 event | Codex Runtime | P0 | 已完成 | `stdout_ingress_drops_command_output_flood_and_preserves_terminal_events` |
| CDO-05 | 在 batching、Runtime lookup、shutdown permit 与数据库读取前保留下游 transient guard | Core Runtime | P0 | 已完成 | PR #72 纵深防御测试 |
| CDO-06 | 为历史 delta 定义独立治理的迁移或压缩策略，包含备份、授权、审计与回滚要求 | Core Data | P1 | 已计划 | 后续历史 Evidence 性能项目；明确不属于 PR #69/#72 |
| CDO-07 | 增加不含内容的 Camp-open 诊断：collection 基数、response 字节与 meaningful-paint 阶段耗时 | Core Observability | P2 | 已计划 | 目标：Diagnostics 规划 |
| CDO-08 | 记录结构化事故发现、缓解、恢复与验证时间 | Release Engineering | P2 | 已计划 | 目标：更新事故响应模板 |

## 复发判据

若后续任何 Codex output-delta notification 出现以下情况，即视为本事故复发：

- 进入 `CodexIncoming` 或 Core `codex_tx` 队列；
- 创建 Execution Evidence、Canonical Activity、Managed Blob 或 Renderer live event；
- 让 Camp-open 工作量随 stdout/stderr frame 数量而不是语义操作数量增长；
- 延迟或阻止 JSON-RPC response、`item/completed` 或 `turn/completed` 的处理；或
- 在 operation 终态、cancellation、Host unbind、Turn replacement 或 route supersession 后更新 operation。

历史 delta 行继续存在属于已接受的技术债，本身不算复发。若未经独立批准的迁移语义就自动
重写或删除这段历史，则属于另一项数据治理事故。

## 经验

Streaming 是 transport 属性，不是持久化要求。只有 frame 增加了无法从终态语义 record 重建的
事实时，才应持久化。优化无界 event 的写入速度并不会让系统变得有界；每一个下游 read、IPC
和 UI projection 都会继承 producer 的 cardinality。

只有在持久 event 到达 read model 前已经由语义约束，完整 active-state recovery 与有界 Camp
open 才能兼容。最后，如果更早的无界队列仍接受同一洪流，只消除数据库写入仍不够。
Cardinality 控制应放在能够安全分类 event、又不会阻断 control 与 terminal traffic 的最早 ingress。

## 参考资料

- [PR #69：让 command output delta 成为瞬态数据](https://github.com/murray17/rovai-ai/pull/69)
- [PR #72：在 ingress 丢弃 Codex command output delta](https://github.com/murray17/rovai-ai/pull/72)
- [PR #63：连续 Tool 分组与两级结果披露](https://github.com/murray17/rovai-ai/pull/63)
- [V1.28-D12：Command output delta Host-ingress clean break](../versions/v1.28/decisions.md#v1-28-d12)
- [当前 Execution Evidence 与 Canonical Activity 不变量](../architecture/foundational-invariants.md#evidence-canonical-activity)
- [Camp Open Read Path](../architecture/camp-open-read-path.md)
- [Camp Open Projection v6](../contracts/camp-open-projection-v6.md)
- [Run Process Detail Surface v20](../contracts/run-process-detail-surface-v20.md)
- [Runtime Activity Mapping Registry](../runtime-activity/registry.md#command-output-durability-audit)
- [Codex ingress 实现](../../crates/rovai-core/src/codex.rs)
- [Camp open read-model 实现](../../crates/rovai-core/src/read_model.rs)
