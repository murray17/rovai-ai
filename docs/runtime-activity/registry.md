---
document_type: runtime-activity-mapping-registry
authority: runtime-activity-mapping-catalog
classifier_version: activity-v1
last_updated: 2026-08-25
---

# Runtime Activity Mapping Registry

## Adapter catalog

| Adapter kind | 产品显示名 | 协议族 | 基线 coverage | 细粒度工具名边界 | Fixture | 真实 smoke |
|---|---|---|---|---|---|---|
| `codex-cli` | Codex CLI | Codex app-server | `fine_grained` | MCP 使用结构化 `server/tool`；commandActions 全为 read/list/search 时使用中文语义 hint；其他 command 从公开 `command` 生成去 wrapper、保留完整序列并脱敏的 Renderer 标题，展开后分开显示命令与 output | 受控 fixture、Renderer 十 Runtime matrix 与 v1.18 命令/脱敏/详情回归通过 | manual completion/config/process + Skill turn 通过；MCP projection 通过；新版 Core 标题 post-fix smoke 待运行，Renderer fallback 已用真实 Camp Evidence 回归 |
| `opencode-cli` | OpenCode | ACP v1 | `fine_grained` | 使用 ACP 结构化 `kind`；有 `toolName` 才作为精确名，否则显示 Runtime `title` hint；公开 output 只来自文本 Content block 或 `rawOutput.stdout/stderr/output/text` | 受控 fixture 与固定 `printf` smoke 断言已建立 | manual completion + Skill turn 通过；MCP projection 通过；`1.18.15` 真实 command-output 与完整 allow/deny smoke 通过 |
| `copilot-cli` | GitHub Copilot | ACP v1 | `fine_grained` | 同 ACP 合同；支持标准 `type: content` 嵌套文本；逻辑 MCP 名称通过 Context 的 `logicalName → runtimeName` 映射提示解析 | 受控 fixture 与固定 `printf` smoke 断言已建立 | manual completion + Skill turn + MCP projection 通过；`1.0.79` 真实 command-output smoke 通过 |
| `kiro-cli` | Kiro | ACP v1 | `fine_grained` | 同 ACP 合同；Team bridge 使用 Kiro/Bedrock 兼容 input schema，不改变 Core canonical 校验 | 受控 fixture 通过 | ACP session + Skill turn + MCP projection 通过 |
| `qoder-cli` | Qoder | ACP v1 | `fine_grained` | 同 ACP 合同 | 受控 fixture 通过 | Skill turn 通过 |
| `codebuddy-cli` | CodeBuddy | ACP v1 | `fine_grained` | 同 ACP 合同 | 受控 fixture 通过 | Skill turn 通过 |
| `qwen-code` | Qwen Code | ACP v1 | `fine_grained` | 同 ACP 合同 | 受控 fixture 通过 | Skill turn 通过 |
| `trae-cn-cli` | TRAE CLI CN | ACP v1 | `fine_grained` | 同 ACP 合同；标准 `rawInput.command` 与 TRAE Bash 实测 `rawInput.Command` 的非空字符串进入公开 input，`Description` 等相邻字段保持私有；命令结构补全缺失的 execute kind；同 `toolCallId` 的 terminal 自带 command/kind/digest；Terminal content 只作 display anchor | 实测 `Command + Description` started、相邻 raw 字段排除、非 TRAE 大写字段 fail-closed、稀疏 terminal、非零 exit code 与固定 `printf` fixture 已建立 | `traecli 0.120.52` completion/cancel、Approval allow/deny、Missing-Send tool→final 与 MCP Projection 正式 Smoke 通过；六类 command 的 started/terminal 展示通过；正式 full matrix 仍被既有 nonzero status 漂移阻断 |
| `cursor-agent` | Cursor Agent | ACP v1 | `run_level` | 仅采用 ACP 标准 Session/Prompt 终态；`cursor/update_todos`、`cursor/task`、`cursor/generate_image` 保持私有且不生成 Activity，未知 Cursor 扩展 fail closed；认证和结构化工具事件尚未完成真实 admission | 私有 request 路由、私有 notification 隔离与 Runtime-level unknown fallback fixture 已建立 | `2026.08.11-e8db854` 隔离探测通过 initialize；authenticate 超时且未取得 authenticated Session，因此无 completion/tool smoke，不声明细粒度 coverage |
| `kimi-code-cli` | Kimi Code | ACP v1 | `run_level` | 标准 ACP Shell update 保留稳定 Tool ID、公开 command/output 与 terminal；普通 `agent_message_chunk` 原样进入 agent text Evidence，不按 provider 或 `<think>` 标签清洗；缺少结构化事件时不补造细粒度 Activity | Kimi run-level mapping、Tool chronology、generic agent-text 与 Runtime-level fallback fixture 已建立 | `kimi 0.32.0` + MiniMax M3 真实 prompt、Shell allow/deny、固定 `printf` output、cancel、cleanup 与完整十五项 Built-in CLI matrix 通过；`run_level` 只表示缺少结构化事件时不补造细粒度 Activity，不否定 Built-in transport 资格 |
| `grok-build` | Grok Build | ACP v1 | `run_level` | 标准 ACP tool update 按既有安全归一；`_x.ai/*` notification 保持 metadata，普通 assistant text 原样进入 agent text Evidence；缺少结构化 Tool 事件时不补造细粒度 Activity | Grok run-level mapping、官方 config、generic agent-text 与 Missing-Send fixture 已建立 | macOS arm64 已用 `grok 1.0.5` + MiniMax-M3 通过真实 Deep Probe、AgentRun 与 cold resume；`0.2.118` 原始矩阵保留为历史证据，macOS x64/Windows x64 待补；Usage/Cost 不从 vendor metadata 推断 |
| `claude-code-cli` | Claude Code | Claude stream-json + bounded stderr fallback | `fine_grained` | `tool_use.id` 是 lifecycle identity；Bash/Read/Edit/Write 等原生名称映射到既有 kind；仅 Bash 的公开 `input.command` 进入 started 与 terminal input，仅 Bash tool result 的公开 stdout/stderr 进入 output；公开 `text_delta` 进入 narration；session-bound `system/api_retry` 只投影固定 code/status、次数和等待秒数，不产生 Tool | partial + complete message 去重、started→terminal command 自包含、空输出 Bash、narration/fallback、stdout 未结束前 structured retry diagnostic 与 provider error/UUID/Session/raw stderr 不泄露 fixture 通过 | 既有 Skill turn 与 MCP projection 通过；`2.1.220` 原生 Bash command-output、公开 narration、Session continuation 与实际 `system/api_retry` 429 重试流已实证；完整展示 post-fix smoke 待运行 |
| `antigravity-app` | Antigravity | Antigravity stream-json / legacy text | `run_level` | capability-gated stream-json 使用 `conversation_id + step_index` 作为结构化 tool identity；仅 Shell 工具公开 `tool_info.parameters.CommandLine` 为 `input.command`，terminal 缺失 parameters 时按相同 identity 补齐；`toolName` 保留原生 ID 但不作为标题；旧版 text 保持 run-level，私有日志不产生工具 Evidence | stream-json command/lifecycle/output、非 Shell 输入排除与 legacy fallback fixture 通过 | 既有 manual completion + Skill turn 通过；`agy 1.1.13` 原生 `run_command` output、Session continuation 与 AGY→Codex handoff smoke 通过 |

