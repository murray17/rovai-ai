---
document_type: postmortem
incident_id: INC-2026-08-31-CHANNEL-POLL-RECEIPT-STORAGE-GROWTH
incident_date: 2026-08-31
status: mitigated
systems:
  - channel-host-maintenance
  - event-log
  - execution-evidence-store
  - authority-migration
  - desktop-runtime-availability
last_updated: 2026-08-31
---

# 渠道轮询回调永久写库导致磁盘持续占用，升级路径放大为整库复制

> **雾切响子的小结：** 真相只有一个：数据库 670 MB 里，92% 是后台每 750–800ms 一次的轮询回调留下的
> "到此一游"回执，其中 99.94% 什么都没做。它不是一天写坏的，是 App 安静放着就自己长大的。
> 修复没有删任何一行历史，而是关掉水龙头：tick 不再是命令，索引去重交给 Migration 129，
> 升级从"复制整库"改为"原位逐版本事务"。结论先行，证据随后，全部数字可由正文复核。

## 摘要

2026-08-31 上午，用户报告两件事：本地数据库为何达到约 670 MB，以及为何版本升级需要长时间复制数据库。
只读诊断确认：日常库 `rovai.sqlite` 为 670,191,616 字节，其中 `event_log` 占 313.9 MiB、
`agent_run_execution_evidence` 占 281.8 MiB，而全部 Camp 消息正文仅约 2.4 MiB。数据库并非损坏，
`freelist_count` 为 0；体量主要来自持续写入的永久记录。

最大单一增长源是渠道轮询回调：飞书 Host 每 750ms、钉钉 Host 每 800ms 一次 tick，每次都经过通用
命令网关并写入一条 `command.result / channel_host.tick` 永久回执。诊断时刻共 454,739 条 tick 回执，
占 `event_log` 全部 491,861 条记录的 92.45%；其中 454,480 条（99.9%）既没有返回待投递消息，也没有
roster 刷新请求。按当日写入速率（2026-08-30 单日 220,982 条），两个渠道每天最多新增约 22 万条回执。
也就是说，App 不聊天、无人操作，后台也在持续写永久记录。

次要因素有两个。其一，执行证据表存在一组完全重复的索引：`UNIQUE(agent_run_id, sequence)` 自动索引
与手动创建的同字段普通索引各占 19.5 MiB。其二，约 4.7 万条 `command.output.delta` 是 2026-08-26
之前的批量事务优化（`27d56e8d`、`99fe3f14`）生效前的历史遗留，最后新增在 8 月 26 日，当前不再增长；
调查初稿曾把它误当活跃增长源，后已纠正。

升级慢是另一层问题：旧升级路径对任何需要 schema 迁移的版本执行"创建 staging 副本 → SQLite Backup API
整库复制 → 在副本上迁移 → 校验 → 再复制一份原库到备份目录 → 原子切换"。复制循环每搬运约 1 MiB
（256 页）固定 `sleep 25ms`，仅人为等待即约 16 秒；迁移备份目录 `.rovai-authority-migration-backups`
另占约 1.2 GB。升级耗时与磁盘占用随历史库体积增长，与本次 schema 变更量无关。

修复在同日完成于 `rovai/channel-integration` 分支（提交 `cbae7eff`，后经 `201b93d2` 合并最新 main 并
安装到 `/Applications`）：飞书/钉钉共用新的强类型维护接口 `ChannelHostTickRequest`，tick 不再生成
commandId 或永久回执，投递领取与队列推进保留在同一个 IMMEDIATE 写事务中；Migration 129
（Data Contract `v1.40 / projection schema 81`）先验证等价唯一索引存在，再原子删除重复索引；
普通升级改为原位逐版本事务迁移，不再复制整库、不再默认全库检查，旧快照恢复仅保留中断兼容。
本复盘不归咎个人。把内部调度回调当作领域命令、把灾难恢复级安全机制当作默认升级路径，每项在局部
都自洽；事故产生于没有任何 seam 为"内部维护流量"与"永久业务事实"划界。

## 事故元数据

