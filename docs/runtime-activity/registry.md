---
document_type: runtime-activity-mapping-registry
authority: runtime-activity-mapping-catalog
classifier_version: activity-v2
last_updated: 2026-08-29
---

# Runtime Activity Mapping Registry

## Adapter catalog

| Adapter kind | 产品显示名 | 协议族 | 基线 coverage | 细粒度工具名边界 | Fixture | 真实 smoke |
|---|---|---|---|---|---|---|
| `codex-cli` | Codex CLI | Codex app-server | `fine_grained` | MCP 使用结构化 `server/tool`；Core v2 不把 commandActions 翻译成标题，Renderer 从公开 command 生成去 wrapper、保留完整序列并脱敏的标题；只有 `item.type=webSearch` 可把 `item.query` 投影为 Search Operation | 受控 fixture、Renderer 跨 Runtime 命令/脱敏/详情、typed query 与普通 query 排除回归通过 | manual completion/config/process + Skill turn 通过；MCP projection 通过；`0.147.0` WebSearch wire 实证通过 |
| `opencode-cli` | OpenCode | ACP v1 | `fine_grained` | 使用 ACP 结构化 `kind`；有 `toolName` 才作为精确名，否则显示 Runtime `title` hint；公开 output 只来自文本 Content block 或 `rawOutput.stdout/stderr/output/text` | 受控 fixture 与固定 `printf` smoke 断言已建立 | manual completion + Skill turn 通过；MCP projection 通过；`1.18.15` 真实 command-output 与完整 allow/deny smoke 通过 |
| `copilot-cli` | GitHub Copilot | ACP v1 | `fine_grained` | 同 ACP 合同；支持标准 `type: content` 嵌套文本；`1.0.79 kind=search + query-only rawInput` 可投影 Web 搜索，`kind=read + pattern` 文件搜索不得准入；逻辑 MCP 名称通过 Context 的 `logicalName → runtimeName` 映射提示解析 | query-only positive、文件搜索 negative、固定 `printf` fixture 已建立 | manual completion + Skill turn + MCP projection 通过；`1.0.79` 真实 Web/file search 与 command-output wire 已核验 |
| `kiro-cli` | Kiro | ACP v1 | `fine_grained` | 同 ACP 合同；`2.18.1 kind=search + query-only rawInput` 可投影 Web 搜索，`{path,pattern}` 内容搜索与 pattern-only glob 不得准入；成功 Edit/Write 的唯一标准 location 可独立命名文件操作；单 entry Diff 的 rooted-relative path 只在与同 ToolCall location 完全对应时纠正；Team bridge 使用 Kiro/Bedrock 兼容 input schema，不改变 Core canonical 校验 | Search Operation positive/negative、path-only、标准 Diff、精确路径对齐与 mismatch fail-closed fixture 通过 | ACP session + Skill turn + MCP projection 通过；`2.18.1` 真实 Web/file search 与 pre-fix file-change wire 已核验，post-fix App smoke 待补 |
| `qoder-cli` | Qoder | ACP v1 | `fine_grained` | 同 ACP 合同；`1.1.28 kind=search + query-only rawInput` 可投影 Web 搜索，`{output_mode,path,pattern}` 内容搜索不得准入；成功 Edit/Write 可从同 ToolCall 先前唯一标准 location 生成文件操作行，terminal kind 冲突不覆盖首次可信 kind | Search Operation positive/negative、path-only、sparse terminal location 与 Read→edit 冲突 fixture 通过 | Skill turn 通过；`1.1.28` 真实 Web/file search 与 pre-fix Edit wire 已核验，post-fix App smoke 待补 |
| `codebuddy-cli` | CodeBuddy | ACP v1 | `fine_grained` | 同 ACP 合同；`2.133.1` 只在 terminal `kind=fetch + query-only rawInput` 投影 Web 搜索，started `kind=other`、WebFetch 非 query 输入与 Grep `kind=search` 均不得准入 | terminal fetch positive、started/WebFetch/Grep negative fixture 通过 | Skill turn 通过；`2.133.1` 真实 WebSearch/WebFetch/Grep wire 已核验 |
| `qwen-code` | Qwen Code | ACP v1 | `fine_grained` | 同 ACP 合同 | 受控 fixture 通过 | Skill turn 通过 |
| `trae-cn-cli` | TRAE CLI CN | ACP v1 | `fine_grained` | 同 ACP 合同；标准 `rawInput.command` 与 TRAE Bash 实测 `rawInput.Command` 的非空字符串进入公开 input，`Description` 等相邻字段保持私有；命令结构补全缺失的 execute kind；同 `toolCallId` 的 terminal 自带 command/kind/digest；Terminal content 只作 display anchor | 实测 `Command + Description` started、相邻 raw 字段排除、非 TRAE 大写字段 fail-closed、稀疏 terminal、非零 exit code 与固定 `printf` fixture 已建立 | `traecli 0.120.52` completion/cancel、Approval allow/deny、Missing-Send tool→final 与 MCP Projection 正式 Smoke 通过；六类 command 的 started/terminal 展示通过；正式 full matrix 仍被既有 nonzero status 漂移阻断 |
| `cursor-agent` | Cursor Agent | ACP v1 | `run_level` | 仅采用 ACP 标准 Session/Prompt 终态；`cursor/update_todos`、`cursor/task`、`cursor/generate_image` 保持私有且不生成 Activity，未知 Cursor 扩展 fail closed；认证和结构化工具事件尚未完成真实 admission | 私有 request 路由、私有 notification 隔离与 Runtime-level unknown fallback fixture 已建立 | `2026.08.11-e8db854` 隔离探测通过 initialize；authenticate 超时且未取得 authenticated Session，因此无 completion/tool smoke，不声明细粒度 coverage |
| `kimi-code-cli` | Kimi Code | ACP v1 | `run_level` | 标准 ACP Shell update 保留稳定 Tool ID、公开 command/output 与 terminal；成功 Edit/Write terminal 的唯一标准 location 可独立生成文件操作行；普通 `agent_message_chunk` 原样进入 agent text Evidence，不按 provider 或 `<think>` 标签清洗；缺少结构化事件时不补造细粒度 Activity | Kimi path-only、run-level mapping、Tool chronology、generic agent-text 与 Runtime-level fallback fixture 已建立 | `kimi 0.32.0` + MiniMax M3 真实 prompt、Shell allow/deny、固定 `printf` output、cancel、cleanup 与完整十五项 Built-in CLI matrix 通过；`0.38.0` pre-fix Edit wire 已核验，post-fix App smoke 待补；`run_level` 只表示缺少结构化事件时不补造细粒度 Activity |
| `grok-build` | Grok Build | ACP v1 | `run_level` | 标准 ACP tool update 按既有安全归一；`_x.ai/*` notification 保持 metadata，普通 assistant text 原样进入 agent text Evidence；缺少结构化 Tool 事件时不补造细粒度 Activity | Grok run-level mapping、官方 config、generic agent-text 与 Missing-Send fixture 已建立 | macOS arm64 与 Windows x64 已分别用 `grok 1.0.5` + MiniMax-M3 通过真实 Deep Probe、AgentRun 与 cold resume；`0.2.118` 原始矩阵保留为历史证据，macOS x64 待补；Usage/Cost 不从 vendor metadata 推断 |
| `claude-code-cli` | Claude Code | Claude stream-json + bounded stderr fallback | `fine_grained` | `tool_use.id` 是 lifecycle identity；Grep/WebSearch 分别映射 file_search/web_search；只把名称精确为 WebSearch 的 `input.query` 投影为 Search Operation，started→terminal 自包含；ToolSearch 不是 WebSearch；成功 matching Edit 仍形成同 Activity 的 `exact_mutation` | partial + complete message 去重、command、WebSearch/ToolSearch 边界、Edit、narration/retry 与私有相邻字段排除 fixture 通过 | 既有 Skill turn 与 MCP projection 通过；`2.1.220` WebSearch、ToolSearch、Bash、narration、Session、retry 与 Edit 已实证 |
| `antigravity-app` | Antigravity | Antigravity stream-json / legacy text | `run_level` | capability-gated stream-json 使用 `conversation_id + step_index`；`grep_search/search/search_web` 分别映射 file_search/search/web_search；只公开 Shell CommandLine，当前无准入的公开 query wire；旧版 text 保持 run-level | stream-json command/lifecycle/output、三种 search kind、非 Shell 输入排除与 legacy fallback fixture 通过 | 既有 manual completion + Skill turn 通过；`agy 1.1.22` 真实 `search_web`/`grep_search` wire 已核验；`1.1.13` 原生 `run_command` output、Session continuation 与 AGY→Codex handoff smoke 通过 |

