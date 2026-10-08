---
document_type: verification-record
version: v1.72
authority: implementation-evidence
last_updated: 2026-10-08
---

# Core legacy heartbeat 移除验收

基线 `51c8b346`，任务分支 `rovai/remove-global-heartbeat`。范围是移除整个 legacy 500ms maintenance，
保持数据库、现有事务和执行状态机。当前规范见 [Single Chat](../../architecture/single-chat.md)、
[Automation](../../architecture/scheduled-automation.md)、[Delivery](../../architecture/public-a2a-message-delivery.md)
及 [Planned Shutdown](../../architecture/planned-shutdown.md)。

## 原消费者与替代入口

从原 `process_agent_run_maintenance` 的循环体和通知分支逐项核对：

| 原职责 | 替代驱动／owner | 恢复、阻塞和退出 |
| --- | --- | --- |
| Pending FIFO 发布、non-batch Run 派发 | `process_non_batch_runs`：发送／队列编辑／终态事务提交、readiness／cleanup 变化 | 启动扫描；修复／就绪等待对应通知，暂时失败按 3s 重试；准备并发上限 16，独立于普通 batch 协调循环 |
| Automation 到期、occurrence 结算／超时、通知准备 | `process_automation_deadlines`：相关提交及最早 next_run_at／timeout_at／available_at | 先 settle 再 claim；每批 16 后重新查 deadline，skipped 积压继续且让出执行权；沿用启动 interrupted/missed 规则 |
| CampTurn elapsed execution budget | `process_execution_budgets`：运行事实变化、最早 deadline | 保留原预算时间源与每批 100 的结算；已耗尽项退出提醒 |
| Runtime 授权响应 | `process_runtime_authorizations`：Action／Delivery／绑定变化、future available_at | 重验原 epoch／授权／lease；无 Runtime 时等变化，SQL 暂时失败 3s 后重试 |
| Runtime 取消／终态 cleanup | `process_runtime_cancellations`：提交及 cleanup 结果 | 每批最多启动 32；同 epoch 去重；失败才安排 500ms 重试，保留原 3s 总 cleanup 界限 |
| 终态文本定稿 | `process_text_retries`：新失败及最早 retry_not_before | 原 buffer、首次 500ms 指数退避至 30s；无失败不设 timer，成功移除；只重试文本 |
| Mission cleanup、Camp 删除 | `process_housekeeping` 中原通知和原低频入口 | 原 gate 和业务服务；子任务进入 Core 原 tracked task set |
| MCP 回收、执行意图／文件投影恢复、Blob GC | `process_housekeeping` 中原低频入口 | 不增加频率或扫描职责；统一停止并等待 |

普通 Delivery 仍由原单一 Scheduler 领取，保留启动扫描和固定 30s 恢复入口。网络恢复仍只派发已获准的
既有 Run。没有新增 Job 表、事件日志、通用调度框架或第二份业务状态。

## 删除与生命周期

- 删除 `process_agent_run_maintenance`、500ms interval／tick 分支、maintenance 启动注册、专用退出通知和旧 abort helper。
- 有限的独立 Notify 只传“需要重验”的合并许可，每个消费 owner 各用一个；未进入 wait 的通知也可保存。
- DomainCommandGateway 在实际 commit 后、文本收尾前唤醒；直接结算事务也在后处理前通知。
- `run_core` 直接持有等待任务 JoinSet；正常退出和强制 launch-handoff 超时均停止并等待。
  non-batch preparation、cleanup／投影、Mission/Camp 清理进入已有 Core task set，报告后不能遗留业务写入。
- 未改变公开文本定稿事件 shape；`nativeMethod=execution-text-maintenance` 仅为保留的事件来源值，不是循环入口。

## 计时器清单

新增的是按需等待入口，原业务 deadline／backoff 值继续沿用：

| 时间等待 | 何时存在 | 用途 |
| --- | --- | --- |
| Automation 最近 deadline | 有 enabled 计划、active timeout 或 future notification available_at | 一次性到期重验，修改／关闭／删除后重算 |
| 执行预算最近 deadline | 有未耗尽的 active CampTurn deadline | 原预算到期结算 |
| Runtime authorization available_at | 有 future pending 授权响应 | 到时重验原响应资格 |
| 文本 retry_not_before | 定稿实际失败 | 500ms、1s、2s…至 30s，成功移除 |
| Runtime cleanup retry | 本轮 cleanup 未确认 | 500ms 后重试原 cleanup，成功移除 |
| non-batch 暂时准备失败／读取失败，其他推进读取失败／不确定时钟采样 | 本次实际失败 | 3s 一次性重试；cleanup 准入等到已有 3s 截止时间 |
| 受限时间重观察 | Automation／预算／授权有未来 deadline | 最多 30s 重看墙钟；对应 deadline 未到期不查 SQL，覆盖缺失墙钟通知，不扫描无关业务 |

