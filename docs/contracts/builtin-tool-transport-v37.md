---
document_type: protocol-contract
contract: builtin-tool-transport-v37
authority: builtin-tool-transport
status: accepted
version: 37
last_updated: 2026-10-10
---

# Built-in Tool Transport v37

Inherits [v36](builtin-tool-transport-v36.md) and the Agent Output 10 extension in
[Camp History v12](camp-history-v12.md). Contract/CLI are 37 and capability is
`builtin_cli.transport.v37`. The 30-operation catalog, IPC 2, Envelope 1, receipt 1,
Agent Output 10 and evidence projection schema 4 are unchanged.

## Send file input

Only `rovai send --input-file <path>` gains body-file support. Core still receives the
existing closed Send request object. There is no body-file field, format selector or
Core-side reading or deletion of the client's input file. Other commands' file input
and Send's JSON stdin/heredoc retain their existing behavior.

The CLI accepts a regular file, including a symlink to one, at any readable location.
Relative paths resolve against CLI cwd; existing attachment path resolution is unchanged.
Reject directories, devices and pipes before a potentially blocking read. Decode strict
UTF-8, remove at most one leading UTF-8 BOM, and reject raw NUL. No extension-based format
selection, encoding repair, document extraction, truncation or automatic splitting occurs.

Classification uses JSON parsing, existing input normalization and the existing closed
Send input schema, in that order. Only a schema-valid object is a complete request. Keep
all of its fields and proceed through the normal validation and Core execution path.
Business failures after recognition never fall back to publishing the request as text.
The current schema has no required fields: `{}` is a request rejected later by business
validation, and attachment-only requests remain supported.

Every other valid text file becomes the exact `body`, preserving remaining whitespace,
line endings, JSON string escapes and literal `\n`. Unknown fields, incorrect types,
JSON scalars/arrays, malformed JSON and JSONL therefore become body text. A bare JSON
example exactly matching the Send schema is unavoidably treated as a request. Compatibility
is promised for valid old requests; invalid old input can now become a body. These are
implementation boundaries, not additional Agent tutorials.

| Input | Behavior |
| --- | --- |
| Body file and direct send options except `--body` | Form one request; normal business constraints apply |
| Complete request file without direct options | Preserve the entire request |
| Complete request file with any direct business option | Reject; never merge or override, even when values agree |
| `--body` with `--input-file`, or repeated `--input-file` | Reject independently of file content |
| Explicit file or direct options with inherited stdin | Do not inspect or read stdin |
| Empty/whitespace body with files | Existing attachment-only rules apply |

Final body size retains the existing 32 KiB UTF-8 byte limit. The schema's character-count
constraint and Core's byte-count validation remain separate. There is no additional raw
file cap: JSON indentation and escaping do not count toward decoded body length.

## Errors and effects

Read, encoding and input failures occur before dispatch and retain `builtin_tool.invalid_input`,
`fix_input` and exit 2. Only the complete-request/direct-options conflict adds this safe message:

```text
The input file matches a complete Send request and cannot be combined with command-line send options.
```

Other parse errors keep the existing generic message. Do not echo paths, contents or raw I/O
errors. Final schema issues use existing bounded diagnostics. Core business rejection,
indeterminate outcomes and success receipts are unchanged; no fallback, implicit notification,
attachment registration, input-file deletion or extra message is introduced.

## Teaching and Session compatibility

Send help teaches direct flags and body files only, with a raw reply example. Public Charter
revision 21 removes the universal input-source exclusion sentence; root help and
`cli-operations` remove the corresponding redundant guidance. Schema descriptions, routing,
attention, attachments, receipts, Skill metadata and Send reference remain unchanged.
No extra temporary-directory guidance or requirement is added. Exact Run tmp exclusion and
cleanup retain their current owners; arbitrary input files are not automatically cleaned up.

Bootstrap v5/formatter 5, native-binding compatibility v4/4/16/26/26, ordinary context 28 and
public batch 33 are unchanged. Existing Sessions retain frozen Bootstrap evidence and may
continue valid JSON calls. CLI capability, help and managed Skill ship together. Roll back
with matching product/CLI/Core/Skill versions; this cannot erase new teaching already in a
Native Session's history and does not guarantee that learned body-file calls work on old CLI.