Coverage 只描述 Core 实际能看到的粒度，不是产品支持等级。若某次运行没有报告结构化 tool event，
该运行不能因为产品基线为 `fine_grained` 就补写工具调用。

## Classifier cutover

Migration 116 把新 operation 的 current classifier 切换到 `activity-v2`，Data Contract 为
`v1.29 / projection schema 70`。已有 `activity-v1` row 不回填、不重分类、不删除；同一 operation 已有 v1
projection 时，后续 phase 继续用 v1 结算。Read Side 接受 v2 与 v1，并在同一 Evidence 异常出现两版时优先 v2。
此切换不声称已经实现任意历史 Evidence replay 或平行 reprojection。

`activity-v2` 的新写入顶层域只包含 `shell | file | tool | runtime | unknown`。Git、Network、Permission 与
Plan 不再作为新 Canonical 顶层域；历史 v1 值仍可只读展示，并由 Renderer 收敛到 Unknown presentation。

## Terminal file-change Evidence matrix

此矩阵分别描述 v1.29 的“可靠终态文件操作路径”与“可靠终态文件内容”准入，不改变上表的整体 Tool coverage。
`protocol-supported` 只表示 Adapter 能消费协议标准事件；ACP 运行没有发送 Diff 时仍可显示已证明的单文件操作，
但不显示增删计数或 inline diff。

