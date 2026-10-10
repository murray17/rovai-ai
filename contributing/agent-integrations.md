# Agent integration

Rovai connects coding agents through their native protocols so they can work together as teammates. This page maps the existing adapters, their implementations and remaining gaps.

[简体中文](agent-integrations.zh-CN.md) · [Agent setup and notes](https://rovai.dev/docs/agent-setup.html)

## Existing integrations

| Agent | Transport | Status | Reference |
| --- | --- | --- | --- |
| Codex CLI | App Server | Platform-dependent | [Code](../crates/rovai-core/src/codex.rs) |
| Claude Code | Stream JSON | Platform-dependent | [Code](../crates/rovai-core/src/claude.rs) |
| Pi Coding Agent | JSONL RPC + extension | Platform-dependent | [Code](../crates/rovai-core/src/pi.rs) |
| OpenCode | ACP | Platform-dependent | [Code](../crates/rovai-core/src/acp.rs) |
| GitHub Copilot CLI | ACP | Platform-dependent | [Code](../crates/rovai-core/src/acp.rs) |
| Kiro CLI | ACP | Platform-dependent | [Code](../crates/rovai-core/src/acp.rs) |
| Qoder CLI | ACP | Platform-dependent | [Code](../crates/rovai-core/src/acp.rs) |
| CodeBuddy CLI | ACP | Platform-dependent | [Code](../crates/rovai-core/src/acp.rs) |
| Qwen Code | ACP | Platform-dependent | [Code](../crates/rovai-core/src/acp.rs) |
| TRAE CLI CN | ACP | Platform-dependent | [Code](../crates/rovai-core/src/acp.rs) |
| Kimi Code | ACP | Platform-dependent | [Code](../crates/rovai-core/src/acp.rs) |
| Grok Build | ACP | Platform-dependent | [Code](../crates/rovai-core/src/acp.rs) |
| DeepSeek Harness | ACP | Platform-dependent | [Code](../crates/rovai-core/src/acp.rs) |
| ZCode | Native App Server | Platform-dependent | [Code](../crates/rovai-core/src/zcode.rs) |
| Antigravity | Native application CLI | Platform-dependent | [Code](../crates/rovai-core/src/antigravity.rs) |
| Cline | ACP | Deferred | [Code](../crates/rovai-core/src/acp.rs) |
| Command Code | ACP | Deferred | [Code](../crates/rovai-core/src/command_code_acp.rs) |
| Cursor Agent | ACP + vendor extensions | Awaiting qualification | [Code](../crates/rovai-core/src/acp.rs) |

This reflects main on **2026-10-10**. Platform availability is recorded in the [compatibility notes](../docs/runtime-compatibility.md). Cline, Command Code and Cursor have implementations but are not exposed through ordinary user entry points.

## Integration approaches

**Native structured protocols.** Codex CLI uses App Server, Claude Code uses bidirectional Stream JSON, and Pi uses JSONL RPC with a Rovai extension. Each retains its native authentication, models and sessions; Rovai presents their execution events in a shared interface.

**ACP.** OpenCode, Copilot, Kiro, Qoder, CodeBuddy, Qwen, TRAE, Kimi, Grok and DSH share the [ACP Host](../crates/rovai-core/src/acp.rs). Models, permissions, MCP and recovery still vary by product and remain part of each adapter’s policy. DSH, for example, runs through `dsh --profile acp` and has separate [model preparation logic](../crates/rovai-core/src/dsh.rs) for native and standard Web configuration.

**Application entry points.** ZCode uses its native App Server; Antigravity uses the CLI bundled with its application. Discovery, authentication sources and execution follow the respective product.

The [Adapter Registry](../crates/rovai-core/src/agent_runtime_adapter.rs) lists adapter identities and platform status. Product-specific details live in [Runtime Catalog Boundaries](../docs/architecture/runtime-catalog-boundaries.md).

## Integrations not yet available

| Agent | Current state and gaps | Notes |
| --- | --- | --- |
| **Cline** | The official ACP path has first-run, continuation and recovery records. Tested version 3.0.70 lacks the required ACP compaction configuration; automatic compaction and recovery after it remain unverified. | [Current findings](../docs/research/cline-runtime/latest-acp-2026-10-08.md) |
| **Command Code** | The default model has execution and recovery records through official ACP. Tested versions 1.74.1 / 1.79.1 still have incomplete custom model selection; MCP tools are discoverable but calls fail with some tested providers. The earlier headless approach is retired. | [Model selection](../docs/research/command-code-runtime/model-selection-2026-10-09.md) · [MCP](../docs/research/command-code-runtime/mcp-delivery-ab-2026-10-06.md) |
| **Cursor Agent** | ACP and vendor extensions are wired up; capability and platform qualification for public use is incomplete. | [Integration research](../docs/research/cursor-agent-runtime-research.md) |

## Development references

[Local development](../docs/development/README.md) · [Integration checklist](../docs/development/runtime-integration-checklist.md) · [Compatibility notes](../docs/runtime-compatibility.md)
