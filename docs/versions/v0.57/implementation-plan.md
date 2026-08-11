---
document_type: implementation-plan
version: v0.57
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-11
---

# v0.57 实施与验收计划

> 完成结论：生产实现、迁移、完整自动化、macOS arm64 打包与隔离数据侧栏验收均已完成。

## Checkpoint 0：语义与文档真源

- [x] 明确“移除项目”只隐藏本机侧栏，不删除目录、Camp、消息、AgentRun、审计或正在运行的执行；
- [x] 冻结确认 Dialog、Quick Chat 回退、置顶清理、恢复入口和 Steel 非 danger 色义；
- [x] 建立 v0.57 唯一 current 入口并冻结 v0.56 历史快照；
- [x] 更新当前 UI 详规和桌面侧栏验收口径。

## Checkpoint 1：导航偏好与迁移

- [x] 将 `navigation.json` 从 pins-only schema 1 迁移为 schema 2 的统一 Navigation Preferences；
- [x] Electron Main 串行化并原子写入 pin replacement、Project removal 与 restore，清理 malformed 和
  duplicate 记录；
- [x] schema 1 既有 pin 无损迁移，非法记录按现有安全口径丢弃；
- [x] Project 移除同时清除其 Project pin 与相关 Camp pins，恢复不复原旧 pin。

## Checkpoint 2：Renderer 交互

- [x] 普通、置顶与零 Camp directory Project 共用“移除项目”菜单项；Quick Chat 不显示；
- [x] 确认 Dialog 使用 Neutral Porcelain + Steel 既有结构，完整说明非删除与恢复路径；
- [x] 当前 Project/Active Camp 回退 Quick Chat，清理瞬态 Camp 视图并提交稳定 Restorable Location；
- [x] 目录选择、新对话创建、Camp 打开和启动恢复在需要时取消同一路径的隐藏记录；
- [x] Dialog 取消返回原菜单触发器，确认后焦点转移到仍存在的 Quick Chat 项目行。

## Checkpoint 3：验证与完成门槛

- [x] Main Store、navigation projection 与 Renderer menu 定向测试通过；
- [x] `pnpm typecheck`、完整 `pnpm test`、文档治理与 `git diff --check` 通过；
- [x] 生成 macOS arm64 本地包并通过 `pnpm accept:sidebar-ui`；
- [x] 打包验收证明确认/取消、Project/Camp pin 清理、跨重启隐藏、恢复、焦点和 Core 数据不变；
- [x] 将本计划和版本概览同步回填为 complete，并记录真实命令与证据路径。

## 完成条件

- [x] UI 文案不会让用户误以为目录或历史被删除；
- [x] 隐藏状态与既有 pins 跨 App 重启可靠，schema 1 用户不丢失置顶；
- [x] 所有恢复入口使用同一 canonical `directory:<projectPath>` key，不产生重复 Project；
- [x] Core Navigation、Camp Snapshot 与运行事实不因侧栏移除发生变化；
- [x] 自动化、打包 App 与文档状态一致。

## 实际验证结果

```bash
pnpm typecheck
pnpm test
pnpm package:mac
pnpm build:desktop
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder --mac dir --arm64
pnpm accept:sidebar-ui
pnpm docs:test
pnpm docs:check
pnpm docs:adr:generate -- --check
git diff --check
codesign --verify --deep --strict dist/mac-arm64/Rovai-ai.app
```

2026-08-11 完成：`pnpm test` 通过 39 个 Vitest 文件 / 251 条测试、147 条 Qualification /
Benchmark Node 测试与 21 条文档测试。macOS arm64 App、Core、CLI 和
`open-panel-prewarm.node` 均通过架构与严格签名检查。Renderer 最终收口后使用已经验证且构建前后
哈希不变的 release Core/CLI 资源完成增量重打包；最终 `app.asar` SHA-256 为
`44224b257deb79b3bd18152e6d3d4ba38a538b8cfa780d1146c11c5314f4f834`。

打包侧栏验收报告输出到
`/Users/murray.xue/Downloads/Rovai-ai-comparison-2026-08-11/acceptance/sidebar-project-removal-v057/`。
它在 `1440×920` Day 与 `1040×700` reduced-motion 场景验证：Project 菜单与确认文案、取消焦点
返回、Project/Camp pin 同步清理、Quick Chat 焦点与 Restorable Location 回退、跨 App 重启隐藏、
恢复重显、Core Navigation/Camp Snapshot 不变，以及无横向溢出。主截图同时保留菜单与确认 Dialog。