| 协议族与适用 Adapter | 过去/当前实际接入事件 | 可靠文件操作 path | 可靠终态内容 | Command file rows |
| --- | --- | --- | --- | --- |
| Codex app-server（`codex-cli`） | Codex `item/completed`，`item.type=fileChange`、`status=completed` | `changes[].path` | `changes[] { path, kind, diff }`；update 为 unified diff，add/delete 为完整新/旧内容 | 支持；Core 统一规范化后逐 change 显示 `修改 xxx +A −D` |
| ACP v1（`opencode-cli`、`copilot-cli`、`kiro-cli`、`qoder-cli`、`codebuddy-cli`、`qwen-code`、`trae-cn-cli`、`cursor-agent`、`kimi-code-cli`、`grok-build`） | ACP `session/update.tool_call_update`；私有 Cursor/Kimi/Grok extension 与 run-level fallback 不补造文件操作或 diff | 成功 terminal `edit | write` + 同 ToolCall 累计唯一标准 `locations[].path`；不读取 rawInput/title/output | terminal 累计 `content.type=diff { path, oldText?, newText }`；只接纳标准 ACP terminal Diff | 有 path 即显示普通 `修改 xxx`；另有 Diff 才显示计数并展开。Kiro 单 entry rooted-relative path 只按同 ToolCall 唯一 location 精确对齐 |
| Claude stream-json（`claude-code-cli`） | 完整 assistant `tool_use(name=Edit)` + 相同 ID 的非错误 user `tool_result` | 完整 `file_path` | `file_path/old_string/new_string` 证明单次 `exact_mutation`，不证明文件行号或完整文件 before/after | 支持 Edit 片段行；不读文件、不生成 `@@`，失败/缺失/取消/`replace_all` 与其他 Tool 不准入 |
| Antigravity stream-json（`antigravity-app`） | `step_update` terminal state | 无等价可靠单文件终态 path | step/tool 名与公开 payload 没有可证明完整的 terminal patch | 不支持；不按 edit/write 名称推测 |

Codex `item/started`、`item/fileChange/patchUpdated`、`turn/diff/updated` 和原始 Tool 名 `apply_patch` 均不进入
Command Diff。ACP `content` collection 按协议 update 的 replace 语义累计；只有成功 terminal Tool 状态才把标准
Diff blocks 送入 append-only Evidence。ACP file-operation path 与 Diff 是同一 terminal Evidence 的独立子投影；
Renderer 只消费 Canonical presentation/diffProjection，不含 Runtime 分支。Claude 不解析 Bash/shell、Write、
NotebookEdit 或 ApplyPatch 输入；Edit 的 exact mutation 也只在 matching result 后发布。

