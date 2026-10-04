# Usage 分批刷盘一致性验收（2026-10-03）

本轮为确定性正确性修复；基线 `6682fbc9`，独立 worktree `rovai/runtime-execution-metrics`。
以下数据都是合成回放，不是实际模型账单，不更新各 Runtime 的真实支持状态。

## 复现与修复

修复前的新回归在同批输入 A=(100, null, 0, 10)、B=(50, 20, 0, 5) 后失败：
Input=170、uncached=150、read=20、write=0、output=15，quality=runtime_reported。
这里的四项输入依次为原生 uncached、cache read、cache write、output，语义为互斥桶。
B 的分类错误地补齐了 A；原有分批路径只能得到 B 的 Input=70。

修复将归一化移到每个调用进入 buffer 时，保留结果、来源身份和数值帧顺序。
Flush 只把已归一的字段加到 summary/hourly。Delta 临时 checkpoint 按单个调用身份去重，
重复投递与提交后重试不会重复加和；失败恢复先接旧帧，再接新到帧。累计首基线、reset 和
各帧观测时间不再被最后一帧覆盖。请求命中分子/分母按有明确 Cache Read 的独立模型调用生成。

## 回放结果

[可执行 fixture](../../../crates/rovai-core/tests/fixtures/runtime-usage/flush-partitions.json)
保存输入的原始数值字段、scope/counter mode/input semantics 和最终预期列。
8 组、24 种 Flush 分区均经 `observe_run → normalize → buffer → SQLite → summary/hourly`：

| 场景 | 最终 Input / Output | 请求 hit / observable | Input/Output 完整性 |
| --- | --- | --- | --- |
| A read 缺失、B 完整 | 70 / 15 | 1 / 1（A 不可判断命中） | 部分 |
| 上述调用顺序反转 | 70 / 15 | 1 / 1 | 部分 |
| A write 缺失、B 完整 | 70 / 15 | 1 / 2 | 部分 |
| A output 缺失 | 170 / 5 | 1 / 2 | 部分 |
| 三个完整调用，仅一个命中 | 200 / 18 | 1 / 3 | 已收到的调用完整 |
| 两次显式零值调用 | 0 / 0 | 0 / 2 | 已收到的调用完整 |
| inclusive 的缺失字段互补 | 100 / 15 | 1 / 1 | 部分，不跨调用推导 uncached |
| 累计 100→150→20(reset)→40 | 70 / 7 | 未知（Session 累计） | 已收到的差分完整 |

每种分区重复投递原始事件，并在 checkpoint INSERT 注入真实 SQLite ABORT，确认 summary/hourly
事务回滚，然后恢复失败批次。存在后续分区时先接收新帧再恢复旧批次，检查累计基线顺序。
Delta 还重试已提交批次，必须零新增。每种分区都比较 summary 的 7 个计数和 quality，以及 hourly
的 7 个计数；另有现存 owner 覆盖 execution epoch 恢复、终态清 checkpoint 与 Context 压缩下降。

## 完整性读取

复用 `usage_quality` 保存粘性的 runtime_reported_partial，不新增表或字段。Input/Output 的任一
收到的 contribution 不完整时，后续完整调用和 finalization 都不能将部分和变成完整 Run 总量。
这是 Input/Output 覆盖状态，不宣称 Cache Read/Write 各自覆盖了所有调用，也不证明原生没有漏发。

Core 返回 `inputOutputComplete`；SQL 读 owner 验证新完整、部分和旧 collector 行。Renderer 的
现有入口判断只对成功且已结算的完整数值求 Input＋Output；70＋15 的部分示例保持未知入口，
气泡仍可读取已经收到的字段。已知零值仍可显示零，完整示例为 218，不再加 Cache Read=20。
现有快照相等比较包含该字段，完整性变化会更新对应行。

旧 parser_version < 5 的历史行没有完整性证据，因此保留数值、完整性未知，不扫描正文或重算历史。
这不是 Runtime CLI 版本门槛。布局、Context 与原生 Runtime 采集资格不变；没有新增速度逻辑。

## 自动化与 owner

- 定向：`cargo test -p rovai-core --features extended-tests --lib monitoring::tests::`，13 项通过。
- Renderer：`pnpm exec vitest run apps/desktop/src/renderer/src/execution-metrics-reader.test.ts apps/desktop/src/renderer/src/execution-console-layout.test.ts`，34 项通过。
- `pnpm typecheck` 通过。
- 默认 `pnpm test:rust:pr`：447 项通过、0 失败、1 项既有 ignored；新 SQLite owner 按准入进入扩展层。
- `pnpm docs:test`、`pnpm docs:check`、`DOCS_BASE_REF=3bf3cce6f758b9055e1dd377f336d3609e8ab1a8 pnpm docs:check:ci` 均通过。

新增 Rust owner `call_normalization_and_request_counts_do_not_depend_on_flush_partition` 归
[Usage v8](../../contracts/runtime-usage-monitoring-v8.md)；专门拥有分区不变性和原子 Flush 失败恢复。
既有单值 normalize owner 不能覆盖事务 rollback、跨 Flush checkpoint 与 summary/hourly 读取；
既有累计 owner 没有共享键的独立 delta 调用，所以使用一个隔离临时 SQLite 库，进入 extended-tests。
其他 parser、Pi/Codex buffer 和 execution 读测试在原 owner 内扩展，无删除或禁用测试。

本轮没有重新调用真实 Runtime、重打包或覆盖用户日常 App；定时器分区缺陷由固定回放验证。
历史账单数字可能已受旧逻辑影响；没有保存原始 observation，无法可靠自动修复旧汇总。


## PR #568 合入 main 前补验

与 main `70439069` 汇合时保留主线 v0.4.3、Run 分页和成员创建来源关联，并保留指标分支的 schema 132
已部署兼容链路。五份文档冲突已按各自当前合同合并；ZCode transport 仅按 rustfmt 整理格式。

合并结果验证：`pnpm typecheck`、`pnpm test`（235 个 Vitest 文件、2525 项；组合 Node suite
328 通过、2 项平台跳过）、`pnpm test:rust:pr`（450 通过、1 项既有 ignored）、定向 Monitoring
13 项、`cargo fmt --all --check` 与基于 `70439069` 的文档门禁通过。

生产 Renderer 的既有 `pnpm test:execution-metrics-ui` 隔离 Electron owner 已补验通过：500 Run 可视
范围读取、隐藏暂停/恢复、稳定终态停止轮询、迟到用量、原生 Session 切换和失效，以及数值不变仅
完整性变化时从部分入口切到总量入口。fixture 显式提供 inputOutputComplete，百分比期望沿用当前
合同的一位小数。此次不启动 Core/真实 Runtime，不使用日常 userData，不安装日常 App。