Coverage 只描述 Core 实际能看到的粒度，不是产品支持等级。若某次运行没有报告结构化 tool event，
该运行不能因为产品基线为 `fine_grained` 就补写工具调用。

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

以上记录证明真实 Runtime 的连接、会话和可观测边界；它不替代十二 Runtime 的受控 Mapping fixture，也不允许 Core 根据未发生的工具调用补写 Canonical Activity。Cursor 当前只有 run-level 与 private-extension 隔离 fixture，不包含 authenticated Tool smoke；Kimi 已有真实 Shell Evidence，但仍保持保守的 run-level catalog baseline。

## Protocol mapping

### Codex app-server

| Runtime item type | activityDomain | semanticKind | toolName | presentationHint |
|---|---|---|---|---|
| `commandExecution` | `shell` | `shell.execute` | 无结构化名称时为空 | Core 优先 `item.title`；否则仅用结构化 `commandActions` 的 read/list/search 类型和安全路径 basename 生成“读取文件 / 检索项目文件”等有界标题；unknown 的 Canonical 回退仍为“执行 Shell 命令”，Renderer 再按下述展示边界提炼命令名 |
| `fileChange` | `file` | `file.write` | 空 | 优先 `item.title`；否则用 `changes` 的数量、单文件 basename 和 add/delete/update 类型生成标题 |
| `webSearch` | `tool` | `tool.web.search` | 有结构化名称时保留 | Runtime title 或 Core domain hint |
| `imageGeneration` | `tool` | `tool.image.generate` | 有结构化名称时保留 | Runtime title 或 Core domain hint |
| `mcpToolCall` | `tool` | `tool.mcp.call` | `server/tool` | Runtime title 或 Core domain hint |
| `dynamicToolCall` / collab tool | `tool` | `tool.call` | Runtime `tool` 字段 | Runtime title 或 Core domain hint |