## 2026-08-24 TRAE command display 真实 smoke 记录

- `traecli 0.120.52` 的真实 Bash started event 使用 `rawInput = { Command, Description }`，没有原生
  `kind`；terminal event 省略 `rawInput`，通过相同 `toolCallId` 与 started observation 关联；
- 修复后的隔离 Core 对 stdout、stderr、mixed、empty、nonzero 与 large 六类命令都在 started 和 terminal
  payload 公开原始受控 command，并投影为 `shell.execute`；`Description` 未进入公开 payload；
- 当前 Codex 宿主禁止嵌套 macOS Seatbelt，本次真实 Runtime 验收仅在临时测试二进制中跳过第二层
  `sandbox-exec`，正式源码未保留该绕过，数据目录与 Git workspace 均为一次性隔离路径；
- 正式 full matrix 仍在 nonzero status 断言失败：TRAE 对 `exit 7` 报告 `status=completed`，且
  `rawOutput` 没有 exit code。临时只放宽该状态断言后，六类 command display 全部通过；此证据不把
  output 中的 `Error:` 文本推断成退出码，也不冒充既有 nonzero status 合同已经通过。

## 2026-08-17 command output 真实 smoke 记录

- OpenCode `1.18.15` / `opencode/big-pickle`：公开 output 为
  `ROVAI_OPENCODE_CLI_PRINTF_OK\n`；修正 smoke 未应用自身 `permission=ask` 的配置漂移后，完整
  allow-once/deny 回归也通过，拒绝目标文件未创建；
- GitHub Copilot CLI `1.0.79` / `claude-sonnet-5`：公开 output 包含
  `ROVAI_COPILOT_CLI_PRINTF_OK\n` 与结构化 shell terminal 状态；`allow_all=off` 下实际解析 1 次审批；
- TRAE CLI CN 当前安装 / runtime default：公开 output 为 `ROVAI_TRAE_CN_CLI_PRINTF_OK\n`，实际解析
  1 次审批；按 v0.87 静态/执行期验证边界，`reportedVersion=null` 不视为失败；
- Claude Code `2.1.220` / runtime default：原生 `Bash` tool result 公开
  `ROVAI_CLAUDE_PRINTF_OK`，保留原生 tool-use ID，第三次 AgentRun 继续复用同一 Native Session 与
  logical Conversation；
- Antigravity `agy 1.1.13` / runtime default：`output.stream_json` capability 下原生 `run_command`
  step 公开 `ROVAI_AGY_PRINTF_OK\n`，使用结构化 step identity；同一 AGY Session 续接、后续换绑 Codex
  和私有日志清理同时通过。

五组 smoke 均使用临时 Core data-dir、managed Skill Library 与 Git workspace；没有启动、停止或替换
`/Applications/Rovai AI.app`，也没有读写日常数据库。以上只证明各 Runtime 在本次真实调用中的公开
command output 与生命周期投影，不把一次 pass 扩大为所有模型、版本或未执行工具的能力结论。

## 2026-08-05 真实联网 smoke 记录

- `cargo test --workspace -- --ignored --test-threads=1 --nocapture`：7 个 manual local Runtime smoke 全部通过（Codex 3、OpenCode、Copilot、Antigravity、Kiro ACP session）。
- `ROVAI_SKILL_SMOKE_ADAPTERS=kiro-cli pnpm smoke:skills`：Kiro `kiro-cli 2.15.1` 模型 turn 通过，返回 Skill marker；此前的 `runtime_prompt_runtime_error` 已定位为上下文 formatter 版本约束冲突并修复。
- `ROVAI_MCP_PROJECTION_SMOKE_ADAPTERS=copilot-cli pnpm smoke:mcp-projection`：Copilot `1.0.78` 实际调用 Core 投影工具，返回 `rovai-projection:copilot`，未调用 Runtime 原生同名工具。
- `ROVAI_MCP_PROJECTION_SMOKE_ADAPTERS=kiro-cli pnpm smoke:mcp-projection`：Kiro `2.15.1` 实际调用 Core 投影工具，返回 `rovai-projection:kiro`。
- 此前的 Codex、Claude Code、OpenCode 投影 smoke，以及四 Runtime 原生 MCP smoke 均保持通过。全适配器投影命令随后启动过，但本轮在 Kiro 阶段按用户要求停止，未将该未完成命令记为通过。

