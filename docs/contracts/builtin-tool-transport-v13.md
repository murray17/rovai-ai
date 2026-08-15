---
document_type: contract
contract: builtin-tool-transport-v13
status: accepted
target_version: v0.89
last_updated: 2026-08-16
---

# Built-in Tool Transport v13

v13 replaces [Built-in Tool Transport v12](builtin-tool-transport-v12.md). Unix IPC, authenticated Core Envelope,
receipt/replay, process lease, single-JSON stdout, common direct/stdin/input-file parsing, Agent Output v2 and all
fourteen v12 commands remain. v13 adds the fifteenth fixed command:

```text
team.gather -> rovai gather
```

```text
BUILTIN_TOOL_CONTRACT_VERSION = 13
BUILTIN_TOOL_CLI_COMMAND_VERSION = 13
Runtime capability = builtin_cli.transport.v13
fixed command count = 15
IPC protocol = 1; Envelope = 1; receipt = 1; Agent Output = 2
```

`rovai gather --to <AGENT_ID>... --body <TEXT>` maps to the closed Gather v1 input. `--to` is repeatable;
direct flags, JSON stdin/heredoc and `--input-file` are mutually exclusive. Exact help states the Default Lead gate,
shared body, asynchronous completion, and the requirement to end the current Lead Run without polling or duplicate
Gather calls. Root help lists Gather alongside Send/Task/Camp/History/Memory/Member.

Catalog input/output/error schemas, CLI mapping, digest, compatibility fence, Router, receipt/replay, Agent projection,
Session Charter, health/benchmark product fingerprint and Product Runtime discovery all use v13. v12 capability is
incompatible with a v13 binding.

Gather Evidence contains only bounded recipient count/set digest, gather/request/delivery locators and accepted/terminal
state. It excludes body, fallback, captured message body, raw error and Context payload.

## References

- [Gather v1](gather-v1.md)
- [Built-in Tool Transport v12 (historical)](builtin-tool-transport-v12.md)
- [Built-in Tool Runtime architecture](../architecture/builtin-tool-runtime.md)