原有周期任务保持：普通 Delivery 30s 恢复；MCP/Mission 30s；pending execution intent／终态文件投影 15s；
Blob GC 60s（1h 宽限，每批 32）；Camp 删除启动后 1s、随后 15s。Channel Host 继续拥有通知发送、availableAt
退避与 outstanding-work lease watchdog。Runtime 其他已有监控／回收周期不属于本次删除范围。

## 测试 owner 与准入

新增两个等待边界 owner，其他回归扩展原有测试：

- `application::execution_drivers::tests::notifications_survive_processing_and_wait_registration`：
  原循环隐藏的“提交先于 wait／处理中又提交”、通知合并、不同 owner 信号隔离、提前 deadline 与 shutdown。
  原有领域测试不拥有等待原语，使用暂停时间与 Notify，不建数据库。
- `application::execution_drivers::tests::idle_drivers_do_not_scan_and_skipped_backlog_drains_without_ticks`：
  真实生产等待任务＋隔离 Core fixture＋SQLite VM 计数。原领域测试不能证明后台仍在扫描或空 dispatch 批次滞留。
  启动对账与 1s 删除检查结束后，在 10s／20 个原 tick 机会中新增 SQL VM operation 为 **0**；
  33 个全 missed 定义不推进时间即处理完，通知后会扫描，停止后再通知／推进 120s 不再扫描。
  注入 Automation SQL 读取失败后，1s 内不重复读取，3s 到期无需新通知即恢复，避免故障忙循环。
- `single_chat::tests` 扩展原 send/FIFO owner：提交唤醒、前一 Run 终态唤醒和发布后再次唤醒；私有路由、
  FIFO、附件修复、取消和迟到输出沿用原矩阵。
- `automation::tests` 扩展 missed owner 到 33 个定义、最近 deadline 查询、提前修改／关闭／删除重算和通知
  future available_at／已提示排除。
  原 overlap、超时、通知独立性和启动恢复 owner 继续使用；AutomationClock 原 owner 保留真实睡眠、执行器迟到、
  回拨和不确定采样的确定性观察输入。
- `execution_text::slow_tests` 在原注入失败 seam 断言：终态已提交、收尾返回 Err，仍唤醒 runs/automation/cancel/text；
  不重放事务，retry deadline 仅在失败期间存在。
- 原强制 scheduler abort owner 改为真实 JoinSet 的 abort＋drain；原 cleanup 去重 owner 增加生产 driver 自动重试。
  原测试的退出、去重和不确认 cleanup 隔离断言保留。
- 原 intercepted Action authorization owner 验证扫描开始后刚到期的响应仍保留提醒、已观察但阻塞的响应不空转。
  扫描和提醒使用同一观察时间下界，避免两个查询之间到期的工作丢失唤醒。

最小命令使用 `cargo test -p rovai-core --features slow-tests --lib <owner>`，不得将 0 tests 当作通过。

## 实际验证与平台边界

macOS 隔离验收实际通过：

| 检查 | 结果 |
| --- | --- |
| `cargo check --workspace` | 通过 |
| `cargo fmt --all --check`、`git diff --check` | 通过 |
| `pnpm test:rust:pr` | 453 项通过；1 项要求真实 Runtime 的既有 smoke 按声明忽略 |
| `cargo test -p rovai-core --features slow-tests --lib <owner>` | 133 项不同定向用例通过，见下方 owner 范围；重复回归不重复计数 |
| `pnpm test` | Vitest 238 文件／2602 项通过；Node 主脚本组 334 项通过、2 项 Windows 用例跳过；文档／Skill／sandbox 分别 10／3／7 项通过 |
| `pnpm docs:check`、`DOCS_BASE_REF=51c8b346 pnpm docs:check:ci` | 在同基线、包含完整改动的干净验证 worktree 通过 |
| 空闲与停止 | 生产等待任务在启动对账后 10s／20 次原 tick 机会内 SQL VM 操作增量为 0；停止并等待后推进 120s，无扫描或写入 |

