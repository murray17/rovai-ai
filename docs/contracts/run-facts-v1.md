---
document_type: protocol-contract
contract: run-facts-v1
authority: agent-run-model-facts
status: accepted
version: 1
last_updated: 2026-08-16
---

# Run Facts v1 Contract

`RUN_FACTS` is an optional AgentRun Dynamic Context section rendered immediately before `CURRENT_INPUT`. Core builds
it only from authoritative state already known at ContextManifest materialization. The compact JSON object has
`schemaVersion: 1` plus the optional fields below; no facts means the entire section is omitted.

## Shape and triggers

### `taskContext`

Present only for an A2A Run with a frozen Task association:

```json
{"taskId":"task-1","referenceMode":"frozen","laterChangesRetargetRun":false}
```

This is a frozen reference, not a Task value snapshot. Later Task edits do not retarget the already accepted Run.

### `sessionContinuity`

Present when the Run replaces a previously known Native Session that cannot be continued:

```json
{"state":"lost","requiredAction":"recheck_private_session_assumptions"}
```

It does not claim that public/evidenced input was lost or that a replacement operation is authorized.

### `externalEffect`

Present when the Conversation has an earlier external action with authoritative `unknown` outcome:

```json
{"state":"unsettled","requiredAction":"reconcile_before_repeat"}
```

### `gather`

Present only for a current Gather member dispatch:

```json
{
  "role":"member",
  "returnTarget":"current_input_source",
  "returnWakesTarget":false,
  "authoritativeResult":"last_accepted_captured_return_current_run_retry_generation",
  "finalReturnMustBeComplete":true,
  "fallback":{
    "source":"successful_runtime_final_output",
    "when":"no_captured_return_current_run_retry_generation"
  }
}
```

`current_input_source` resolves through frozen `CURRENT_INPUT.source.senderAgentId`. Only the last accepted captured
return from the current target Run and active retry generation is authoritative. Only if that generation has no
captured return may its successful Runtime final output be the fallback; failed, cancelled, other-Run or other-
generation final output is not this fallback.

### `delegation`

Present when A2A depth or CampTurn A2A count exhausts the existing delegation budget:

```json
{
  "newA2aDispatchAllowed":false,
  "newA2aTargetContactAllowed":false,
  "capturedGatherReturnBlockedByDelegationBudget":false
}
```

The captured-return field appears only when `gather` is also present. A non-Gather exhausted-budget Run contains only
the first two fields. `false` states one negative budget fact; it does not establish membership, lineage, target,
generation, allowance or any other admission. Core reauthorizes every invocation.

## Serialization and evidence

Top-level field order is `schemaVersion`, `taskContext`, `sessionContinuity`, `externalEffect`, `gather`, `delegation`.
Each absent fact is omitted, not serialized as `null`, false defaults or empty objects. ContextManifest v16 freezes
ordered typed fact references, exact compact JSON bytes and their SHA-256 digest even when the model section is absent.

## References

- [ADR-0200](../adr/0200-compact-context-projection-and-structured-run-facts.md)
- [ContextManifest Evidence v16](context-manifest-evidence-v16.md)
- [Gather v2](gather-v2.md)
- [Message Delivery v4](message-delivery-v4.md)
