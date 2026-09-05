---
document_type: implementation-plan
version: v1.52
authority: implementation-and-acceptance-status
status: in-progress
last_updated: 2026-09-06
---

# v1.52 实施与验收

范围以[版本概览](README.md)和[第三版交互稿](tool-call-consistency.html)为准。以下未勾选项均待实施或验收。

## 实施顺序

- [x] 记录最终设计与本清单，收录第三版 HTML，创建独立 worktree，并同步至最新 `origin/main`。
- [ ] 确定最小文件阅读引用与新增／编辑投影，先核对 Runtime 真实事件；按当前合同完成来源、路径和生命周期校验。
- [ ] 实施统一详情底色／左轴、组文案、子行图形、停止样式、文件链接、独立 Diff 箭头及红色 Toast。
- [ ] 同步受影响的当前 UI／Contracts；若修改 Activity 映射，按 Registry 维护规则交付正例、反例、started→terminal 与 live/history 一致性证据。
- [ ] 完成下述 UI 与全部 Runtime 事件验收，更新真实结果和缺口。

## UI 验收

- [ ] Shell、Web、Built-in read 和普通 Tool 使用现有 Shell 背景、同一左轴；内容与内边距不变，Diff 内容不变。
- [ ] 所有终态组只显示“完成了 x 个步骤”，多文件行不重复计数；只有执行中、等待审批有组状态图标；子行状态在单色、forced-colors 和 reduced-motion 下可辨识。
- [ ] 阅读行不可展开；阅读／新增／编辑的虚线文件名可用鼠标与键盘进入正确文件；名称省略仍能获知完整路径。文件名和 Diff 箭头互不触发。
- [ ] 新增使用笔图标与“新增”，编辑使用笔图标与“编辑”；无法区分时统一“编辑”，没有可靠路径或 Diff 时不伪造入口。
- [ ] 文件已移动、删除或读取失败时只出现红色 Toast“无法打开该文件”；当前页面、已有预览、滚动与焦点不被切换，恢复文件后可再次点击打开。
- [ ] 静态行空白、动作文字和图标无整行 hover；文件名与可操作箭头有准确 Hover / Focus；停止中不出现色条，收到终态后才显示停止图形。
- [ ] 底部执行台与 Inspector 行为一致；Day / Night、1040×700、1440×920、窄浮层及 200% 缩放无页面横向溢出；Toast 可被辅助技术获知且不抢焦点。

## Runtime 事件验收

每个 Runtime 使用独立测试工作区：先阅读已有 `existing.txt`，再新增不存在的 `created.txt`，最后编辑 `existing.txt`（同时覆盖已有空文件）。分别记录原生事件、Canonical 投影、界面标题／图标、文件预览与原有 Diff；逐项比较 live 更新和历史回读。

