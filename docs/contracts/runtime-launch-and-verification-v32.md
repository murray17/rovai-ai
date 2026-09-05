---
document_type: contract
name: Runtime Launch and Verification
version: v32
status: accepted
source_version: v1.39
last_updated: 2026-09-04
---

# Runtime Launch and Verification v32

v32 replaces [v31](runtime-launch-and-verification-v31.md). v31 的 Pi JSONL wire、无 Prompt Machine Ready、private exact
Session locator、Resident Host/Fleet/LRU、managed system prompt/receipt、Skills、原生 Tool Approval、Final、Cancel、Usage、
platform preview 与 cleanup 语义保持不变。v32 只删除 Pi 的 Core-managed External MCP bridge，并冻结以下替代边界。

## 1. Pi External MCP is unsupported

Pi 的 `McpProjectionCapability` 为 `Unsupported`：`supportsStdio=false`、`supportsStreamableHttp=false`、
`sameNamePolicy=null`、`approvalControl=unsupported`。这不改变 MCP Library、全局配置、Server enablement、成员 Assignment
或任何其他 Runtime 的 External MCP 能力。

成员使用 Pi 时，Core 必须静默忽略其 MCP Assignment。Pi dispatch 不读取 `McpConfigStore`，不调用
`McpProjectionService::prepare`，不要求 `mcp` optional subsystem Ready，也不创建 `PreparedMcpProjection`。因此 Pi
启动、恢复和继续运行不能因 MCP 配置损坏、Server command 缺失、transport/initialize/`tools/list` 超时或 schema 错误而
失败、等待或产生 warning。成员之后切换到支持 MCP 的 Runtime 时，原 Assignment 仍按该 Runtime 的合同正常投影。

## 2. Pi Host and managed extension have no MCP surface

Pi AgentRun request、Host binding、managed input receipt、Runtime state 与 compatibility digest 均不包含 MCP projection、
Server、Tool catalog、activation result 或 schema digest。managed extension `rovai-pi-host-v4` 只激活既有 Pi native tools，
不调用 `registerTool` 构造 MCP proxy，也不生成或接收 MCP approval/bridge envelope。Core 不拥有 Pi 专用 MCP client、
stdio/HTTP/SSE transport、`initialize`、`tools/list`、`tools/call`、Server process 或 cleanup 路径。

Pi receipt 继续封闭验证 Host/Run/epoch/binding、Runtime Input Delivery、Prompt/Session、Bootstrap、Skills、system prompt 与
active native Tool catalog，并与 Input accepted 原子提交。删除 MCP 字段不削弱 bash/write/edit 的 Rovai managed
Approval、Tool evidence 或 receipt 原子性。

## 3. Reuse, recovery, and historical data

MCP Assignment 或配置变化不进入 Pi process compatibility、Host reuse、Native Session exact resume 或 replacement 判定，
也不使 quiescent Pi Host 退出统一 LRU。恢复旧 Pi Run 时，ContextManifest 或历史诊断中已有的 MCP exposure/digest、
activation、receipt 或 tool-call 数据只作为历史事实保留；Pi 的无 MCP materialization 路径不解析、比较或重新激活这些
字段，不需要迁移或删除。

新 Pi Run 仍可在通用 ContextManifest 中保存合同要求的空 MCP exposure占位，但不得产生 Pi MCP activation、catalog、
tool-call、approval、Server lifecycle 或 bridge diagnostics。

## 4. Unchanged boundaries

- MCP 设置与成员分配 UI、保存逻辑和 read model 不变；不增加 Pi warning、badge、tooltip 或自动取消分配。
- Codex、Claude Code、OpenCode、Copilot、Kiro、Qoder、CodeBuddy、Qwen Code、TRAE、Kimi 与 Grok 的 External MCP
  projection 不变。
- Pi Skills、官方 extension、built-in CLI、native tools、managed Bootstrap、Approval、receipt、Usage、Fleet 与 platform
  preview 不变。
- ACP Client Terminal 继续使用 `derive_runtime_one_shot_command`，在最终 request cwd/environment 中解析 bare/relative
  command；这是独立的 ACP 合同。只为旧 Pi MCP Server 启动存在的普通 Managed Process portable capture 不再保留。

## References

- [Runtime Launch and Verification v31（historical）](runtime-launch-and-verification-v31.md)
- [Managed Runtime Process v1](managed-runtime-process-v1.md)
- [V1.39-D09](../versions/v1.39/decisions.md#v1-39-d09)
- [Pi parity matrix](../research/pi-runtime-reintegration-parity-matrix.md)
