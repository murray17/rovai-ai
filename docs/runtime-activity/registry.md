---
document_type: runtime-activity-mapping-registry
authority: runtime-activity-mapping-catalog
classifier_version: activity-v1
last_updated: 2026-08-05
---

# Runtime Activity Mapping Registry

## Adapter catalog

| Adapter kind | 产品显示名 | 协议族 | 基线 coverage | 细粒度工具名边界 | Fixture | 真实 smoke |
|---|---|---|---|---|---|---|
| `codex-cli` | Codex CLI | Codex app-server | `fine_grained` | MCP 使用结构化 `server/tool`；command/file 没有工具标识时显示 Core domain hint | 受控 fixture 通过 | manual completion/config/process + Skill turn 通过；MCP projection 通过 |
| `opencode-cli` | OpenCode | ACP v1 | `fine_grained` | 使用 ACP 结构化 `kind`；有 `toolName` 才作为精确名，否则显示 Runtime `title` hint | 受控 fixture 通过 | manual completion + Skill turn 通过；MCP projection 通过 |
| `copilot-cli` | GitHub Copilot | ACP v1 | `fine_grained` | 同 ACP 合同 | 受控 fixture 通过 | manual completion + Skill turn 通过；MCP projection AgentRun 成功但未调用哈希化投影名称 |
| `kiro-cli` | Kiro | ACP v1 | `fine_grained` | 同 ACP 合同 | 受控 fixture 通过 | ACP session smoke 通过；Skill model turn 两次 `runtime_prompt_runtime_error/Internal error` |
| `qoder-cli` | Qoder | ACP v1 | `fine_grained` | 同 ACP 合同 | 受控 fixture 通过 | Skill turn 通过 |
| `codebuddy-cli` | CodeBuddy | ACP v1 | `fine_grained` | 同 ACP 合同 | 受控 fixture 通过 | Skill turn 通过 |
| `qwen-code` | Qwen Code | ACP v1 | `fine_grained` | 同 ACP 合同 | 受控 fixture 通过 | Skill turn 通过 |
| `claude-code-cli` | Claude Code | Claude stream-json | `run_level` | 当前不生成未报告的 command/file/tool；只显示 Run/final result | 受控 fixture 通过 | Skill turn 通过；MCP projection 通过 |
| `antigravity-app` | Antigravity | Antigravity managed log | `run_level` | 当前内部步骤不推断；Core Team Tool 可使用 Catalog 验证 canonical name | 受控 fixture 通过 | manual completion + Skill turn 通过 |

Coverage 只描述 Core 实际能看到的粒度，不是产品支持等级。若某次运行没有报告结构化 tool event，
该运行不能因为产品基线为 `fine_grained` 就补写工具调用。

## 2026-08-05 真实联网 smoke 记录

- `cargo test --workspace -- --ignored --test-threads=1 --nocapture`：7 个 manual local Runtime smoke 全部通过（Codex 3、OpenCode、Copilot、Antigravity、Kiro ACP session）。
- `ROVAI_SKILL_SMOKE_ADAPTERS=all pnpm smoke:skills`：Codex、OpenCode、Copilot、Claude Code、Antigravity 通过后，Kiro 连续两次模型 turn 返回 `runtime_prompt_runtime_error` / `Internal error`；随后 Qoder、CodeBuddy、Qwen Code、Claude Code、Antigravity 的单独复跑通过。
- `ROVAI_MCP_PROJECTION_SMOKE_ADAPTERS=all pnpm smoke:mcp-projection`：Codex、Claude Code、OpenCode 的真实投影工具调用通过；Copilot AgentRun 成功但 Runtime 只看到哈希化投影名称，未调用目标工具，因此专项断言失败。随后原生 `ROVAI_MCP_SMOKE_ADAPTERS=codex-cli,claude-code-cli,opencode-cli,copilot-cli pnpm smoke:mcp` 四个 Runtime 全部通过，证明 Copilot 的联网/原生 MCP 调用可用，差异位于 Core 投影名称解析而非账号或模型连通性。该结果不应被改写为 Copilot Core 投影工具映射通过。

以上记录证明真实 Runtime 的连接、会话和可观测边界；它不替代九 Runtime 的受控 Mapping fixture，也不允许 Core 根据未发生的工具调用补写 Canonical Activity。

## Protocol mapping

### Codex app-server

| Runtime item type | activityDomain | semanticKind | toolName |
|---|---|---|---|
| `commandExecution` | `shell` | `shell.execute` | 无结构化名称时为空 |
| `fileChange` | `file` | `file.write` | 空 |
| `webSearch` | `tool` | `tool.web.search` | 有结构化名称时保留 |
| `imageGeneration` | `tool` | `tool.image.generate` | 有结构化名称时保留 |
| `mcpToolCall` | `tool` | `tool.mcp.call` | `server/tool` |
| `dynamicToolCall` / collab tool | `tool` | `tool.call` | Runtime `tool` 字段 |

`item.id` 是 lifecycle identity。`item.title` 只进入 `presentationHint`。

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
- terminal 冲突为 `unsettled`；
- 无结构化工具名时显示 presentation hint 或 activity-domain fallback，不伪造函数名；
- title、命令字符串、provider 和 Runtime 名称永远不决定 domain 或 identity。