| 字段 | 值 |
|---|---|
| 发现方式 | 用户主动询问数据库体积与升级耗时；Codex 只读诊断确认 |
| 受影响路径 | 渠道 Host tick → 通用命令网关 → `event_log` 持久化；authority migration 整库复制升级路径 |
| 触发条件 | 渠道（飞书/钉钉）已发布并保持连接，App 持续后台运行；数据库 schema 需要迁移的版本升级 |
| 用户可见症状 | 数据库 670 MB 持续增长且与聊天量无关；版本升级出现明显等待与额外磁盘占用 |
| 诊断时 event_log | 491,861 行，其中 `channel_host.tick` 454,739 行（92.45%）；tick 中 454,480 行空结果 |
| 渠道分布 | feishu-channel-host 293,385 次；dingtalk-channel-host 161,681 次 |
| 单日峰值 | 2026-08-30：tick 220,982 行 + roster reconcile 6,503 行 |
| 诊断时证据表 | 379,753 行 / 529 个 Run；两份等价 `(agent_run_id, sequence)` 索引各 19.5 MiB |
| 数据完整性 | `quick_check` 通过、freelist 为 0；不存在损坏或未回收删除 |
| 迁移备份目录 | `.rovai-authority-migration-backups` 约 1.2 GB，无自动保留策略 |
| 修复提交 | `cbae7eff`（`perf(storage): migrate authority in place and bound channel maintenance writes`） |
| 事故持续时间 | 写入自 2026-08-28 12:39 UTC 渠道接入后持续；11:14 诊断、14:04 修复推送远端 |

## 影响

日常数据库体积被后台维护流量主导：`event_log` 表 256.6 MiB 本体加相关索引约 313.9 MiB，其中九成以上
行来自无业务结果的轮询回执。这些行不删除、不回收，随时间线性累积；按 8 月 30 日速率推算，仅 tick
回执每年即可新增约 8,000 万行。同时每次 schema 升级付出整库复制的 CPU/IO 时间（该库约 16 秒纯等待）
并再占用一份原库大小的磁盘。没有用户数据损坏，没有任何会话内容丢失；影响限于磁盘占用、升级时长
和写入放大。

### 因果边界

三个因素相互独立，不能混为一谈：轮询回执是活跃增长源（修复后停止新增）；重复索引是一次性既存占用
（Migration 129 删除后释放页供复用，文件不立即缩小）；历史 delta 行是已修复问题的遗留（当前不增长，
清理需独立数据治理决策）。调查初稿曾把 4.7 万条历史 command delta 与活跃增长混在一起陈述，复盘按
证据纠正为三分法。

## 发现与响应

2026-08-31 11:14（Asia/Shanghai），用户在 Codex 会话中提出两个问题：数据库为何这么大、升级为何要
复制数据库。诊断全程只读（`sqlite3 -readonly` + `PRAGMA query_only=ON` + `dbstat`），未写日常库。

11:22 给出完整结论与六项建议；11:29 用户指示先实施第 1、3 项（取消空轮询回执、删除重复索引），
在当前 channel 分支修改。实施中发现轮询 tick 即使无消息也可能在处理超时或推进队列，因此方案收敛为
"取消轮询本身的永久回执，保留其事务"：维护、FIFO admission 与投递领取仍在同一 IMMEDIATE 事务内，
失败整笔回滚。12:07 完成两项优化；12:08 用户追加粘贴完整需求文档，要求普通升级改为原位逐版本事务
迁移；12:59 完成。13:24 合并最新 main（`48a9140f`）并打包安装到 Applications；13:33 记录分支改名；
14:04 推送远端 `rovai/channel-integration`（时区均为 Asia/Shanghai）。

## 时间线

所有时间为 Asia/Shanghai；数据库内时间为 UTC 转换。

| 时间 | 事件 |
|---|---|
| 2026-08-28 20:39 | 渠道 Host 接入后首条 `channel_host.tick` 回执写入（12:39 UTC）。 |
| 2026-08-28 至 08-30 | tick 回执按 750/800ms 节奏持续累积；8-30 单日 220,982 行为峰值。 |
| 2026-08-31 11:09 | 最近一次整库复制升级在备份目录留下 669,544,448 字节 original-main.sqlite。 |
| 2026-08-31 11:14 | 用户发起诊断请求；只读统计确认 670 MB 构成与轮询回执占比。 |
| 2026-08-31 11:22 | 交付完整分析：三大增长源 + 升级复制两个性能问题 + 六项建议。 |
| 2026-08-31 11:29 | 用户拍板先做第 1、3 项，当前分支实施。 |
| 2026-08-31 12:07 | 空回执取消与索引迁移完成：81 项定向测试、全量 Rust/JS 回归通过。 |
| 2026-08-31 12:08 | 用户粘贴原位迁移需求文档；开始实施普通升级协议改造。 |
| 2026-08-31 12:59 | 原位逐版本事务迁移完成：全量回归通过，含真实 Core 启动与防空库验证。 |
| 2026-08-31 13:03 | 修复提交 `cbae7eff` 落盘。 |
| 2026-08-31 13:24 | 合并 main `48a9140f`（后为 `201b93d2`），打包安装到 Applications，旧包备份。 |
| 2026-08-31 14:04 | 推送远端 channel 分支，最新提交 `76cfaf8f`；未创建 PR。 |

