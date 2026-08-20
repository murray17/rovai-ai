---
document_type: contract
name: Runtime Launch and Verification
version: v12
status: accepted
source_version: v1.17
last_updated: 2026-08-20
---

# Runtime Launch and Verification v12

v12 replaces [v11](runtime-launch-and-verification-v11.md). Dispatch admission, exact Camp root delivery, Auth Receipt v1,
Host schemas and `generation_fenced_v1` remain. It moves compatibility to Camp Attachment View contract 3 and requires
resolved publication state.

Before Claim, Core holds the Camp read admission and, in the same Database critical section, verifies there is no
persistent attachment writer intent. Before Host acquire/resume/input dispatch, the one verified authorization proves:

1. no `pending | recovery_required` publication operation exists;
2. the frozen Receipt v2 is an ancestor of the Runtime-available catalog;
3. available Desired entries exactly match current View receipts/filesystem;
4. the resolution digest/tombstone ledger is valid and failed attachments are excluded;
5. exact root containment and Adapter delivery remain valid.

Host compatibility uses `campAttachmentViewContractVersion: 3`; Camp/Agent/root/mode/generation/contract drift fences
reuse. Context materialization and Runtime launch receive the same Camp admission and verified authorization; neither may
reacquire the gate or rescan the View. Retry reuses frozen Formatter 21/Manifest 21 bytes and creates a current physical
authorization only after the same checks.

## References

- [Runtime Launch and Verification v11](runtime-launch-and-verification-v11.md)
- [Camp Published Attachment View v3](camp-published-attachment-view-v3.md)
- [ContextManifest Evidence v21](context-manifest-evidence-v21.md)

