---
document_type: runtime-activity-mapping-registry
authority: runtime-activity-mapping-catalog
classifier_version: activity-v1
last_updated: 2026-08-11
---

# Runtime Activity Mapping Registry

## Adapter catalog

| Adapter kind | 产品显示名 | 协议族 | 基线 coverage | 细粒度工具名边界 | Fixture | 真实 smoke |
|---|---|---|---|---|---|---|
| `codex-cli` | Codex CLI | Codex app-server | `fine_grained` | MCP 使用结构化 `server/tool`；command/file 无工具名时用 `commandActions` / `changes` 生成有界 presentation hint，未知命令回退 Core domain hint | 受控 fixture 通过 | manual completion/config/process + Skill turn 通过；MCP projection 通过；新版标题 post-fix smoke 待运行 |
| `opencode-cli` | OpenCode | ACP v1 | `fine_grained` | 使用 ACP 结构化 `kind`；有 `toolName` 才作为精确名，否则显示 Runtime `title` hint | 受控 fixture 通过 | manual completion + Skill turn 通过；MCP projection 通过 |
| `copilot-cli` | GitHub Copilot | ACP v1 | `fine_grained` | 同 ACP 合同；逻辑 MCP 名称通过 Context 的 `logicalName → runtimeName` 映射提示解析 | 受控 fixture 通过 | manual completion + Skill turn + MCP projection 通过 |
| `kiro-cli` | Kiro | ACP v1 | `fine_grained` | 同 ACP 合同；Team bridge 使用 Kiro/Bedrock 兼容 input schema，不改变 Core canonical 校验 | 受控 fixture 通过 | ACP session + Skill turn + MCP projection 通过 |
| `qoder-cli` | Qoder | ACP v1 | `fine_grained` | 同 ACP 合同 | 受控 fixture 通过 | Skill turn 通过 |
| `codebuddy-cli` | CodeBuddy | ACP v1 | `fine_grained` | 同 ACP 合同 | 受控 fixture 通过 | Skill turn 通过 |
| `qwen-code` | Qwen Code | ACP v1 | `fine_grained` | 同 ACP 合同 | 受控 fixture 通过 | Skill turn 通过 |
| `claude-code-cli` | Claude Code | Claude stream-json | `run_level` | 当前不生成未报告的 command/file/tool；只显示 Run/final result | 受控 fixture 通过 | Skill turn 通过；MCP projection 通过 |
| `antigravity-app` | Antigravity | Antigravity managed log | `run_level` | 当前内部步骤不推断；Core Team Tool 可使用 Catalog 验证 canonical name | 受控 fixture 通过 | manual completion + Skill turn 通过 |

Coverage 只描述 Core 实际能看到的粒度，不是产品支持等级。若某次运行没有报告结构化 tool event，
该运行不能因为产品基线为 `fine_grained` 就补写工具调用。

## 2026-08-05 真实联网 smoke 记录

- `cargo test --workspace -- --ignored --test-threads=1 --nocapture`：7 个 manual local Runtime smoke 全部通过（Codex 3、OpenCode、Copilot、Antigravity、Kiro ACP session）。
- `ROVAI_SKILL_SMOKE_ADAPTERS=kiro-cli pnpm smoke:skills`：Kiro `kiro-cli 2.15.1` 模型 turn 通过，返回 Skill marker；此前的 `runtime_prompt_runtime_error` 已定位为上下文 formatter 版本约束冲突并修复。
- `ROVAI_MCP_PROJECTION_SMOKE_ADAPTERS=copilot-cli pnpm smoke:mcp-projection`：Copilot `1.0.78` 实际调用 Core 投影工具，返回 `rovai-projection:copilot`，未调用 Runtime 原生同名工具。
- `ROVAI_MCP_PROJECTION_SMOKE_ADAPTERS=kiro-cli pnpm smoke:mcp-projection`：Kiro `2.15.1` 实际调用 Core 投影工具，返回 `rovai-projection:kiro`。
- 此前的 Codex、Claude Code、OpenCode 投影 smoke，以及四 Runtime 原生 MCP smoke 均保持通过。全适配器投影命令随后启动过，但本轮在 Kiro 阶段按用户要求停止，未将该未完成命令记为通过。

以上记录证明真实 Runtime 的连接、会话和可观测边界；它不替代九 Runtime 的受控 Mapping fixture，也不允许 Core 根据未发生的工具调用补写 Canonical Activity。

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

### Core Team Tool

只有 `sourceAuthority === "core"` 且 `canonicalTool` 通过当前 Rovai Tool Catalog 验证时，
`canonicalTool` 才成为 `toolName` 并标记 `core_verified`。其他同名字段都不可信。

### Claude Code / Antigravity

当前只按实际 Run 级事件展示 `runtime/runtime.run` 和最终回复。不得根据最终 workspace diff、日志文本
或产品能力推断 command/file/tool。Antigravity 中由 Core 自己调度并记录的 Team Tool 是独立的
Core-verified Activity，不会反推出其它内部步骤。

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
