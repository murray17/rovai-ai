---
document_type: implementation-plan
version: v1.29
authority: implementation-and-acceptance-status
status: completed
last_updated: 2026-08-26
---

# v1.29 实施计划

## 实施步骤

- [x] 确认添加、移除、至少一位成员、Lead successor、普通再次添加与模型上下文边界；
- [x] active member 相同 capability overrides 保持 no-op，不同 overrides 显式 conflict；
- [x] 完成 Migration 109、membership generation/version、外部来源绑定与旧非终态工作 clean break；
- [x] 完成 add、removal preview、atomic cutover、durable reconciliation 与任务释放；
- [x] 给 Agent 业务工具、Message Delivery、Gather completion 和公开输出增加 exact membership lifetime fence；
- [x] 收口 ordinary outbound source lifetime：pending Delivery cutover、materialized target reconciliation 与
  dispatch/retry 双重 fence；
- [x] 完成 Desktop typed IPC、Camp open projection 与 event invalidation；
- [x] 完成添加多选、成员 `•••` 菜单、权威移除预览、最后成员禁用和 reconciliation 状态；
- [x] 完成 Rust、TypeScript、Renderer 与 Migration 定向回归；
- [x] 运行完整自动化、文档治理和格式/Clippy 门禁；
- [x] 使用隔离 userData 在真实 App 验收日/夜主题、键盘、添加、移除、冲突和恢复；
- [x] 提交并推送 `rovai/dynamic-camp-membership` worktree 分支；
- [x] 按用户最新范围把交付止于分支 push；不创建 PR、不合入 `main`、不替换本机 App。

## 验收原则

- 添加只改变未来新 Run；旧 Run 的 Context、授权和 membership lifetime 不被改写；
- 旧 Run 可以按 send admission 的当前名册联系后来加入的成员，但其 accepted outbound Delivery 不能越过 source
  membership cutover；
- 移除提交成功即阻止新业务效果，reconciliation 只描述已接受工作的正式终态进度；
- 离开后再添加不会恢复任何旧 Run、Delivery、Gather、Task ownership 或 Tool capability；
- UI 不用乐观假状态代替 Core generation/version，也不隐藏至少一位成员的约束。

## 验证证据

- `pnpm test`：76 个 Vitest 文件、533 个 Renderer/TypeScript 测试与 198 个 Node 协议测试通过；
- `pnpm typecheck`、`cargo check --workspace --all-targets`、
  `cargo clippy --workspace --all-targets --all-features -- -D warnings` 通过；
- `cargo test -p rovai-core --bin rovai`：25/25 通过；
- `cargo test -p rovai-core --features slow-tests --lib slow_tests::`：286/286 通过，覆盖动态 membership、
  当前名册 target admission、ordinary outbound source-lifetime cutover/dispatch/retry fence、exact-run
  business-tool fence、Delivery/Gather settlement 与 Missing-Send Recovery publication fence；
- `DOCS_BASE_REF=abda52ca5340429e0b7af6557f01d046a52200cc pnpm docs:check:ci` 通过；
- `pnpm package:mac:unsigned` 通过；`pnpm accept:member-lifecycle-ui` 使用系统临时目录中的隔离 userData
  与打包 App 通过，覆盖最后成员禁用、模型详情、添加、移出预览、普通再次添加、日/夜主题、键盘、无横向
  溢出、重启持久化和旧库迁移；当前受限执行环境不允许 macOS/Chromium sandbox 初始化，因此仅该验收进程
  使用 `ROVAI_MEMBER_LIFECYCLE_ACCEPT_NO_SANDBOX=1`，产品默认启动参数未改变；
- 默认库测试共 315 项，其中 314 项通过；唯一未通过项是既有 macOS Runtime sandbox 环境探针，系统
  `/usr/bin/sandbox-exec` 在当前宿主直接返回 `sandbox_apply: Operation not permitted`。该环境限制已独立复现，
  与本版本功能路径无关，未修改或退役测试。
