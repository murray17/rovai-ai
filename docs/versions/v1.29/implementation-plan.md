---
document_type: implementation-plan
version: v1.29
authority: implementation-and-acceptance-status
status: completed
last_updated: 2026-08-27
---

# v1.29 实施计划

## 实施步骤

- [x] 确认添加、移除、至少一位成员、Lead successor、普通再次添加与模型上下文边界；
- [x] active member（包括 away）相同 capability overrides 保持 no-op，不同 overrides 显式 conflict；受信
  source 的 accepted no-op 正常推进 source reconciliation generation；
- [x] 完成 Migration 110、membership generation/version、外部来源绑定与旧非终态工作 clean break；
- [x] 独立完成 Migration 111 zero-attempt cancellation hotfix：从 current-main v110 数据库升级到
  Data Contract v1.24/schema 65，显式/批量取消复用转换并清除 wait/attempt/projection association；
- [x] 完成 Migration 112 Managed Attachment v2：新 Composer/Agent 文件经 durable intent 一次 ingest，最终
  Message/ref/Delivery 事务绕过 legacy View gate，历史 v1 保持只读兼容；
- [x] 完成 Migration 113 planned shutdown protocol 扩展：保留历史 pending v2 cycle，并允许新 v3 cancel-all
  intent 持久化与重启补偿；
- [x] 保持 Context DB-only：v2 payload 缺失时仍投影持久路径，不增加 unavailable descriptor 或 Run Fact；
- [x] 解除新 Run 对 legacy View readiness 的隐式依赖：no-legacy receipt 不查 View，失败 legacy locator 安全省略，
  dispatch 使用稳定 Camp root 且不取得 read admission、不检查 unresolved writer intent、不触发 rebuild；
- [x] 完成 add、removal preview、atomic cutover、durable reconciliation 与任务释放；
- [x] 给 Agent 业务工具、Message Delivery、Gather completion 和公开输出增加 exact membership lifetime fence；
- [x] 收口 ordinary outbound source lifetime：pending Delivery cutover、materialized target reconciliation 与
  dispatch/retry 双重 fence；
- [x] 完成 Desktop typed IPC、Camp open projection 与 event invalidation；
- [x] 完成添加多选、成员 `•••` 菜单、权威移除预览、最后成员禁用和 reconciliation 状态；
- [x] 完成安全退出交互：立即阻止新界面操作，400ms 内完成不闪现等待面，慢退出显示中性 busy modal；
- [x] 完成 Rust、TypeScript、Renderer 与 Migration 定向回归；
- [x] 运行完整自动化、文档治理和格式/Clippy 门禁；
- [x] 使用隔离 userData 在真实 App 验收日/夜主题、键盘、添加、移除、冲突和恢复；
- [x] 提交并推送 `rovai/dynamic-camp-membership` worktree 分支；
- [x] dynamic membership 基线已通过独立 PR 合入 `main`；zero-attempt cancellation 继续使用独立 PR，
  不替换本机 App；
- [x] 以真实 `projection_blocked` CampTurn Stop、显式 pending/interrupted 取消、已有 attempt 取消、迟到
  projection success/failure、current-main v110→v111 升级及 restart 回归证明 cancelled terminal 单调；

## 验收原则

- 添加只改变未来新 Run；旧 Run 的 Context、授权和 membership lifetime 不被改写；
- 旧 Run 可以按 send admission 的当前名册联系后来加入的成员，但其 accepted outbound Delivery 不能越过 source
  membership cutover；
- 移除提交成功即阻止新业务效果，reconciliation 只描述已接受工作的正式终态进度；
- 离开后再添加不会恢复任何旧 Run、Delivery、Gather、Task ownership 或 Tool capability；
- UI 不用乐观假状态代替 Core generation/version，也不隐藏至少一位成员的约束。

## 验证证据

- `pnpm test`：82 个 Vitest 文件、585 个 Renderer/TypeScript 测试通过；Node 协议测试 219 个通过、
  1 个既有用例按环境条件跳过；
- `pnpm typecheck`、`cargo check --workspace --all-targets`、
  `cargo clippy --workspace --all-targets --all-features -- -D warnings` 通过；
- `cargo test -p rovai-core --all-targets`：Core library 326/326、CLI 25/25、Host 161/161 通过，4 个显式
  manual Runtime smoke 保持 ignored；其中 Migration 111 回归从 current-main 的
  `v1.23 / schema 64 / migration 110` 数据库复现 SQLite 275，再升级到 `v1.24 / schema 65`，验证
  zero-attempt cancellation 可写、Migration 111 重启幂等且 terminal Delivery 不复活；Migration 112 再从
  `v1.24 / schema 65 / migration 111` 升级到 `v1.25 / schema 66` 并验证重启幂等；Migration 113 保持该
  contract/schema marker，验证 pending v2 cycle 不丢失、新 v3 cycle 可写且重启幂等；
- Managed v2 回归覆盖源 Run 仍为 `running` 时发送 4 个共 14 MiB 文件、Delivery 在源 Run 结束前开始、零
  legacy publication operation/gate、同一 attachmentId 多 Message ref 不二次复制、Context 在 payload 被删后
  仍只按数据库投影稳定路径、legacy rebuild 不删除 v2 resource，以及 staging/promote 两个 commit 前 crash
  窗口的 orphan cleanup 与同 command id 重试；
- `cargo clippy -p rovai-core --all-targets --all-features -- -D warnings` 通过；
- `cargo test -p rovai-core --features slow-tests --lib slow_tests::`：291/291 通过，覆盖动态 membership、
  active-away no-op/source generation、当前名册 target admission、ordinary outbound source-lifetime
  cutover/dispatch/retry fence、exact-run business-tool fence、Delivery/Gather settlement 与 Missing-Send
  Recovery publication fence；
- `node --test scripts/benchmark/protocol/product-contract.test.mjs`、`pnpm docs:test`、`pnpm docs:check` 通过；
- `DOCS_BASE_REF=f588c773c2652a9e78887a31d17de8ed37524bb0 pnpm docs:check:ci` 通过；
- `pnpm package:mac:unsigned` 通过；`pnpm accept:member-lifecycle-ui` 使用系统临时目录中的隔离 userData
  与打包 App 通过，覆盖最后成员禁用、模型详情、添加、移出预览、普通再次添加、日/夜主题、键盘、无横向
  溢出、重启持久化和旧库迁移；当前受限执行环境不允许 macOS/Chromium sandbox 初始化，因此仅该验收进程
  使用 `ROVAI_MEMBER_LIFECYCLE_ACCEPT_NO_SANDBOX=1`，产品默认启动参数未改变；
- `pnpm package:mac` 与 `pnpm accept:planned-shutdown` 通过；隔离打包 App 在真实 Runtime 活跃时满足 5 秒
  关闭目标，并验证 400ms 防闪、“正在安全退出”日/夜主题、200% zoom、reduced motion、无操作按钮、
  Run-local 取消审计、未知效果保留、自然退出和完整进程树回收；
- 本次 `pnpm test:rust:pr` 三个分组全部通过，无忽略或失败测试。
