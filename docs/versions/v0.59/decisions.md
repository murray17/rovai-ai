---
document_type: version-decisions
version: v0.59
lifecycle: historical
last_updated: 2026-08-18
---

# v0.59 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0162](#adr-0162) | Missing-Send Recovery Publication at Successful AgentRun Termination | `accepted` |

<!-- legacy-adr:begin id=ADR-0162 source-file-sha256=bff504be07c91eb26abe7719d64768796d35a804619b1d73b0b79220b7b5fdc1 -->
<a id="adr-0162"></a>

## ADR-0162: Missing-Send Recovery Publication at Successful AgentRun Termination

迁移时原路径：`docs/adr/0162-missing-send-recovery-publication.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0162
title: Missing-Send Recovery Publication at Successful AgentRun Termination
status: accepted
date: 2026-08-12
decision_scope: cross-version
source_version: v0.59
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0162 -->
<a id="adr-0162-context"></a>
### Context

Every shipped Adapter uses ADR-0134's `explicit_send_only` mode. The Runtime can therefore finish useful work and
produce a reliable native final while publishing nothing when it omits `rovai send`. Treating every final as ordinary
public output would weaken that explicit boundary and expose streamed or ambiguous text; requiring a new semantic
`final` send kind would not recover existing zero-send Runs and would make Core classify Agent intent.

The safety net must work for both user-triggered and Message-Delivery-triggered Runs, preserve the existing successful
AgentRun definition, and remain deterministic under command replay and send/succeed races.

<a id="adr-0162-decision"></a>
### Decision

1. Adapter catalog owns an immutable Missing-Send Recovery policy independent from Runtime Public Output Mode. Every
   currently shipped Adapter keeps `explicit_send_only` and enables `if_no_accepted_send` recovery.
2. An Adapter may attach one optional typed recovery candidate to successful AgentRun termination. Candidate absence,
   whitespace, a UTF-8 byte length above the `camp.message.send` 32 KiB limit, or provenance incompatible with the
   Run's frozen Adapter makes recovery ineligible but does not change Run success.
3. Candidate provenance is closed and Runtime-native:
   - Codex: the last non-empty `agentMessage` in the authoritative `turn/completed.turn.items`;
   - Claude Code: the matched-Session successful result value;
   - Antigravity: successful, untruncated, valid UTF-8 print stdout;
   - ACP: only an `end_turn` assistant suffix observed after the last tool activity. Optional `messageId` joins chunks
     of one identified message; an anonymous contiguous suffix is allowed when IDs are absent; identified/anonymous
     identity confusion fails closed.
4. Inside the successful terminal transaction, Core determines whether the same AgentRun already has any accepted
   Camp Message Send by durable `source_agent_run_id` plus non-null `source_operation_id` and matching Agent author.
   Recipient set, body, reply, intent, current tombstone state and semantic similarity are irrelevant. Any such send
   suppresses recovery.
5. If recovery is enabled, the candidate is valid, and no accepted send exists, Core creates exactly one
   recipient-free Public A2A Message in the same transaction as Run success. The message contains one literal Text
   segment, has no effective recipients, Delivery, reply-to, Task attachment or send operation identity, and is linked
   by `AgentRun.finalCampMessageId`.
6. The terminal command's durable replay returns its original result without re-running eligibility or persistence.
   A send committed before succeed suppresses recovery. If succeed commits first, it atomically creates recovery and
   fences the Run; a later send is rejected and cannot create a second message.
7. Audit/result metadata records the policy, candidate boundary, accepted-send fact and closed decision reason without
   copying the candidate body. This mechanism recovers zero-send silence only; it is not a final-answer completeness
   guarantee.

<a id="adr-0162-consequences"></a>
### Consequences

- All nine Runtime integrations need a tested final collector in addition to their existing Run-success output path.
- Core owns one deterministic terminal decision and no Renderer heuristic, delivery scheduler or Agent prompt decides
  whether recovery occurs.
- A progress or addressed send can suppress a later final recovery. This false negative is accepted to avoid an
  untestable intent classifier and duplicate public output.
- Separate successful silent Runs, including independent A2A targets, may each create one recovery message.
- Oversize or uncertain finals remain private execution evidence while the AgentRun still succeeds.

<a id="adr-0162-rejected-alternatives"></a>
### Rejected Alternatives

- **Enable `assistant_final_visible` for all Adapters**: conflates ordinary public output with a zero-send safety net
  and changes ADR-0134's exact-suppression semantics.
- **Suppress only an equal public-only body**: duplicates final output after any progress or addressed send and no
  longer represents the confirmed “missing send” condition.
- **Add progress/final send intent**: cannot repair existing callers without a new behavior contract and asks Core to
  trust or infer semantic intent.
- **Publish the last stream/stdout chunk**: lacks a reliable native completion boundary and can expose logs or partial
  text.
- **Truncate an oversize candidate**: silently changes Agent-authored meaning and makes the public fact differ from
  the Runtime final.

<a id="adr-0162-references"></a>
### References

- [v0.59 版本目标](README.md)
- [ADR-0134](../v0.45/decisions.md#adr-0134)
- [Missing-Send Recovery Publication v1](../../contracts/missing-send-recovery-publication-v1.md)
- [Public A2A Message 与 Message Delivery](../../architecture/public-a2a-message-delivery.md)
<!-- legacy-adr-body:end id=ADR-0162 -->
<!-- legacy-adr:end id=ADR-0162 -->
