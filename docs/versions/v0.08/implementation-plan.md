---
document_type: implementation-plan
version: v0.08
lifecycle: current
authority: implementation-plan-and-acceptance
last_updated: 2026-07-24
---

# Lumen AI v0.08 实施计划与验收清单

> 状态：实施中（检查点 2/5 已完成）
>
> 版本范围：[README.md](README.md)
>
> 架构协议：[architecture.md](architecture.md)
>
> 跨版本边界：
> [ADR-0017](../../adr/0017-managed-skill-library-runtime-projection.md)

## 实施原则

- 分为五个可独立验证的检查点；每个检查点完成代码、测试和文档状态更新后形成
  独立 Commit。
- 先建立 Core 真源、不可变内容和导入协议，再接 Runtime 投影和 UI。
- 不维护旧 Skill 草案模型、兼容表或双写路径；当前仍是开发期，错误实验数据可以
  通过明确 Migration/Reset 清理。
- 所有写操作继续走 `DomainCommandGateway + event_log(command.result)`；
  不增加通用 Outbox 或第二个 Read Model 数据库。
- 每个检查点完成自动化测试，不等待中途人工审核；全部功能和 App 检查完成后再
  交给用户做一次最终验收。

## 检查点 1：Skill Library、不可变 Revision 与导入

> 实施状态：已完成（2026-07-24）。

目标：建立唯一 Skill 真源、受管目录和安全的两阶段导入。

实施内容：

- 增加 Migration v19：
  - `skill`
  - `skill_revision`
  - `skill_projection_observation`
  - `context_manifest.skill_exposure_json`
  - `context_manifest.skill_exposure_digest`
- 增加 `SkillLibraryStore`，使用 `~/.lumen/skills/.staging` 和
  `<skill-id>/revisions/<revision-id>/content`。
- 实现递归校验、路径规范化、Frontmatter 解析、Digest、文件模式保留、大小限制、
  Staging 过期清理和孤儿 Revision GC。
- 实现 Inspect/Commit 两阶段导入、同名幂等、Imported 更新确认、Bundled 冲突拒绝。
- 把 `grill-me` 和 `grill-with-docs` 作为自包含应用资源打包；首次安装默认启用，
  应用升级创建新 Revision 但保留用户启停选择。
- 实现 `skills.list/get/import.inspect/import.commit/setEnabled/delete` 的 Core
  协议和命令幂等。
- Imported Skill 删除先进入 `deleting`，内容实际清理留给检查点 2 的投影排空。

必须测试：

- 单 Skill 与集合目录一级发现。
- 无 `SKILL.md`、非法 Frontmatter、Name/目录不一致。
- Symlink、Socket/FIFO/特殊节点、路径逃逸。
- 文件数、递归深度、单文件与总大小边界。
- 可执行位和 Digest 稳定性。
- 同名同 Digest 幂等、同名更新、Bundled 同名拒绝。
- 重复 `commandId` 与冲突请求。
- Staging TOCTOU、过期清理、DB 失败后的孤儿目录 GC。
- Bundled 首次安装、升级和用户禁用保持。

完成门：

- SQLite 是元数据和启停真源；受管 Revision 内容不可原地修改。
- 导入过程没有执行任何候选内容。
- 两个默认 Skill 可从产品资源独立安装且无隐藏 Skill 依赖。
- `cargo test --workspace`、`pnpm typecheck` 和相关契约测试通过。

实施记录：

- Migration v19、`SkillLibraryService`、两阶段导入、不可变 Revision、Bundled 安装、
  Staging/孤儿清理与 Core 方法均已落地。
- `grill-me`、`grill-with-docs` 已作为自包含资源编译进 Core；Imported 默认禁用，
  Bundled 首次安装默认启用且升级不覆盖用户启停选择。
- 验证通过：Rust 91 + 33 测试（另有 4 条手工 Runtime Smoke 保持 ignored）、
  TypeScript typecheck、Vitest 39 测试。