## 技术根因

```text
渠道 Host 定时唤醒（飞书 750ms / 钉钉 800ms）
  -> 构造 channel_host.tick DomainCommand
  -> 通用命令网关按惯例写入 command.result 回执
  -> event_log 每次追加一行永久记录（无业务结果也写）
  -> 数据库体积随运行时长线性增长，与聊天量无关

版本升级需要 schema 迁移
  -> 创建 staging 副本 + SQLite Backup API 整库复制（每 MiB 固定 sleep 25ms）
  -> 副本迁移 + 校验 + 再复制一份原库到备份目录
  -> 原子切换
  -> 升级耗时与磁盘占用 ∝ 历史库体积，与本次变更量无关
```

### 内部维护流量被当作领域命令持久化

tick 的本质是"宿主心跳"：多数时候既无待投递消息，也无 roster 变化（99.9% 空结果）。但它复用了
DomainCommand 网关，网关的默认契约是"每命令一条永久回执"。没有任何 seam 区分"内部调度流量"与
"用户意图产生的业务事实"，于是心跳以业务事实的存储成本永久落盘。

### 灾难恢复机制成为默认升级路径

整库复制 + 副本迁移 + 文件切换对"写错的迁移、断电、进程崩溃"是最强保护，作为特殊场景手段是合理的。
但逐版本迁移本身已有 receipt 可提供断点续迁，把灾难恢复路径当作所有普通升级的默认执行方式，使
升级成本与历史体积挂钩。固定 25ms 批间等待即便在无锁竞争时也照睡不误，又叠加了纯人为延迟。

### 唯一约束与手动索引重复

`agent_run_execution_evidence` 的 `UNIQUE(agent_run_id, sequence)` 已自动生成等价 B-tree，
建表语句又手动创建了同字段普通索引。SQLite 官方查询规划文档明确建议避免功能重复索引；此重复
既占 19.5 MiB，又增加每次证据写入的索引维护成本。

## 促成因素

- **统一网关的便利性**：新内部请求复用 DomainCommand 通道最省事，但继承了"每命令一回执"的语义。
- **回执无审查指标**：没有任何"event_log 增长率 vs 业务事件率"的告警或诊断，问题只能靠人工发现。
- **安全机制的默认性**：整库复制的安全叙事（"迁移写错也能恢复"）掩盖了成本随体积增长的结构性问题。
- **性能调优优化了错误的单位**：备份循环的 25ms 等待本意是 BUSY 退避，却写成无条件固定等待。
- **同字段双索引无人复核**：建表 DDL 与唯一约束分开演进时，没有等价索引检查。

## 既有防护为何没有阻止事故

- WAL、事务与 `quick_check` 保证了完整性，但对"写入什么"没有发言权。
- Managed Blob 阈值只约束单条大正文，不约束大量小行。
- 执行证据的批量事务优化（27d56e8d）减少了写入开销，反而让高频回执更"便宜"地持续落盘。
- 备份目录有清晰结构（`original-main.sqlite` + manifest），但没有保留数量/期限上限策略。
- delta 持久化在 8-26 事故（INC-2026-08-25-CODEX-OUTPUT-DELTA-CAMP-OPEN）后已被 PR #69/#72 修复；
  本次诊断正确识别出遗留行不再是活跃源，未重复修复。

## 不属于根因的事项

- 聊天正文不是体积来源（2.4 MiB / 670 MB）；不压缩会话即可解决本问题。
- 这次 schema 升级没有生成大体积：升级前后库均为 669.5 MB 级，schema 变化仅约 0.14 MB。
- SQLite 本身无故障：无损坏、freelist 为 0，VACUUM 只能回收约 50 MiB 页内空闲，不是解药。
- 用户未清理数据库不是过错；系统本就不应让维护流量无界落盘。
- 轮询频率本身（750/800ms）不是根因；本轮刻意不改频率，只改"轮询是否留痕"。

