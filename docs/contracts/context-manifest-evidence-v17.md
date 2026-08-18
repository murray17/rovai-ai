---
document_type: protocol-contract
contract: context-manifest-evidence-v17
authority: proposed-agent-run-context-evidence
status: proposed
version: 17
last_updated: 2026-08-18
---

# ContextManifest Evidence v17 Contract (Proposal)

Model-context revision 1 is confirmed. This proposal would replace
[ContextManifest Evidence v16](context-manifest-evidence-v16.md) only after its own acceptance and implementation; v16
remains the accepted current entry. v17 requires AgentRun Context Formatter 19
and preserves Bootstrap v3 / Bootstrap Formatter 3, Context Delivery Profile v3, Collaboration State v2,
Self Active Tasks, Run Facts v1, Current Input Skill Links v1, source/budget selection,
exact rendered payload and Runtime Input Delivery ACK authority except for the changes below.
It requires Gather Completion Input v3 because Gather freezes Structured CampMessage-backed request/result text before
Formatter materialization; Gather product behavior, limits and fallback semantics remain unchanged.

## Formatter 19 section order

The complete order is:

```text
COLLABORATION_STATE?
→ SELF_ACTIVE_TASKS?
→ SHARED_CONVERSATION?
→ RUN_FACTS?
→ A2A_GUIDANCE?
→ CURRENT_INPUT
```

`CURRENT_INPUT` remains mandatory, complete and last. `[A2A_GUIDANCE]` is trigger-conditional but, when eligible, is
mandatory and cannot be removed for payload budget. Optional public history and Self Active Task tails keep their
existing eviction priority; if the mandatory guidance plus Current Input cannot fit, materialization fails with the
existing payload-too-large boundary.

## Exact guidance projection

Only an ordinary `invocationKind=a2a` Run materialized from a `public_a2a` Message Delivery with frozen
`edge_kind=forward|return` includes the section. Gather member dispatch is an ordinary forward and receives forward
guidance. Direct user Runs and `gather_completion` Runs omit it. Captured Gather return Delivery creates no Run and
therefore no section.

Forward exact compact JSON is:

```json
{"instructions":["This member message delegates work to you.","Complete the requested work. Route back only a substantive result or a blocking question that the sender must act on; otherwise do not send.","Do not send acknowledgement, agreement, thanks, closure, standby, no-new-information, or a repeated conclusion.","A member message does not require a courtesy reply."]}
```

Return exact compact JSON is:

```json
{"instructions":["This message is a result from your earlier delegation.","Do not route an acknowledgement or confirmation back to the sender.","If it changes the Principal-facing conclusion, publish exactly one Camp update with `rovai send --public-only`.","If it adds no new Camp-visible value, end without sending.","Use Agent routing again only for a concrete new action or blocking question."]}
```

The section bytes are exactly header, compact JSON, footer and two final newlines as used by other Formatter sections.
The model object is closed and exposes only `instructions: string[]`. It exposes no `edgeKind`, Delivery/AgentRun ID,
parent/root lineage, depth, caller identity or internal recipient identity. `CURRENT_INPUT.source` and all its fields
remain unchanged.

## Principal projection evidence

Every v17 Manifest stores required:

```text
message_projection_audience = agent_v1
```

Formatter 19 renders every Structured CampMessage-backed Current Input and Shared Conversation body through the Agent
segment renderer, where CurrentUserMention is `@Principal`. For direct/member inputs,
`currentInputSource.projectedBodyDigest` and every `sharedMessageEvidence[].projectedBodyDigest` are SHA-256 digests of
that Agent-projected full/prefix text. Source `contentDigest`, Structured Content, `mentionsCurrentUser`, source
identity, body-length/truncation/offset, attachment and selection evidence retain their existing fields and authority;
body length and offsets now count Agent-projected Unicode scalars.

For `gather_completion`, the existing `currentInputSource.projectedBodyDigest` retains its established meaning: it is
the complete frozen completion-input digest, not one message-body digest. The audience-specific request/captured body
digests live in `currentInputSource.gatherCompletion` below. No consumer may reinterpret the generic field by source.

