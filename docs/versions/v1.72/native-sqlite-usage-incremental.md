---
document_type: implementation-record
version: v1.72
authority: non-normative-runtime-evidence
status: implemented
last_updated: 2026-11-11
---

# Kilo / OpenCode V1：SQLite 用量增量读取

User sequence 82 要求核对历史重扫与预算问题，并共同修复。基线为 `9bf4194727cdcef1903aed2dbfe2f5f38b6b1004`，
独立分支 `rovai/kilo-models-bulk-probe`，worktree 为 `../rovai-ai-kilo-models-bulk-probe`，状态 `ready`。
主线已同步至 `92ff101a7de0485bb4e74750946eea4b3949f0b7`；不改变主 checkout 或其他工作的文件。

## 确认的问题与范围

两者共用 `native_usage.rs` 的 `OpenCodeUsageReader`。原 baseline 最多读取 8193 个历史 ID；
超出 8192 就放弃 reader。每次 poll 再选择该 Session 历史完成消息的数值，返回 Rust 后由 seen 去重。
去重防止重复计账，但没有避免历史 JSON 数值提取、查询返回及历史占用身份预算。

这是 P2 性能/规模问题。baseline 已在后台建立，prompt dispatch 和业务终态不等待该 I/O；
本轮没有证据把它称为 Warm 前台卡顿。OpenCode V2 使用自己的终态 Usage，不经过此 reader，范围不扩展到 V2。

## 现有 reader 内的修复

- baseline 从原生 message 表尾冻结一个物理行号与消息身份，不遍历 Session 历史 ID。
- 轮询在一个只读事务快照内校验 root Session/cwd 和 cursor 身份，向前读取新行的 ID/创建时间。
  按 rowid 范围访问原生主树，避免 Session/time 索引退化成历史遍历；不修改原生索引或数据库。
- 物理 cursor 前进与完成状态分开。本轮 pending 集合按消息 ID 点查；晚写入的完成时间、数值、
  初始空元数据及同一行错误后重试仍可接纳。user 等非 assistant 记录离开候选集。
- 完成调用沿原 source identity 去重，已计账消息不再查询数值。8192 预算分别约束本轮候选和已计账消息，
  不由 baseline 历史耗尽。原生数字桶、reasoning 合成、Context Gauge、Kilo cost 语义保持。
- 文件连续性与只读入口保留；行号删除重用或重排使 cursor 身份失配时停用当前 reader，
  不猜测恢复位置、不重新扫描历史。下一 Run 建立新的 baseline，已有 pending 仍属于历史。

没有最大消息 ID 或时间戳推断，不新增监控服务、持久化 cursor、Session 缓存、线程、定时器或后台账本。
既有 ACP 后台初始化、四秒采样及 Run/epoch 归属控制均未修改。

已核对两边官方 `MessageUpdated` projector：已有 message 按主键冲突更新 `data`，保留原行；
本轮 pending 的后续数值点查与这一原生写入方式一致，不依赖消息 ID 或创建时间单调。

SQLite 发现阶段只扫描全库新插入的物理后缀并筛选当前 Session；其他 Session 的新行也可能带来筛选工作，
但不从中提取数值。它不宣称所有数据库工作仅与当前 Session 的调用数有关。

## 修复前失败与测试归属

扩展既有 `opencode_metadata_excludes_old_pending_child_and_repeated_calls`，不新增/删除 Rust 测试函数。
真实原生 schema 的 Session/time/id 索引加入现有 SQLite fixture，预置 32,768 条完成历史。
仅加入大历史、尚未修改生产 reader 时，该 owner 明确失败：`native Usage baseline exceeds identity bound`。
完成修复后，同一 owner 通过，原数值、原生 witnesses、Session/cwd、子会话及私有内容排除断言保留。

新增矩阵覆盖空表首次记录、相同创建时间与非单调消息 ID、先创建后完成、元数据迟到、同一消息错误后重试、重复 poll、
后继/冷 baseline、Kilo 费用去重、最高行号删除重用和超过本轮候选预算。
对生产实际使用的两条发现 SQL 读取 SQLite VM step 计数，不使用壁钟性能断言：

| 32,768 条历史，三个新行（含一个子会话） | VM steps | 返回 |
| --- | ---: | --- |
| 读取表尾 cursor | 10 | 一个身份 |
| 读取新增候选 | 34 | 当前根 Session 的两个新身份 |

该计数是本机 bundled SQLite / fixture 的确定性执行证据，不是跨平台 I/O 耗时保证。
单独纯 parser 不能证明索引/游标查询、完成时间更新或跨 poll 去重，因此沿用 SQLite owner。

最小入口：

```sh
cargo test -p rovai-core --features extended-tests --lib native_usage::tests::opencode_metadata_excludes_old_pending_child_and_repeated_calls -- --exact --nocapture
```

## 验证与未验证范围

最终验证结果：

| 门禁 | 结果 |
| --- | --- |
| `cargo test -p rovai-core --features extended-tests --lib native_usage::tests -- --nocapture` | 3 passed；含最终空表、长历史及查询工作量矩阵 |
| `pnpm test:rust:pr` | 484 passed / 1 existing ignored |
| `cargo fmt --all -- --check` | passed |
| `pnpm docs:test`、`docs:check:ci` | passed；CI 比较基线为上述主线 SHA |
| `git diff --cached --check` | passed |

首轮默认 workspace 为 437 passed / 1 failed / 1 ignored，失败为未修改的
`runtime_probe_process::tests::cancelling_the_owner_kills_the_spawned_process_group`，
其“子进程两秒内退出”断言超时。该项单独复查通过，随后按原 `pnpm test:rust:pr` 完整重跑通过；
不改该测试、回收期限或默认测试集。失败对照记录保留，修复前的 SQLite fixture 已清理，成功 fixture 由 owner 自行清理。
本次不启动日常 App/Core，不读取或写入用户原生数据库，不进行新付费模型生成或提升平台资格。
本机验证为 macOS arm64，不冒充新的 Linux/Windows 或真实模型资格验收。
Reader 启动过晚、原生行格式不兼容、锁忙、连续性丢失及本轮超限仍保留 partial/unknown，
不通过 ACP 或历史重扫补齐账单；SQLite 的通用手工导入/重写不作为新支持能力。

## 文档与合同影响

当前[监控架构](../../architecture/runtime-monitoring.md#本地原生数值来源与-context)和
[测试归属](../../development/testing.md#kilo-官方-acp-验证归属)已同步。
Usage v11 及其继承的每 Run 去重、历史排除、部分统计和有界观察合同保持，不改 wire/Schema/错误或投递语义，
无需增加合同版本、Version Decision 或模型上下文治理；平台资格、UI、活动映射和 Root README 均无需更新。

## 官方依据

- [Kilo 的 message 表与索引](https://github.com/Kilo-Org/kilocode/blob/03a6f07d053cd7e6aa88fa1e258e93510335259f/packages/core/src/session/sql.ts)。
- [OpenCode 1.18.32 的 message 表与索引](https://github.com/anomalyco/opencode/blob/v1.18.32/packages/core/src/session/sql.ts)。
- [Kilo 原生 message 更新](https://github.com/Kilo-Org/kilocode/blob/03a6f07d053cd7e6aa88fa1e258e93510335259f/packages/core/src/session/projector.ts#L282)、[OpenCode 1.18.32 原生 message 更新](https://github.com/anomalyco/opencode/blob/v1.18.32/packages/core/src/session/projector.ts#L260)。
- [SQLite rowid table 语义](https://www.sqlite.org/rowidtable.html)：物理行号可被重排，不能作为无连续性验证的永久身份。