## 检查点 2：项目原生投影、所有权与恢复

> 实施状态：已完成（2026-07-24）。

目标：把全局启用 Skill 安全投影到项目和大厅执行根，并在重启后恢复。

实施内容：

- 为 Adapter Registry 增加闭合的 Skill Discovery Capability：
  - `.agents/skills`
  - `.claude/skills`
  - `.agent/skills`
- 实现按规范化 `executionRoot` 串行的 `SkillProjectionReconciler`。
- 计算使用同一执行根的活跃 Adapter Native Root 并集；AgentRun 前至少校验当前
  Adapter 所需入口。
- 使用临时 Link + Atomic Rename 创建单 Skill 入口，不接管整个目录。
- 实现四重所有权证明、Observation 重建、未知/损坏链接 Fail Closed。
- 实现项目内容优先：
  - 非 Lumen 同名入口不覆盖；
  - 标记 `shadowed`；
  - Run 降级继续。
- 使用 `git rev-parse --git-path info/exclude` 管理具名 Lumen 区块和具体路径，
  不修改 `.gitignore`。
- 实现启动扫描、启停/更新唤醒、运行前校验、显式重试和删除排空。
- 项目 Camp 使用项目根；大厅使用现有 `<Core data_dir>/lobby`。

必须测试：

- 三类 Native Root 的最小组合；不生成 `.opencode/skills` 或 `.github/skills`。
- 多 Adapter 对同一 Revision 的等价入口。
- 项目普通文件、普通目录、外部 Symlink 和 Broken Link 冲突。
- Lumen 链接被改写后绝不删除用户内容。
- Observation 丢失后的可证明重建。
- App/Core 崩溃发生在 Link 创建、Rename、DB 更新和 Git Exclude 更新各阶段。
- Git 仓库、Worktree、非 Git 目录和已有 `info/exclude` 用户内容。
- 大厅与项目执行根互不越权。
- Imported 删除在 Run 排空前不删除内容，排空后彻底清理。

完成门：

- 已知执行根在启动和运行前都能从权威状态恢复正确投影。
- `git status` 不因 Lumen 受管入口变脏，且用户配置没有被宽泛忽略。
- 同名项目 Skill 完整保留；冲突只造成可见降级。
- 不存在通用 Outbox、每 Run Mount/Unmount 或用户级 Runtime 安装。

实施记录：

- Adapter Registry 已固定三类最小原生项目根；Codex/OpenCode/Copilot 共用
  `.agents/skills`，Claude Code 使用 `.claude/skills`，Antigravity 使用
  `.agent/skills`。
- `SkillProjectionReconciler` 已实现持久 Symlink 投影、Revision 校验、项目内容优先、
  Observation 重建、运行排空、Imported 硬删除、启动/周期/状态变化恢复与显式
  `skills.reconcile`。
- Git 仓库仅维护 `info/exclude` 中的具名 Lumen 区块和具体入口；区块外字节保持不变，
  非 Git 根不创建 Git 配置。
- 验证覆盖 Native Root 并集、同名目录、外部 Symlink、Observation 丢失、运行中禁用、
  删除排空、Git 状态和 Bundled 篡改恢复；Core 进程的查询、显式 Reconcile 与命令
  幂等已通过隔离 HOME 实测。
- 全量验证通过：Rust 99 + 33 测试（另有 4 条手工 Runtime Smoke 保持 ignored）、
  Clippy、TypeScript typecheck、Vitest 39 测试。

## 检查点 3：AgentRun、ContextManifest 与 Native Session

> 实施状态：待实施。

目标：让每个 AgentRun 可观察实际 Skill 暴露，同时保持已确认的 Session 连续性。

实施内容：

