---
document_type: runtime-contract
contract: accepted-input-recovery-v3
authority: accepted-runtime-input-restart-classification-and-user-convergence
status: accepted
version: 3
last_updated: 2026-08-20
---

# Accepted Input Recovery v3

Accepted Input Recovery v3 replaces [v2](accepted-input-recovery-v2.md). Normal blocker detection, user resolution,
Stop/budget convergence, outcome-unknown handling and the prohibition on accepted-input resend remain unchanged. v3 makes
Manifest 21/View Receipt v2 the current recovery pairing and adds the Migration 100 clean break.

## Current recovery

For Formatter 21 / Manifest 21, an accepted input with unknown outcome still enters `waiting/recovery_blocked` and can only
converge under the existing evidence-aware v2 rules. A surviving View, path, Session or Host never proves prompt completion.

A dispatchable frozen Context is valid when its semantic View receipt remains an append-only ancestor. Controlled rebuild
may change root/Entry identity, operation and physical generation without invalidating the frozen Context. Before any new
or explicitly retryable dispatch, Core independently admits the current physical View and generates a current Runtime
Attachment Auth Receipt/request digest. Exact model bytes are reused; paths are not rewritten and Authority storage is
never substituted. Accepted delivery is not resent.

## Migration 100 clean break

Migration 100 applies the v2 delivery/action classification to all nonterminal Manifest 20/Receipt v1 work before current
execution admission opens:

- disproved handoff settles as cancelled/not-executed with the clean-break reason;
- prepared or delivery-unknown handoff preserves uncertainty;
- accepted or possibly effective work settles as outcome/effect unknown unless reliable terminal evidence exists;
- current Binding/Session/resume pointers are fenced without erasing historical identities.

Historical Manifest 20, Formatter 21 payload Blob, Runtime Auth Receipt/ACK, Action/Approval, Execution, Workspace/Git and
summary evidence remain byte-for-byte and non-dispatchable. New execution uses Manifest 21/Receipt v2 only. Migration 99
history and its v2 classification remain valid and are not rewritten.

The subsequent Migration 101/schema 56 publication-serialization guard does not change this classification, rewrite
historical evidence or add a recovery reader.

## References

- [Accepted Input Recovery v2](accepted-input-recovery-v2.md)
- [ContextManifest Evidence v21](context-manifest-evidence-v21.md)
- [AgentRun Recovery](../architecture/agent-run-recovery.md)
