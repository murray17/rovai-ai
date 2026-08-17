---
document_type: runtime-activity-mapping-registry
authority: runtime-activity-mapping-catalog
classifier_version: activity-v1
last_updated: 2026-08-17
---

# Runtime Activity Mapping Registry

## Adapter catalog

| Adapter kind | 产品显示名 | 协议族 | 基线 coverage | 细粒度工具名边界 | Fixture | 真实 smoke |
|---|---|---|---|---|---|---|
| `codex-cli` | Codex CLI | Codex app-server | `fine_grained` | MCP 使用结构化 `server/tool`；command/file 无工具名时用 `commandActions` / `changes` 生成有界 presentation hint，未知命令回退 Core domain hint | 受控 fixture 通过 | manual completion/config/process + Skill turn 通过；MCP projection 通过；新版标题 post-fix smoke 待运行 |
| `opencode-cli` | OpenCode | ACP v1 | `fine_grained` | 使用 ACP 结构化 `kind`；有 `toolName` 才作为精确名，否则显示 Runtime `title` hint；公开 output 只来自文本 Content block 或 `rawOutput.stdout/stderr/output/text` | 受控 fixture 与固定 `printf` smoke 断言已建立 | manual completion + Skill turn 通过；MCP projection 通过；`1.18.15` 真实 command-output 与完整 allow/deny smoke 通过 |
| `copilot-cli` | GitHub Copilot | ACP v1 | `fine_grained` | 同 ACP 合同；支持标准 `type: content` 嵌套文本；逻辑 MCP 名称通过 Context 的 `logicalName → runtimeName` 映射提示解析 | 受控 fixture 与固定 `printf` smoke 断言已建立 | manual completion + Skill turn + MCP projection 通过；`1.0.79` 真实 command-output smoke 通过 |
| `kiro-cli` | Kiro | ACP v1 | `fine_grained` | 同 ACP 合同；Team bridge 使用 Kiro/Bedrock 兼容 input schema，不改变 Core canonical 校验 | 受控 fixture 通过 | ACP session + Skill turn + MCP projection 通过 |
| `qoder-cli` | Qoder | ACP v1 | `fine_grained` | 同 ACP 合同 | 受控 fixture 通过 | Skill turn 通过 |
| `codebuddy-cli` | CodeBuddy | ACP v1 | `fine_grained` | 同 ACP 合同 | 受控 fixture 通过 | Skill turn 通过 |
| `qwen-code` | Qwen Code | ACP v1 | `fine_grained` | 同 ACP 合同 | 受控 fixture 通过 | Skill turn 通过 |
| `trae-cn-cli` | TRAE CLI CN | ACP v1 | `fine_grained` | 同 ACP 合同；实际 Probe 已证明稳定 `toolCallId`、结构化 permission request 与 started→terminal lifecycle；Terminal content 只作 display anchor | 受控 fixture 与固定 `printf` smoke 断言已建立 | `traecli 0.120.52` completion/cancel、Approval allow/deny、Missing-Send tool→final 与 MCP Projection 正式 Smoke 通过；当前安装真实 command-output smoke 通过，静态版本按 v0.87 边界保持 `null` |
| `claude-code-cli` | Claude Code | Claude stream-json | `fine_grained` | `tool_use.id` 是 lifecycle identity；Bash/Read/Edit/Write 等原生名称映射到既有 kind，仅 Bash tool result 的公开 stdout/stderr 进入 output | partial + complete message 去重、started→terminal、敏感字段 fixture 通过 | 既有 Skill turn 与 MCP projection 通过；`2.1.220` 原生 Bash command-output 与 Session continuation smoke 通过 |
| `antigravity-app` | Antigravity | Antigravity stream-json / legacy text | `run_level` | capability-gated stream-json 使用 `conversation_id + step_index` 作为结构化 tool identity；旧版 text 保持 run-level，私有日志不产生工具 Evidence | stream-json lifecycle/output 与 legacy fallback fixture 通过 | 既有 manual completion + Skill turn 通过；`agy 1.1.13` 原生 `run_command` output、Session continuation 与 AGY→Codex handoff smoke 通过 |

