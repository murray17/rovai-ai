---
document_type: implementation-plan
version: v1.52
authority: implementation-and-acceptance-status
status: complete
last_updated: 2026-09-06
---

# v1.52 实施与验收

范围以[版本概览](README.md)和[第三版交互稿](tool-call-consistency.html)为准；逐 Runtime 的脱敏结果见
[真实文件操作验收](runtime-acceptance.md)。

## 实施顺序

- [x] 记录最终设计与本清单，收录第三版 HTML，创建独立 worktree，并同步至最新 `origin/main`。
- [x] 为项目内合格 `child_of_handle` 建立 Main-owned 独立 workspace 恢复来源，保留 generation fence、稳定
  source 与 `previewKey` 去重，并覆盖 A→B→C、父释放／删除和外部来源边界。
- [x] 确定最小文件阅读引用与新增／编辑投影；按协议结构完成来源、路径、成功终态与生命周期校验。
- [x] 实施统一详情底色／左轴、组文案、跨执行入口状态图形、停止样式、文件链接、纯读取 Shell 聚合、独立
  Diff 箭头及红色 Toast。
- [x] 同步受影响的当前 UI／Contracts；按 Registry 规则交付正反例、started→terminal、迁移与 live/history 一致性证据。
- [x] 完成 UI 与 14 个 Runtime 的真实事件验收；通过、诚实回退、运行失败与产品准入阻断分别记录。

## 项目内子文件恢复验收

- [x] `child_of_handle` 成功打开后仅由 Main 独立取得当前 Camp workspace 根；目标越界、引用有歧义或 authority
  不可用时省略 `restoreRequest`，不影响当前成功预览。
- [x] `restoreRequest` 使用可逆 root-relative `camp_workspace` 引用；发布 handle 前重验 binding generation，
  不复用父 capability root，也不形成父链。
- [x] Renderer 优先安装 Main 返回的稳定来源；临时 child 不覆盖稳定业务来源，同一项目文件通过稳定 source key 与
  `previewKey` 复用冷 Tab ID。
- [x] 父文件释放／删除、A→B→C、A→B→A stale result、外部／Root Grant child、系统应用格式、消息／附件／
  Evidence 原来源及无副作用 restore 均有定向回归。

## UI 验收

- [x] Shell、Web、Built-in read 和普通 Tool 使用现有 Shell 背景、同一左轴；内容与内边距不变，Diff 内容不变。
- [x] 所有终态组只显示“完成了 x 个步骤”，多文件行不重复计数；只有执行中、等待审批有组状态图标；子行状态在单色、forced-colors 和 reduced-motion 下可辨识。
- [x] 执行台队员项、Inspector 头像角标、Run 时间线、Tool 子行和单聊工具行复用同一状态图形；运行和取消弧线
  在 reduced-motion 下静止，排队图形仅出现在有排队事实的 Run。
- [x] 阅读行不可展开；阅读／新增／编辑的虚线文件名可用鼠标与键盘进入已证明路径；名称省略仍能获知完整路径。文件名和 Diff 箭头互不触发。
- [x] 四条纯 `sed -n` 涉及两个不同文件时仍只有一个命令项，摘要显示 `Read 2 files` 且每个文件只列一次；
  同一文件多区间沿用单文件 Read，同名不同路径可区分。混入其他动作、管道、重定向、展开／替换或未支持
  Shell 语法时保留原 Shell，展开后完整命令、输出和整次状态不变。
- [x] 新增使用笔图标与“新增”，编辑使用笔图标与“编辑”；无法区分时统一“编辑”，没有可靠路径或 Diff 时不伪造入口。
- [x] 文件已移动、删除或读取失败时只出现红色 Toast“无法打开该文件”；当前页面、已有预览、滚动与焦点不被切换，恢复文件后可再次点击打开。
- [x] 静态行空白、动作文字和图标无整行 hover；文件名与可操作箭头有准确 Hover / Focus；停止中不出现色条，收到终态后才显示停止图形。
- [x] 底部执行台与 Inspector 行为一致；Day / Night、1040×700、1440×920、窄浮层及 200% 缩放无页面横向溢出；Toast 使用 alert/assertive 且不抢焦点。

