---
document_type: version-overview
version: v0.41
lifecycle: current
authority: version-scope-and-status
design_status: accepted
implementation_status: in_progress
last_updated: 2026-08-05
---

# Rovai-ai v0.41 Runtime Activity 统一观测语义

> 状态：已从历史 Binding Set/identity replay 方案收敛为当前 Projection；Core、Read Side、Renderer 与九 Runtime 受控 fixture 验收均已完成。2026-08-05 的真实联网验收中，Copilot 与 Kiro 的专项问题已修复并分别复跑通过：Copilot 实际调用 Core 投影工具，Kiro Skill/MCP turn 均通过。版本仍等待用户确认最终 UI 展示结果后再标记 complete。
>
> 前置版本：[v0.40 Camp 历史检索工具收敛](../v0.40/README.md)
>
> 有效决策：[ADR-0111](../../adr/0111-core-owned-canonical-runtime-activity.md)～[ADR-0118](../../adr/0118-v041-local-data-clean-break-and-managed-reset-boundary.md)、[ADR-0122](../../adr/0122-current-canonical-activity-projection-and-deferred-identity-replay.md)。ADR-0119～ADR-0121 已被 ADR-0122 替代，仅作历史记录。

## 版本目标

修复九个 Agent Runtime 的活动被统一展示成“运行命令 已完成”的问题，同时保持观测诚实性：

```text
Runtime 原始事件 / Core 实际介入事实
        ↓
append-only Execution Evidence
        ↓
Core Mapping Registry + 当前 Canonical Activity Projection
        ↓
Renderer Activity Presentation
```

- Evidence 只保存 Runtime 实际报告或 Core 实际介入的事实；
- `source_event_key` 只去重 Evidence；`operationId` 只合并同一结构化操作；
- Core 根据结构化字段维护 `activity-v1` Projection；
- Renderer 只消费 `activityDomain`、`semanticKind`、`toolName`、`presentationHint`、`phase`、`outcome`；
- 未报告的行为保持未知，不根据标题、命令、Runtime 名称或工作区变化补写。

## v0.41 最小持久化模型

保留 `agent_run_execution_evidence`，新增一张 `canonical_runtime_activity`：

- 唯一键：`(agentRunId, executionEpoch, operationId, classifierVersion)`；
- 保存当前 domain/semantic/tool/presentation/phase/outcome；
- 保存首末 Evidence sequence、Evidence ID 集合和 revision；
- 每条活动 Evidence 与 Projection 在同一 SQLite 事务中 insert/update；
- started、progress、terminal 使用相同稳定 Runtime/Core ID 时更新同一行；
- 缺少稳定 ID 时使用 Evidence ID，各自形成 unknown operation，禁止模糊合并。

v0.41 不实现 operation registry、Binding Ledger、immutable Binding Set、sealed Manifest、default head、identity replay 或并行历史 grouping。未来出现真实的历史重分组需求时另立 ADR。

## Mapping Registry 初始规则

| 结构化事实 | Canonical 输出 |
|---|---|
| Codex `commandExecution` | `shell / shell.execute` |
| Codex `fileChange` | `file / file.write` |
| Codex `webSearch` | `tool / tool.web.search` |
| Codex `mcpToolCall` | `tool / tool.mcp.call`，保留 `server/tool` |
| ACP `kind=read` | `file / file.read` |
| ACP `kind=edit|write` | `file / file.write` |
| ACP `kind=execute|command` | `shell / shell.execute` |
| 经 Catalog 验证的 Core Team Tool | `tool / tool.call`，显示 canonical tool name |
| 只有 Run 级事实 | `runtime / runtime.run` |
| 无法验证 | `unknown`，不猜测 |

Claude Code 与 Antigravity 当前只有 Run 级结果时，只展示 Run 开始、处理中、完成/失败/取消和最终回复；不得伪造命令或文件步骤。

Runtime 的协议兼容不得进入 Renderer 分类逻辑：Copilot 的动态 Context 显式传递逻辑 MCP 名称到 Runtime 名称的映射；Kiro 的 Team bridge 使用 Bedrock 兼容 schema，但 Core 输入校验仍以 canonical catalog 为准。

## 长期迭代规则

每次新增 Runtime 或映射规则，提交必须同时包含：

1. 一个 Core Mapping Registry 变更；
2. 正例、unknown 例和 lifecycle 合并 fixture；
3. Runtime/协议版本与 coverage level；
4. live 与恢复读取的一致性测试；
5. Renderer 不重新分类的验证；
6. 真实 smoke 是否可运行、外部依赖与验收证据。

新 classifier 默认只影响新 operation；进行中的 operation 固定首次建立时的版本；历史不自动重算。真正需要历史 reprojection 时再设计显式入口、审计和回滚。

## 验收标准

- 九个 Adapter 都有 fixture/文本矩阵；
- 可观测细粒度工具的 Runtime 展示其真实报告或 Core 验证的名称；
- Run-level Runtime 不出现虚构工具；
- started/completed 只形成一项 operation；
- Core、TypeScript、Renderer 测试与桌面构建通过；
- 隔离 App 验收输出截图和机器可读报告。

实现细节见[架构](architecture.md)、[活动合同](activity-contract.md)和[实施计划](implementation-plan.md)；长期规则目录见[Runtime Activity Mapping Registry](../../runtime-activity/README.md)。
