---
document_type: implementation-plan
version: v0.69
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-13
---

# v0.69 实施与验收计划

## Checkpoint 0：权威与缺口冻结

- [x] 确认 ADR-0168 的长期领域决定不变，本版本不新增或替代 ADR；
- [x] 把源码审查发现的 launch handoff、waiting abortive settlement 与 deadline 三个缺口收口为
  v0.69 当前范围；
- [x] 在 Planned Shutdown Architecture/v1 Contract 中澄清阶段、授权与有界 guard 语义；
- [x] 为 v0.66 增加历史勘误，不改写当时真实通过的测试与验收记录。

## Checkpoint 1：Launch handoff 线性化

- [x] 以单调 lifecycle phase 取代 `launch_open / draining / terminal_open` 的重叠状态表达；
- [x] `closing_launch` 立即拒绝新 launch，并阻止新的 recovery/background Runtime 启动；
- [x] route binding 写入 happens-before launch permit 释放，writer barrier 完成后才能进入 `draining`；
- [x] Codex、ACP 与 one-shot terminal 通过单一 admission 接口选择 ordinary/planned 路径；
- [x] 可控 Barrier/oneshot 测试覆盖 Provider route 已激活、Core binding 未完成时触发 shutdown 和 terminal，
  并保留稳定错误 route 的负向 fence。

## Checkpoint 2：Waiting abortive settlement

- [x] planned-shutdown abortive settlement 的前置检查与最终 update 同步接受 `running | waiting`；
- [x] waiting Approval、可能/未 dispatch Action、Runtime Delivery 与 prepared/accepted input 按既有
  Run-local effect closure 结算；
- [x] 覆盖可靠 failed/cancelled 的 waiting 测试，并验证 terminal source/reason、Delivery 与 CampTurn
  聚合；
- [x] 保留普通 success blocker、CampTurn cancel intent、existing final output、错误 epoch/route、
  recovery blocker 与 sibling Run/Delivery 的既有 fencing。

## Checkpoint 3：硬 deadline 与短命 guard

- [x] launch、terminal 与 live-route close/drain 使用 deadline-aware 接口，不在 timeout 后再次无界等待；
- [x] agent task abort/join、Runtime shutdown/reap、Built-in/event/ACP worker 与 stdout flush 均有明确上界；
- [x] terminal transaction 成功后立即收口 active execution，并释放 terminal/route guard；
- [x] Renderer emit、Skill/MCP reconciliation 与 Adapter cleanup 移出 correctness guard；
- [x] 卡住 callback、Runtime reap 和 worker 的 deterministic tests 证明 report/exit 有界，unresolved
  accepted input 不产生伪 terminal。

## Checkpoint 4：验证与发布收口

- [x] `cargo fmt --all`、workspace check、严格 Clippy 与单线程 workspace test 全部通过；
- [x] `pnpm test`、typecheck、Desktop production build 与 planned-shutdown 相关 Renderer 回归通过；
- [x] `pnpm docs:test`、`pnpm docs:check`、diff-aware docs CI、ADR generated history 与 diff check 通过；
- [x] 隔离 packaged App 使用真实 Runtime 验证 accepted input、受控退出、可靠 terminal/诚实 unknown、
  descendant reap、重启 same epoch 与 no-resend；
- [x] 回填真实命令、计数、耗时、Runtime 版本和限制后，将 overview/plan 一致标记为 `complete`。

## 当前证据

已执行并通过：

- Rust：`cargo fmt --all -- --check`、`cargo check --workspace --all-targets`、
  `cargo clippy --workspace --all-targets -- -D warnings`；library `393/393`、CLI `11/11`、Core
  `72/72` 通过，另有 `3` 个显式 manual Runtime smoke ignored；
- planned-shutdown 聚焦回归 `19/19`，包含 `closing_launch` handoff barrier、稳定错误 route、绑定后
  non-terminal error 保留 unknown、waiting 的三类 wait reason × failed/cancelled、Run-local effect
  closure 与 deadline-aware terminal/route drain；Runtime Fleet deadline/force-kill 回归 `5/5`；
- `pnpm test`：文档治理 `21/21`、Vitest `311/311`、Node/benchmark `179/179`；同时通过
  `pnpm typecheck`、`pnpm build:desktop`、`DOCS_BASE_REF=origin/main pnpm docs:check:ci`、
  `pnpm docs:adr:generate -- --check` 与 `git diff --check`；
- `pnpm package:mac` 生成 arm64 packaged App，`codesign --verify --deep --strict` 通过；App 只在
  `dist/mac-arm64` 中验收，未安装或替换日常 App；
- `pnpm accept:planned-shutdown` 使用隔离临时 Git workspace/userData 与 Claude Code
  `2.1.220`：等待 Runtime input 为 `accepted` 后关闭，Desktop 在 `8504ms` 自然 `exit 0`，
  `forcedSignal=null`，Core report 为 `completed/deadlineExpired=true`，观察到的 `6` 个后代进程全部
  reap；Run 无 cancellation intent、无 terminal source/reason、无 `ended_at`，CampTurn 无取消；
- 同一隔离数据重启后，同一 Run 保持 `executionEpoch=1` 并进入 `waiting/recovery_blocked`，没有自动
  重发；第二次关闭在 `3863ms` 自然退出，`forcedSignal=null`，Core report 为
  `completed/deadlineExpired=false`。

真实 Runtime 此次没有返回可靠 terminal，因此该验收刻意证明 deadline 到期后的诚实 unknown 与
no-resend，而不是伪造 cancelled/failed；可靠 success/failed/cancelled 的同 generation settlement 由
确定性领域与 coordinator 回归覆盖。