- AgentRun Context Materialization 前调用当前 Adapter 的投影校验。
- 将实际 `SkillExposureEntry[]` 和 Digest 写入不可变 ContextManifest。
- Camp Snapshot/Context Inspector 合约升级到 Schema v5。
- 同一 AgentRun 恢复严格复用原 Manifest，不从最新 Skill Library 重组。
- Reconciler 不在仍可能读取文件系统的 Run 中途切换入口。
- 实现 Revision 更新的 `stale`、冲突的 `shadowed`、能力缺失的 `unsupported`
  和文件错误的 `error` 记录。
- 禁用/删除无法安全移除时，新 Run 等待 `skill_projection_drain`。
- 新 Native Session Charter 加一条稳定 Skill 提醒；不增加每轮
  `[SKILL_DISCOVERY]` 或正文注入。
- Skill 变化不加入 `bindingCompatibilityDigest`，不自动重建 Native Session。
- 增加用户显式 `conversations.restartNativeSession` 命令。

必须测试：

- Manifest 精确记录 Ready/Stale/Shadowed/Unsupported/Error。
- Runtime 已收到输入后 Core 重启，恢复仍使用同一 Manifest。
- Run 执行中更新/禁用/删除 Skill 不改变其入口。
- Revision 更新期间新 Run 记录实际旧 Revision，而不是目标 Revision。
- 禁用/删除排空期间不会让新 Run 继续暴露被撤销 Skill。
- Charter 只在新 Session 追加，Resume 不重复；Adapter System Prompt 不被替换。
- 手动重启仅替换 Native Binding，Conversation 身份不变。
- Skill 更新不自动改变 Native Binding Generation。

完成门：

- Context Inspector 可以解释某 Run 实际观察到的 Skill 与未暴露原因。
- 同一 Run 的恢复输入仍满足 ADR-0009。
- Session 连续性和 Skill 可见性边界与 SK-14 一致，不作虚假的跨 Turn 冻结承诺。
- 现有 Context、A2A、Task、Approval、Action 和 Recovery 测试不回归。

## 检查点 4：设置 → 技能与 Electron 安全边界

> 实施状态：待实施。

目标：提供完整但克制的本机 Skill 管理体验。

实施内容：

- 扩展 `packages/contracts`、Core Method Allowlist、Main 与 Preload 具名 API。
- Main 增加原生目录选择器；Core 对路径重新验证。
- Main 根据 Skill ID 打开受管目录，不向 Renderer 暴露任意 Shell/文件系统能力。
- 保留左侧一级“成员”；设置内部增加“技能 / 外观 / 诊断”二级导航。
- 技能页实现：
  - 列表、来源、描述、启停、Revision 时间；
  - 单目录/集合目录预览；
  - 风险摘要；
  - Imported 更新确认和删除确认；
  - Bundled 不可更新/删除；
  - Finder 检查入口；
  - Compatibility 与 Projection Issue。
- 诊断页增加投影问题和显式 Reconcile。
- Context Inspector 显示 Skill Exposure。
- Runtime 用户文案统一为中文；稳定产品名、ID、命令和参数值保持原文。
- 遵循 `docs/ui/`：Day/Night 同构、状态不只靠颜色、完整键盘和 Focus。

必须测试：

- Settings 二级导航、刷新后默认区、焦点恢复。
- Loading、Empty、Error、Busy、Disabled、Deleting、Corrupted。
- 单导入、集合混合成功/失败、重复导入、更新确认。
- Toggle 版本冲突和 Core 失败不产生虚假乐观状态。
- Bundled 操作边界与 Imported 删除确认。
- 冲突、能力缺失、Stale 和手动 Reconcile。
- 原生 Dialog 取消、路径变化、Core 重启和 Finder 打开失败。
- Day/Night、`1440×920` 与 `1040×700`，无整页横向滚动。

完成门：

- Renderer 没有直接 SQLite、任意路径、Shell 或 `ipcRenderer` 权限。
- 用户能够理解 Skill 来自哪里、是否启用、实际是否投影成功。
- UI 不把启用描述成权限批准，也不把投影描述成模型已经读取。
- TypeScript、Renderer/Main 测试和 `build:desktop` 通过。