## Runtime 事件验收

每个 Runtime 使用独立测试工作区：先阅读已有 `existing.txt`，再新增不存在的 `created.txt`，最后编辑 `existing.txt`（同时覆盖已有空文件）。分别记录原生事件、Canonical 投影、界面标题／图标、文件预览与原有 Diff；逐项比较 live 更新和历史回读。

| Runtime / adapter | 阅读事件 | 新增事件 | 编辑事件 | 本轮结果与重点 |
| --- | --- | --- | --- | --- |
| Codex CLI / `codex-cli` | `passed` | `passed` | `passed` | 0.153.4；cat/head/tail/sed structured read 与 add/update Diff 通过 |
| OpenCode / `opencode-cli` | `passed` | `passed` | `passed` | 1.18.20；同路径 `rawOutput.metadata.exists` 区分新增／编辑，缺失或冲突保守回退 |
| GitHub Copilot / `copilot-cli` | `passed` | `passed` | `passed` | 1.0.82；新文件被报告为 update，未误称新增 |
| Claude Code / `claude-code-cli` | `passed` | `passed` | `passed` | 2.1.236；Read/Write/Edit matching result 与 exact mutation 通过；create 对已有空文件的假阳性不升级为新增 |
| Antigravity / `antigravity-app` | `passed` | `passed` | `passed` | 1.1.27；文件效果成功，无可靠单文件终态时保持原工具回退 |
| Kiro / `kiro-cli` | `passed` | `passed` | `passed` | 2.21.1；location、path-only 和 update Diff 通过 |
| Qoder / `qoder-cli` | `passed` | `passed` | `passed` | 1.1.28；read/write、稀疏终态和空文件事件通过 |
| CodeBuddy / `codebuddy-cli` | `passed` | `passed` | `passed` | 2.133.1；本机 MiniMax `minimax-m3` Ready 与五条真实 Run 通过，path-only add 保守显示“编辑” |
| Qwen Code / `qwen-code` | `passed` | `passed` | `passed` | 0.23.0；read 通过；写入按 typed path 或 update Diff 显示“编辑”，basename-only 路径缺口已记录 |
| TRAE CLI CN / `trae-cn-cli` | `passed` | `passed` | `passed` | 0.120.52；四项 typed path 与 live/history 通过，新增被报告为 update |
| Cursor Agent / `cursor-agent` | `blocked` | `blocked` | `blocked` | 当前 macOS arm64 缺 qualification evidence，按产品准入阻断 |
| Kimi Code / `kimi-code-cli` | `passed` | `passed` | `passed` | 0.40.1；read、path-only write 与 update Diff 通过 |
| Grok Build / `grok-build` | `failed` | `failed` | `failed` | 1.0.13；连接与模型执行通过，一次完整文件矩阵成功、紧接复跑无可用文件 Tool 终态，因不可重复保持回退 |
| Pi / `pi` | `passed` | `passed` | `passed` | 0.84.4；同 ToolCall start 参数与成功 end 关联后 read/write 精确路径通过 |

统一通过条件：

- **新增与编辑**：只有明确新增证据才显示“新增”；例如 Codex `add`、标准完整 before/after 中明确不存在的旧文件，
  或 OpenCode 写入前 `metadata.exists=false` 与同 ToolCall path 对齐。Claude 2.1.236 的 `create` 对已有空文件存在
  假阳性，不能单独准入。已有空文件仍是编辑；仅证明写入时允许回退“编辑”。没有文件操作证据则保留原工具／
  未知，不能为了通过矩阵补造事件。
