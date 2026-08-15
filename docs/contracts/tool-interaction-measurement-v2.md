---
document_type: interface-contract
contract: tool-interaction-measurement
version: 2
authority: qualification-tool-opportunity-trace-and-tool-use-judge
status: accepted
last_updated: 2026-08-15
---

# Tool Interaction Measurement v2

本合同替代 v1 作为当前 Tool-use 测量合同。它仍是 advisory Measurement Layer：不改变 Hard Outcome，
不把调用数量解释为质量，也不把 Tool-use、协作过程和交付结果压成综合分。

## 运行时兼容性门禁

`rovai.qualification.tool-measurement-spec@2.0.0` 必须在 dispatch 前冻结：

- Case ID/Seal、`development | holdout` partition、private Fixture/Oracle digests；
- `builtinToolCatalogDigest`、Built-in contract/IPC version；
- Core `operationProjection` schema version；
- 非空、闭合且带 applicable semantic items 的 opportunities。

Runner 必须把这些值与当前 Core `health.check` 精确比较。任一不一致都在 fixture materialization 和 dispatch
之前 fail closed；旧 Pack 不允许在新 Tool catalog 上“尽量运行”。Measurement artifact 保留同一兼容性绑定，
从而让跨版本比较可以明确屏蔽不兼容的 Tool-use 轴。

## Opportunity 与 Adapter

Opportunity 仍以 `forced_use | natural_use | non_use_control` 预注册，observed call 不得创造 denominator。
v2 的闭合 Adapter/operation 集为：

| Adapter | Operations | 确定性层拥有的主要事实 |
| --- | --- | --- |
| `camp_history` | `camp.list/search/read`, `history.search` | query/target、Message identity、cursor/truncation、sealed relevant/distractor alignment |
| `memory_retrieval` | `memory.view/search/read` | exact scope/target、Memory/Revision/cache identity、完整性与 semantic-content coverage |
| `memory_mutation` | `memory.write` | v3 add/revise target、scope/kind、receipt、new revision、可选 exact readback |
| `task_coordination` | `team.create_task`, `team.get_task`, `team.update_task`, `team.list_tasks` | Task identity、assignee/status/version、mutation receipt、最终 Task state binding |
| `camp_message_send` | `camp.message.send` | recipient/预注册 Task link、Message/Delivery/Run/receipt 与 effect identity；语义协作质量不在本 Judge 重复评分 |

未知 operation 只能保留通用 Tool Ledger lifecycle，不能获得 Adapter oracle verdict 或 Tool-Use Judge verdict。
当前 Transport v12 新增的 `member.create` 已纳入 Core `operationProjection@2`、catalog 穷举门禁和
Tool Ledger mutation taxonomy，但本合同不伪造其专用语义评测：人类确认、六字段身份质量、头像安全和后续
成员价值需要独立 Opportunity/Effect contract，不得并入 Task 或 A2A 结果。

Private Fixture v2 可以以 symbol 预置 Camp Message、Memory 与 Task；materialization 后才把新鲜
Message/Memory/Revision/Task identity 与 Task version 代入 sealed oracle。因此 `get/update/list` 可以在
relevant Task 和 distractor Task 上测量，不需要把运行前未知的随机 ID 写进 Case prompt。

## Core Operation Evidence v2

Core 必须在真实操作前 durable 记录 input-digest-bound `started` Evidence，在终态记录 result-digest-bound
Evidence；两者是一个 logical interaction。`operationProjection@2` 是字段闭合、有界、可重算 digest 的投影：

- Camp/Task 保留语义判断所需的 bounded query、handoff、acceptance criteria、status/assignee/version；
- Memory v3 保留 nested Target、current Revision、cache state、scope/direction 与 bounded retrieval keys；
- Memory write/read/view 只保留经过 secret detector 的 bounded semantic body；命中 secret、超限或缺少精确
  source binding 时显式 redacted/truncated/unavailable；
- raw Tool payload、snippet、transcript、credential/token/header、provider-private metadata 和 filesystem locator 禁止进入。

Core health 必须发布当前 projection schema version。Core catalog 每个 operation 都必须通过穷举 projection
admission test；Measurement Adapter 另有闭合集合测试，避免产品加 Tool 后 Benchmark 静默漏测。

## Memory “写入”与“生效”

`memory.write` 的 applied receipt 只证明 mutation 成功，不自动证明 Memory 对后续行为生效。

- 写入正确性：deterministic receipt、Memory/Revision identity、scope/kind/target 和 semantic input closure；
- immediate effective readback：仅当 Opportunity 预注册 `requireEffectiveReadback=true`，且后续权威
  `memory.read | memory.view` 返回同一 identity 与 exact body digest 时才 pass；
- 跨 AgentRun/跨 Turn 的自动注入、召回和行为改变，需要多阶段 Case 或 paired availability ablation；单 Turn
  immediate readback 不得冒充长期生效。

## Evidence 与 LLM Judge

Runner 为 exact retrieved Camp/Memory content 与 Task final state创建独立 Judge-safe Evidence record；每条正文/状态
必须与 authoritative source digest 闭合。仅有 ID、snippet、redacted body 或不完整 coverage 时，相关 semantic item
为 unavailable，模型不得猜测。

确定性层判断：operation identity、授权、start/terminal lifecycle、receipt/replay、实体/revision/status、pagination、
sealed oracle alignment、coverage 和 effect binding。Tool-Use Judge 只判断：

1. `SER.tool_use.selection_necessity`
2. `SER.tool_use.input_strategy`
3. `SER.tool_use.result_interpretation`
4. `SER.tool_use.downstream_use`
5. `SER.memory.retention_quality`

每个 Opportunity 只启用预注册 applicable items。Judge 使用 v1 冻结的双 Replica、counterbalanced order、
tool/network/workspace disabled、typed abstention/disagreement 和 Hard Outcome non-interference 协议；Pack 升级为
`rovai.qualification.tool-use-judge-pack@2.0.0`，但 checklist 与 reconciliation authority 不变。

## A2A 与 Process Evidence

A2A routing/effect 继续由 deterministic Tool/Collaboration Ledger 判断；delegation、handoff、contribution、feedback
和 Lead integration 只由 Process Judge 判断。Process projection 可以保留 source-bound message ordinal、reply parent 与
Task linkage，让模型看见反馈链，但 reply/task/time adjacency 仍只是候选关系，不证明贡献被吸收或导致代码变化。

## 评分与发布边界

- 发布逐 Opportunity deterministic categorical findings、coverage 和逐项 LLM verdict/disagreement；
- call/member/result count 没有正向质量含义；
- 不生成 Tool-use aggregate score、collaboration score 或 winner；
- Tool availability、Team/Solo 因果价值和效率只在预注册 paired experiment 中按 Hard Outcome、blinded Outcome
  non-inferiority 与 typed resource vector 发布 paired delta；失败更快不算效率提升。

## References

- [ADR-0171](../adr/0171-opportunity-based-tool-interaction-measurement.md)
- [Tool Interaction Measurement v1（历史）](tool-interaction-measurement-v1.md)
- [Semantic Judge Views v1](semantic-judge-views-v1.md)
- [Paired Collaboration Experiment v1](paired-collaboration-experiment-v1.md)
- [Benchmark Protocol 架构](../architecture/benchmark-protocol.md)
