---
document_type: implementation-plan
version: v0.41
authority: implementation-plan-and-acceptance
status: in_progress
last_updated: 2026-08-05
---

# v0.41 实施与验收计划

> 范围已按 ADR-0122 收缩：只实现 append-only Evidence、Core `activity-v1` Mapping Registry、单张当前 Canonical Projection 和 Renderer 展示。ADR-0119～ADR-0121 的 Binding Set 基础设施不进入 v0.41。

## Checkpoint 1：Core 与持久化

- [x] 新增 Core-owned `canonical_activity` 模块；
- [x] 以 Core Action ID → Runtime stable ID → Evidence ID 的优先级生成 operationId；
- [x] 新增单张 `canonical_runtime_activity`；
- [x] Evidence 与 Projection insert/update 使用同一 SQLite 事务；
- [x] started/completed 相同 operationId 更新同一行；
- [x] 无稳定 ID 时按 Evidence 隔离，不模糊合并；
- [x] 写入 v0.41 data contract marker；生产启动对不兼容旧 store 执行 allowlist clean reset；
- [x] 补齐九 Runtime 的 Mapping Registry fixture；
- [x] 增加冲突终态、重复和恢复读取测试。

## Checkpoint 2：Read Side 与 Renderer

- [x] Camp snapshot / Evidence page 附带 Core Canonical Activity；
- [x] live Core event 附带同一 Canonical Activity shape；
- [x] Renderer 使用 operationId 合并，不再按 title/toolCallId 做第二套相关性；
- [x] Renderer 标题优先显示结构化 `toolName`，并标记 Core 验证或 Runtime 报告；
- [x] Renderer icon 使用 `activityDomain`，不再从标题是否包含“命令”推断；
- [x] 更新现有 UI 测试到 v0.41 合同；
- [x] 验证完整 Evidence 控件不再错误聚合。

## Checkpoint 3：九 Runtime 验收

| Adapter | 预期覆盖 | 验收重点 | 状态 |
|---|---|---|---|
| Codex CLI | fine_grained | command/file/MCP 结构化名称与 lifecycle | 受控 fixture + manual/Skill/MCP smoke 通过 |
| OpenCode | fine_grained when ACP reports | ACP kind/title/tool name | 受控 fixture + manual/Skill/MCP smoke 通过 |
| GitHub Copilot | fine_grained when ACP reports | ACP kind/title/tool name | 受控 fixture + manual/Skill/MCP projection smoke 通过；逻辑名到 Runtime 哈希名映射已验证 |
| Kiro | fine_grained when ACP reports | ACP kind/title/tool name | 受控 fixture + ACP session/Skill/MCP projection smoke 通过；Bedrock schema dialect 已验证 |
| Qoder | fine_grained when ACP reports | ACP kind/title/tool name | 受控 fixture + Skill smoke 通过 |
| CodeBuddy | fine_grained when ACP reports | ACP kind/title/tool name | 受控 fixture + Skill smoke 通过 |
| Qwen Code | fine_grained when ACP reports | ACP kind/title/tool name | 受控 fixture + Skill smoke 通过 |
| Claude Code | run_level unless structured event exists | 不伪造 command/file/tool | 受控 fixture + Skill/MCP smoke 通过 |
| Antigravity | run_level + Core Team Tool | Run 级诚实性与 Catalog 名称 | 受控 fixture + manual/Skill smoke 通过 |

验收输出必须包含机器可读矩阵和隔离 App 截图；真实 smoke 的 Runtime 错误或未发生工具调用必须保留原始边界，不能冒充真实映射通过。专项复跑证据和未完成的全适配器命令仍按原始边界记录在长期 [Runtime Activity Registry](../../runtime-activity/registry.md)。

## Checkpoint 4：发布质量

- [x] `cargo test --workspace`；
- [x] `cargo clippy --workspace --all-targets -- -D warnings`；
- [x] `pnpm typecheck`；
- [x] `pnpm test`；
- [x] 桌面 build；
- [x] 隔离 userData UI acceptance 与截图人工检查；
- [ ] 用户确认九 Runtime 展示后将版本标记 complete。

## 长期迭代门禁

每个映射变更必须同时提交 Registry 条目、正例/unknown/lifecycle fixture、coverage 说明、live/recovery 一致性测试和 UI 展示证据。真正出现历史身份重组需求时，先新建 ADR；不得把 Binding Set/replay 基础设施悄悄塞回当前投影表。
