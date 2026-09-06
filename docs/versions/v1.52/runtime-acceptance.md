---
document_type: version-acceptance
version: v1.52
authority: runtime-file-operation-acceptance
status: complete
last_updated: 2026-09-06
---

# v1.52 Runtime 文件操作验收

此文件保留 PR #245 独立工具分支在 v1.52 阶段产生的验收证据，不代表合并后的升级验收。
迁移编号汇合及正文块兼容的当前状态见 [v1.53 实施与验收](../v1.53/implementation-plan.md)。

本轮在 macOS 26.3 arm64 使用本机真实 Runtime 安装、账号、Provider 与默认模型执行。每个 Runtime 使用独立的
临时 Core data root、Git workspace 和 Camp；依次读取已有文件、新增不存在的文件、编辑已有非空文件、编辑已有
空文件。验收同时读取 live `runtime.action` 与持久化 `agentRunEvidence.list`，检查 `activity-v3`、typed operation、
Diff、`Files Changed` 和界面标题。临时目录不进入日常 App 数据，也不把本轮结果提升为新的平台资格。

表中 `passed` 表示事件投影和展示遵守本版本规则；`passed（回退）` 表示 Runtime 完成了文件动作，但没有公开可靠
的单文件终态，因此产品按合同保留原工具／Run 级展示。`failed` 是 Runtime 未完成该文件动作；Core 没有为失败
补造操作。`blocked` 表示在发送模型请求前被现有产品准入拦截。

| Runtime / 实测版本 | 阅读事件 | 新增事件 | 编辑事件（非空／空文件） | 路径、Diff 与最终展示 |
| --- | --- | --- | --- | --- |
| Codex CLI `0.153.4` | `passed` | `passed` | `passed / passed` | cat、head、tail、sed 四个 structured `commandActions.read` 均投影“阅读”，且不进入 `Files Changed`；明确 `fileChange.add` 显示“新增”，update 显示“编辑”并保留 Diff |
| OpenCode `1.18.20` | `passed` | `passed` | `passed / passed` | read/write 精确路径通过；成功 write 的 `rawOutput.metadata.exists=false` 与同 ToolCall path 对齐后显示“新增”，`true` 显示“编辑”。本次 add 与空文件内容均只缺 Prompt 要求的末尾换行，事件、路径与分类通过 |
| GitHub Copilot CLI `1.0.82` | `passed` | `passed` | `passed / passed` | 单文件 read/write 通过；新文件被 Runtime 报为 update，因此显示“编辑”而不猜“新增” |
| Claude Code `2.1.236` | `passed` | `passed` | `passed / passed` | Read/Write/Edit 均在 matching 成功 result 后投影；真实 Write 对新文件与已有空文件都报告 `create + originalFile=null`，不能可靠升级为新增，故两者均保守显示“编辑”；非空已有文件 `update` 与 Edit exact-mutation 通过 |
| Antigravity `1.1.27` | `passed（回退）` | `passed（回退）` | `passed（回退） / passed（回退）` | 四次真实文件效果均成功；当前 stream 没有可准入的单文件终态 path/Diff，因此不显示虚构的阅读／编辑文件行 |
| Kiro `2.21.1` | `passed` | `passed` | `passed / passed` | read 与 write path 精确；只有标准 Diff 时显示计数，path-only 新建与空文件写入显示“编辑”且无空展开 |
| Qoder `1.1.28` | `passed` | `passed` | `passed / passed` | read/write path 与 update Diff 通过；空文件编辑事件通过，模型省略了请求的末尾换行，此差异不改变事件分类 |
| CodeBuddy `2.133.1` | `passed` | `passed` | `passed / passed` | 使用本机既有 MiniMax 配置与显式 `minimax-m3` 建立含 16 个模型的 Ready snapshot；五条 Run 均成功，read/write 路径准确。新增与空文件只有 path-only write，保守显示“编辑” |
| Qwen Code `0.23.0` | `passed` | `passed` | `passed / passed` | read 路径稳定；写入在两次真实运行间出现“精确 typed path”与“只有 basename update Diff”两种 wire，均只显示“编辑”。后者不能证明嵌套文件的可点击目标，点击会诚实 Toast；新增与空文件运行还省略了末尾换行 |
| TRAE CLI CN `0.120.52` | `passed` | `passed` | `passed / passed` | 四项均有精确 typed path；Runtime 把新文件 Diff 报为 update，统一显示“编辑”，live/history 一致 |
| Cursor Agent `2025.09.18-7ae6800` | `blocked` | `blocked` | `blocked / blocked` | macOS arm64 在现有 `runtime_platform.qualification_evidence_missing` 准入处阻断；没有提升平台资格或启动模型 |
| Kimi Code `0.40.1` | `passed` | `passed` | `passed / passed` | read/write 精确路径通过；新增与空文件的 path-only write 保守显示“编辑”，已有文件 update Diff 继续可展开 |
| Grok Build `1.0.13` | `failed` | `failed` | `failed / failed` | Runtime、模型与 ACP 会话已连通：首次宿主矩阵五条 Run、文件效果和 typed path 全部通过，新文件被报告为 update；相同版本立即复跑却报告文件工具不可用／工具名为空，read 无终态、add/edit Run 失败、空文件未执行。因不可重复，不声明可靠文件能力，保持回退 |
| Pi `0.84.4` | `passed` | `passed` | `passed / passed` | 真实 wire 只在 start 提供 toolName/args，Core 以同一 `toolCallId` 关联成功 end 后得到精确 read/write path；write/edit 显示“编辑”且无虚构 Diff。新增与空文件写入省略末尾换行，但事件投影通过 |