以上记录证明真实 Runtime 的连接、会话和可观测边界；它不替代十三 Runtime 的受控 Mapping fixture，也不允许 Core 根据未发生的工具调用补写 Canonical Activity。Cursor 当前只有 run-level 与 private-extension 隔离 fixture，不包含 authenticated Tool smoke；Kimi 已有真实 Shell Evidence，但仍保持保守的 run-level catalog baseline。

## Protocol mapping

### Codex app-server

| Runtime item type | activityDomain | semanticKind | toolName | presentationHint |
|---|---|---|---|---|
| `commandExecution` | `shell` | `shell.execute` | 无结构化名称时为空 | 只保留 Runtime 明确 `item.title`；Core v2 不翻译 commandActions、不生成默认中文 hint |
| `fileChange` | `file` | `file.write` | 空 | 只保留 Runtime 明确 `item.title`；可靠 basename 标题由 Renderer 从 typed file operation/diff 生成 |
| `webSearch` | `tool` | `tool.web.search` | 有结构化名称时保留 | Runtime title；`item.query` 只经内部 candidate 进入 typed Search Operation，不保留通用 item 字段 |
| `imageGeneration` | `tool` | `tool.image.generate` | 有结构化名称时保留 | Runtime title |
| `mcpToolCall` | `tool` | `tool.mcp.call` | `server/tool` | Runtime title |
| `dynamicToolCall` / collab tool | `tool` | `tool.call` | Runtime `tool` 字段 | Runtime title |

`item.id` 是 lifecycle identity。`item.title` 只进入 Core `presentationHint`；原始 command string 不参与
Canonical 分类或 identity。Renderer 对所有有公开 command 的 Shell Activity 统一生成去除外层 Shell wrapper、
保留完整子命令/参数/运算符并确定性脱敏的单行标题，不再为 Codex structured command 建第二套中文 hint。视觉宽度
不足时由 CSS ellipsis 省略，展开后完整脱敏命令与公开 output 分区显示。这个 projection 同时消费 live 与
恢复后的同一 Evidence shape，不创造新事实，也不扩大其他 Runtime 的 command input 边界。Codex `0.147.0` 的本地 app-server schema 与实际 AgentRun
均证明 `commandExecution.title` 可以为空，而 `commandActions` 是协议必填字段；修复 fixture 使用该真实
wire shape，Core post-fix live smoke 仍需单独运行。

### Command output durability audit

2026-08-26 对全部 13 个 Adapter 的归一化路径逐项核验后，terminal output 权威如下：

| 协议路径 | Adapter identities | terminal semantic output | 临时输出片段 |
|---|---|---|---|
| Codex app-server | identity：`codex-cli` | `item/completed` 的 `commandExecution.aggregatedOutput`，并保留 `command`、`status`、`exitCode` | 无 `id` 的 `command.output.delta` 在 Host stdout ingress 按当前 Thread/Turn route 分类后直接丢弃，不进入 `CodexIncoming`；legacy shape fail closed |
| ACP v1 | identities：`opencode-cli`、`copilot-cli`、`kiro-cli`、`qoder-cli`、`codebuddy-cli`、`qwen-code`、`trae-cn-cli`、`cursor-agent`、`kimi-code-cli`、`grok-build` | terminal `tool_call_update` 归一为一条 `runtime.action.payload.output` | 这十个 Adapter 不产生 `command.output.delta` |
| Claude stream-json | identity：`claude-code-cli` | terminal Bash `tool_result` 归一为一条 `runtime.action.payload.output` | 不产生 `command.output.delta` |
| Antigravity stream-json | identity：`antigravity-app` | terminal tool step 归一为一条 `runtime.action.payload.output` | 不产生 `command.output.delta` |

因此当前 Adapter 均不需要输出 spool。未来只有在原生 terminal 无法给出完整 aggregate 时，才允许 Adapter-owned
临时 spool；它必须有明确硬上限、生成完整或明确 truncated 的 terminal result，并在 Run 结束后删除。Core 或
Renderer 不得用无界字符串 accumulator 补偿协议缺口，也不得把片段逐条持久化。