## 解决与恢复

1. **维护接口独立**：新增 `channels.host.tick` / `channels.dingtalk.host.tick` 强类型入口，
   使用 `ChannelHostTickRequest { workerId, limit }`，不是 DomainCommand，响应直接返回
   `{ deliveries, rosterRefreshes }`，无 command identity / status / replay 语义。非法参数或
   非受信 Actor 直接拒绝，不追加回执也不伪装空列表。规范由
   [Channel Host Maintenance v1](../contracts/channel-host-maintenance-v1.md) 拥有。
2. **事务与业务保障不变**：一次 tick 在单个 IMMEDIATE 事务内完成超时收口、队列推进、delivery
   领取；失败整笔回滚。真实 admission 审计、delivery lease/attempt/dedupe key、settlement 的
   永久幂等回执全部保留；测试验证响应丢失后 lease 恢复、同一 delivery 不重复创建、整笔回滚。
   未给通用网关加"跳过日志"开关——那是会伤及所有领域命令的口子。
3. **Migration 129 删重复索引**：先以 `pragma_index_list/index_xinfo` 严格验证 `UNIQUE(agent_run_id,
   sequence)` 等价索引存在（列序、排序、collation 完全一致），再在同一 IMMEDIATE 事务内 `DROP INDEX`
   并提交 receipt，失败回滚。Data Contract 前进到 `v1.40 / projection schema 81`。
