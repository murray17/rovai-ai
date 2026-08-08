---
document_type: version-overview
version: v0.46
lifecycle: current
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
last_updated: 2026-08-08
---

# Rovai-ai v0.46：Agent CLI 精简与隐式 Camp 作用域

> 设计与实现状态：已完成。v0.45 已冻结为 historical；v0.46 的代码、Migration、合同、
> 真实 Runtime、Crash/restart、打包 App 与签名验收均已通过。本版本的发布判断以协议边界正确、
> 业务信息不丢失和真实 Runtime 证据为准。
>
> 前置版本：[v0.45 显式 A2A 与公共输出重构](../v0.45/README.md)
>
> 主要决策：[ADR-0135](../../adr/0135-compact-agent-output-over-canonical-built-in-tool-envelope.md)
>；相关长期边界：[ADR-0124](../../adr/0124-cli-only-transport-for-rovai-built-in-operations.md)、
> [ADR-0118](../../adr/0118-v041-local-data-clean-break-and-managed-reset-boundary.md)。

## 版本目标

v0.46 把 Agent 使用 `rovai` 的边界收敛为“固定业务命令 + 精简帮助 + 业务结果 JSON”：

- Core IPC 继续返回完整、可验证的 Built-in Tool Invocation Envelope；CLI 必须先验证它，再按
  operation 的显式 `agentOutputSchema` 投影到 Agent stdout；
- 正常成功直接输出业务结果，不输出 `ok`、`operation`、`requestId`、`receipt`、
  `contractVersion` 或 `result` wrapper；业务失败只输出带 `code`、`message`、`recovery` 和安全
  业务 `details` 的 `error` 对象；
- 十二个业务 operation 全部有显式 projection 和 golden fixture。未特别裁剪的 operation 保留
  canonical result；`camp.message.send` 和 `memory.write` 只删除已经确认的冗余字段；
- Agent Runtime 不再提供 `tool list`、`tool describe`、隐藏 Discovery 或通用 `tool invoke`；
  Core catalog 只服务 IPC 校验、合同测试、Qualification 和开发诊断；命令发现使用
  `<command> --help`；
- `camp.message.send` 对 Agent 做 clean break：没有 `campId`/`--camp-id`、alias 或 silent
  translation。发送 Camp 只从 authenticated current Run 推导；持久 Replay 复用记录的
  `camp_id + AgentRun + executionEpoch`；
- `message.camp_mismatch` 从 send 的 Agent 合同、recovery、catalog、fixtures 和帮助中删除；
  内部不变量仍可用于检测损坏，但不新增稳定的 `builtin_tool.protocol_violation`；
- v0.45 的 Team Task 领域输入和业务语义不变；Task 的 Agent-facing 输出同样经过 projection，
  本期不增加 `task.read` 或重构 Task 合同；
- 不迁移旧 send 输入、旧 Replay 记录或旧 Rovai-owned App data。开发切换只允许使用
  ADR-0118 的受管 clean reset allowlist，不触碰用户工作区、外部 Runtime、Native Home、凭据或
  MCP 状态。

## 固定版本常量

```yaml
contractVersion: 3
cliCommandVersion: 3
ipcProtocolVersion: 1
envelopeContractVersion: 1
receiptVersion: 1
agentOutputContractVersion: 1
runtimeCapability: builtin_cli.transport.v3
```

Envelope 和 receipt 仍是 v1；提升的是 catalog/CLI/Agent-facing contract，而不是 Core receipt
格式。v2 与 v3 不在同一 AgentRun 中混用。

## Agent-facing 输出原则

所有业务调用统一走：

```text
Core complete Envelope → validate → explicit Agent Result Projection → stdout
```

成功示例：

```json
{"messageId":"msg_123","effectiveRecipients":["agent_27"]}
```

业务失败示例：

```json
{"error":{"code":"task.version_conflict","message":"Read the current Task before deciding whether to update it.","recovery":"refresh_then_decide","details":{"currentVersion":4}}}
```

`builtin_tool.outcome_indeterminate` 不暴露 `requestId`，只返回：

```json
{"error":{"code":"builtin_tool.outcome_indeterminate","message":"Confirm current state before acting again.","recovery":"confirm_outcome"}}
```

Envelope-owned 字段限制只适用于 Envelope → Agent 边界；未来业务 JSON 可以合法使用同名字段。
每个 operation 的 schema 是闭集并由 golden fixture 验证；不实现通用递归删字段器，也不以
固定压缩比例删除有业务意义的字段。

## 十二项 projection 摘要

| Operation | Agent success projection |
| --- | --- |
| `camp.message.send` | `{messageId, effectiveRecipients}` |
| `team.create_task` | canonical `{taskId, status, version}` |
| `team.list_tasks` | canonical task-list result |
| `team.update_task` | canonical `{taskId, status, assigneeAgentId, version}` |
| `camp.list` | canonical result |
| `camp.search` | canonical result |
| `camp.read` | canonical result |
| `history.search` | canonical result |
| `memory.search` | canonical result |
| `memory.read` | canonical result |
| `memory.write` | `{memoryId, revisionId}` |
| `memory.propose_hearth` | canonical result |

