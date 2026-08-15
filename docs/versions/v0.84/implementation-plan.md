---
document_type: implementation-plan
version: v0.84
authority: implementation-plan-and-acceptance
status: in_progress
last_updated: 2026-08-15
---

# v0.84 实施与验收计划

## Checkpoint 0：版本与长期 Renderer 边界

- [x] 从 `main@ebb57ea8` 创建 `codex/execution-sidecar` 独立 worktree；
- [x] 冻结完成的 v0.83 并开启唯一 current v0.84；
- [x] 新增 ADR-0190 与 Run Process Detail Surface v6，明确不改变 Core/Run/Evidence 权威；
- [x] 更新 Camp UI 合同、合同索引、CURRENT 导航与桌面验收入口。

## Checkpoint 1：位置状态与导航

- [x] 默认继续在底部渲染 Run Pulse 与 Execution Drawer；
- [x] “移到右侧”显示 Inspector、激活条件式“执行”Tab，并保留基础 Inspector 页签；
- [x] “移回底部”恢复底部承载与基础页签，切换控件具备稳定可访问名称和焦点交接；
- [x] Task、停止结果和世界地图过程入口在右侧模式下定位执行 Tab。

## Checkpoint 2：Sidecar 适配与功能保真

- [x] 右侧使用现有 Inspector 310px / 260px 宽度，不增加可拖宽容器；
- [x] 队员过程入口改为最多约四行的纵向列表，更多队员内部滚动；
- [x] 执行详情复用现有连续 Run、Delivery、Tool/Evidence、Recovery 与终态内容；
- [x] 右侧取消高度 resize handle，底部高度偏好、键盘调整和 sticky latest 保持；
- [x] 空详情、关闭、Escape、Inspector 隐藏/恢复、双主题和窄屏保持上下文。

## Checkpoint 3：自动验证

- [x] 增加 Renderer 单元回归，覆盖默认两 Tab、位置状态和可访问文案；
- [x] 扩展 `accept:runtime-activity-ui`，验证第三 Tab、纵向列表、唯一详情与往返状态；
- [x] 运行 Impeccable detector、TypeScript typecheck、Renderer 测试和文档门禁；
- [x] 运行 Desktop build、macOS package、签名与 `accept:runtime-activity-ui` 隔离 App 验收。

## Checkpoint 4：交付

- [ ] 回填真实验证结果并把版本状态更新为 complete；
- [ ] 提交 worktree，快进合入并推送 `main`；
- [ ] 从最终 `main` 构建，退出旧安装版后替换 `/Applications/Rovai-ai.app`；
- [ ] 从安装位置启动并确认进程不引用仓库 `dist/`。

## 验证结果

- `pnpm typecheck`、`pnpm test` 与目标 Renderer 单元测试通过；
- `pnpm docs:test`、`pnpm docs:check`、`DOCS_BASE_REF=ebb57ea8 pnpm docs:check:ci` 通过；
- Impeccable layout detector 对本次 Renderer/CSS 改动报告 `[]`；
- `pnpm build:desktop`、`pnpm package:mac` 通过，App、Core 与 CLI 均为 arm64 且严格签名校验通过；
- `pnpm accept:runtime-activity-ui` 在隔离 App 中通过：10 个 Agent 纵向入口唯一、有界滚动，右侧仅一份详情、无高度拖拽与横向溢出，移回底部后选中 Agent 与 resize handle 均恢复。
