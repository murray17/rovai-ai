---
document_type: implementation-plan
version: v1.54
authority: implementation-and-acceptance-status
status: in_progress
last_updated: 2026-09-06
---

# v1.54 实施与验收

范围以[版本概览](README.md)和[交互稿](tool-call-consistency.html)为准；逐 Runtime 的脱敏结果见
[真实文件操作验收](runtime-acceptance.md)。

## 实施顺序

- [x] 保存确认后的交互稿、版本范围和 Runtime 验收记录，并在独立 worktree 合并最新 `origin/main`。
- [x] 统一 Tool 详情底色、状态图形、终态组摘要、文件链接、独立 Diff 箭头、停止样式和 danger Toast。
- [x] 按协议来源、路径、成功终态与生命周期准入 typed read/write；保留现有 Runtime 回退边界。
- [x] 将确定的多条纯读取 Shell 命令按完整路径去重，在同一摘要行显示多个独立文件入口，保留原始详情。
- [x] 保留 Claude Write 的 `create|update` 原生声明，并只在 Renderer 把 `create` 映射为“新增”。
- [x] 合并 migration 141 的 Runtime 图片来源后，以 migration 142 / v1.54 / schema 93 完成 activity-v3 切换。
- [ ] 完成合并后全量检查、生产打包、本机 Applications 安装、备份清理与 PR CI。

## UI 验收

- [x] 终态组只显示“完成了 x 个步骤”；只有执行中和等待审批在组右侧显示图形。
- [x] Tool 子行、执行台、Inspector 头像角标、Run 时间线和单聊行的状态形状一致，forced-colors 与
  reduced-motion 保留可辨识状态。
- [x] 阅读／新增／编辑的动作词与文件名相隔 5px；文件名有虚线底线，可用鼠标或键盘打开已证明路径。
- [x] 阅读／新增／编辑行的文件链接命中框按文字收口；动作词、图标、状态、增删统计和空白区域均无
  hover 或点击作用，有 Diff 时仅右侧独立箭头负责展开。
- [x] 多条读取涉及 `local-workflow.md` 与 `install-macos-daily.mjs` 时仍只有一个命令项，并在一行显示
  `阅读 local-workflow.md, install-macos-daily.mjs`。重复完整路径只显示一次，同名不同路径显示可区分路径。
- [x] 任何结构化 read 缺少非空路径时不生成“阅读”摘要或空文件入口；混合动作、管道、重定向、变量展开、
  命令替换与其他未支持语法保持原 Shell 展示。
- [x] 展开后仍显示原始命令、输出和整次状态；摘要不拆分 Tool Call、Evidence 或步骤计数。
- [x] 文件已移动、删除或读取失败时只出现红色 Toast“无法打开该文件”，当前页面、已有预览和焦点不被切换。

## Runtime 事件验收

每个 Runtime 使用独立测试工作区，分别核对 read、新增、编辑非空文件和编辑空文件的原生事件、Canonical 投影、
界面标题、文件预览与既有 Diff。已完成矩阵及边界见[真实文件操作验收](runtime-acceptance.md)。本轮新增验收重点：

- Claude Code 2.1.236 的新文件与已有空文件都会给出 `type=create / originalFile=null`；规范化 Evidence 只保存
  `runtimeOperationType=create`，不写 filesystem `changeKind=add`，Renderer 显示“新增”。非空已有文件的
  `type=update` 继续显示“编辑”。
- OpenCode 只在本 Runtime 已核验的 `rawOutput.metadata.exists` Boolean 与同 ToolCall 路径严格对齐后区分
  新增／编辑；其他 ACP Runtime 不借用该字段。
- Codex、ACP、Claude 与 Pi 的空路径、失败终态、路径冲突和未知类型全部保守回退，不制造可点击文件行。

## 检查与完成条件

- [x] `pnpm test`、`pnpm typecheck`、`pnpm build:desktop`；
- [x] `cargo fmt --all -- --check`、`cargo check --workspace --all-targets`、Core library/CLI 定向及适用全量测试；
- [ ] `pnpm docs:test`、`pnpm docs:check`、`DOCS_BASE_REF=<merge-base> pnpm docs:check:ci`、`git diff --check`；
- [x] 生产 Electron `file-preview-layout` 与 `file-reference-navigation` 原生 fixture 已执行并明确记录宿主阻断；
- [x] HTML 交互稿脚本通过解析，用户浏览器实看反馈已逐项收口；
- [x] `package:mac:daily`、`install:mac:daily`、签名／架构／版本检查，并删除 Applications 内旧备份；
- [ ] 推送分支并等待 PR CI 通过。

## 验证记录

| Gate | 状态 | 证据 |
| --- | --- | --- |
| Renderer 与仓库门禁 | `passed` | `pnpm test`：156 个 Vitest 文件、1597 项通过；仓库 Node 测试 220 项通过、1 项既定 Windows 测试 skipped；`pnpm typecheck` 与 production Desktop build 通过 |
| 文件行交互边界 | `passed` | 定向 3 个文件、216 项测试通过；静态文件行不再复用 disclosure summary，文件链接使用文字宽度命中框，CSS 契约禁止整行 hover |
| Rust | `passed` | workspace/all-targets check、Core binary 227 项、CLI 33 项和适用 Core lib 515 项通过；5 项明确的真实 Runtime smoke ignored |
| macOS sandbox 单例 | `platform-blocked` | Core lib 总计 516 项中的既有 `managed_process` sandbox 测试，以及两个生产 Electron fixture，都在业务断言前被当前嵌套宿主的 `sandbox-exec` exit 71 阻断；没有记作业务通过或失败 |
| 文档与交互稿 | `passed` | docs 单测 9 项、版本与决定治理、HTML inline script parse 和 diff hygiene 通过；diff-aware CI 门禁待推送后执行 |
| 日常安装 | `passed` | arm64 ad-hoc 包安装到 `/Applications/Rovai AI.app`；App/Core/CLI 严格验签、Bundle ID `ai.rovai.desktop`、版本 `0.0.7` 与架构检查通过；6 个旧备份全部删除 |

## Worktree 交接

- Worktree：`/Users/murray.xue/VSCodeProjects/opensource/rovai-ai-tool-call-consistency`
- Branch：`rovai/tool-call-consistency`
- Base：本轮合并后的 `origin/main`
- Status：`in_progress`
