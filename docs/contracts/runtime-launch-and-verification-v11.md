---
document_type: contract
name: Runtime Launch and Verification
version: v11
status: accepted
source_version: v1.15
last_updated: 2026-08-20
---

# Runtime Launch and Verification v11

Runtime Launch and Verification v11 replaces [v10](runtime-launch-and-verification-v10.md). It preserves v10 dispatch
admission, exact Camp root delivery, Host schemas, Runtime Attachment Auth Receipt v1 and `generation_fenced_v1`. It moves
Host compatibility to Camp Attachment View contract 2 and separates frozen Context semantics from current local physical
authorization.

## Dispatch and compatibility

Before Host acquire, resume or prompt dispatch, Core holds the current Camp read admission and validates:

1. the frozen Manifest 21/View Receipt v2 remains an append-only semantic ancestor;
2. the current View root, every Entry, permissions, Authority digest and physical catalog pass local integrity admission;
3. workspace/root containment and exact-root Adapter delivery remain valid.

ACP Host compatibility remains schema 3 and Codex Host compatibility remains schema 2, with the current values:

```json
{
  "campAttachmentViewContractVersion": 2,
  "campAttachmentRoot": "/absolute/current-camp/attachments",
  "campAttachmentVisibilityMode": "generation_fenced_v1",
  "campAttachmentGeneration": 4
}
```

Camp, Agent, root, mode, generation or contract drift prevents Host reuse. Every Adapter still receives only the exact
current Camp `attachments` root. Missing exact-root delivery fails with `camp_attachment_view_runtime_unsupported`; there
is no Authority, instance, `camps` parent or other-Camp fallback.

## Runtime authorization and recovery

Each prepared delivery stores a current physical Runtime Attachment Auth Receipt v1 whose
`manifestViewReceiptDigest` points to the frozen v2 semantic receipt. `requestDigest` continues to bind that Auth Receipt,
exact payload and Binding identity; accepted ACK remains the only proof of delivery.

Retry/recovery reuses exact frozen Formatter 21/Manifest 21 bytes. An append or semantics-preserving controlled rebuild may
leave the semantic receipt valid, but a physical generation/identity change still fences the old Host and requires a newly
verified physical authorization before a new dispatch. A changed stable path, content digest, kind/counts, missing Entry or
non-append-only catalog remains incompatible. Already accepted input is never replayed.

The v10 Probe requirements and absence of TRAE live-append evidence remain unchanged, so every Adapter/platform continues
to use `generation_fenced_v1`.

## References

- [Runtime Launch and Verification v10](runtime-launch-and-verification-v10.md)
- [Camp Published Attachment View v2](camp-published-attachment-view-v2.md)
- [ContextManifest Evidence v21](context-manifest-evidence-v21.md)
- [Runtime compatibility evidence](../runtime-compatibility.md)