`item.id` 是 lifecycle identity。`item.title` 与上述结构化 presentation 字段只进入 Core
`presentationHint`；原始 command string 不参与 Canonical 标题生成、分类或 identity。Renderer 对
`commandActions` 全为 read/list/search 的 command 使用结构化中文 hint；其他 command 从已经公开的
`item.command` 生成去除外层 Shell wrapper、保留完整子命令/参数/运算符并确定性脱敏的单行标题。视觉宽度
不足时由 CSS ellipsis 省略，展开后完整脱敏命令与公开 output 分区显示。这个 projection 同时消费 live 与
恢复后的同一 Evidence shape，不创造新事实，也不扩大其他 Runtime 的 command input 边界。Codex `0.147.0` 的本地 app-server schema 与实际 AgentRun
均证明 `commandExecution.title` 可以为空，而 `commandActions` 是协议必填字段；修复 fixture 使用该真实
wire shape，Core post-fix live smoke 仍需单独运行。

### ACP v1

| ACP `kind` | activityDomain | semanticKind |
|---|---|---|
| `read` / `read_file` | `file` | `file.read` |
| `edit` / `write` / `write_file` / `apply_patch` | `file` | `file.write` |
| `execute` / `command` / `terminal` / `shell` | `shell` | `shell.execute` |
| `search` / `web_search` | `tool` | `tool.web.search` |
| `mcp_tool_call` / `tool` | `tool` | `tool.call` |
| 未识别 | Evidence kind 可证明时使用其域，否则 `unknown` |

`toolCallId` 是 lifecycle identity。ACP `title` 是 Runtime presentation hint，不是分类输入；只有明确的
`toolName` 才作为精确名称。通用 ACP 只有非空字符串 `rawInput.command` 可以投影为公开 `input`；
`trae-cn-cli` 额外只接受实测 Bash 字段 `rawInput.Command`，该大小写例外不适用于其他 Adapter。相邻
rawInput 字段保持私有并只参与完整 `rawInputDigest`。Runtime 缺失 kind 时，这个窄 command shape 映射为 `execute`。同一
`toolCallId` 的 terminal update 即使省略 rawInput/kind，也从当前 Prompt 的进程内观察携带相同 command、kind
与 digest；不从 title 或 digest 推导。effective execute 的 `exitCode | exit_code` 非零时，公开 terminal status
与 Action outcome 为 failed，即使 ACP tool lifecycle 报告 completed。

Tool output 先读取 `ToolCallContent.type = content` 包裹的公开 text Content block，并兼容旧 adapter 的
直接 text block。`diff`、image/audio/resource 与 `type = terminal` 都不被解释为命令输出；Rovai 声明
Client Terminal 不可用，因此不会读取 `terminalId` 或从私有 terminal 猜测 stdout。只有 Content 没有
公开文本时，才从 `rawOutput` 的顶层 `stdout`、`stderr`、`output`、`text` 字符串白名单回退；其他键只
参与原有 digest，不进入公开 payload。

### Core Team Tool

只有 `sourceAuthority === "core"` 且 `canonicalTool` 通过当前 Rovai Tool Catalog 验证时，
`canonicalTool` 才成为 `toolName` 并标记 `core_verified`。其他同名字段都不可信。

### Claude Code

`--output-format stream-json --include-partial-messages` 中的 partial `content_block_start` 与完整 assistant
`tool_use` 共同建立、去重同一个原生 tool-use ID；对应 user `tool_result` 结算 terminal。Bash 映射
`shell.execute`，Read/Glob、Edit/Write、Grep/WebSearch 分别进入既有 file/tool domain；未知名称保持
`tool.call`。只允许 Bash `tool_use.input.command` 进入公开 input，并按 tool-use ID 同时放入 started 与 terminal
Evidence，使没有 stdout/stderr或只加载 terminal 的命令仍可检查；
只允许 Bash tool result 的公开 stdout/stderr 或标准公开 text result 进入 output。其它工具输入、文件内容和
provider metadata 不公开。公开 `text_delta` 以 message/block-scoped item ID 投影为
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
Canonical Activity 分类，结构化 kind 仍映射 `shell.execute`。
没有该 capability 的旧安装继续使用 text final/run-level 展示。私有日志仍只校验 Conversation 和输入接受，
不得产生工具 Evidence；workspace diff、最终文本或产品能力也不得反推内部步骤。Core 自己调度的 Team Tool
仍是独立的 Core-verified Activity。

## Lifecycle and unknown rules

- Core Action ID → Runtime native ID → Evidence ID；
- 只有相同 operationId 合并；
- lifecycle completion 可以只报告 identity/status；这类稀疏更新只推进 phase/outcome，不得用 Evidence-kind fallback 覆盖同一 operation 已报告的结构化 domain、semantic kind 或 title；
- terminal 冲突为 `unsettled`；
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
