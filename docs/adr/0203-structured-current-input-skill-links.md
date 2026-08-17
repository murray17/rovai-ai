---
document_type: adr
id: ADR-0203
title: Structured Current Input Skill Links
status: accepted
date: 2026-08-17
decision_scope: cross-version
source_version: v0.98
supersedes: []
superseded_by: null
---

# ADR-0203: Structured Current Input Skill Links

## Context

Composer 的 Skill Picker 过去只写普通 `/name` 文本。Core 因而无法区别用户明确选择的 Rovai Skill 与
手写 lookalike，也无法在不解析自然语言的前提下，把当前 AgentRun 真正可见且经完整性验证的 Skill 文件
告诉模型。另一方面，SkillProjection 是 execution-root、Runtime Group 和 start-time 状态相关的共享可变
视图；把路径写进 CampMessage、在 Draft 时冻结，或仅凭仍存在的旧 link 决定可用性，都会产生错误身份或
绕过后来 disable/unassign/delete 的结果。

ADR-0105 已拒绝为不支持 Runtime 原生发现的场景注入 Prompt Skill fallback。当前需要的是更窄的能力：
用户明确选择、发送时有资格且在该 Run start time 已由现有原生投影 preflight 证明为 ready 时，只提供同一
原生投影中 `SKILL.md` 的文件指针，不内联内容、不模拟不支持的 discovery，也不宣称 Runtime 已加载。

## Decision

Picker 选择保存为 closed Structured Content 中的 `SkillMention(skillId,nameAtSend)`，正文始终投影为
`/nameAtSend`。普通输入、粘贴和历史 Slash 文本不升级为结构化 Skill。

Direct user send 在每个 AgentRun 的冻结 Runtime 配置已确定后，于同一事务保存 per-Run
`SkillSelectionSnapshot`。只有发送时 Skill 仍存在且 active、enabled、名称一致，并至少有一个 Assignment
与该 Run 的冻结 Delivery Groups 相交，选择才有发送资格。发送时无资格不能因后来启用或重新分配而回溯。

首次 Context materialization 在 Core serialized preparation critical section 内重新冻结当前 Library
availability，并与该 Run 的全量 verified `SkillExposureSnapshot` 相交。一个 Core-owned、只读的解析
Module 按稳定 Group precedence 选择同 ID、同名、ready 的 exposure，并只从可信 `entryPath` 派生
`entryPath/SKILL.md`。合法 missing、disabled、unassigned、renamed、shadowed 或非-ready 状态静默省略；
任何现有全量 projection `error`、`stale`、Revision/content digest 或 ownership 完整性失败仍阻止 Runtime
launch，不能缩窄为 selected-only preflight。

成功解析的选择进入 mandatory final `CURRENT_INPUT` 的 optional sibling field：
`skills: [{name,path}]`。正文和附件不改变；零 entry 时省略整个字段。`skillId`、Revision、digest、Group、
availability 和 omission reason 只属于 Core state 与 ContextManifest Evidence。Runtime Adapter 继续传输
现有完整 Dynamic Context，不增加 Provider-specific Skill item。

这不是 ADR-0105 所拒绝的 Prompt Skill fallback：它不为 unsupported discovery 内联或复制 Skill，不从
name 猜路径，不绕过 Assignment/Enablement/Projection，也不建立第二套 Runtime Skill protocol。
SkillProjectionReconciler 继续独占 filesystem side effect；Resolver 只消费已验证 Exposure。

ADR-0147 的四层 authority 保持分离：selection 与 start-time availability 是 Context Source State；
`CURRENT_INPUT.skills` 是 Model Context Projection；Exposure、resolution 和 exact bytes 是 Context
Projection Evidence；Runtime Input Delivery accepted ACK 不证明 Skill 文件被模型读取。

## Consequences

- 用户看见和发送的 Slash Marker 保持稳定，同时 Core 获得不可由 lookalike 文本伪造的选择身份。
- 同一共享消息的不同 AgentRun 可以根据各自冻结 Runtime Group 与 execution root 得到不同路径或省略结果；
  CampMessage 不被 Run-specific path 污染。
- 发送时与 start time 的双时点资格避免 late enable 回溯，也避免 active-Run protection 暂时保留的旧 link
  绕过当前 desired state。
- Context Formatter、ContextManifest 和 Data Contract 必须升级并 clean break 不兼容技术状态；旧普通文本
  不回填。
- 文件指针仍依赖 Runtime/模型自行读取；Rovai 只能证明指针的选择与投影完整性，不能证明实际 load。

## Rejected Alternatives

- 扫描 `/name` 普通文本并匹配 Library：拒绝，因为手写/paste lookalike 会获得隐藏身份，历史文本也会被
  后来的 Library 状态重新解释。
- 在 CampMessage 或 Draft 中冻结绝对路径：拒绝，因为路径属于每个 Run 的 execution root、Runtime Group
  与 start-time Exposure，不属于共享消息或编辑期状态。
- 只读取 start-time Exposure、不保存发送时资格：拒绝，因为发送后启用或重新分配会回溯改变已接受输入。
- 只检查发送时资格、不读取 start-time desired state：拒绝，因为 disable/unassign/delete 后仍被 active
  Run protection 保留的旧 link 可能错误进入新 Run。
- 内联 Skill 内容、创建 per-Run copy 或增加 Provider-native Skill item：拒绝，因为会建立第二套 Skill
  protocol、改变 Adapter transport，并混淆 Projection 与 Runtime load evidence。
- 对 selected Skill fail open、把未选择 Skill 从 preflight 排除：拒绝，因为会削弱现有 execution-time
  integrity 和 shared root ownership 门禁。

## References

- [v0.98 版本概览](../versions/v0.98/README.md)
- [确认的模型上下文变更 revision 1](../versions/v0.98/model-context-change.md)
- [ADR-0105](0105-runtime-group-assigned-skill-delivery.md)
- [ADR-0147](0147-lossless-model-context-projection-and-layered-delivery-evidence.md)
- [ADR-0161](0161-event-driven-root-scoped-skill-projection-reconciliation.md)
- [ADR-0188](0188-bundled-skill-bootstrap-fast-path-and-execution-integrity.md)
- [Current Input Skill Links v1](../contracts/current-input-skill-links-v1.md)
- [ContextManifest Evidence v16](../contracts/context-manifest-evidence-v16.md)