Codex 的 transport-only delta 不写 Execution Evidence、不更新 Canonical Activity、不创建 Managed Blob，也不进入
Renderer `liveRuntimeEvents`。Host ingress 对精确当前 Thread/Turn + 非空 `itemId` 与 stale/malformed/unbound/legacy
分别给出 current/rejected 分类，但两者都在同一 route 读锁下消费并丢弃；因此 terminal 尚未被 Core 消费前的 delta
即使仍分类为 current，也没有可更新的状态。带 `id` 的同名 request 保持 request response 路径，下游漏网 guard 位于
shutdown route permit、batching、Runtime lookup 与数据库之前。既有历史 `command.output.delta` Evidence/Blob 不迁移、
不删除、不重写，并继续由历史只读展示路径解析。

### ACP v1

| ACP `kind` | activityDomain | semanticKind |
|---|---|---|
| `read` / `read_file` | `file` | `file.read` |
| `edit` / `write` / `write_file` / `apply_patch` | `file` | `file.write` |
| `execute` / `command` / `terminal` / `shell` | `shell` | `shell.execute` |
| `search` | `tool` | `tool.search` |
| `web_search` | `tool` | `tool.web.search` |
| `file_search` | `file` | `file.search` |
| `mcp_tool_call` / `tool` | `tool` | `tool.call` |
| 未识别 | Evidence kind 可证明时使用其域，否则 `unknown` |

`toolCallId` 是 lifecycle identity。ACP `title` 是 Runtime presentation hint，不是分类输入；只有明确的
`toolName` 才作为精确名称。通用 ACP 只有非空字符串 `rawInput.command` 可以投影为公开 `input`；
`trae-cn-cli` 额外只接受实测 Bash 字段 `rawInput.Command`，该大小写例外不适用于其他 Adapter。相邻
rawInput 字段保持私有并只参与完整 `rawInputDigest`。Runtime 缺失 kind 时，这个窄 command shape 映射为 `execute`。同一
`toolCallId` 的 terminal update 即使省略 rawInput/kind，也从当前 Prompt 的进程内观察携带相同 command、kind
与 digest；不从 title 或 digest 推导。effective execute 的 `exitCode | exit_code` 非零时，公开 terminal status
与 Action outcome 为 failed，即使 ACP tool lifecycle 报告 completed。

Search Operation 采用两层准入。第一层是协议明确的 effective kind `web_search`：只复制非空字符串
`rawInput.query`，相邻字段仍保持私有。第二层是当前 Runtime 实测但 ACP kind 模糊的 Adapter/version tuple：

| Adapter/version | 实测 Web 事件 | 必须排除的相邻事件 | 准入规则 |
|---|---|---|---|
| `copilot-cli 1.0.79` | `kind=search`，`rawInput={query}` | 文件内容搜索为 `kind=read`、`{pattern}` | Adapter + version + `search` + query-only |
| `qoder-cli 1.1.28` | `kind=search`，`rawInput={query}` | 文件搜索为 `kind=search`、`{output_mode,path,pattern}` | Adapter + version + `search` + query-only |
| `kiro-cli 2.18.1` | `kind=search`，`rawInput={query}` | 内容搜索为 `kind=search`、`{path,pattern}`；glob 为 `{pattern}` | Adapter + version + `search` + query-only |
| `codebuddy-cli 2.133.1` | terminal `kind=fetch`，`rawInput={query}` | started `kind=other`；WebFetch 为非 query 输入；Grep terminal 为 `kind=search` | Adapter + version + terminal `fetch` + query-only |

这些 tuple 先形成 internal candidate；Core 使用 AgentRun 冻结的 Adapter 与 reported version 复核后，才把
Evidence kind 升级为 `web_search` 并写入 available `runtimeSearchOperation`。版本缺失/变化、shape 多一个字段或
tuple 不匹配时写 unavailable projection（不含 query），并保留原生 `search/fetch` 分类。terminal 省略 rawInput
时可从同 ToolCall 的当前 Prompt 观察继承 candidate。query 不做敏感词过滤，其他 rawInput 邻接字段仍保持私有。