这里的 canonical result 是“去除 Envelope wrapper 后的业务对象”，不是完整 Envelope 的缩小版。
每项的 `agentOutputSchema`、projection identity 和 golden fixture 由 Core catalog 内部维护。

## 错误通道与退出码

| 情况 | stdout | 退出码 |
| --- | --- | ---: |
| 成功 projection | 直接业务 JSON | `0` |
| Core 业务拒绝 | `{"error":{...}}` | `1` |
| 结果待确认 | 稳定 `builtin_tool.outcome_indeterminate` error，无 request identity | `3` |
| CLI 参数/输入来源无效 | `builtin_tool.invalid_input` + `fix_input` | `2` |
| 可预期 Context/IPC/协议失败 | 安全通用结构化 error | `2` |
| 非结构化进程级故障 | stderr 可有脱敏诊断 | 进程级非零 |

可预期路径的 stderr 默认为空；不得泄露 socket/context path、token、credential、SQL 或完整
Rust/anyhow 错误链。

## Discovery、Bootstrap 与 Help

Agent Runtime 的 `rovai` 不提供任何 `tool list` / `tool describe`，也不保留隐藏可执行 Discovery。
Bootstrap、root help、Skill、fixture 和 smoke 只列固定业务命令，并提示使用
`<command> --help`。Help 只给必要参数、输入来源互斥规则、关键约束和短示例，不打印完整
Schema、Envelope、receipt、catalog digest 或错误表。

Catalog 仍是 Core 的唯一合同真源，供：

- IPC operation/input/result 校验；
- `agentOutputSchema` 与 golden fixture 合同测试；
- Qualification、Evidence/receipt 验证和开发诊断。

## 不变范围

- Message Delivery 状态机、recipient-scoped recovery、Context Profile v2 和 Runtime public
  output boundary 不在本版本重构；
- 外部 MCP 继续使用 Runtime-native Projection，不进入 Built-in Tool Router；
- Task 的领域输入、版本冲突和“更新不唤醒 assignee”语义不变；
- 跨 Camp read 工具的显式 `campId` 合同不变；
- 不增加 generic tool entry point、Human 表格输出、全局 JSON 字段黑名单或 `task.read`。

## 发布判断

固定压缩率不是门槛。实现必须证明：

1. 完整 Core Envelope 在 projection 前经过验证，receipt/replay/evidence 不受 stdout 影响；
2. 十二项 operation 的 closed `agentOutputSchema` 与 golden fixture 通过，业务字段没有丢失；
3. Agent-facing 不再有 Discovery、send 的 Camp 输入或旧错误提示词；
4. send 首次调用和持久 Replay 都使用正确的 authenticated/recorded identity，旧身份不能越界；
5. 错误 stdout/exit/stderr 矩阵、indeterminate 脱敏和 stale lease fail-closed 通过；
6. 打包 App 与九种正式 Runtime 的真实 CLI smoke 通过，且 Crash/restart、replay、fence 和
   negative path 有证据。

输出缩减比例作为 observability metric 测量并报告，用来发现异常漂移，不得驱动字段删除。

## 发布验收证据

2026-08-08 的最终验收结果：

- `cargo test --workspace --no-fail-fast`：Core library 282、Agent CLI 8、Core binary 47 通过；
  3 个既有手工 Runtime 测试按标记忽略；
- `pnpm typecheck`、`pnpm test`：Vitest 174 与 Qualification Node tests 78 通过；
- `pnpm smoke:builtin-cli`：Codex 0.146.1、OpenCode 1.18.10、Copilot 1.0.78、Claude Code
  2.1.220、Antigravity 1.1.11、Kiro 2.16.1、Qoder 1.1.14、CodeBuddy 2.132.0、Qwen Code
  0.21.5 全部完成十二项 operation、旧 send flag/JSON 拒绝、业务冲突、Envelope Evidence、
  stale lease fence 与新 lease Resume；
- 九 Runtime 的 13 个 Envelope/Projection 样本分别观测到 49.0%–49.4% 输出缩减；该数字仅
  记录，不构成发布门槛；
- `pnpm smoke:recovery`：硬崩溃后 accepted input 进入 reconciliation，原 execution epoch、
  Context Manifest 与 Task command replay 保持稳定，第二次重启无重复对象；
- `pnpm smoke:intake`：Codex 真实 intake、连续 Conversation、重启恢复与永久删除通过；
- `pnpm package:mac` 与 `codesign --verify --deep --strict` 通过；打包 App 内 release CLI 报告
  `contract-v3 ipc-v1`，并以打包 Core/CLI 完成 Codex 十二项 Runtime smoke；
- `pnpm accept:runtime-activity-ui` 通过九 Runtime controlled fixture。未配置 Apple notarization，
  因此只声明 ad-hoc hardened-runtime 签名验证，不声明公证通过。

实施检查点和暂停前后的证据要求见[实施与验收计划](implementation-plan.md)。
