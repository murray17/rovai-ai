---
document_type: contract
contract: builtin-tool-transport-v14
status: accepted
target_version: v1.05
last_updated: 2026-08-18
---

# Built-in Tool Transport v14

v14 replaces [Built-in Tool Transport v13](builtin-tool-transport-v13.md) as the current contract. The fifteen fixed
commands, canonical operation catalog, Envelope v1, receipt/replay v1, process/lease token semantics, idempotency,
single-JSON stdout and Agent Output v2 remain unchanged. v14 changes the local endpoint shape and admits a secured
Windows Named Pipe backend.

```text
BUILTIN_TOOL_CONTRACT_VERSION = 14
BUILTIN_TOOL_CLI_COMMAND_VERSION = 14
Runtime capability = builtin_cli.transport.v14
fixed command count = 15
IPC protocol = 2; Envelope = 1; receipt = 1; Agent Output = 2
```

## Endpoint context

`BuiltinToolCliContext.core_socket` is removed and replaced by exactly one required endpoint:

```rust
#[serde(tag = "transport", rename_all = "snake_case")]
pub enum LocalIpcEndpoint {
    UnixSocket { path: String },
    WindowsNamedPipe { name: String },
}

pub struct BuiltinToolCliContext {
    pub contract_version: u32,
    pub ipc_protocol_version: u32,
    pub core_endpoint: LocalIpcEndpoint,
    // existing process identity, process token and optional lease fields
}
```

There is no dual optional field or precedence rule. A v13 Context/capability is incompatible and fails before any
operation is attempted. Core, CLI, catalog digest, Adapter compatibility digest, frozen Runtime compatibility, Bootstrap,
Charter, Health, Diagnostics and benchmark/product fingerprints all carry v14.

## Windows Named Pipe

- random per-Core name: `\\.\pipe\rovai-ai-<core-pid>-<uuid>`; never persisted across Core starts;
- byte mode with existing newline-delimited UTF-8 JSON framing; partial reads and bounded frame limits remain mandatory;
- first listening instance uses `FILE_FLAG_FIRST_PIPE_INSTANCE`; later instances for that listener do not;
- all instances use `PIPE_REJECT_REMOTE_CLIENTS` and the same protected DACL;
- DACL is applied at `CreateNamedPipe` time through valid `SECURITY_ATTRIBUTES` and allows current logon SID plus SYSTEM;
- Pipe handles are non-inheritable; failure to create the replacement listening instance closes admission rather than
  running without a known listener;
- a connected instance is dispatched only after the next listener instance is successfully created;
- optional client PID observation is diagnostic only and never replaces process/lease token checks.

Tokio's unsafe `ServerOptions::create_with_security_attributes_raw` may be used behind the Windows backend when its
pointer lifetime and security descriptor ownership are locally proven. No caller outside that module handles raw
`SECURITY_ATTRIBUTES`.

## Release and compatibility

v14 is a clean break because Core and `rovai` CLI ship together and old Runtime processes must drain before update.
macOS repeats the complete v14 transport matrix over Unix Socket. On Windows, each Runtime remains unavailable until its
own Runtime Platform Admission evidence includes v14 discovery, read, mutation, replay, fencing and negative paths.

## References

- [ADR-0212](../adr/0212-cross-platform-local-ipc-transport-v14.md)
- [Built-in Tool Transport v13 (historical)](builtin-tool-transport-v13.md)
- [Built-in Tool Runtime](../architecture/builtin-tool-runtime.md)
- [Tokio Named Pipe API](https://docs.rs/tokio/latest/tokio/net/windows/named_pipe/struct.ServerOptions.html)