定向 owner：Automation 9、AutomationClock 1、Single Chat 9、文本收尾 1、Action 20、Runtime 34、
Planned Shutdown 11、Channel 38、Delivery pending-work gate 1、新等待边界 2；Application 的强制退出、
cleanup 重试、native failure gate、launch 取消、网络恢复各 1，Automation suspend/resume control 2。
测试使用现有断言验证 FIFO／私有路由、overlap、通知与执行隔离、超时／取消、accepted input 隔离和 shutdown；
新增等待边界负责通知与 deadline 的竞态、skipped 批次和空闲行为。

主工作区 `docs/prototypes/` 下有 Git 忽略的本机原型及既存失效链接，直接全量文档检查会读到它们。
因此文档和完整 `pnpm test` 在干净验证 worktree 执行，使用相同受控文件与改动；没有修改原型或增加门禁例外。

本次使用自动验收通道，Core/数据库／Skill Library／MCP／Runtime files 均由临时 fixture 隔离；没有启动日常
App/Core 或真实模型。未实测 Windows/Linux 原生休眠、实际设备睡眠及 NTP 调钟；时钟分类使用已有确定性测试，
不能代替这些平台实机证据。旧基线每 500ms 进入一次全局业务扫描来自基线代码，不冒充旧二进制的实测计数。

## 2026-10-08 准备期间唤醒补查修复

基线 `2881a26a`，分支 `rovai/non-batch-wake-recheck`。旧协调器消费条件变化通知后，会跳过仍在准备的
Run；若其准备结果为无进展、没有其他通知或重试 deadline，完成后就可能永久等待。

- `process_non_batch_runs` 在消费变化通知时，给当时每个 in-flight Run 标记一次待重验；准备完成后消费标记，
  即使未推进也补查数据库。多个通知合并为一个标记；没有新通知且未推进时继续等待，读取失败沿用既有退避。
- 只补充协调器的内存标记，没有新增定时器、任务、持久状态或调度抽象；原准入、并发上限与退出监督不变。
- 新增独立 regression owner
  `application::execution_drivers::tests::non_batch_preparation_rechecks_coalesced_wakes_once_without_spinning`。
  现有 Notify owner 不拥有“扫描跳过 in-flight Run 后准备完成”的窗口；复用隔离 Core fixture，使用真实
  Single Chat Run、生产协调器、实际 readiness 通知和 SQLite VM 计数。通过单线程手动 poll 固定顺序，
  在通知被消费前不允许准备任务完成，无真实 Runtime、网络、随机延迟或新增生产测试 hook。
- 同一测试在旧生产逻辑上失败：完成后预期一次重验，实际为零。修复后通过：重复通知不并发准备同一 Run，
  无进展完成后只补一次检查；另一 readiness 条件仍阻塞时，继续推进 60 秒没有 SQL 增量或重试 deadline。
- 定向回归使用 `cargo test -p rovai-core --features slow-tests --lib <owner>`，先核对 `-- --list` 非零：
  execution drivers 3、Single Chat 9、Planned Shutdown 11，共 23 项通过。既有空闲、48 小时无预算唤醒、
  FIFO、停止和关闭断言保留。此交错验证在 macOS 隔离 fixture 执行，未启动日常 App 或真实模型。
- `pnpm test:rust:pr` 453 项通过、1 项既有真实 Runtime smoke 按声明忽略；`pnpm docs:test` 10 项通过；
  `cargo fmt --all --check`、`git diff --check` 通过。文档门禁在同提交的干净验证 worktree 执行，命令为
  `pnpm docs:check` 与 `DOCS_BASE_REF=2881a26a pnpm docs:check:ci`，本机忽略的原型保持原样。

## 与 main 集成

合入前同步 `ed90fa9b`，保留 main 的用户授权续做入口和 `RuntimeThinking` 状态类型，同时保留本次独立唤醒与
cleanup deadline 所有权。当前规范合并到 [Message Delivery v11](../../contracts/message-delivery-v11.md) 与
[Run Process Detail Surface v45](../../contracts/run-process-detail-surface-v45.md)；已退为历史的 v10／v43 保持
main 原文，不把本次新行为反写到历史合同。