## 结论与边界

- 可靠 read 在所有提供标准单文件终态的 Runtime 中显示“阅读”，并从 `Files Changed` 排除。Antigravity 缺少该
  证据、Grok 无法重复取得该证据时保持回退；Cursor 没有越过已有准入。
- “新增”由 Codex 的明确 add 与 OpenCode 写入前 `metadata.exists=false` 证明。其他 Runtime 的 path-only write 或
  update Diff 全部显示“编辑”。Claude 的 create 在 2.1.236 对已有空文件出现真实假阳性，因此不升级为新增，避免
  把空文件误判为新文件。
- Qwen 的 basename-only Diff 是本轮唯一不能证明嵌套文件预览目标的成功写入 wire。产品不拼接读操作路径、不读取
  当前磁盘猜测，失败点击只显示 `无法打开该文件`。
- OpenCode、Qoder、Qwen 与 Pi 的少数运行省略了 Prompt 要求的末尾换行；这是模型文件内容服从度差异，文件操作
  事件、成功终态和保守标题仍按实测结构验收，未将内容差异伪装为完全一致。

Claude 另外以三个一次性隔离目录直接抓取 2.1.236 `stream-json` Write 终态，只保留脱敏结构：不存在文件为
`type=create / originalFile=null`，已有非空文件为 `type=update / originalFile=string`，已有空文件再次为
`type=create / originalFile=null`；三者 `tool_use_id`、`filePath` 与成功 result 均准确关联。原始 JSONL 在结构摘要
生成后删除。

当前命令执行环境禁止嵌套 `sandbox-exec`，直接从该环境启动 Core 会使 Runtime 版本探针以 status 71 失败。CodeBuddy
和 Grok 的最终结论均来自一次性本地 background App 启动的宿主隔离流程；它仍由 Rovai Core 正常应用 Runtime
sandbox、独立 data root 与临时 Git workspace，没有使用日常 Electron `userData`。Grok 连续执行两次：一次
完整通过、一次没有可靠文件 Tool 终态；最终按不可重复处理，而不是把偶然成功提升为稳定能力。

## 可重复入口

- ACP/Codex/Claude/Antigravity 矩阵：[scripts/smoke-acp-runtime.mjs](../../../scripts/smoke-acp-runtime.mjs)，设置
  `ROVAI_ACP_FILE_OPERATION_MATRIX=1` 并以 `ROVAI_ACP_SMOKE_ADAPTER` 逐 Runtime 隔离执行。
- Pi 矩阵：[scripts/smoke-pi-runtime.mjs](../../../scripts/smoke-pi-runtime.mjs)，设置
  `ROVAI_PI_FILE_OPERATION_MATRIX=1`。
- Core 正反例覆盖：[Runtime File Change Observation v3](../../contracts/runtime-file-change-observation-v3.md)；
  文件入口失败不切换预览由 production Electron fixture 验证。

真实运行产生的 Camp ID、Run ID、Session ID 和临时绝对路径只用于本轮核对，没有提交到仓库；本文件保留版本、
状态、事件类别和可复现入口这些脱敏结论。
