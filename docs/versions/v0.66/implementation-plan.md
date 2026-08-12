---
document_type: implementation-plan
version: v0.66
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-13
---

# v0.66 实施与验收计划

## Checkpoint 0：领域、ADR 与合同

- [x] 冻结 planned shutdown 与 CampTurn Stop、异常恢复的边界；
- [x] 冻结同 generation route binding、真实 terminal proof 与 Provider Turn ID 可选语义；
- [x] 冻结可靠 success、abortive failed/cancelled 和 Run-local effect closure；
- [x] 冻结 `CampTurn.cancelled` 只来自 Turn cancellation intent 的通用聚合不变量；
- [x] 冻结 launch/terminal/live-route admission、deadline linearization、Main-only IPC 与 UI projection。

## Checkpoint 1：Migration、终态和聚合

- [x] Migration 77 增加 AgentRun terminal source/reason 与 CampTurn aggregate reason，并升级 Data/Read
  contract；
- [x] 普通 Runtime terminal 写稳定 source，无 terminal proof 的 Core launch failure 保持 source 为空，
  planned-shutdown terminal 在同事务写 planned reason；
- [x] 抽取参数化 Run-local effect closure，保留 Action `resolution_source=reconciler` 的证明语义；
- [x] planned-shutdown abortive settlement 覆盖可靠 failed/cancelled，cancelled 要求 planned stop；
- [x] Message Delivery 只结算 exact target，区分 planned-shutdown cancellation；
- [x] CampTurn required cancelled 聚合为 failed/required_run_incomplete，optional failed/cancelled 不阻塞完成；
- [x] Read Side、TypeScript contract 与 replay/idempotency 覆盖新字段。

## Checkpoint 2：Core lifecycle coordinator

- [x] launch admission 覆盖 claim → acquire → prepare → prompt-send handoff，并消除 detached launch race；
- [x] draining 后停止 Scheduler、recovery launch 和后台 Runtime launch，但保留领域/terminal write；
- [x] active execution registry 绑定 generation、route、Run、epoch、Adapter correlation 与 planned stop；
- [x] 九 Runtime planned stop 并发发出，RPC/process exit/transport error 均不结算；
- [x] terminal guard 在真实 observation 到达 settlement gate 时短命创建，不在 beginDrain 预发；
- [x] live Runtime route admission 在 drain window 保留 callback，deadline 时线性化围栏并排空已进入回调；
- [x] monotonic deadline 依次 close terminal guard、drain terminal transaction、fence route/Built-in、
  reap Runtime；
- [x] unresolved accepted input 保持非终态，退出过程不触发虚假 recovery write。

## Checkpoint 3：Desktop 与 Renderer

- [x] 增加 Main-only `core.shutdown` wire 和 `CoreClient.shutdown()`，重复调用复用 Promise；
- [x] shutdown 开始即禁止 restart，等待 report 与真实 child exit；
- [x] Core deadline 外层 watchdog 才发 SIGTERM，随后 SIGKILL 兜底；
- [x] `before-quit` 阻止立即退出，Core 结束后再真正 quit，不向 Renderer 暴露关闭 authority；
- [x] planned-shutdown cancelled 显示“已停止”与真实 Runtime 确认文案；
- [x] cancelled Run 的 unsettled external effect 继续显示；
- [x] 关闭期间显示无取消操作的 accessible modal，如实说明 unknown 保留。

## Checkpoint 4：验证与发布收口

- [x] DB/domain tests 覆盖 required/optional、retry、budget、Turn cancellation 和 Delivery sibling isolation；
- [x] Core concurrency tests 覆盖 drain/claim、terminal/deadline、duplicate/conflict、route fence 与 unknown；
- [x] Desktop tests 覆盖 idempotent shutdown、report→exit、restart suppression、SIGTERM/SIGKILL fallback；
- [x] Renderer unit tests 覆盖 terminal source copy、cancelled unsettled warning、accessible modal 与长文案；
- [x] Rust fmt/check/test、TypeScript typecheck/Vitest/build、docs:test/docs:check/docs:check:ci 全部通过；
- [x] 真实 packaged App 视觉检查覆盖 Day/Night、`1040×700`、200% zoom、reduced motion 和自然退出；
- [x] 真实 Claude Code input accepted 后的 stop/deadline、unknown 保留、进程 reap 与下次启动 recovery
  blocker 验收通过，版本状态改为 complete。

## 当前自动化证据

- `cargo fmt --all`、`cargo check --workspace`、`cargo clippy --workspace --all-targets -- -D warnings`；
- `cargo test --workspace -- --test-threads=1`：library `363/363`、CLI `10/10`、Core
  `68/68`，另有 `3` 个显式标注的真实 Runtime 手工 smoke ignored；
- `pnpm test`：docs `21/21`、Vitest `302/302`、Node/benchmark `155/155`；
- `pnpm typecheck`、`pnpm build:desktop`；
- `pnpm package:mac`、`pnpm accept:runtime-activity-ui`：九 Runtime 过程 fixture、恢复 blocker、
  `1040×700`、200% zoom 与 reduced motion 通过；
- `pnpm accept:planned-shutdown`：隔离 packaged App 启动真实 Claude Code `2.1.220`，input accepted
  后主动退出；关闭等待 `12273ms` 后自然 `exit 0`，六个已观察子进程全部 reap，Run/Turn 未写取消
  意图或伪 terminal。相同数据重启后同一 epoch 进入 `waiting/recovery_blocked` 且未重发，第二次
  关闭 `7626ms` 自然退出；Day/Night、`1040×700`、Night 200% zoom 与无操作 accessible modal
  截图/DOM 断言通过；
- `pnpm docs:adr:generate`、`pnpm docs:test`、`pnpm docs:check`、
  `DOCS_BASE_REF=origin/main pnpm docs:check:ci`、`pnpm docs:adr:generate -- --check`；
- 隔离数据目录 Core wire smoke：未知字段返回 `CORE_SHUTDOWN_INVALID` 且 Core 继续存活，
  随后合法 v1 request 返回 `status=completed`、`deadlineExpired=false` 并自行退出。