4. **原位升级替代整库复制**：普通 Upgrade 以 READ_WRITE/NOFOLLOW/NO_MUTEX（无 CREATE）打开
   ticket 指向的原库，写入前重验合同/classifier/receipt/身份，然后执行既有逐版本 IMMEDIATE 事务
   迁移链；失败回滚当前步骤、已提交 receipt 保留、重开续迁。不再创建 staging/backup/manifest，
   不再默认全库 `quick_check`/`foreign_key_check`（改为受影响表的局部 FK 检查）；旧 manifest 的
   中断恢复保留。瞬时错误独立 250/750/1500ms 重试，不占 crash budget；任何失败不得初始化空库。
   规范由 [Desktop Runtime Availability v2](../contracts/desktop-runtime-availability-v2.md)、
   [Channel/Main Schema Join v2](../contracts/channel-main-schema-join-v2.md) 与
   [V1.36-D07](../versions/v1.36/decisions.md#v1-36-d07) 拥有。
5. **审计修正历史迁移事务边界**：72/90/96/97 的事务外 DDL 并入本步 IMMEDIATE 事务；25 处提交后的
   全库 FK 检查改为提交前局部检查。
6. **历史数据不动**：不清理历史 tick 回执或 delta 行，不执行 VACUUM；删除索引释放的页供 SQLite
   复用，文件不立即缩小。历史数据治理留给独立决策。

## 做得好的地方

- 只读诊断先行，全部结论有精确 SQL 计数支撑，未碰日常数据。
- 修复区分了"取消记录"与"取消事务"：维护事务照旧，只是不再留痕，投递可靠性零让步。
- 删除索引的迁移内置等价唯一索引验证，缺失即拒绝，不盲删。
- 原位迁移需求由用户提供了详尽边界文档（防空库、禁 CREATE、ticket 绑定路径），实现逐条对齐并
  以七种来源 × 四个强杀窗口的回归覆盖。
- 调查中途主动纠正了自己的错误陈述（历史 delta ≠ 活跃增长），未将错就错。

## 可以改进的地方

- 内部维护流量与领域命令的边界应在新事件类型进入持久路径前显式分类，而不是事后统计发现。
- 缺少"存储增长率 vs 业务事件率"的常规诊断；92% 的占比本可更早暴露。
- 备份目录缺少"至少保留一份 + 数量/期限上限"的清理策略，1.2 GB 无人知晓地躺着。
- 迁移备份复制循环的 25ms 固定等待属于明显的反模式，代码评审未拦截。

## 幸运之处

- 数据库未损坏、无数据丢失，修复无需恢复操作。
- 渠道接入仅三天（8-28 起），若数月后发现，`event_log` 将再膨胀一个数量级。
- 用户在同一天内提出了两个相关问题，使"增长源"与"升级路径"在同一个分析周期内被一起修复。

## 纠正与预防措施

状态反映本复盘发布时可用的证据。

| ID | 措施 | 责任角色 | 优先级 | 状态 | 证据或目标 |
|---|---|---|---|---|---|
| CPP-01 | 渠道 tick 走独立维护接口，不再产生 `channel_host.tick` 永久回执 | Channel Runtime | P0 | 已完成 | `cbae7eff`；[Channel Host Maintenance v1](../contracts/channel-host-maintenance-v1.md) |
| CPP-02 | 维护事务保留：FIFO admission、delivery lease、settlement 幂等与整笔回滚 | Channel Runtime | P0 | 已完成 | `host_ticks_are_ephemeral_and_reject_untrusted_or_invalid_requests` 及 FIFO fixture 扩展 |
| CPP-03 | Migration 129 验证等价唯一索引后原子删除重复索引 | Core Data | P0 | 已完成 | `v129_removes_only_the_redundant_index_atomically_and_keeps_sequence_uniqueness` |
| CPP-04 | 普通升级改为原位逐版本事务，停止整库复制/备份/manifest | Core Data | P0 | 已完成 | [V1.36-D07](../versions/v1.36/decisions.md#v1-36-d07)；[Desktop Runtime Availability v2](../contracts/desktop-runtime-availability-v2.md) |
| CPP-05 | 迁移失败/重试不得初始化空库；瞬时错误独立重试不占 crash budget | Core Data | P0 | 已完成 | `--require-existing-authority` 真实 Core 隔离进程验证（8 项） |
| CPP-06 | 为 event_log 增长率 vs 业务事件率的常规诊断（不含内容） | Core Observability | P1 | 已计划 | 建议纳入 Diagnostics 规划 |
| CPP-07 | 迁移备份目录保留策略（至少一份 + 数量/期限上限） | Core Data | P1 | 已计划 | 依赖旧 manifest 生命周期收口 |
| CPP-08 | 历史 tick 回执与 delta 行的清理/VACUUM 治理决策 | Core Data | P2 | 未开始 | 需独立数据治理批准；本复盘不授权删除 |
| CPP-09 | 修复仅存在于 `rovai/channel-integration` 分支，尚未合入 main | Release | P1 | 跟踪中 | `cbae7eff`..`0f124a4a`；合入 main 与 PR 待定 |

## 复发判据

若出现以下任一情况，视为本事故复发：

- 任何渠道 Host tick 再次写入 `event_log` 持久行（无论是否有业务结果）；
- 日常数据库在无聊天/无 Run 的静默时段出现持续线性增长；
- 普通版本升级再次触发整库复制、staging 数据库或迁移备份目录的新条目；
- 相同字段的功能重复索引再次被创建。

以下不算复发：既存历史 tick/delta 行继续存在（已接受的技术债，见 CPP-08）；升级时对旧 manifest
现场的兼容恢复（设计保留路径）。

## 经验

调度心跳不是领域事实。"每个命令一条永久回执"的契约只对表达用户或外部系统意图的命令成立；
内部维护流量的持久化成本必须由其语义价值证明。同样，安全机制的成本应与其保护的场景匹配：
逐版本 receipt 已经提供断点续迁，普通升级不需要灾难恢复级的整库快照。最后，无界写入的问题
不会因为写入变快而消失——批量事务优化让每条回执更便宜，也让 45 万条垃圾来得更早。

## 参考资料

- 修复提交 `cbae7eff`（perf(storage): migrate authority in place and bound channel maintenance writes，`rovai/channel-integration` 分支）
- [Channel Host Maintenance v1](../contracts/channel-host-maintenance-v1.md)
- [Channel/Main Schema Join v2](../contracts/channel-main-schema-join-v2.md)
- [Desktop Runtime Availability v2](../contracts/desktop-runtime-availability-v2.md)
- [V1.36-D07：严格准入后原位事务升级](../versions/v1.36/decisions.md#v1-36-d07)
- [v1.36 实施计划：渠道轮询与索引优化](../versions/v1.36/implementation-plan.md)
- [v1.36 实施计划：普通升级原位事务与启动反馈](../versions/v1.36/implementation-plan.md)
- [INC-2026-08-25：Codex 命令输出增量放大](2026-08-25-codex-command-output-delta-camp-open-amplification.md)（delta 遗留行的既往修复）
- [SQLite 查询规划：避免冗余索引](https://sqlite.org/queryplanner.html)
- [SQLite VACUUM](https://sqlite.org/lang_vacuum.html)
