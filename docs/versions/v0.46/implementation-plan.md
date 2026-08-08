---
document_type: implementation-plan
version: v0.46
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-08
---

# v0.46 实施与验收计划

> 完成状态：设计合同、代码、Migration、fixture、Bootstrap/Help 清理、九 Runtime v3 smoke、
> Crash/restart、真实 intake、打包 App 和签名验收均已完成。本计划中的“通过”均有可复现代码、
> 测试、打包或真实 Runtime 证据；ADR 的 `accepted` 与实现完成仍是两个独立事实。

## Checkpoint 0：v0.45 冻结前置证据（已完成）

以下证据在 v0.46 文档切换前独立重跑：

- [x] `cargo fmt --check`、`pnpm typecheck` 通过；
- [x] `pnpm test` 通过（Vitest 174、Qualification Node tests 78）；
- [x] `cargo test --workspace` 通过（Core 273、CLI 2、Core binary 46；3 个既有手工 Runtime
  测试按标记忽略）；
- [x] v0.45 database clean-break 测试确认新数据库不保留
  `conversation_input`/`inbox_message` 等旧私有投递表；
- [x] `pnpm smoke:recovery` 通过：硬崩溃后同一 execution epoch 进入显式 reconciliation，任务
  command replay 稳定，第二次重启无重复 AgentRun/Task/Message；
- [x] `pnpm smoke:intake` 通过：Codex 真实 Runtime intake、连续 Conversation、恢复和删除均
  通过；
- [x] `pnpm package:mac`、`codesign --verify --deep --strict`、`pnpm accept:runtime-activity-ui`
  通过；本地 App 未配置 Apple notarization，因此仅记录签名验证，不声称公证通过。
- [x] v0.45 冻结为 `historical`，v0.46 成为唯一 `current`。

## Checkpoint 1：合同与 catalog 设计（已完成）

- [x] 接受 ADR-0135，明确 Core Envelope、Envelope validation、Agent Result Projection、Evidence/
  Qualification/debug 的边界，并局部替代 ADR-0124 的 Agent-facing response/Bootstrap 条款；
- [x] 冻结 v3 常量：`contractVersion=3`、`cliCommandVersion=3`、`ipcProtocolVersion=1`、
  `envelopeContractVersion=1`、`receiptVersion=1`、`agentOutputContractVersion=1`、
  `builtin_cli.transport.v3`；
- [x] 冻结十二个 operation 的显式 `agentOutputSchema`、projection identity 和 golden fixture
  责任；
- [x] 冻结 Envelope → Agent 边界只禁止透传 Envelope-owned
  `contractVersion/ok/operation/requestId/receipt` 和 `result` wrapper；明确不做全局递归禁字段扫描；
- [x] 冻结 60% 输出缩减为观测指标，不作为发布硬门槛；
- [x] 冻结 Agent-facing 无 `tool list`/`tool describe`/hidden discovery/generic invoke，Help 只
  提供必要参数、约束和短示例。

## Checkpoint 2：transport v3 与 Projection 实现（已完成）

- [x] 将 transport/catalog 常量提升到 v3；catalog digest 覆盖
  `agentOutputContractVersion`、每项 `agentOutputSchema` 和 projection identity；
- [x] 新增独立 Projection 模块（建议 `builtin_tool_cli_output.rs`），职责只包括：完整 Envelope
  validation、显式 operation dispatch、成功/业务错误 projection、schema/golden 校验和安全
  stdout 文档；不得复制 Domain handler；
- [x] 为十二项 operation 建立 closed schema 与 golden fixture：
  `camp.message.send`、三个 Task、三个 Camp read/list/search、`history.search`、四个 Memory
  read/search/write/propose-hearth（合计十二项）；
- [x] 对 `camp.message.send` 只输出 `messageId/effectiveRecipients`；对 `memory.write` 只输出
  `memoryId/revisionId`；其余 operation 直接输出 canonical result；
- [x] 验证 projected document 的 schema-extra field 被拒绝；验证 `null`、`false`、空数组、分页
  和 truncation 等有业务意义的字段不会被裁剪；
- [x] 添加回归测试证明未来业务结果可合法拥有名为 `operation`/`requestId` 等字段，且不会被
  Envelope 边界规则误删；
- [x] 明确禁止任何通用递归字段删除器和任何按压缩比例删除字段的实现。

## Checkpoint 3：CLI 命令、Help 与输出通道（已完成）

- [x] `rovai` Agent Runtime 只接受十二个固定业务命令；删除 `tool list`、`tool describe`、
  隐藏 executable discovery、`tool invoke` 和 `tool call`；Core 内部 catalog API 仍可供
  Qualification/debug，但不能从 Agent shell 调用；
- [x] root help、各 command `--help`、Bootstrap、Charter、Skill、示例和 fixture 统一为短帮助；
  Help 不打印完整 Schema/Envelope/receipt/catalog digest/error table；
- [x] 删除任何 Agent 可控的 envelope output mode、环境变量、隐藏 flag 或 `--full`；Runtime
  stdout 固定为 projection；完整 Envelope 只能走 Core IPC/Evidence/Qualification/host debug；
- [x] 实现退出码矩阵：成功 `0`、业务拒绝 `1`、可预期 CLI/Context/IPC/protocol `2`、
  `outcome_indeterminate` `3`；可预期路径一行 JSON stdout，stderr 保持空；
- [x] 过滤 socket/context path、process/lease token、binding credential、SQL 和 anyhow chain；
  indeterminate 不包含 `requestId`、operation 或可反查 identity；
- [x] 添加 stdin/direct flag/input-file 互斥测试并更新 Help 示例。

## Checkpoint 4：Camp Message Send v2 clean break（已完成）

