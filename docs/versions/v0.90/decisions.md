---
document_type: version-decisions
version: v0.90
lifecycle: historical
last_updated: 2026-08-18
---

# v0.90 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0195](#adr-0195) | Generation-Scoped Last Gather Return with Independent Bound | `accepted` |
| [ADR-0196](#adr-0196) | Self-Contained Gather Request in Mandatory Completion Input | `accepted` |

<!-- legacy-adr:begin id=ADR-0195 source-file-sha256=016c1002fe3c6f9cc406095d7861072309d6263ac9f005f835410e3e52c111cc -->
<a id="adr-0195"></a>

## ADR-0195: Generation-Scoped Last Gather Return with Independent Bound

迁移时原路径：`docs/adr/0195-generation-scoped-last-gather-return.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0195
title: Generation-Scoped Last Gather Return with Independent Bound
status: accepted
date: 2026-08-16
decision_scope: cross-version
source_version: v0.90
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0195 -->
<a id="adr-0195-context"></a>
### Context

A Gather dispatch to N members already consumes N accepted A2A operations. Charging each captured return to the same
maximum prevents a full 16-member Gather from returning any explicit result. At the same time, projecting every public
return creates two correctness failures: a progress message can displace the useful terminal summary, and returns from
a failed retry generation can be mixed with the replacement generation.

Captured returns do not materialize Runs, but they remain public durable writes and therefore cannot be unbounded or
silently deleted. The completion needs one deterministic result per current Item responsibility while preserving older
messages as audit history.

<a id="adr-0195-decision"></a>
### Decision

Gather capture uses an independent bound and generation-scoped last-result authority:

1. An exact captured return consumes neither the ordinary CampTurn accepted-A2A allowance nor an AgentRun
   responsibility. The ordinary CampTurn limits remain unchanged for dispatchable A2A work.
2. Core admits at most 16 captured returns for one exact GatherItem dispatch Delivery, source AgentRun and active retry
   generation. The CampTurn lifecycle and deadline remain authoritative.
3. Barrier result selection requires the Item's current target Run and active retry generation, then selects only the
   last accepted eligible public message by stable Camp sequence/order. Earlier eligible messages are progress history;
   prior-generation messages are audit-only.
4. A successful member final output is the fallback only when that current generation has no captured return. Member
   context and CLI teaching require the last explicit return to contain the complete conclusion.
5. Retry preserves all old Runs, Deliveries and CampMessages; changing active generation changes result authority
   without rewriting history.

This locally overrides ADR-0193's statement that a capture consumes accepted A2A and narrows ADR-0194's ordered
captured-result projection. Its persistent identity, terminal authority, unified Delivery and immutable Barrier
boundaries otherwise remain effective.

<a id="adr-0195-consequences"></a>
### Consequences

- A 16-member Gather can receive an explicit result from every member without removing the normal A2A safety cap.
- Progress is allowed, but the member must deliberately make its last return complete; terminal output cannot
  implicitly overwrite an explicit captured result.
- Completion cannot combine conclusions from a failed generation and its retry, while all public evidence remains
  inspectable.
- Capture admission needs its own atomic counter query and stable failure detail, and completion queries need exact Run
  and generation predicates.

<a id="adr-0195-rejected-alternatives"></a>
### Rejected Alternatives

- **Remove or raise the CampTurn accepted-A2A maximum globally.** This broadens ordinary delegation and loop risk for a
  return path that cannot materialize a Run.
- **Project every captured message.** Progress noise and superseded retry generations remain ambiguous to the Lead.
- **Use the member terminal output even after a capture.** Two competing result authorities make deterministic recovery
  and user-visible intent unclear.
- **Delete old-generation captures on retry.** They are valid public and audit facts even though they no longer control
  the current completion.

<a id="adr-0195-references"></a>
### References

- [v0.90 版本目标](README.md)
- [ADR-0193](../v0.89/decisions.md#adr-0193)
- [ADR-0194](../v0.89/decisions.md#adr-0194)
- [Gather v2](../../contracts/gather-v2.md)
- [Message Delivery v4](../../contracts/message-delivery-v4.md)
<!-- legacy-adr-body:end id=ADR-0195 -->
<!-- legacy-adr:end id=ADR-0195 -->

<!-- legacy-adr:begin id=ADR-0196 source-file-sha256=b06af3639f34595a67a82c9926306efeee01a334a5bbf863dfc0e1351d631e35 -->
<a id="adr-0196"></a>

## ADR-0196: Self-Contained Gather Request in Mandatory Completion Input

迁移时原路径：`docs/adr/0196-self-contained-gather-completion-request.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0196
title: Self-Contained Gather Request in Mandatory Completion Input
status: accepted
date: 2026-08-16
decision_scope: cross-version
source_version: v0.90
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0196 -->
<a id="adr-0196-context"></a>
### Context

The first Gather Completion input identifies the request only by `requestMessageId`. When completion runs later, the
public request may have been omitted by history selection and the Native Session may be replaced or compacted. An ID is
enough for audit lookup but not enough for the mandatory continuation to know the question, constraints and requested
output without making an additional read.

The Barrier already binds an immutable public request CampMessage and owns a mandatory Current Input. Relying on optional
history for the actual task text contradicts that durable continuation boundary.

<a id="adr-0196-decision"></a>
### Decision

Every newly frozen Gather Completion input contains a mandatory request snapshot:

```text
request = { messageId, body, contentDigest }
```

The Barrier reads it from the bound request CampMessage in the same transaction that freezes completion input. The
request message identity must equal `requestMessageId`, and Context materialization verifies body and digest against the
durable CampMessage. The full body is not shortened to make room for optional history. Gather input and complete Context
receive explicit bounded ceilings large enough for the maximum accepted request and Item evidence.

The input schema, Context Formatter and ContextManifest Evidence advance together. Existing frozen schema v1 input and
Formatter v15 evidence remain exact recovery authorities and are not rewritten; new collecting Gathers produce schema
v2 and Formatter v16 evidence.

This extends ADR-0194's mandatory typed input. Conversation remains the durable route and Native Session remains a
replaceable transport binding.

<a id="adr-0196-consequences"></a>
### Consequences

- A completion continuation can synthesize results with the exact accepted question even when all optional public
  history is absent.
- Request bytes are duplicated in one bounded immutable completion snapshot, increasing storage and payload size.
- Recovery validation must support both historical v1 and current v2 shapes without treating legacy absence as current
  permission to omit the request.
- ContextManifest records request digest/length evidence in addition to the overall completion input digest.

<a id="adr-0196-rejected-alternatives"></a>
### Rejected Alternatives

- **Depend on recent public history or Native Session residue.** Both are optional and can legitimately disappear.
- **Require the Lead to call `camp.read` before every synthesis.** The trigger would no longer be a self-contained
  mandatory input and a tool failure could erase the task meaning.
- **Store only a digest with the request ID.** It proves identity but does not provide model-visible instructions.
- **Truncate the request inside Completion Input.** Lost constraints are more damaging than optional history omission.
- **Rewrite stored v1 completions during migration.** That changes already-frozen bytes and violates recovery evidence.

<a id="adr-0196-references"></a>
### References

- [v0.90 版本目标](README.md)
- [ADR-0194](../v0.89/decisions.md#adr-0194)
- [Gather v2](../../contracts/gather-v2.md)
- [ContextManifest Evidence v14](../../contracts/context-manifest-evidence-v14.md)
<!-- legacy-adr-body:end id=ADR-0196 -->
<!-- legacy-adr:end id=ADR-0196 -->
