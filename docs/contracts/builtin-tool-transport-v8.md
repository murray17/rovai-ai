---
document_type: contract
contract: builtin-tool-transport-v8
status: accepted
target_version: v0.70
last_updated: 2026-08-13
---

# Built-in Tool Transport v8

v8 keeps v7's thirteen fixed business commands, Unix IPC, complete Core Envelope, receipt, Replay, Agent Output v2,
process-scoped lease, Task v3 transport, exact Camp read addressing and single-JSON stdout. It replaces
`camp.message.send` with [Camp Message Send v5](camp-message-send-v5.md) and narrows the Agent-facing schema,
exact help, Session Charter and `cli-operations` teaching for current-user attention without changing Core effects.

## Fixed commands and versions

```text
rovai send
rovai task create|get|update|list
rovai camp list|search|read
rovai history search
rovai memory search|read|write|propose-hearth
```

`BUILTIN_TOOL_CONTRACT_VERSION = 8`, `BUILTIN_TOOL_CLI_COMMAND_VERSION = 8`, and Runtime capability is
`builtin_cli.transport.v8`. IPC protocol, Envelope, receipt and Agent Output versions do not change. v7 and earlier
are historical CLI-context/catalog versions and cannot satisfy the v8 capability or catalog identity.

## `rovai send` surface

- closed fields are `body`, `to`, `mentionUser`, `taskId`;
- CLI adds boolean `--to-user`, mapped only to `mentionUser=true`;
- `--to` / inline tokens remain the only Agent routing sources; `--to-user` creates no Agent delivery;
- Task linkage requires exactly one Effective Agent Recipient regardless of `mentionUser`;
- user identity fields, recipient aliases and old reply/return fields are rejected;
- canonical Core result includes the complete accepted effects; Agent projection remains exactly
  `{messageId,effectiveRecipients}` with no `userMentioned` or notification/user identity.

The catalog summary and schema descriptions, exact-help prose and base examples are owned by one send-teaching
module and tested together. Direct flags, stdin and `--input-file` still validate against the same closed operation
schema. A transport cannot accept a field omitted by that schema.

## Exact `camp.read item` output

The `camp.read` input union and all four modes remain unchanged. Only every item returned by `mode="item"` gains the
required closed field:

```json
"addressing": {
  "effectiveAgentRecipients": ["agent_5"],
  "mentionsCurrentUser": true
}
```

The field is present for every body slice. Agent recipient IDs use frozen canonical order;
`mentionsCurrentUser` derives from authoritative Structured Content. `around`, `thread`, `timeline`, Camp search and
History search outputs remain compact and do not gain addressing.

## Exact help paths

Agent teaching and tests use only:

```text
rovai --help
rovai send --help
rovai task create --help
rovai task get --help
rovai task list --help
rovai task update --help
rovai camp list --help
rovai camp search --help
rovai camp read --help
rovai history search --help
rovai memory search --help
rovai memory read --help
rovai memory write --help
rovai memory propose-hearth --help
```

`rovai task --help`, `rovai camp --help`, `rovai memory --help` and generic `rovai <family> --help` are not teaching
aliases. Root help chooses an operation; exact operation help owns flags, constraints and short examples.

Base `rovai send --help` contains exactly three separated addressing examples:

```text
rovai send --body 'Status update'
rovai send --to agent_5 --body 'Please review and report back'
rovai send --to-user --body 'Please choose A or B'
```

It does not show `--to` and `--to-user` together. The `--to-user` field help owns the positive predicate, routine
negative cases, message-local non-inheritance, no Agent Delivery and no-user-approval statements from
[Camp Message Send v5](camp-message-send-v5.md).

## Charter and Skill boundary

Session Charter owns the fixed command set, exact-help rule, single input source, compact output, current Run Camp,
explicit public-send obligation and safe recovery. It does not embed complete schemas, every flag, command-family
decision trees or Memory governance.

The system-required official bundled `cli-operations` Skill is loaded only for command-family ambiguity, message→Task
choice, multi-operation coordination or complex recovery. Routine one-operation send/recipient/list/get/search/read
uses exact help and does not require the Skill. `--to-user` belongs to `rovai send --help`; the Skill's Send reference
adds only the non-routine independent-actions combination rule and user-facing closure responsibility guidance.
That guidance cannot become Core role authorization or rejection.

`memory-stewardship` remains the system-required Memory governance authority and may be losslessly split into
references. Both operational Skills remain enabled and assigned to every Runtime Group, but that availability does
not mean every turn loads them. All Agent commands in `memory-stewardship` use `rovai memory <action>`; internal
dotted operation names are not CLI examples.

## Catalog and Native Session rollout

The v8 catalog digest includes the changed send summary and `mentionUser` schema description, so it differs from v7
even though the accepted Core effects and wire fields are unchanged. CLI context version 8 and capability
`builtin_cli.transport.v8` prevent an old process context from claiming the new interface.

Antigravity binding compatibility already includes Built-in Tool contract version and catalog digest; a v7 binding
therefore cannot resume as compatible under v8 and the replacement Native Session receives the new Charter. Other
Runtime adapters continue the accepted rule that Charter prose alone does not enter binding compatibility and does
not globally discard useful Native Sessions. Their resumed processes use the current v8 CLI/exact help and current
official Skill revision, while the revised Charter is guaranteed for newly created Native Sessions. Existing
Bootstrap Evidence is never rewritten.

## Recovery

Business error output remains `{"error":{"code","message","recovery"}}`. With `confirm_outcome`, a returned
authoritative CampMessage locator can be checked using exact `camp.read`. Without a locator, Transport/Skill/Charter
must not recommend body search, approximate matching or resend; the Agent reports uncertainty through its current
Runtime outcome and stops the mutation.

No-locator `builtin_tool.outcome_indeterminate` continues to hide request identity. Missing downstream completion is
not evidence that send failed.

## Unchanged transport rules

Malformed input, credentials, active lease/fence, IPC and Envelope failures remain transport errors. Domain rejections
remain successful Transport Envelopes with business error projection. Safe transport retry windows cannot bypass
Domain Gateway idempotency. Non-help execution writes exactly one JSON document to stdout; secrets, socket/context
paths, receipt, request identity and full Envelope remain hidden.

Task mutations/reads, Camp list/search collection shapes, History search and Memory domain schemas are otherwise
unchanged from v7.

## References

- [Camp Message Send v5](camp-message-send-v5.md)
- [Current User Attention v3](current-user-attention-v3.md)
- [Built-in Tool Transport v7 (historical)](builtin-tool-transport-v7.md)
- [Built-in Tool Transport v7 Errata](builtin-tool-transport-v7-errata.md)
- [Built-in Tool Transport v6 (historical)](builtin-tool-transport-v6.md)
- [ADR-0165](../versions/v0.65/decisions.md#adr-0165)
- [ADR-0166](../versions/v0.65/decisions.md#adr-0166)
- [ADR-0167](../versions/v0.65/decisions.md#adr-0167)
- [Built-in Tool Runtime architecture](../architecture/builtin-tool-runtime.md)
