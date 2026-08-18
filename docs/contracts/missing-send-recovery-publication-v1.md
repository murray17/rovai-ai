---
document_type: protocol-contract
contract: missing-send-recovery-publication-v1
authority: successful-agentrun-missing-send-publication
status: accepted
version: 1
last_updated: 2026-08-12
---

# Missing-Send Recovery Publication v1 Contract

This is an internal Adapter-to-Core terminal contract. It does not add an Agent command, CLI option, recipient
source, or new Camp Message Send version. [Camp Message Send v2](camp-message-send-v2.md) remains the sole
Agent-intent publication contract.

## 1. Catalog policy and terminal candidate

The frozen Adapter catalog exposes:

```text
missingSendRecoveryMode = disabled | if_no_accepted_send
```

All nine shipped Adapters use `if_no_accepted_send`; their independent `publicOutputMode` remains
`explicit_send_only`.

`agent_run.succeed` keeps required, non-empty `finalOutput` for successful execution and adds the optional internal
field:

```json
{
  "missingSendRecoveryCandidate": {
    "boundary": "codex_completed_turn | claude_success_result | antigravity_print_stdout | acp_end_turn_assistant_suffix",
    "body": "Adapter-delimited text"
  }
}
```

The candidate is not the success final. Missing, blank, oversize or invalid provenance candidates MUST NOT reject or
fail the successful AgentRun.

## 2. Adapter/boundary compatibility

| Frozen Adapter | Accepted boundary | Required evidence |
| --- | --- | --- |
| `codex-cli` | `codex_completed_turn` | last non-empty `agentMessage` in matching successful `turn/completed.turn.items` |
| `claude-code-cli` | `claude_success_result` | matched Session, non-error `result` with success subtype |
| `antigravity-app` | `antigravity_print_stdout` | successful process, untruncated stdout, valid UTF-8, verified Native Conversation |
| six ACP Adapters | `acp_end_turn_assistant_suffix` | matching prompt success with `stopReason=end_turn` and unambiguous assistant text after the last tool activity |

Core MUST reject the candidate for recovery when the boundary does not match the frozen Adapter kind. It MUST NOT
fall back to generic streamed text, process logs or a different Adapter boundary.

ACP message collection follows these rules:

- every `agent_message_chunk` still contributes to the existing aggregate success final;
- tool activity clears the recovery suffix accumulated before that activity;
- chunks with the same non-empty optional `messageId` append; a new ID starts the latest suffix;
- when all suffix chunks omit ID, adjacent chunks form one anonymous suffix;
- mixing identified and anonymous chunks within the post-tool candidate makes the candidate unavailable;
- only `end_turn` can expose a non-empty candidate.

## 3. Eligibility decision

Core evaluates recovery inside the successful AgentRun terminal transaction in this order:

1. load and fence the current running AgentRun by Camp, version and execution epoch;
2. resolve its frozen Adapter and recovery policy;
3. test whether an accepted send exists:

```sql
source_agent_run_id = :agent_run_id
AND author_type = 'agent'
AND author_id = :agent_id
AND source_operation_id IS NOT NULL
```

4. validate candidate presence, Adapter boundary, trimmed non-emptiness and raw UTF-8 byte length no greater than
   `32768`;
5. persist a recovery message only when policy is enabled, accepted-send evidence is absent and the candidate is
   valid.

Tombstone state, recipients, body digest, reply-to, send timing and inferred intent MUST NOT alter the accepted-send
fact. Automatic messages with null `source_operation_id` do not count as an Agent send.

The closed decision is one of:

```text
published
suppressed_accepted_send
skipped_policy_disabled
skipped_ordinary_publication
skipped_no_candidate
skipped_boundary_mismatch
skipped_empty_candidate
skipped_candidate_too_large
```

## 4. Recovery CampMessage shape

A published recovery message MUST have:

- `authorType = agent`, with author and source Run from the terminal target;
- `body` equal to the untruncated candidate and `structuredContent = [{kind: text, text: body}]`;
- `addressMode = default`, empty addressed/effective recipient arrays and no recipient presentation tokens;
- `replyToCampMessageId = null`, no Task attachment, and `sourceOperationId = null`;
- the source CampTurn/AgentRun association, a canonical content digest and normal Camp sequence/index entries;
- zero Message Deliveries and zero A2A budget allocation;
- `AgentRun.finalCampMessageId` set to its message ID.

Text that looks like `@agent_27` remains literal Text and is not passed through addressing resolution.

## 5. Terminal result, audit and replay

The applied terminal result and `agent_run.succeeded` event expose a `missingSendRecovery` object containing:

```json
{
  "mode": "if_no_accepted_send",
  "decision": "published",
  "acceptedSendDetected": false,
  "candidateBoundary": "codex_completed_turn",
  "messageId": "msg_…"
}
```

Unavailable values are `null`. Metadata may include a canonical candidate digest but MUST NOT duplicate candidate
body. The recovery `camp_message.sent` event identifies `publicationKind = missing_send_recovery`, boundary,
recipient-free status and source Run without body.

Command Gateway replay returns the stored terminal result and creates no new message. Concurrent ordering is defined
by commit order: accepted send first suppresses; terminal success first publishes and fences any late send.

## References

- [ADR-0162](../versions/v0.59/decisions.md#adr-0162)
- [Camp Message Send v2](camp-message-send-v2.md)
- [Public A2A Message 与 Message Delivery](../architecture/public-a2a-message-delivery.md)