- **阅读**：可靠只读语义和文件路径才产生“阅读 文件名”。Codex 另测 `sed -i`、读后写／测试的复合命令、多文件、缺路径与路径含空格；不能凭命令前缀误翻译。Built-in `camp.read` 仍是读取 Camp 消息。
- **生命周期与恢复**：覆盖 started→terminal、稀疏更新、重复事件、失败／拒绝／取消；不得把未执行或失败写入当作成功修改，不得重复步骤或文件行。相同证据在 live 与历史回读中呈现一致。
- **预览与变化**：点击对应真实文件；删除文件后的点击只出 Toast。已存在的 Diff、path-only、单次多文件、项目外文件与受管临时产物排除遵守当前合同，不从当前磁盘重建历史 Diff。
- **证据记录**：每格填 `passed / failed / blocked / not-run`，附 Runtime 版本、模型、平台、Run/Tool 关联、脱敏事件或 fixture 与截图位置。共享 fixture 不能替代真实 Runtime 测试；结论仅覆盖实测组合，缺事件、认证或额度问题明确记录。

## 检查与完成条件

最终验证以合并后的 `origin/main` 为基线执行：

- `pnpm test` 通过：Vitest 155 个文件、1587 个用例通过；Node 协议套件 221 个用例中 220 个通过，1 个仅限
  Windows 的用例按条件跳过；文档治理子套件同时通过。
- Shell 读取摘要、执行台布局、Tool 分组、单聊工具行与 App 投影 5 个定向文件共 222 个用例通过；其中摘要
  单元测试覆盖结构化动作优先、完整路径去重、同名路径区分、单文件措辞、稀疏终态以及所有受限语法反例。
- 文件预览、执行展示和 Main 快照 11 个定向文件共 295 个用例通过；成功后提交重构后又运行相关 3 个文件、
  188 个用例并通过。
- `pnpm typecheck`、`pnpm build:desktop`、`cargo fmt --all --check` 与
  `cargo check --workspace --all-targets` 通过。
- `rovai-core --lib` 在命令环境中 511 个用例通过，唯一受嵌套 macOS sandbox 阻断的隔离用例在宿主环境
  单独运行通过；`rovai-core --bin rovai-core` 为 227 个通过、5 个需显式本机条件的用例按设计忽略。
- 生产 Electron `file-preview-layout` 与 `file-reference-navigation` 均在本机原生终端通过；前者还以挂起首屏读取
  证明成功前不出现 provisional Tab，失败不切换页面、Tab 或 Pane，且释放 handle 后可重试。
- 第三版 HTML 的内联脚本语法、`pnpm docs:test`、`pnpm docs:check`、基于下列 Base 的
  `docs:check:ci` 与 `git diff --check` 通过。
- 14 个 Runtime 均使用本机真实安装、账号与 Provider 执行；CodeBuddy 明确选择本机已配置的 `minimax-m3`，其余
  使用记录中的 Runtime 模型。逐项结果、诚实回退、模型执行失败和准入阻断见
  [真实文件操作验收](runtime-acceptance.md)，没有用共享 fixture 代替真实矩阵。

真实 App/Runtime 验收遵守[本地隔离流程](../../development/local-workflow.md)，使用独立临时 Core data root、Git
workspace 与 Camp，不读写日常 App 数据目录；运行产生的 ID、绝对临时路径与原始输出未进入仓库。

## Worktree 交接

- Worktree：`/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-tool-call-consistency`
- Branch：`rovai/tool-call-consistency`
- Base：`origin/main` 的 `91af2eeebd7ebfb581820c2f68d259ff51497199`
- Governance：已合并主干既有 v1.52 子文件恢复范围；本次版本记录、真实验收和交互稿均位于任务分支。
- Status：`complete`；生产实现、真实 Runtime 矩阵和验证证据已完成。
- Next：提交评审并由 CI 复核，不再补造未观察到的 Runtime 事件。