- [x] 从 Agent-facing send input/schema/parser/help/Bootstrap/Charter/docs/fixtures/smoke 中删除
  `campId` 与 `--camp-id`；不提供 alias、compatibility 或 silent translation；旧输入返回
  `builtin_tool.invalid_input` + `fix_input`；
- [x] 不向 `BuiltinToolCliContext`、Lease 或 process context 增加 Camp ID；首次调用由
  authenticated current Run 推导 Camp 并生成内部 `CampMessageSendCommand.camp_id`；
- [x] 持久 Replay 复用记录的 `camp_id + source AgentRun + executionEpoch`，不再次依赖当前活跃
  identity；添加跨 Run/epoch、lease rotation、响应丢失和重放安全测试；
- [x] 从 send 的 error contract/recovery/catalog/describe/fixtures/smoke 删除
  `message.camp_mismatch`；内部 invariant 仅 fail closed，不新增稳定
  `builtin_tool.protocol_violation`；
- [x] 将 v0.45 遗留的 `message.idempotency_conflict` 文档合同统一为
  `builtin_tool.idempotency_conflict`；
- [x] 保持其他跨 Camp read 工具的显式 `campId` 合同不变；
- [x] 依 ADR-0118 执行开发时 Rovai-owned App data clean reset；禁止触碰用户 workspace、外部
  Runtime/MCP state、Native Home 或 credentials。

## Checkpoint 5：静态边界与内容清理（已完成）

- [x] 对 Agent-facing 源、Bootstrap、root help、Charter、Skill、文档、示例、fixture 和 smoke
  做 operation-specific legacy scan：旧 send 的 `campId`/`--camp-id`、`tool list`/`tool describe`
  提示、旧 `message.camp_mismatch`、旧 `message.idempotency_conflict` 拼写均不得残留；
- [x] 扫描结果区分“当前 Agent 合同”与“历史迁移/历史 Qualification 证据”；不把全局禁字段
  递归扫描误当作 Projection 实现；
- [x] 对旧 `team.call_member`/`conversation_input` clean-break 只保留必要的历史 migration 断言，
  不让它们重新进入 Runtime catalog、Bootstrap 或可执行 Agent path；
- [x] 为每个 Operation 保留 Envelope → Agent output golden fixture；为错误通道和 clean-break
  输入保留可审阅的负向断言与真实 Runtime smoke 步骤。

## Checkpoint 6：Core IPC、Evidence 与 Qualification（已完成）

- [x] Core IPC 始终返回完整 Envelope，并在 CLI projection 前验证 receipt、operation、requestId
  和 result/error 互斥性；
- [x] Evidence/Qualification/debug 保留完整 Envelope 和 request identity，但这些路径不改变
  Agent stdout 合同；
- [x] 验证 projection 不能参与 receipt、replay、authorization 或业务重试决策；
- [x] 添加 indeterminate、stale lease、malformed envelope、schema-extra 和 generic protocol
  failure 的负向 fixture/test；
- [x] 记录序列化字节缩减指标，仅用于观测报告，不写成 Pass/Fail gate。

## Checkpoint 7：Runtime 与打包验收（已完成）

- [x] 更新 `smoke:builtin-cli`：九种正式 Runtime 只使用固定业务命令和 `--help`，不调用 Discovery；
- [x] 每种 Runtime 验证 send、read/search、mutation、旧 send 输入、业务错误、version conflict、
  stale lease、replay 和无重复效果；transport-independent indeterminate 由确定性 response-loss
  测试覆盖；
- [x] 验证 send 的首次身份推导与 durable recorded-identity Replay，确认当前活跃身份切换不会
  改写旧命令的 Camp；
- [x] `pnpm smoke:recovery` 重新验证 crash/restart 后 reconciliation、replay 和 fence；Projection
  由九 Runtime smoke 与 golden fixture 独立验证；
- [x] `pnpm smoke:intake` 验证真实 Agent 不需要 Discovery 即可完成固定命令调用；
- [x] 重新执行 `pnpm package:mac`、deep/strict codesign、Runtime Activity UI acceptance 和
  packaged App 的 CLI smoke；
- [x] 任一正式 Runtime 缺少 v3 capability、旧 Discovery 提示或 projection/schema 失败，版本
  不得标记 complete。

## Checkpoint 8：发布门槛与报告（已完成）

- [x] Rust/TypeScript/Renderer/fixture/静态检查、package 和真实 Runtime smoke 全部有证据；
- [x] 业务信息保留、Envelope 边界和 error/exit/stderr 合同全部通过；
- [x] 旧 send 输入、旧 Replay 和旧 Rovai-owned data 没有兼容路径；
- [x] 输出缩减观测指标写入报告，但不作为硬门槛，也不以达标为由删除业务字段；
- [x] 只有完成以上证据后，才将 v0.46 `implementation_status` 改为 `complete`。

## 最终证据摘要

- Rust：Core library 282、Agent CLI 8、Core binary 47 通过，3 个手工 Runtime 测试按标记忽略；
- TypeScript/Renderer/Qualification：Vitest 174、Node 78、typecheck 与 Runtime Activity UI 通过；
- 真实 Runtime：九种正式 Runtime 均完成十二项 v3 command、旧 send 输入负向、业务冲突、
  Envelope Evidence、lease fence 与 Resume；
- 恢复：OpenCode Crash/restart reconciliation 与 Codex intake/restart/delete 通过；
- 发布物：macOS arm64 App、deep/strict codesign 与打包 Core/CLI 的 Codex Runtime smoke 通过；
- 观测：每 Runtime 13 个样本的 Envelope → Projection 字节缩减为 49.0%–49.4%，仅报告、不设门槛。
