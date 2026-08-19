---
document_type: contract
name: Runtime Launch and Verification
version: v10
status: accepted
source_version: v1.15
last_updated: 2026-08-20
---

# Runtime Launch and Verification v10

Runtime Launch and Verification v10 replaces [v9](runtime-launch-and-verification-v9.md). It inherits v9 model catalog,
Picker/check, Availability, explicit-model final validation, public failure, continuation and fencing. It adds the exact
Camp Published Attachment View authorization to every AgentRun launch and Host compatibility.

## 1. Dispatch admission

Before Host acquire, resume or prompt dispatch, Core must hold the current Camp attachment read admission and verify a
ready [Camp Published Attachment View v1](camp-published-attachment-view-v1.md): root identity, catalog digest, every
referenced Entry receipt and compatible generation. Workspace/root overlap is checked again at dispatch.

Every Adapter receives only the exact current Camp `attachments` root. Missing/unsupported exact-root delivery returns
`camp_attachment_view_runtime_unsupported`; there is no Authority root, instance root, `camps` parent or other-Camp
fallback. The admission guard remains held for the complete launch/run so publication, rebuild and deletion cannot mutate
the catalog while that Runtime execution is active.

## 2. Compatibility and receipts

ACP Host compatibility advances from schema 2 to schema 3; Codex Host compatibility advances from schema 1 to schema 2.
Both add:

```json
{
  "campAttachmentViewContractVersion": 1,
  "campAttachmentRoot": "/absolute/current-camp/attachments",
  "campAttachmentVisibilityMode": "generation_fenced_v1",
  "campAttachmentGeneration": 2
}
```

The process/fleet key also continues to bind exact Camp and Agent identities. One-shot Adapters freeze the same facts in
their launch receipt without inventing a reusable Host schema. Camp A/B, root, mode, generation or contract drift prevents
reuse. Formatter 21 / Manifest 20 and Auth Receipt digest remain part of the Native Binding/input compatibility chain.

Every prepared Runtime Input Delivery stores Runtime Attachment Auth Receipt v1. `requestDigest` binds its digest together
with exact model input and Binding identity; only the Runtime accepted ACK proves delivery.

## 3. Visibility mode

`generation_fenced_v1` is the default for every Adapter and platform. A successful Camp publication/rebuild makes an old
generation incompatible; the mutation gate stops/fences the old Host before promote, and the next Run uses the same Camp
root with the new generation.

`live_append_v1` may omit generation from compatibility only after a real Adapter×platform×architecture×binary Probe
demonstrates that one quiescent IdleWarm Host/Session observes two atomic appends, reads file/directory payloads, receives no
broader root and reliably stops/fences on Core loss. The Probe must separately classify same-UID sandbox strength. There is
currently no positive TRAE live-append Probe, so TRAE also uses `generation_fenced_v1`.

Windows `AdapterKind × windows-x64` rows remain `not_qualified`; implementing the private View storage does not qualify any
Runtime for Windows execution.

## 4. Recovery

Retry/recovery reuses the frozen Formatter 21 bytes and Manifest receipt; it does not resolve a new path or reselect history.
The same root/Entry identity and append-only successor relation must still hold. Root replacement, controlled rebuild,
generation mismatch, missing Entry or integrity drift fences Session/Binding and blocks dispatch rather than changing the
historical input.

## References

- [Runtime Launch and Verification v9](runtime-launch-and-verification-v9.md)
- [Camp Published Attachment View v1](camp-published-attachment-view-v1.md)
- [ContextManifest Evidence v20](context-manifest-evidence-v20.md)
- [Runtime compatibility evidence](../runtime-compatibility.md)