For `gather_completion`, `currentInputSource.gatherCompletion` additionally requires input schema v3 and the frozen
`messageProjectionAudience=agent_v1` plus request/captured projected-body digests defined by Gather v3. Formatter does
not post-process a v2 completion payload.

The complete v17 Gather evidence delta is:

```text
messageProjectionAudience: "agent_v1"
requestProjectedBodyDigest: "sha256:<64 lowercase hex>"
orderedItemRefs[].capturedMessageRefs[] += {
  bodyProjectionAudience: "agent_v1",
  projectedBodyDigest: "sha256:<64 lowercase hex>"
}
```

All v16 Gather evidence fields remain required: invocation/gather/completion Delivery/request identity, request source
content digest and byte length, input schema version/digest/byte length, snapshot digest, and ordered Item/captured
source references. The completion input digest binds the complete v3 object; the explicit projected digests permit
source-by-source validation without treating the Human body cache as evidence.

## A2A guidance evidence

Every v17 Manifest stores a non-null closed union and its canonical JSON digest:

```json
{"schemaVersion":1,"included":false}
```

or:

```json
{
  "schemaVersion": 1,
  "included": true,
  "variant": "forward | return",
  "payloadDigest": "sha256:<64 lowercase hex>"
}
```

`payloadDigest` hashes the exact compact model JSON between the section tags, not source Delivery JSON. The separate
`a2a_guidance_evidence_digest` is the existing unprefixed 64-lowercase-hex canonical JSON digest of this evidence
object. The full `rendered_payload_digest` continues to hash exact complete Dynamic Context bytes and therefore binds
the tags, order, guidance JSON and Current Input. `context.manifest_created` emits the evidence digest and
`messageProjectionAudience`, never instruction text or internal edge IDs.

Both public-Delivery preflight and final materialization derive the variant from the same frozen trigger Delivery and
revalidate its message, recipient, target Run, dispatch disposition and edge. A mismatch fails closed. Frozen delivery
context stores the same evidence union/digest; materialization may wrap it in Manifest authority but cannot reselect a
variant. Active recovery reuses frozen payload/evidence byte-for-byte.

## Versions, clean break and recovery

```text
Native Session Bootstrap contract = native_session_bootstrap_v3 (unchanged)
Bootstrap Formatter = 3 (unchanged)
AgentRun Context Formatter = 19
ContextManifest = 17
Context Delivery Profile = 3 (unchanged)
Gather Completion Input = 3
```

Bootstrap v3 is retained because the three-section formatter, field order, delivery modes and Bootstrap Evidence shape
do not change. The changed complete Charter bytes receive a new `sessionCharterDigest`; Bootstrap stable evidence binds
that digest. Formatter19/Manifest17 change `native_binding_context_contract()`, which changes every Adapter Binding
compatibility digest and forces a replacement Native Binding/Session. Thus no existing Session can be marked compatible
without receiving the new Charter.

The next implementation transition (numeric migration identifier assigned after confirmation) is a development-data
clean break. It rebuilds the local product store with `CHECK(formatter_version = 19)` and required audience/guidance
evidence; it does not backfill or preserve v1.06 Camp, CampMessage, Structured Content, Attachment, Task, execution,
monitoring, Manifest, Delivery, Bootstrap, Binding or Session rows. Exact reset mechanics and user-facing warning are
implementation-stage work after confirmation. There is no Formatter18/Manifest16 reader, alias, inferred guidance
backfill, dual write or old-data compatibility path.

Missing-Send Recovery policy is unchanged. A return Run that ends without an accepted send may still produce one
recipient-free recovery publication; that publication cannot create another A2A Run. Suppressing such publication is a
separate phase and ADR.

## References

- [v1.07 model-context revision 1](../versions/v1.07/model-context-change-a2a-public-only.md)
- [ContextManifest Evidence v16 (accepted predecessor)](context-manifest-evidence-v16.md)
- [ADR-0218](../adr/0218-audience-specific-principal-message-projection.md)
- [Run Facts v1](run-facts-v1.md)
- [Gather v3 proposal](gather-v3.md)