Coverage 只描述 Core 实际能看到的粒度，不是产品支持等级。若某次运行没有报告结构化 tool event，
该运行不能因为产品基线为 `fine_grained` 就补写工具调用。

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

以上记录证明真实 Runtime 的连接、会话和可观测边界；它不替代十 Runtime 的受控 Mapping fixture，也不允许 Core 根据未发生的工具调用补写 Canonical Activity。

## Protocol mapping

### Codex app-server

| Runtime item type | activityDomain | semanticKind | toolName | presentationHint |
|---|---|---|---|---|
| `commandExecution` | `shell` | `shell.execute` | 无结构化名称时为空 | 优先 `item.title`；否则仅用结构化 `commandActions` 的 read/list/search 类型和安全路径 basename 生成“读取文件 / 检索项目文件”等有界标题；unknown 回退“执行 Shell 命令” |
| `fileChange` | `file` | `file.write` | 空 | 优先 `item.title`；否则用 `changes` 的数量、单文件 basename 和 add/delete/update 类型生成标题 |
| `webSearch` | `tool` | `tool.web.search` | 有结构化名称时保留 | Runtime title 或 Core domain hint |
| `imageGeneration` | `tool` | `tool.image.generate` | 有结构化名称时保留 | Runtime title 或 Core domain hint |
| `mcpToolCall` | `tool` | `tool.mcp.call` | `server/tool` | Runtime title 或 Core domain hint |
| `dynamicToolCall` / collab tool | `tool` | `tool.call` | Runtime `tool` 字段 | Runtime title 或 Core domain hint |

`item.id` 是 lifecycle identity。`item.title` 与上述结构化 presentation 字段只进入
`presentationHint`；原始 command string 不参与标题生成、分类或 identity。Codex `0.147.0` 的
本地 app-server schema 与实际 AgentRun 均证明 `commandExecution.title` 可以为空，而
`commandActions` 是协议必填字段；修复 fixture 使用该真实 wire shape，post-fix live smoke 仍需单独运行。

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
`toolName` 才作为精确名称。

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
`tool.call`。只允许 Bash tool result 的公开 stdout/stderr 或标准公开 text result 进入 output，input、
文件内容和其它 provider metadata 不公开。最终 success result、Usage 与 Session 校验维持独立边界。

### Antigravity

Capability snapshot 明确包含 `output.stream_json` 时，Adapter 消费公开 NDJSON `init`、`step_update`、
`result`；tool step 只用结构化 conversation、step index、state、tool name 和白名单 command output。
没有该 capability 的旧安装继续使用 text final/run-level 展示。私有日志仍只校验 Conversation 和输入接受，
不得产生工具 Evidence；workspace diff、最终文本或产品能力也不得反推内部步骤。Core 自己调度的 Team Tool
仍是独立的 Core-verified Activity。

## Lifecycle and unknown rules

- Core Action ID → Runtime native ID → Evidence ID；
- 只有相同 operationId 合并；
- lifecycle completion 可以只报告 identity/status；这类稀疏更新只推进 phase/outcome，不得用 Evidence-kind fallback 覆盖同一 operation 已报告的结构化 domain、semantic kind 或 title；
- terminal 冲突为 `unsettled`；
- 无结构化工具名时显示 presentation hint 或 activity-domain fallback，不伪造函数名；
- title、命令字符串、provider 和 Runtime 名称永远不决定 domain 或 identity。

## Runtime-specific transport notes

这些规则只描述 Runtime 接入所需的协议/传输适配，不改变 Canonical Activity 的语义分类：

- Copilot 的 Core MCP projection 使用稳定逻辑名保留 Evidence 身份，同时在动态 Context 中公布当前 Runtime 实际暴露名；模型必须调用 Context 映射中的 `runtimeName`。
- Kiro 的 Team bridge 通过 `ROVAI_TEAM_SCHEMA_DIALECT=kiro-bedrock-v1` 暴露 Bedrock 可接受的 `camp.read` input schema；Core 仍使用完整 canonical schema 做输入验证。
