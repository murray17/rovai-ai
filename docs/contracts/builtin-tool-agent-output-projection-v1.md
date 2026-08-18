---
document_type: protocol-contract
contract: builtin-tool-agent-output-projection-v1
authority: builtin-tool-agent-stdout-projection
status: accepted
version: 1
last_updated: 2026-08-18
---

# Built-in Tool Agent Output Projection v1 Contract

This contract freezes the CLI-local failure boundary after Core has returned and the complete Invocation Envelope has
validated, but the operation-specific Agent result projection or its closed output Schema does not validate.

## Agent-facing result

The CLI emits exactly one safe JSON document on stdout and exits with its local failure status:

```json
{
  "error": {
    "code": "builtin_tool.output_contract_mismatch",
    "message": "The operation completed, but its result could not be safely projected.",
    "recovery": "stop",
    "details": {
      "operation": "camp.read"
    }
  }
}
```

The error object and `details` are closed. `operation` is the validated canonical operation name. Agent output never
contains a JSON Schema path, filesystem path, Rust error, canonical result, Envelope, receipt or request identity.
`stop` forbids blind repetition: Core has already completed the operation, so another call could repeat a mutation or
consume additional read budget without repairing the local contract drift.

This code is distinct from Camp authorization errors and from the generic pre-result CLI failure. It does not change
`builtin_tool.outcome_indeterminate`, whose `confirm_outcome` recovery continues to represent uncertain Core outcome.

## Local diagnostic

The CLI writes the full available projection/validation error chain to a new private file under the managed
`ROVAI_RUN_TMP` directory. The filename uses an unpredictable operation-local UUID and create-new semantics; on Unix
the file mode is `0600`. The diagnostic records observation time, stable code, canonical operation and full local error.
Failure to write diagnostics never expands Agent stdout or changes the safe error above.

## References

- [ADR-0135: Compact Agent Output](../adr/0135-compact-agent-output-over-canonical-built-in-tool-envelope.md)
- [Built-in Tool Runtime architecture](../architecture/builtin-tool-runtime.md)
- [Camp History Retrieval v1](camp-history-v1.md)