## 检查点 5：真实 Runtime Smoke、全量回归与最终验收

> 实施状态：待实施。

目标：证明项目级入口被每个本机 Runtime 原生发现，并完成恢复与 App 验收。

实施内容：

- 增加 `smoke:skills`，使用隔离 HOME、Lumen Data Dir、Git Repo 和 Lobby Root
  验证导入、启停、更新、冲突、Git Exclude、重启恢复和删除。
- 对本机已安装且认证可用的 Runtime 执行真实 Skill Smoke：
  - Codex CLI
  - Claude Code CLI
  - OpenCode CLI
  - Copilot CLI
  - Antigravity App
- Smoke 使用只返回稳定标记的无副作用测试 Skill，证明原生发现而非 Prompt 注入。
- OpenCode/Copilot 必须验证同时存在 `.agents` 与 `.claude` 等价入口时不会产生
  不确定的同名语义；不通过时收紧 Adapter 搜索路径或明确能力缺失。
- 验证 Runtime 当前版本由 Probe 发现，不加入版本 Allowlist。
- 扩展 App Capture/检查，覆盖技能页和 Context Inspector。
- 执行全量 Rust/TypeScript/Vitest/Smoke/Build/macOS Package。
- 删除实验 API、临时兼容路径、重复 Skill 根和无使用者样式。
- 更新版本状态、根 README、本地开发说明和验收记录。

完成门：

- `cargo test --workspace`
- `pnpm typecheck`
- `pnpm test`
- `pnpm smoke:core`
- `pnpm smoke:skills`
- 现有 Intake、Runtime、Action、Multi-Agent、Context、Task、Recovery Smoke
- `pnpm build:desktop`
- `pnpm package:mac`
- Day/Night × 两种窗口尺寸的真实 App 检查
- 所有可用 Runtime 的真实原生 Skill Smoke 通过；不可用 Runtime 具有明确、
  可复现的环境证据，不被伪报为通过。

## 最终验收矩阵

| 场景 | 预期 |
|---|---|
| 首次启动 | 两个 Bundled Skill 安装并默认启用 |
| Imported 导入 | 预览后默认禁用；来源目录删除不影响受管副本 |
| 重复导入 | 同 Digest 幂等；不同 Digest 明确确认更新 |
| Bundled 同名 | 拒绝覆盖 |
| 项目 Camp | 只创建 Adapter 所需的最小原生入口 |
| 大厅 Camp | 只在 Lumen Lobby Root 暴露，不读取用户项目 |
| 项目同名 Skill | 项目内容保留，Lumen 标记 Shadowed，Run 继续 |
| Git 项目 | 工作区保持干净；`.gitignore` 不变 |
| 非 Git 项目 | 原生入口可用，不创建 Git 排除 |
| Skill 更新 | 创建新 Revision；Run 中途不切换；Session 不自动重建 |
| Skill 禁用 | 新 Run 不再暴露；必要时等待投影排空 |
| Skill 删除 | 排空后内容、投影和排除项彻底删除 |
| Runtime 不支持 | 明确 Unsupported，不注入 Skill 正文伪造支持 |
| Script Skill | 启用不扩大成员 Runtime 权限或绕过 Approval |
| Core 重启 | Staging、Deleting、Projection 与 Exclude 可恢复 |
| Context Inspector | 显示本 Run 实际 Revision 与 Ready/Stale/Shadowed 等结果 |

## 实施状态摘要

| 检查点 | 状态 |
|---|---|
| 1. Skill Library 与导入 | 待实施 |
| 2. 项目原生投影与恢复 | 待实施 |
| 3. AgentRun 与 Native Session | 待实施 |
| 4. 设置 → 技能 | 待实施 |
| 5. Smoke 与最终验收 | 待实施 |
