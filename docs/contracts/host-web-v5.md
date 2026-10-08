---
document_type: protocol-contract
contract: host-web-v5
authority: shared-host-web-transport
status: accepted
version: 5
source_version: v1.72
last_updated: 2026-10-07
---

# Host Web v5

继承 [v4](host-web-v4.md) 的认证、Owner、allowlist、超时和命令回执。已认证 User 的变更操作新增
`agentRuns.continue`，输入与准入由 [AgentRun Continuation v1](agent-run-continuation-v1.md) 拥有。
Web 仅转发闭合请求并通过既有 `commands.reconcile` 核对原 commandId；不得因运输失败换 ID 重发。
该增量不改变登录与 Session schema，传输 `protocolVersion` 保持 4。Agent 权限不扩大。