文件操作 presentation 使用更窄的终态合同：只有成功 `completed`、累计 native kind 精确为 `edit | write`，且同一
`toolCallId` 的标准 `locations[].path` 能确定唯一规范化路径时，才在同一 Canonical Activity 上生成
`修改 <basename>`。terminal 省略或清空 locations 时保留先前非空累计值；首次可信结构化 kind 不被后续冲突值
覆盖。该路径不来自 rawInput/title/output，也不自动生成 `diffProjection`。`write_file`、`apply_patch` 等普通分类
仍可属于 file domain，但不因名称获得这条文件操作 Evidence。

Tool output 先读取 `ToolCallContent.type = content` 包裹的公开 text Content block，并兼容旧 adapter 的
直接 text block。`diff`、image/audio/resource 与 `type = terminal` 都不被解释为命令输出；标准 `diff` 只在
成功 terminal ToolCall 的独立 v1.29 file-change Evidence 通路中按完整 before/after 处理。Rovai 声明 Client
Terminal 不可用，因此不会读取 `terminalId` 或从私有 terminal 猜测 stdout。只有 Content 没有
公开文本时，才从 `rawOutput` 的顶层 `stdout`、`stderr`、`output`、`text` 字符串白名单回退；其他键只
参与原有 digest，不进入公开 payload。

### Core Team Tool

只有 `sourceAuthority === "core"` 且 `canonicalTool` 通过当前 Rovai Tool Catalog 验证时，
`canonicalTool` 才成为 `toolName` 并标记 `core_verified`。Renderer 只用这组 canonical identity 选择 Rovai
图标；display title 或 Shell command 中出现 `rovai` 不构成 Core Tool。其他同名字段都不可信。

### Claude Code

`--output-format stream-json --include-partial-messages` 中的 partial `content_block_start` 与完整 assistant
`tool_use` 共同建立、去重同一个原生 tool-use ID；对应 user `tool_result` 结算 terminal。Bash 映射
`shell.execute`，Read/Glob 映射 file read，Edit/Write 映射 file write，Grep 映射 `file.search`，WebSearch
映射 `tool.web.search`；未知名称保持 `tool.call`。只允许 Bash `tool_use.input.command` 进入公开 input，并按
tool-use ID 同时放入 started 与 terminal Evidence，使没有 stdout/stderr 或只加载 terminal 的命令仍可检查；
只允许 Bash tool result 的公开 stdout/stderr 或标准公开 text result 进入 output。WebSearch 另只把精确
`input.query` 送入 internal candidate，并按 tool-use ID 保持 started/terminal 自包含；Core 准入后只在
`runtimeSearchOperation.query` 保存，query 原样保存、不做敏感词过滤。ToolSearch 只是工具发现，不获得这条
准入。其它工具输入、
文件内容和 provider metadata 不进入普通 Tool input/output。

唯一例外是内部 Command Diff 通道：完整 assistant `tool_use` 的名称精确为 `Edit`、`file_path/old_string/new_string`
类型完整且 `replace_all` 缺失或为 false 时，Adapter 按 tool-use ID 暂存 exact mutation；matching user
`tool_result` 明确非错误后，终态 `runtime.action` 才携带该 mutation。Evidence 保存相对 execution root 规范化后的
`semantics/path/oldText/newText`，Canonical projection 派生 `−/+` 片段；不搜索当前文件，不输出文件行号或 hunk。
缺 result、失败、取消、字段不完整、no-op、`replace_all=true`、Write、NotebookEdit 与 ApplyPatch 都不产生 Diff。

公开 `text_delta` 以 message/block-scoped item ID 投影为
`agent.text.delta`；只有整次 Run 没有 text delta 时，才把已经公开的 success `result` 作为 narration
fallback。`thinking_delta`、失败 result 和 provider metadata 不进入公开 Evidence；最终 Camp Message、
Usage 与 Session 校验维持独立边界。

Claude Code 2.1.220 在 `--print --output-format stream-json` 中以 session-bound
`type=system/subtype=api_retry` 报告 attempt、`max_retries` 与 `retry_delay_ms`。Adapter 在完整 NDJSON 事件到达、
stdout 尚未结束时立即发出 `runtime.diagnostic`：稳定 `diagnosticId`、`runtime_api_retrying`、`retrying`、
attempt/max 与整数等待秒数。provider error/status、事件 UUID、Session ID 和未知字段均不公开；字段缺失、
计数越界或 Session 不匹配 fail closed。v14 的有界 stderr 固定 grammar 只作为兼容 fallback。该事件是
non-terminal Evidence，不能变成 Canonical Activity，也不能推进 Run outcome；Renderer 按 diagnostic ID
只展示最新 attempt，并在任何终态后移除 live retry notice。

