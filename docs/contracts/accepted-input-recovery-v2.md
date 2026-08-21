---
document_type: runtime-contract
contract: accepted-input-recovery-v2
authority: accepted-runtime-input-restart-classification-and-user-convergence
status: accepted
version: 2
last_updated: 2026-08-20
---

# Accepted Input Recovery v2

Accepted Input Recovery v2 replaces [v1](accepted-input-recovery-v1.md). Normal startup blocker detection, user resolution,
Stop/budget convergence, events and the prohibition on resend remain unchanged. v2 adds the Migration 99 clean-break
classification required by Camp Published Attachment View v1.

## 1. Normal current-input recovery

For Formatter 21 / Manifest 20, an accepted input with unknown outcome still enters `waiting/recovery_blocked` and can only
converge to `failed/accepted_input_outcome_unknown` with `manualRetryAllowed=false` under the v1 command/Stop rules. Neither
a View path nor a surviving Native Session proves the prompt completed. Prepared/delivery-unknown input, Action unknown,
Runtime Delivery Checkpoint and cancellation retain their independent evidence authority.

Resume or retry must verify the exact frozen Manifest 20, Runtime Attachment Auth Receipt, Camp root identity and compatible
generation. It cannot regenerate model bytes, substitute a new View path or fall back to Authority storage.

## 2. Migration 99 one-time clean break

Migration 99 prevents all old nonterminal Formatter 20 inputs from later dispatch and classifies them by delivery/action
evidence, not merely by Run status:

| Evidence | Result |
| --- | --- |
| Prompt handoff is disproved; no accepted/delivery-unknown input or possible effect | `cancelled / camp_attachment_view_v1_clean_break` |
| Prepared handoff cannot be excluded, or delivery is unknown | `failed / input_delivery_outcome_unknown` and uncertainty retained |
| Accepted input has a reliable failed terminal | preserve that reliable failed settlement |
| Accepted outcome/tool/effect cannot be proved | `failed / accepted_input_outcome_unknown`, no manual retry |
| Action is proved not dispatched | `not_executed / camp_attachment_view_v1_clean_break`, then classify Run input |
| Action may have dispatched or is active unknown | preserve unknown effect with migration resolution source; never ordinary cancelled |

Pending/running A2A Delivery, Gather and CampTurn converge from their target Run; a never-attempted Delivery retains
`interrupted_before_dispatch`. Migration fences current Session/Binding/resume pointers while retaining their historical IDs
and monotonic generation. Historical Manifest 19, Formatter 20 payload Blob, Delivery/ACK, Action/Approval, Execution,
Git/Workspace and summary evidence remain byte-for-byte and non-dispatchable.

## References

- [Accepted Input Recovery v1](accepted-input-recovery-v1.md)
- [ContextManifest Evidence v20](context-manifest-evidence-v20.md)
- [AgentRun Recovery](../architecture/agent-run-recovery.md)
