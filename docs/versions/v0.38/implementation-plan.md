---
document_type: implementation-plan
version: v0.38
authority: implementation-status
status: complete
last_updated: 2026-08-05
---

# v0.38 实施与验收计划

## Checkpoint 1：合同与测试

- [x] 冻结唯一实时 Task 卡、无数值进度、Task/Run 状态分离与历史保留合同。
- [x] Core 测试证明创建和全部更新不产生 CampMessage，审计事件继续追加。
- [x] Renderer 测试证明创建即有卡、更新不换 ID、旧卡过滤和审计窗口回退。

## Checkpoint 2：Core 与 Renderer

- [x] 删除 Task 状态变化的结构化系统 CampMessage 写入。
- [x] 从当前 Task Snapshot 与创建锚点投影唯一 `task_card`。
- [x] 卡片显示当前标题、负责人和状态，并打开当前 Task Inspector。
- [x] 历史 `task_event` 只从会话投影过滤，不删除持久数据。

## Checkpoint 3：验证

- [x] `cargo test --workspace`
- [x] `cargo clippy --workspace --all-targets -- -D warnings`
- [x] `pnpm test`
- [x] `pnpm typecheck`
- [x] `pnpm build:desktop`
- [x] `pnpm package:mac`
- [x] `pnpm accept:task-card-ui`

## 验收说明

本版本不调用真实 Agent Runtime，不修改用户数据，也不需要数据库 Migration。2026-08-05
完整验证通过：Rust workspace 280 个 lib 测试与 58 个 bin 测试通过（5 个显式忽略的手工
Runtime smoke 未运行），Vitest 29 个文件共 181 个测试及 Node 78 个测试通过；TypeScript、
Clippy、桌面构建和 macOS 打包均通过。隔离 `userData` 的真实 App 验收覆盖 1440×920 与
1040×700 Reduced Motion，确认创建、普通更新、完成和取消均只保留原卡，Task 生命周期不
产生 CampMessage，卡片详情与两种尺寸均无水平溢出。
