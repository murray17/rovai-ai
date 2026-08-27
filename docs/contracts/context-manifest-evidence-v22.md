---
document_type: protocol-contract
contract: context-manifest-evidence-v22
authority: agent-run-context-evidence
status: accepted
version: 22
last_updated: 2026-08-27
---

# ContextManifest Evidence v22 Contract

ContextManifest Evidence v22 replaces [v21](context-manifest-evidence-v21.md) for new AgentRuns. It adds an
ExternalPrincipal direct-input source and the deterministic agent projection of `ExternalQuote`; every existing section,
selection, budget, attachment receipt, Run Facts, Gather Completion and delivery evidence rule remains v21-compatible.

## Versions

```text
Native Session Bootstrap contract = native_session_bootstrap_v3
Bootstrap Formatter = 3
AgentRun Context Formatter = 22
ContextManifest = 22
Context Delivery Profile = 4
Run Facts = 2
Gather Completion Input = 3
Camp Attachment View Contract = 2
Camp Attachment View Receipt = 2
Runtime Attachment Auth Receipt = 1
Data Contract = v1.25
Projection Schema = 66
Latest Migration = 112
```

New-write ContextManifest pairing is closed:

```text
Manifest 19 + Formatter 20 + Run Facts 1 + no View receipt  (legacy read only)
Manifest 20 + Formatter 21 + Run Facts 2 + View receipt v1  (historical read only)
Manifest 21 + Formatter 21 + Run Facts 2 + View receipt v2  (historical read only)
Manifest 22 + Formatter 22 + Run Facts 2 + View receipt v2  (current write)
```

## ExternalPrincipal direct input

A direct AgentRun may now be triggered by `CampMessage.authorType = external_principal`. Core must prove the referenced
ExternalPrincipal exists and belongs to the admitted channel request. `CURRENT_INPUT` keeps the same top-level shape:

```json
{
  "source": {
    "type": "external_principal",
    "provider": "feishu",
    "displayName": "Alice"
  },
  "message": "<complete deterministic agent-facing projection>",
  "mentionsCurrentUser": false
}
```

`source` never contains principal ID, open/user/union ID, tenant, chat, topic, App ID, external message ID, project path or
authorization data. Local user direct input remains exactly `{"type":"user"}`；A2A member call and Gather Completion
source shapes are unchanged.

## ExternalQuote projection

`ExternalQuote` is a Structured Camp Message segment:

```json
{
  "kind": "external_quote",
  "senderDisplayName": "Bob",
  "body": "新版接口字段变了",
  "attachmentSummaries": [
    {"name": "spec.pdf", "mediaType": "file"}
  ],
  "contentDigest": "sha256:<64 lowercase hex>"
}
```

The agent-facing plain projection is exact:

```text
引用 Bob：
> 新版接口字段变了
> [附件] spec.pdf (file)
```

Every quote body line receives `> `；empty body uses `> （无文本）`；attachment lines preserve stored order. The
current message's member mentions and text follow in the same Structured Content order. This complete projection becomes
`CURRENT_INPUT.message` through the normal CampMessage path and is covered by source content digest、projected body digest、
exact Dynamic Context bytes digest and Runtime Input Delivery Evidence.

`ExternalQuote` is channel-owned. User-authored Composer content and ordinary user admission reject it; only trusted channel
ingress may construct a digest-valid segment.

No `rendered_message_override`、`current_input_override`、prompt-only quote field or external reply resolver exists.
Feishu-triggered `replyToMessageId` is absent, so v21 referenceClosure selection remains unchanged and does not duplicate
the quote.

## Selection and evidence

The section order stays:

```text
COLLABORATION_STATE?
SELF_ACTIVE_TASKS?
SHARED_CONVERSATION?
RUN_FACTS
A2A_GUIDANCE?
CURRENT_INPUT
```

ExternalPrincipal-authored CampMessages are eligible public messages alongside user and agent messages, subject to the same
publication fence, sequence boundary, recent limit, body/total budgets and reference authorization. Human display name is
loaded from the ExternalPrincipal authority at projection time; missing identity makes preparation fail closed.

Profile 4 recent self-author exclusion, omission evidence, Skill links, attachment paths/receipts, Run Facts 2, A2A
guidance, Gather Completion 3, Bootstrap Redelivery and accepted ACK rules are byte-for-byte unchanged from v21 except where
an ExternalPrincipal source or ExternalQuote necessarily changes the selected CampMessage bytes.

## Migration and compatibility

Migration 112 preserves historical Manifest rows and extends the closed table constraints to pairing 22/22. The new-write
trigger rejects any new ContextManifest not using version 22. Historical terminal v19-v21 evidence remains readable and is
not rewritten; an already frozen v21 Runtime input remains its original evidence rather than being relabeled v22.

Adapter Binding compatibility includes Formatter/Manifest 22, so a new input cannot reuse a binding whose context contract
digest only admits 21. Native Session Bootstrap bytes, Bootstrap Formatter and Session Charter revision do not change.

## References

- [ContextManifest Evidence v21](context-manifest-evidence-v21.md)
- [Feishu Channel v1](feishu-channel-v1.md)
- [Context Delivery Profile v4](context-delivery-profile-v4.md)
- [Run Facts v2](run-facts-v2.md)
- [v1.30 模型上下文变更说明](../versions/v1.30/model-context-change-feishu-external-principal.md)
