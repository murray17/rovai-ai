---
document_type: contract
contract: builtin-tool-transport-v20
status: accepted
target_version: v1.23
last_updated: 2026-08-21
---

# Built-in Tool Transport v20

Model-context revision 3 is confirmed. v20 inherits v19 IPC v2, Envelope/receipt/replay, process/lease and
Run-tmp identity, Agent Output v2, Send v12, fifteen-command catalog, PublicOnly, Principal attention and exact operation
help. It changes four Session Charter guidance passages and compatibility identities needed to deliver those bytes.
The v1.21 root CLI split between Agent operations and `rovai app` User Automation remains byte-for-byte unchanged.

```text
BUILTIN_TOOL_CONTRACT_VERSION = 20
BUILTIN_TOOL_CLI_COMMAND_VERSION = 20
Runtime capability = builtin_cli.transport.v20
fixed command count = 15
Camp Message Send = 12
IPC protocol = 2; Envelope = 1; receipt = 1; Agent Output = 2
Session Charter revision = 2
Context Formatter = 21; ContextManifest = 21; Profile = 4
```

## Session Charter delta

The exact before/after Charter is frozen in
[v1.23 model-context revision 3](../versions/v1.23/model-context-change-cli-help-reuse.md). It replaces only:

1. three Principal definition lines with one definition covering `@Principal` and `--to-principal`;
2. the negative “fifteen fixed / never MCP” catalog sentence with a positive local CLI route;
3. unconditional root/exact help sequencing with need-based lookup and Native Session reuse;
4. duplicated `--to-principal` effects with a message-local new-need condition.

These replacements preserve human Principal identity, attention-only effects, scheduling/approval boundaries, the
complete fifteen-operation local CLI route and every operation's exact help authority. Repeated `--help` remains valid.

## Compatibility and recovery

The Native Binding context contract adds internal `sessionCharterRevision: 2`. Every Adapter already embeds that
contract in its Binding compatibility digest, so a previous implicit-revision Binding cannot resume for a newly
resolved v20 Run. Core creates a new Binding/Native Session and delivers the full Bootstrap. The field is not rendered
to the model and does not enter Bootstrap Evidence, Dynamic Context or ContextManifest.

v20 contract/CLI version and catalog digest move atomically. v19 capability/catalog cannot invoke v20 Core and v20 CLI
cannot invoke v19 Core. Historical terminal Bootstrap Evidence and receipts remain readable and are not rewritten.
There is no database Migration or v19/v20 dual stack.

## Verification

- Charter snapshot contains all four exact replacements and excludes every corresponding v19 passage;
- current root help snapshots remain unchanged for managed Runtime and ordinary User Automation processes;
- operation-specific help, Send v12 and all fifteen identities remain unchanged;
- Binding contract contains `sessionCharterRevision: 2`; digest with the field differs from the legacy contract;
- constants, capability and catalog digest consistently advertise v20;
- packaged macOS App CLI verifies `--help` and `app --help` without contacting built-in Core transport.

## References

- [Built-in Tool Transport v19](builtin-tool-transport-v19.md)
- [v1.23 model-context revision 3](../versions/v1.23/model-context-change-cli-help-reuse.md)
- [Built-in Tool Runtime](../architecture/builtin-tool-runtime.md)
