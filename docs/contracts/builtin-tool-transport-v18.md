---
document_type: contract
contract: builtin-tool-transport-v18
status: accepted
target_version: v1.17
last_updated: 2026-08-20
---

# Built-in Tool Transport v18

v18 replaces [v17](builtin-tool-transport-v17.md). IPC v2, Envelope/receipt/replay, process/lease identity, Agent Output
v2, fifteen-command count, Charter and all non-Send commands remain unchanged. It upgrades `camp.message.send` to v11 and
adds the repeatable CLI `--file` mapping to its closed input/catalog/help.

```text
BUILTIN_TOOL_CONTRACT_VERSION = 18
BUILTIN_TOOL_CLI_COMMAND_VERSION = 18
Runtime capability = builtin_cli.transport.v18
fixed command count = 15
Camp Message Send = 11
```

File freeze is a phased invocation: short authenticated replay lookup, unlocked blocking Authority freeze, then exact
lease/run/epoch reauthentication and semantic commit. The global invocation guard and Database mutex may not cover file
copy, recursive traversal, hashing or fsync. Exact replay returns the persisted result without touching input paths.

The accepted Send result and compact Agent output do not add projection state. Session Charter bytes and model-context
versions do not change; exact help and `cli-operations` Send reference own `--file` teaching. v17 capability is
incompatible for new invocation; historical receipts replay without translation.

## References

- [Built-in Tool Transport v17](builtin-tool-transport-v17.md)
- [Camp Message Send v11](camp-message-send-v11.md)
- [V1.17-D01](../versions/v1.17/decisions.md#v1-17-d01)

