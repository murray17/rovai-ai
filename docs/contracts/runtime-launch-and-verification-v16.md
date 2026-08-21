---
document_type: contract
name: Runtime Launch and Verification
version: v16
status: accepted
source_version: v1.20
last_updated: 2026-08-21
---

# Runtime Launch and Verification v16

v16 replaces [v15](runtime-launch-and-verification-v15.md). Launch, readiness, Session, retry diagnostic,
terminal failure and private Runtime payload boundaries remain unchanged. It makes a Runtime-reported Shell command
self-contained in every public `runtime.action` lifecycle event for Claude Code and ACP adapters.

## Public Shell command projection

Claude Code continues to admit only a non-empty Bash `tool_use.input.command` as public `input`. The Adapter retains
that value by native tool-use ID and emits the same `input` on both started and terminal `runtime.action`; adjacent
provider fields and non-Bash inputs remain private. A terminal Evidence item must therefore remain renderable without
joining it to an earlier started item.

For ACP `tool_call | tool_call_update`, only a non-empty string at `rawInput.command` may become public `input`.
Sibling `rawInput` fields never enter the public payload; the canonical digest of the complete raw input remains
`rawInputDigest`. This narrow command shape also supplies `kind = execute` when the Runtime omitted kind. It does not
permit title parsing, digest reversal, arbitrary raw-input traversal or synthetic command reconstruction.

ACP servers may omit raw input and kind from a terminal update. During the active Prompt, the Adapter retains the
matching command, effective kind and raw-input digest in process memory keyed by `toolCallId`, then copies those public
facts into the terminal event. The private raw object is not added to Action records or a transcript store.

The command string is authorized user-visible Execution Evidence. Renderer presentation applies the current
deterministic secret-value redaction before placing it in the DOM; unrelated raw fields remain unavailable even to the
Renderer.

## Shell outcome

For an effective ACP `execute`, a numeric non-zero `exitCode | exit_code` reported on the update or its top-level
`rawOutput` changes the public terminal status and Action outcome to `failed`, even when ACP reports the tool lifecycle
as `completed`. Stdout/stderr remain the existing public output projection. Missing or non-numeric exit codes do not
invent failure.

## Acceptance

- Claude Bash started and terminal events contain the same command and only public stdout/stderr output;
- an ACP event with `rawInput.command` publishes `input`, `kind = execute` and the full raw-input digest while excluding
  every sibling raw field;
- a sparse ACP terminal update recovers command, kind and digest only from the same `toolCallId` observation;
- an ACP execute with exit code 7 is terminal failed, preserves public output and records unknown external-effect
  disposition rather than claiming success;
- events without a public command keep the previous title/toolName and honest unknown fallback.

## References

- [Runtime Launch and Verification v15](runtime-launch-and-verification-v15.md)
- [Run Process Detail Surface v19](run-process-detail-surface-v19.md)
- [Runtime Activity Mapping Registry](../runtime-activity/registry.md)
