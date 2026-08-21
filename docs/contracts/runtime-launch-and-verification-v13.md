---
document_type: contract
name: Runtime Launch and Verification
version: v13
status: accepted
source_version: v1.19
last_updated: 2026-08-20
---

# Runtime Launch and Verification v13

v13 replaces [v12](runtime-launch-and-verification-v12.md). Machine Ready, ACP Idle metadata, dispatch admission, exact
Camp Attachment root, View contract 3 authorization, Host schemas and `generation_fenced_v1` remain unchanged. It adds
the exact writable Run tmp to every formal Runtime launch and Host compatibility.

## Run temporary-root delivery

Every formal Agent Runtime receives exactly three model-visible filesystem scopes where supported:

```text
execution workspace                         existing workspace access
current Camp Published Attachment root      read-only product contract
current Host exact ROVAI_RUN_TMP             writable temporary output root
```

The Run tmp MUST be the same path injected into the Host environment and returned by active built-in lease
authentication. It MUST exist with private platform permissions and have completed the current lease reset before input
dispatch. The Adapter MUST NOT pass its parent, sibling process roots, another lease root, Authority attachments or other
Camp roots.

Codex includes all three in `runtimeWorkspaceRoots`; Claude Code emits a separate `--add-dir` for Run tmp; ACP Session
new/resume/load includes Attachment and Run tmp in `additionalDirectories`, and Copilot Host arguments include both
`--add-dir` values; Antigravity includes all three canonical roots. Equivalent platform-specific native admission must
preserve the same exact-root boundary.

## Compatibility and dispatch

Host compatibility uses Built-in Tool contract 19/catalog digest in addition to the unchanged Camp Attachment View
contract 3 authorization. A Host without mandatory lease reset or exact Run tmp directory delivery cannot serve v13.
Bind reset failure, missing/unsafe Run tmp or Adapter directory-delivery failure rejects launch/input before Runtime
acceptance. Context materialization, Camp attachment authorization and the single Camp read admission remain v12.

## References

- [Runtime Launch and Verification v12](runtime-launch-and-verification-v12.md)
- [Built-in Tool Transport v19](builtin-tool-transport-v19.md)
- [Camp Attachment v4](camp-attachment-v4.md)
- [Camp Published Attachment View v3](camp-published-attachment-view-v3.md)
- [V1.19-D01](../versions/v1.19/decisions.md#v1-19-d01)
