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
Host schemas and `generation_fenced_v1` remain. It moves compatibility to Camp Attachment View contract 3, requires
resolved publication state, and closes the TRAE machine Ready / ACP Idle Session metadata boundaries.

## TRAE machine Ready

`AvailabilityCheck` and `DispatchPreflight` MUST call the same Ready evidence builder and persisted-snapshot validator.
For TRAE `0.120.52`-class ACP integration, `ready` requires all of:

1. canonical executable path plus current executable identity/fingerprint;
2. a non-empty Runtime version observation;
3. successful ACP `initialize` with protocol version 1;
4. successful `session/new` with a non-empty Session ID;
5. a non-empty dynamic model catalog;
6. a non-empty permission/mode catalog;
7. coherent Session config shape: current model is non-empty and present in the model options, and current mode is
   non-empty and present in available modes.

The successful structured handshake classifies the snapshot as authenticated; it does not require a separate model
Prompt. `AvailabilityCheck` and dispatch MUST NOT send a system-marker Prompt, three model Prompts, a write-denial
Prompt, a sleeping shell/cancel Prompt, Tool-side-effect probes, or `session/set_config_option`. Those are independent
Adapter/version/platform behavior evidence and MUST NOT gate machine Ready. A persisted TRAE `ready` that lacks any
current requirement MUST be downgraded before reuse; a weaker check cannot write `ready` and thereby suppress dispatch
verification.

## ACP Idle Session metadata

After `session/new` has established a Session, standard Session metadata/catalog updates are legal without an Active
Prompt. The Host MUST route `available_commands_update`, `config_option_update`, `current_mode_update`,
`session_info_update`, Idle `usage_update`, and explicitly admitted Runtime lifecycle extensions as Session-scoped
metadata. They MUST stay out of Prompt output and MUST NOT set `ProtocolViolated` merely because no Prompt is active.
Unknown Session-scoped Idle messages continue to fail closed.

`available_commands_update` is Runtime-advertised catalog evidence only. It does not prove Rovai owns a file delivery
path, and it does not by itself prove that invoking a command loads a Skill. A `session/load` response also does not end
replay immediately: the Host keeps a bounded post-response settling window and quiet period, quarantines late replay,
and only then accepts the next Prompt.

## Attachment dispatch authorization

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