### Antigravity

Capability snapshot 明确包含 `output.stream_json` 时，Adapter 消费公开 NDJSON `init`、`step_update`、
`result`；tool step 只用结构化 conversation、step index、state、tool name 和白名单 command output。仅
`run_command`、`bash`、`terminal` 等明确 Shell 工具读取 `tool_info.parameters.CommandLine`，并只投影为
`input.command`；started phase 的 command 观察在 lifecycle 去重前按 `conversation_id + step_index` 缓存，
terminal 当前携带 CommandLine 时优先使用，缺失 parameters 时消费该缓存补齐。完整 parameters、Cwd 与相邻私有
字段不公开，原生 `toolName` 只保留为 Runtime 工具标识，不生成 `title`；Renderer 对 presentation hint 与
`toolName` 共用一套 generic Shell 名称判断（包括 `run_command`、`exec_command`、`execute_command`、`bash`、
`execute`、`shell`、`terminal`），有 command 时显示统一脱敏后的完整命令，无 command 时显示“终端操作”。命令只参与展示，不参与
Canonical Activity 分类，结构化 kind 仍映射 `shell.execute`。`grep_search`、`search`、`web_search | search_web`
分别映射 `file.search`、`tool.search`、`tool.web.search`；`search_web` 是 `agy 1.1.22` 实测名称，保留
`web_search` 作为已声明兼容别名。当前公开协议没有单独准入 query 字段，不从 parameters 猜测。
没有该 capability 的旧安装继续使用 text final/run-level 展示。私有日志仍只校验 Conversation 和输入接受，
不得产生工具 Evidence；workspace diff、最终文本或产品能力也不得反推内部步骤。Core 自己调度的 Team Tool
仍是独立的 Core-verified Activity。

## Lifecycle and unknown rules

- Core Action ID → Runtime native ID → Evidence ID；
- 只有相同 operationId 合并；
- operation 首次创建的 classifier/version 固定；已有 v1 projection 的 live operation 不切到 v2，新 operation
  才使用 current v2；历史 v1 与新 v2 都可读取，不做批量重投影；
- lifecycle completion 可以只报告 identity/status；这类稀疏更新只推进 phase/outcome，不得用 Evidence-kind fallback 覆盖同一 operation 已报告的结构化 domain、semantic kind 或 title；
- terminal 冲突为 `unsettled`；
- Runtime 明确报告 interruption 时，已 started 且尚未结算的 operation 归约为
  `phase=terminal / outcome=unsettled / reasonCode=runtime_interrupted`，Renderer 显示 stopped/interrupted；
  只有 Runtime 权威取消终态才归约为 `cancelled`；
- 无结构化工具名时显示 presentation hint 或 activity-domain fallback，不伪造函数名；
- title、provider 和 Runtime 名称永远不决定 domain 或 identity；唯一例外是 Adapter 白名单公开的 ACP
  `rawInput.command`，以及仅 `trae-cn-cli` 的 `rawInput.Command`，可在原生 kind 缺失时证明
  shell/execute，但 command 正文不参与 operation identity。
- 所有公开 Shell command 只允许按上述 Renderer 边界生成完整脱敏的 presentation；没有 command 时保持
  toolName/title/domain fallback。
- `runtime.diagnostic` 是 non-activity 状态证据；它不能因为 `kind=step`、Runtime 名称或展示文案而伪造成
  Tool operation，也不能替代可靠 terminal outcome。

## Runtime-specific transport notes

这些规则只描述 Runtime 接入所需的协议/传输适配，不改变 Canonical Activity 的语义分类：

- Copilot 的 Core MCP projection 使用稳定逻辑名保留 Evidence 身份，同时在动态 Context 中公布当前 Runtime 实际暴露名；模型必须调用 Context 映射中的 `runtimeName`。
- Kiro 的 Team bridge 通过 `ROVAI_TEAM_SCHEMA_DIALECT=kiro-bedrock-v1` 暴露 Bedrock 可接受的 `camp.read` input schema；Core 仍使用完整 canonical schema 做输入验证。
