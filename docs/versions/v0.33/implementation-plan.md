---
document_type: implementation-plan
version: v0.33
authority: implementation-status
status: complete
last_updated: 2026-08-03
---

# v0.33 实施与验收计划

## Checkpoint 1：版本与设计

- [x] 冻结统一侧栏操作范围、非目标和 Renderer-only 边界。
- [x] 创建 v0.33 当前版本并冻结 v0.32 历史快照。
- [x] 更新 Arctic Dawn 与 UI 索引中的直接 Pin 旧合同。

## Checkpoint 2：生产实现

- [x] 引入 Radix Dropdown Menu 并建立共享侧栏菜单。
- [x] 普通区与置顶区 Camp 使用同一个 Camp 行组件。
- [x] Camp 与可置顶 Project 统一使用三点菜单；Quick Chat 不显示 Project 菜单。
- [x] 删除独立 Pin 控件、项目会话数量和“查看全部”数量。
- [x] Pin 迁移、Dialog 关闭与失败路径按稳定目标恢复焦点。

## Checkpoint 3：自动化验证

- [x] 新增菜单文案、Quick Chat 例外、数量隐藏和记忆角标语义断言。
- [x] 目标 Renderer 测试通过。
- [x] `pnpm typecheck` 通过。
- [x] `pnpm test` 通过。
- [x] `pnpm build:desktop` 通过。
- [x] `git diff --check` 通过最终侧栏改动。

## Checkpoint 4：真 App 验收

- [x] `1440×920`：侧栏、Camp/Project 菜单、迁移和主工作区无溢出。
- [x] `1040×700`：菜单碰撞完整位于视口，长标题和底部操作可达。
- [x] 键盘：方向键、`Home/End`、`Escape`、焦点返回、重命名与删除 Dialog 通过。
- [x] Hover、Focus-within、打开、粗指针和 reduced-motion 状态通过。

## 完成证据

- 侧栏目标测试：`2 passed | 58 skipped`，覆盖菜单文案、顺序、Quick Chat
  例外、数量隐藏和记忆角标。
- `pnpm typecheck` 通过。
- `pnpm test` 通过：Vitest `29 files / 177 tests`，附加 Collaboration Audit
  `4 tests`。
- `pnpm package:mac` 通过；最终 Renderer 生产构建包含 396 个模块。
- `pnpm accept:sidebar-ui` 连续两次通过；真 App 覆盖置顶/取消置顶迁移与焦点、重命名、
  永久删除、点击外部关闭、键盘、粗指针、reduced-motion、长标题和视口碰撞。
- 本次截图位于
  `/var/folders/49/z0f8w56s28j4pfc7t80cm3w80000gq/T/rovai-sidebar-ui-captures-jpqLkd/`，
  文件为 `sidebar-day-1440x920.png`、`project-menu-day-1440x920.png`、
  `camp-menu-pinned-day-1440x920.png`、`delete-dialog-day-1440x920.png` 与
  `camp-menu-compact-1040x700-reduced-motion.png`。
- 当前 Rust workspace 为 `260 + 54 passed`，5 个手工 Runtime smoke 忽略。
- `git diff --check`、`node --check scripts/accept-sidebar-ui.mjs` 与
  `node --check scripts/capture-desktop.mjs` 通过。
