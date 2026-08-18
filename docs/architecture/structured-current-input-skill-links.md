---
document_type: architecture
architecture: structured-current-input-skill-links
authority: structured-skill-selection-and-context-resolution-boundaries
status: accepted
last_updated: 2026-08-17
---

# Structured Current Input Skill Links Architecture

本文件说明 Picker identity、发送时冻结、SkillProjection preflight、start-time resolution、Context Formatter
和 Runtime Adapter 的 Module seam。长期决定见
[ContextManifest 与 Run Facts 不变量](foundational-invariants.md#context-manifest-run-facts)，字段级合同见
[Current Input Skill Links v1](../contracts/current-input-skill-links-v1.md)与
[ContextManifest Evidence v17](../contracts/context-manifest-evidence-v17.md)。

## Authority flow

```text
Composer Picker
  -> Structured SkillMention in shared CampMessage
  -> per-recipient SkillSelectionSnapshot at Direct send
  -> full current-root SkillProjection preflight
  -> start-time RunSkillAvailabilityView
  -> CurrentInputSkillResolver
  -> CURRENT_INPUT.skills + ContextManifest resolution evidence
  -> unchanged Runtime Adapter payload transport
```

| 层 | 拥有 | 不拥有 |
| --- | --- | --- |
| Structured Content | `skillId/nameAtSend` 与稳定 `/nameAtSend` Marker | Run path、Revision、Group、eligibility |
| Skill Selection Snapshot | 每个 Direct Run 的发送时资格、first occurrence 与 omission reason | start-time availability、filesystem state |
| SkillProjectionReconciler | 当前 root 投影写入、ownership/digest verification、完整 Exposure | 用户选择、模型字段、Runtime load |
| CurrentInputSkillResolver | selection/availability/Exposure 的确定交集、稳定候选选择与 resolution | filesystem mutation、Library mutation、Adapter transport |
| Context Formatter | optional sibling `skills[{name,path}]` 与 exact Dynamic Context bytes | eligibility、path discovery、accepted ACK |
| Runtime Adapter | 既有完整 prepared/runtime payload transport | Skill 解析、Provider Skill item、load receipt |

## Module interfaces

### Structured Content Module

Interface 是 closed `StructuredCampMessageSegment` 与统一 body projection。Picker 是唯一创建
`SkillMention` 的 Renderer route；手写/paste 只创建 Text。Module 隐藏 token editing、normalization、digest
和 `/nameAtSend` rendering，调用方不查询 Skill Library 或 path。

### Skill Selection Freezer Module

Interface：

```text
freeze_for_run(
  database transaction,
  structured content,
  frozen Adapter delivery groups
) -> SkillSelectionSnapshot v1
```

实现隐藏 first-occurrence dedupe、Library row/enablement/name、Assignment intersection、reason precedence 与
canonical digest。Direct send 调用一次并把结果与 AgentRun 原子写入；所有非 Direct materialization 使用
统一 empty constructor。调用方不得组合独立 SQL 查询重建同一规则。

### SkillProjectionReconciler Module

Interface 保持现状：当前 root + Runtime capability -> verified `PreparedSkillExposure`。它是唯一可以创建、
修复、切换或删除 projection entry 的 Module；新 Resolver 不建立 filesystem Adapter seam，也不回调
Reconciler。

### Current Input Skill Resolver Module

Interface：

```text
resolve(
  SkillSelectionSnapshot v1,
  ordered RunSkillAvailabilityView,
  PreparedSkillExposure v2,
  frozen Delivery Group precedence
) -> CurrentInputSkillResolution v1
```

这是一个深 Module：caller 只提供四个已冻结输入并消费 projection entries + complete evidence；ID/name
matching、send/start 双时点、group compatibility、candidate ordering、`SKILL.md` path derivation 和 omission
reason 都留在实现内部。Module 返回结果、不产生 side effect；它的 Interface 同时是主要测试面。

### Context Formatter Module

Formatter 只接收 Resolver 已完成的 included model entries；不读取 Library、Assignment 或 filesystem。它在
Current Input 对象中增加 optional `skills`，继续使用 canonical JSON，并保持 `CURRENT_INPUT` 最后。
Manifest persistence 在同一 critical section 保存 resolution 与 exact payload evidence。

## Direct send and delayed delivery

用户 Composer Direct send 在同一事务确定 Structured Content、正文、接收者、每个接收者 effective Runtime
config 与 AgentRun。因此每个 Run 的 selection snapshot 使用同一 accepted-send boundary。

A2A/Gather Message Delivery 可能稍后才物化 AgentRun，但不接受 Picker identity。它们保存 versioned empty
snapshot；不能在物化时解析 Slash body，也不能借用物化时 Library 状态伪造发送时资格。

共享 CampMessage 永不保存 execution root 或 path。多接收者 Run 可以因冻结 Adapter Groups 与 root Exposure
不同，得到不同 resolution；这种差异只存在于 Run/Manifest。

## Start-time critical section

首次 materialization 的顺序是：

```text
claim/freeze AgentRun
  -> full current-root projection reconcile + verify
  -> enter serialized Context preparation transaction
  -> revalidate Run/binding/boundaries
  -> load persisted selection snapshot + verify digest
  -> read RunSkillAvailabilityView from current Library desired state
  -> resolve against PreparedSkillExposure
  -> render Formatter v19 bytes
  -> persist Manifest v16 evidence atomically
```

Exposure 的 filesystem preflight 可以先于 Manifest transaction 完成，但 Manifest transaction 必须重新验证
Run 与冻结 Exposure binding，并在同一个 immutable Manifest 中绑定 selection digest、Exposure digest、
availability/resolution 和 rendered bytes。已有 Manifest 的 active Run recovery 直接复用其冻结证据，不再
读取 current desired state 或 filesystem。

## Failure classification

| 条件 | 结果 |
| --- | --- |
| send-time missing/inactive/disabled/name/group mismatch | snapshot ineligible；正文保留；link 永久省略 |
| start-time missing/inactive/disabled/name/group mismatch | resolution omitted；正文保留；Run 继续 |
| shadowed/pending-removal/no ready compatible candidate | resolution omitted；Run 继续 |
| valid ready candidate | include `name` + absolute `entryPath/SKILL.md` |
| any full Exposure error/stale/digest/ownership failure | preflight fail closed；不创建 Context input |
| selection/resolution/Exposure digest tamper | recovery/materialization fail closed |

“静默”只描述用户消息和模型字段：Core 仍在 Manifest resolution 中保存 omission reason。它不把完整性错误
降级为 omission，也不在 Renderer 制造成功或 Runtime load 状态。

## Projection lifecycle and safety

- Resolver 不写 filesystem、不扫描 Runtime-native inventory、不从 name/root 猜路径；
- `entryPath` 是投影 entry 目录，model path 必须 join `SKILL.md`，不能直接输出目录；
- active-Run protection 可以暂时保留旧 link，但 start-time desired-state check 阻止新 Run 使用已
  disabled/unassigned/deleting 的 Skill；
- 普通 Run terminal 不删除 projection；既有 reconciliation/dirty/removed-root lifecycle 不变；
- path 只证明 Core 选择了经过 preflight 的文件，不证明 Runtime/model read，也不授权任何 operation。

## References

- [Skill Projection Reconciliation](skill-projection-reconciliation.md)
- [Built-in Tool Runtime](builtin-tool-runtime.md)
- [Camp Composer Draft](camp-composer-draft.md)
- [Skill Library 与投影不变量](foundational-invariants.md#skills-library-projection)
- [ContextManifest 与 Run Facts 不变量](foundational-invariants.md#context-manifest-run-facts)
- [ContextManifest 与 Run Facts 不变量](foundational-invariants.md#context-manifest-run-facts)