| Runtime / adapter | 阅读事件 | 新增事件 | 编辑事件 | 本轮结果与重点 |
| --- | --- | --- | --- | --- |
| Codex CLI / `codex-cli` | 待验收 | 待验收 | 待验收 | `commandActions.read` 与 `fileChange.kind=add/update`；补测 cat、head、tail、sed -n |
| OpenCode / `opencode-cli` | 待验收 | 待验收 | 待验收 | ACP kind / locations / 标准 Diff；逐项采集原生证据 |
| GitHub Copilot / `copilot-cli` | 待验收 | 待验收 | 待验收 | 文件搜索不得误当单文件阅读；写入有据才命名 |
| Claude Code / `claude-code-cli` | 待验收 | 待验收 | 待验收 | Read／Write／Edit 分开记录；Edit exact mutation 保留片段语义，不伪造整文件 Diff |
| Antigravity / `antigravity-app` | 待验收 | 待验收 | 待验收 | 先核对可用结构化事件；无证据时保持原工具／未知回退 |
| Kiro / `kiro-cli` | 待验收 | 待验收 | 待验收 | 标准 location 与 Diff 路径必须一致；旧修复前观测不能替代本轮验收 |
| Qoder / `qoder-cli` | 待验收 | 待验收 | 待验收 | path-only Write、后续 Edit、稀疏终态与 Read→edit 冲突 |
| CodeBuddy / `codebuddy-cli` | 待验收 | 待验收 | 待验收 | ACP 阅读、写入路径与标准 Diff；缺字段的稳定回退 |
| Qwen Code / `qwen-code` | 待验收 | 待验收 | 待验收 | 原生 read_file 与 ACP 写入逐项验证 |
| TRAE CLI CN / `trae-cn-cli` | 待验收 | 待验收 | 待验收 | Shell 展示通过不代表文件识别通过；单独采集读／新增／编辑事件 |
| Cursor Agent / `cursor-agent` | 待验收 | 待验收 | 待验收 | 先满足当前平台与认证准入；不可运行时记录真实阻塞，不提升资格 |
| Kimi Code / `kimi-code-cli` | 待验收 | 待验收 | 待验收 | 已知 path-only edit 需本轮复测；缺少新增证据时显示编辑 |
| Grok Build / `grok-build` | 待验收 | 待验收 | 待验收 | 标准 ACP 事件与 run-level 回退分开，不从厂商 metadata 补造操作 |
| Pi / `pi` | 待验收 | 待验收 | 待验收 | 原生 read/write/edit 生命周期与精确路径；不引入 Rovai Approval 或虚构 Diff |

统一通过条件：

- **新增与编辑**：只有明确新增证据才显示“新增”；例如 Codex `add` 或标准完整 before/after 中明确不存在的旧文件。已有空文件仍是编辑；仅证明写入时允许回退“编辑”。没有文件操作证据则保留原工具／未知，不能为了通过矩阵补造事件。
- **阅读**：可靠只读语义和文件路径才产生“阅读 文件名”。Codex 另测 `sed -i`、读后写／测试的复合命令、多文件、缺路径与路径含空格；不能凭命令前缀误翻译。Built-in `camp.read` 仍是读取 Camp 消息。
- **生命周期与恢复**：覆盖 started→terminal、稀疏更新、重复事件、失败／拒绝／取消；不得把未执行或失败写入当作成功修改，不得重复步骤或文件行。相同证据在 live 与历史回读中呈现一致。
- **预览与变化**：点击对应真实文件；删除文件后的点击只出 Toast。已存在的 Diff、path-only、单次多文件、项目外文件与受管临时产物排除遵守当前合同，不从当前磁盘重建历史 Diff。
- **证据记录**：每格填 `passed / failed / blocked / not-run`，附 Runtime 版本、模型、平台、Run/Tool 关联、脱敏事件或 fixture 与截图位置。共享 fixture 不能替代真实 Runtime 测试；结论仅覆盖实测组合，缺事件、认证或额度问题明确记录。

## 检查与完成条件

文档准备已运行 `pnpm docs:test`、`pnpm docs:check`、基于原 worktree Base 的 `docs:check:ci`、HTML 脚本语法与 `git diff --check`。实施阶段按实际改动运行定向 Renderer/Core 回归、Typecheck、桌面构建及隔离真实 App 验收；Rust 测试的新增与退役遵守[测试准入规则](../../development/testing.md#rust-测试准入与退役门槛)。

已知基线：第三版各终态组摘要和内联脚本语法已验证；前版双主题、文件预览、Diff 和键盘返回已有原型核对。第三版 Toast 的浏览器点击实测因控制连接失效未完成。所有生产 UI 和本版本 Runtime 矩阵均为待验收，不沿用旧 smoke 标为通过。真实 App/Runtime 验收遵守[本地隔离流程](../../development/local-workflow.md)，不使用日常 App 数据目录。

## Worktree 交接

- Worktree：`/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-tool-call-consistency`
- Branch：`rovai/tool-call-consistency`
- Base：`origin/main` 的 `42f94fcfc7281cd1cec219d11d6d3d2f146f980b`
- Governance：无主线治理提交；本版本记录与交互稿位于任务分支。
- Status：`active`；已同步主干并开始生产实现。
- Next：从可靠文件阅读引用和新增／编辑事件投影开始实施。
