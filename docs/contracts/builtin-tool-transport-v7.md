---
document_type: contract
contract: builtin-tool-transport-v7
status: accepted
target_version: v0.65
last_updated: 2026-08-12
---

# Built-in Tool Transport v7

v7 keeps v6's thirteen fixed business commands, Unix IPC, complete Core Envelope, receipt, Replay, Agent Output v2,
process-scoped lease, Task v3 transport and single-JSON stdout. It replaces `camp.message.send` with
[Camp Message Send v4](camp-message-send-v4.md), extends exact `camp.read item` output, and freezes exact help plus
progressive CLI teaching boundaries.

## Fixed commands and versions

```text
rovai send
rovai task create|get|update|list
rovai camp list|search|read
rovai history search
rovai memory search|read|write|propose-hearth
```

`BUILTIN_TOOL_CONTRACT_VERSION = 7`, `BUILTIN_TOOL_CLI_COMMAND_VERSION = 7`, and Runtime capability is
`builtin_cli.transport.v7`. IPC protocol, Envelope, receipt and Agent Output versions do not change. v6 and earlier
are historical parser/recovery inputs and cannot accept v7 send input or exact read output.

## `rovai send` surface

- closed fields are `body`, `to`, `mentionUser`, `taskId`;
- CLI adds boolean `--to-user`, mapped only to `mentionUser=true`;
- `--to` / inline tokens remain the only Agent routing sources; `--to-user` creates no Agent delivery;
- Task linkage requires exactly one Effective Agent Recipient regardless of `mentionUser`;
- user identity fields, recipient aliases and old reply/return fields are rejected;
- canonical Core result includes the complete accepted effects; Agent projection remains exactly
  `{messageId,effectiveRecipients}` with no `userMentioned` or notification/user identity.

Schema, help, direct flags, stdin and `--input-file` derive from one operation definition. A transport cannot accept
a field omitted by the closed catalog schema.

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

## Charter and Skill boundary

Session Charter owns the fixed command set, exact-help rule, single input source, compact output, current Run Camp,
explicit public-send obligation and safe recovery. It does not embed complete schemas, every flag, command-family
decision trees or Memory governance.

The ordinary official bundled `cli-operations` Skill is loaded only for command-family ambiguity, message→Task
choice, multi-operation coordination or complex recovery. Routine one-operation send/recipient/list/get/search/read
uses exact help and does not require the Skill. `--to-user` belongs to `rovai send --help`.

`memory-stewardship` remains the Memory governance authority and may be losslessly split into references. All Agent
commands in it use `rovai memory <action>`; internal dotted operation names are not CLI examples.

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
unchanged from v6.

## References

- [Camp Message Send v4](camp-message-send-v4.md)
- [Current User Attention v1](current-user-attention-v1.md)
- [Built-in Tool Transport v6 (historical)](builtin-tool-transport-v6.md)
- [ADR-0165](../adr/0165-core-owned-current-user-message-attention.md)
- [ADR-0166](../adr/0166-progressive-built-in-cli-teaching.md)
- [ADR-0167](../adr/0167-seven-skill-official-inventory.md)
- [Built-in Tool Runtime architecture](../architecture/builtin-tool-runtime.md)
